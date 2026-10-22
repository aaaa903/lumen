import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ePub from 'epubjs'
import type { Book as EpubBook, Contents, Location, Rendition } from 'epubjs'
import type {
  Annotation,
  AnnotationColor,
  AnnotationLocator,
  AnnotationTag,
  ExportPayload,
  OpenTarget,
  ShelfBook,
  Tag,
  TextSearchHit,
} from '../../shared/types'
import { buildContext, findBestQuote, findQuoteWithin, normalizeText } from '../../shared/locator'
import { parseReferenceIds } from '../../shared/references'
import { snippetQuote } from '../../shared/search-query'
import AnnotationRail from '../annotations/AnnotationRail'
import ExportDialog from '../annotations/ExportDialog'
import NoteEditor from '../annotations/NoteEditor'
import SelectionMenu from '../annotations/SelectionMenu'
import { HIGHLIGHT_COLORS } from '../annotations/colors'
import { api } from '../lib/api'
import { loadBookAsEpub } from '../lib/convert/text-epub'
import { percentLabel } from '../lib/format'
import {
  FLOW_LABEL,
  FLOW_ORDER,
  FONT_MAX,
  FONT_MIN,
  FONT_STEP,
  LINE_HEIGHT_LABEL,
  MARGIN_LABEL,
  readReaderPrefs,
  saveLastBook,
  saveReaderPrefs,
  THEME_ORDER,
  type ReaderPrefs,
} from '../lib/prefs'
import { applyReaderTheme, LINE_HEIGHT_KEYS, MARGIN_KEYS, READER_THEMES } from './theme'
import { basename, flattenToc, normalizeHref, spineFallback } from './toc'
import TocDrawer, { type TocEntry } from './TocDrawer'
import ReaderSearch from './ReaderSearch'
import { rangeFromOffsets, readSelection, type SelectionResult } from './selection'

type ReaderStatus = 'loading' | 'ready' | 'error'

type PendingProgress = {
  cfi: string | null
  href: string
  chapterIndex: number
  page: number
  percent: number
  chapterTitle: string
}

type ReaderViewProps = {
  book: ShelfBook
  /** 从搜索或标注列表进入时要跳到的位置；为空则按上次进度续读。 */
  target: OpenTarget | null
  onExit: () => void
}

const PROGRESS_DEBOUNCE_MS = 400

type ScrollableManager = { container?: HTMLElement }

/** epub.js 在滚动模式下把正文放在内部容器里；翻页要改这个容器的 scrollTop。 */
function scrolledContainer(rendition: Rendition): HTMLElement | null {
  const manager = (rendition as unknown as { manager?: ScrollableManager }).manager
  return manager?.container ?? null
}

/**
 * 把标注画成 epub.js 的 SVG 高亮。先撤掉上一轮，避免改颜色后叠两层。
 * 返回这一轮实际挂上的 CFI，供下次清理。
 */
function syncHighlights(
  rendition: Rendition,
  list: Annotation[],
  previous: string[],
  onSelect: (id: string) => void,
): string[] {
  for (const cfi of previous) {
    try {
      rendition.annotations.remove(cfi, 'highlight')
    } catch {
      // 章节已被卸载时 remove 会找不到 view，忽略即可。
    }
  }

  const attached: string[] = []
  for (const annotation of list) {
    if (annotation.kind === 'bookmark' || !annotation.locator.cfi) continue
    const color = HIGHLIGHT_COLORS[annotation.color]
    try {
      rendition.annotations.highlight(
        annotation.locator.cfi,
        { id: annotation.id },
        () => onSelect(annotation.id),
        'lumen-highlight',
        {
          fill: color.fill,
          'fill-opacity': '0.32',
          'mix-blend-mode': 'multiply',
        },
      )
      attached.push(annotation.locator.cfi)
    } catch (error) {
      console.warn('[Lumen] 高亮没有画出来', annotation.id, error)
    }
  }
  return attached
}

async function markOrphan(annotation: Annotation): Promise<Annotation> {
  const result = await api.updateAnnotation({ id: annotation.id, orphaned: true })
  return result.ok ? result.data : { ...annotation, orphaned: 1 }
}

/**
 * 打开书后逐条校验：CFI 还能取到且文字对得上就跳过；否则按 quote + 上下文
 * 在所属章节里重新找位置。找不到只标 orphaned，不删除标注。
 */
async function reanchorAnnotations(book: EpubBook, list: Annotation[]): Promise<Annotation[]> {
  const next: Annotation[] = []

  for (const annotation of list) {
    if (annotation.orphaned === 1) {
      next.push(annotation)
      continue
    }

    const locator = annotation.locator
    const quote = normalizeText(locator.quote)
    let valid = false

    if (locator.cfi) {
      try {
        const range = await book.getRange(locator.cfi)
        const rangeText = normalizeText(range.toString())
        valid = rangeText.length > 0 && (quote ? rangeText.includes(quote) || quote.includes(rangeText) : true)
      } catch {
        valid = false
      }
    }
    if (valid) {
      next.push(annotation)
      continue
    }

    // 书签没有 quote，CFI 失效后无法按文本找回，只能标记位置失效。
    if (!quote) {
      next.push(await markOrphan(annotation))
      continue
    }

    const section =
      (locator.href ? book.spine.get(locator.href) : null) ??
      book.spine.get(locator.chapterIndex)
    if (!section) {
      next.push(await markOrphan(annotation))
      continue
    }

    try {
      // Section.load 的类型声明写成同步返回 Document，实际是 Promise；这里局部断言。
      await (section.load(book.load.bind(book)) as unknown as Promise<unknown>)
      const document = section.document
      const text = document.body.textContent ?? ''
      const best = findBestQuote(text, locator.quote, locator.prefix, locator.suffix)
      const range = best ? rangeFromOffsets(document, best.start, best.end) : null
      if (!best || !range) {
        next.push(await markOrphan(annotation))
        continue
      }

      const cfi = section.cfiFromRange(range)
      const context = buildContext(text, best.start, best.end)
      const nextLocator: AnnotationLocator = {
        ...locator,
        cfi,
        href: normalizeHref(section.href || locator.href),
        quote: context.quote || locator.quote,
        prefix: context.prefix,
        suffix: context.suffix,
      }
      const result = await api.updateAnnotation({ id: annotation.id, locator: nextLocator })
      next.push(result.ok ? result.data : { ...annotation, locator: nextLocator })
    } catch (error) {
      console.warn('[Lumen] 重锚失败', annotation.id, error)
      next.push(await markOrphan(annotation))
    }
  }

  return next
}

type LoadableSection = {
  document?: Document | null
  load?: (loader: unknown) => unknown
  cfiFromRange?: (range: Range) => string
}

/** 章节里的一段原文；start / end 是章节正文的 UTF-16 下标。 */
type LocatedQuote = {
  section: LoadableSection
  document: Document
  start: number
  end: number
}

/**
 * 把「章节 + 原文片段」解析成章节内的原文区间。只加载章节取 DOM，不改变当前显示位置；
 * 找不到片段时返回 null，调用方退回到章节开头。
 */
async function locateQuote(
  book: EpubBook,
  href: string,
  chapterIndex: number,
  quote: string,
): Promise<LocatedQuote | null> {
  const cleanHref = normalizeHref(href)
  const section = (cleanHref ? book.spine.get(cleanHref) : null) ?? book.spine.get(chapterIndex)
  if (!section) return null

  const loadable = section as unknown as LoadableSection
  if (!loadable.document) {
    try {
      await (loadable.load?.(book.load.bind(book)) as unknown as Promise<unknown>)
    } catch {
      return null
    }
  }

  const document = loadable.document
  const needle = quote.trim()
  if (!document || !needle) return null

  const text = document.body.textContent ?? ''
  const best = findBestQuote(text, needle)
  if (!best) return null
  return { section: loadable, document, start: best.start, end: best.end }
}

/** 区间 → CFI；章节还没渲染过或不支持 CFI 时返回 null。 */
function cfiFromOffsets(located: LocatedQuote, start: number, end: number): string | null {
  const range = rangeFromOffsets(located.document, start, end)
  if (!range || !located.section.cfiFromRange) return null
  return located.section.cfiFromRange(range) || null
}

/** 临时高亮命中位置，6 秒后自动撤掉；章节已卸载时静默失败。 */
function highlightSearchHit(rendition: Rendition, cfi: string): void {
  try {
    rendition.annotations.highlight(cfi, { id: 'lumen-search-hit' }, undefined, 'lumen-search-hit', {
      fill: '#f2c94c',
      'fill-opacity': '0.48',
      'mix-blend-mode': 'multiply',
    })
    window.setTimeout(() => {
      try {
        rendition.annotations.remove(cfi, 'highlight')
      } catch {
        // 章节已卸载时忽略。
      }
    }, 6000)
  } catch {
    // 当前视图尚未渲染到该章时忽略，用户仍能停在正确章节。
  }
}

/**
 * 从搜索结果进入时标出命中处。找不到片段就只停在那一章，不打断阅读。
 */
async function flashSearchHit(
  rendition: Rendition,
  book: EpubBook,
  target: OpenTarget,
): Promise<void> {
  const located = await locateQuote(book, target.href, target.chapterIndex, target.quote)
  if (!located) return
  const match = target.match?.trim()
  const inner = match
    ? findQuoteWithin(
        located.document.body.textContent ?? '',
        located.start,
        located.end,
        match,
      )
    : null
  const cfi = inner
    ? cfiFromOffsets(located, inner.start, inner.end)
    : cfiFromOffsets(located, located.start, located.end)
  if (cfi) highlightSearchHit(rendition, cfi)
}

export default function ReaderView({ book, target, onExit }: ReaderViewProps) {
  const viewRef = useRef<HTMLDivElement | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const epubBookRef = useRef<EpubBook | null>(null)
  const tocRef = useRef<TocEntry[]>([])
  const spineLengthRef = useRef(0)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const pendingRef = useRef<PendingProgress | null>(null)
  const contentsRef = useRef<Contents | null>(null)
  const chapterLocatorRef = useRef<AnnotationLocator>({
    format: book.format,
    cfi: null,
    href: '',
    chapterIndex: 0,
    chapterTitle: '',
    page: 0,
    percent: 0,
    quote: '',
    prefix: '',
    suffix: '',
  })
  const highlightCfisRef = useRef<string[]>([])
  const annotationsRef = useRef<Annotation[]>([])
  const selectionRef = useRef<SelectionResult | null>(null)
  const editingIdRef = useRef<string | null>(null)
  const railOpenRef = useRef(false)
  const toastTimerRef = useRef<number | undefined>(undefined)

  const [prefs, setPrefs] = useState<ReaderPrefs>(readReaderPrefs)
  const [entries, setEntries] = useState<TocEntry[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chapterTitle, setChapterTitle] = useState('')
  const [activeHref, setActiveHref] = useState('')
  const [percent, setPercent] = useState(0)
  const [pageInfo, setPageInfo] = useState({ current: 0, total: 0 })
  const [status, setStatus] = useState<ReaderStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [railOpen, setRailOpen] = useState(false)
  const [selection, setSelection] = useState<SelectionResult | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const [toast, setToast] = useState<{ message: string; undo?: Annotation[] } | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [annotationTags, setAnnotationTags] = useState<AnnotationTag[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [exportPayload, setExportPayload] = useState<ExportPayload | null>(null)
  const [exporting, setExporting] = useState(false)

  // 异步回调与 iframe 内监听器要读最新值，闭包里的 state 会是旧的。
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const flowRef = useRef(prefs.flow)
  const bookRef = useRef(book)
  bookRef.current = book
  const tocOpenRef = useRef(tocOpen)
  tocOpenRef.current = tocOpen
  const searchOpenRef = useRef(searchOpen)
  searchOpenRef.current = searchOpen
  const settingsOpenRef = useRef(settingsOpen)
  settingsOpenRef.current = settingsOpen
  annotationsRef.current = annotations
  selectionRef.current = selection
  editingIdRef.current = editingId
  railOpenRef.current = railOpen
  const annotationTagsRef = useRef(annotationTags)
  annotationTagsRef.current = annotationTags

  const flushProgress = useCallback(async () => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null

    const result = await api.saveProgress({
      bookId: bookRef.current.id,
      locator: {
        format: bookRef.current.format,
        cfi: pending.cfi,
        href: pending.href,
        chapterIndex: pending.chapterIndex,
        chapterTitle: pending.chapterTitle,
        page: pending.page,
        percent: pending.percent,
      },
      percent: pending.percent,
      chapter: pending.chapterTitle,
    })
    if (!result.ok) console.warn('[Lumen] 进度没有保存', result.message)
  }, [])

  const queueProgress = useCallback(
    (next: PendingProgress) => {
      pendingRef.current = next
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => void flushProgress(), PROGRESS_DEBOUNCE_MS)
    },
    [flushProgress],
  )

  const turnPage = useCallback((direction: 1 | -1) => {
    const rendition = renditionRef.current
    if (!rendition) return
    setSelection(null)

    if (prefsRef.current.flow === 'scrolled') {
      const container = scrolledContainer(rendition)
      if (container) {
        const atBottom =
          container.scrollTop + container.clientHeight >= container.scrollHeight - 12
        const atTop = container.scrollTop <= 4
        // 到章节底部再翻到下一节，否则只滚动一屏。
        if (direction === 1 && atBottom) {
          void rendition.next()
          return
        }
        if (direction === -1 && atTop) {
          void rendition.prev()
          return
        }
        container.scrollBy({ top: direction * container.clientHeight * 0.88 })
        return
      }
    }

    if (direction === 1) void rendition.next()
    else void rendition.prev()
  }, [])

  const showToast = useCallback((message: string, undo?: Annotation[]) => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ message, undo })
    toastTimerRef.current = window.setTimeout(
      () => setToast(null),
      undo && undo.length > 0 ? 5000 : 2600,
    )
  }, [])

  const clearSelection = useCallback(() => {
    try {
      contentsRef.current?.window.getSelection()?.removeAllRanges()
    } catch {
      // iframe 已经卸载时拿不到 selection，忽略。
    }
    setSelection(null)
  }, [])

  const handleHighlightClick = useCallback((id: string) => {
    setSelection(null)
    setRailOpen(true)
    setEditingId(id)
  }, [])

  // epub.js 只在 relocated 时给页码；改字号或窗口尺寸只重排、不发事件，
  // 底部会一直停在旧分母，所以这两个动作之后主动读一次 currentLocation。
  const refreshPageInfo = useCallback((rendition: Rendition) => {
    const current = rendition.currentLocation() as unknown as Location | undefined
    const displayed = current?.start?.displayed
    if (!displayed) return
    setPageInfo({ current: displayed.page ?? 0, total: displayed.total ?? 0 })
  }, [])

  const createFromSelection = useCallback(
    async (color: AnnotationColor, openNote: boolean) => {
      const current = selectionRef.current
      if (!current) return

      const groupId = current.locators.length > 1 ? crypto.randomUUID() : null
      const created: Annotation[] = []
      let failure = ''

      for (const locator of current.locators) {
        const result = await api.createAnnotation({
          bookId: bookRef.current.id,
          kind: 'highlight',
          color,
          locator,
          noteMd: '',
          groupId,
        })
        if (result.ok) created.push(result.data)
        else {
          failure = result.message
          break
        }
      }

      clearSelection()
      if (created.length === 0) {
        if (failure) showToast(failure)
        return
      }

      setAnnotations((previous) => [...previous, ...created])
      if (openNote) {
        setRailOpen(true)
        setEditingId(created[0].id)
      }
      showToast(created.length > 1 ? `已标记 ${created.length} 段` : '已高亮')
    },
    [clearSelection, showToast],
  )

  const handleCopySelection = useCallback(async () => {
    const current = selectionRef.current
    if (!current) return
    const text = current.locators.map((locator) => locator.quote).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制选中文字')
    } catch {
      showToast('复制没有成功，请用 Ctrl+C。')
    }
    clearSelection()
  }, [clearSelection, showToast])

  const addBookmark = useCallback(async () => {
    const current = chapterLocatorRef.current
    if (!current.cfi) {
      showToast('正文还在排版，稍后再加书签。')
      return
    }

    const result = await api.createAnnotation({
      bookId: bookRef.current.id,
      kind: 'bookmark',
      color: 'slate',
      locator: { ...current, quote: '', prefix: '', suffix: '' },
      noteMd: '',
      groupId: null,
    })
    if (!result.ok) {
      showToast(result.message)
      return
    }
    setAnnotations((previous) => [...previous, result.data])
    setRailOpen(true)
    setEditingId(result.data.id)
    showToast('已加书签')
  }, [showToast])

  const handleSelectAnnotation = useCallback(
    (annotation: Annotation, draft?: { color: AnnotationColor; noteMd: string }) => {
      // 从批注编辑器跳到另一条标注时，先把草稿落库；不关闭编辑器，交给下面的 setEditingId 换人。
      const currentId = editingIdRef.current
      if (draft && currentId && currentId !== annotation.id) {
        void api
          .updateAnnotation({ id: currentId, color: draft.color, noteMd: draft.noteMd })
          .then((result) => {
            if (!result.ok) return
            setAnnotations((previous) =>
              previous.map((item) => (item.id === currentId ? result.data : item)),
            )
          })
      }

      setSelection(null)
      setRailOpen(true)
      setEditingId(annotation.id)
      if (annotation.orphaned === 1 || !annotation.locator.cfi) return
      const rendition = renditionRef.current
      if (!rendition) return
      void Promise.resolve(rendition.display(annotation.locator.cfi)).catch((error: unknown) => {
        console.warn('[Lumen] 标注跳转失败', annotation.id, error)
      })
    },
    [],
  )

  const saveNote = useCallback(
    async (patch: { color: AnnotationColor; noteMd: string }) => {
      const id = editingIdRef.current
      if (!id) return
      setSavingNote(true)
      try {
        const result = await api.updateAnnotation({ id, color: patch.color, noteMd: patch.noteMd })
        if (!result.ok) {
          showToast(result.message)
          return
        }
        setAnnotations((previous) =>
          previous.map((annotation) => (annotation.id === id ? result.data : annotation)),
        )
        setEditingId(null)
        showToast('批注已保存')
      } finally {
        setSavingNote(false)
      }
    },
    [showToast],
  )

  const deleteAnnotation = useCallback(
    async (annotation: Annotation) => {
      // 跨段落高亮共用 groupId，删一条就整组删掉，避免留下半截。
      const targets = annotation.groupId
        ? annotationsRef.current.filter((item) => item.groupId === annotation.groupId)
        : [annotation]
      const removed: Annotation[] = []

      for (const target of targets) {
        const result = await api.deleteAnnotation(target.id)
        if (result.ok) removed.push(result.data)
      }
      if (removed.length === 0) {
        showToast('删除没有完成，请重试。')
        return
      }

      const removedIds = new Set(removed.map((item) => item.id))
      setAnnotations((previous) => previous.filter((item) => !removedIds.has(item.id)))
      if (editingIdRef.current && removedIds.has(editingIdRef.current)) setEditingId(null)
      showToast(removed.length > 1 ? `已删除 ${removed.length} 段标注` : '已删除标注', removed)
    },
    [showToast],
  )

  const undoDelete = useCallback(async () => {
    const targets = toast?.undo
    if (!targets || targets.length === 0) return
    const restored: Annotation[] = []
    for (const target of targets) {
      const result = await api.restoreAnnotation(target.id)
      if (result.ok) restored.push(result.data)
    }
    window.clearTimeout(toastTimerRef.current)
    setToast(null)
    if (restored.length > 0) {
      setAnnotations((previous) => [...previous, ...restored])
      showToast('已撤销删除')
    }
  }, [showToast, toast])

  // 退出前先落库，否则最后一次翻页会丢，书架上的百分比会落后一截。
  const exitReader = useCallback(async () => {
    try {
      await flushProgress()
    } finally {
      onExit()
    }
  }, [flushProgress, onExit])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        // 输入框里的方向键与空格属于光标操作，不能触发翻页。
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        void addBookmark()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        if (!editingIdRef.current) setRailOpen(true)
        return
      }
      if (
        bookRef.current.format !== 'pdf' &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault()
        setTocOpen(false)
        setSettingsOpen(false)
        setSearchOpen(true)
        return
      }

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          event.preventDefault()
          turnPage(1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault()
          turnPage(-1)
          break
        case 'Escape':
          if (selectionRef.current) {
            setSelection(null)
          } else if (editingIdRef.current) {
            setEditingId(null)
          } else if (railOpenRef.current) {
            setRailOpen(false)
          } else if (settingsOpenRef.current) {
            setSettingsOpen(false)
          } else if (tocOpenRef.current) {
            setTocOpen(false)
          } else if (searchOpenRef.current) {
            setSearchOpen(false)
          } else {
            void exitReader()
          }
          break
        default:
          break
      }
    },
    [addBookmark, exitReader, turnPage],
  )

  // 键盘要注册两处：焦点在 iframe 内时事件不会冒泡到父窗口。
  const keyHandlerRef = useRef(handleKeyDown)
  keyHandlerRef.current = handleKeyDown

  useEffect(() => {
    saveLastBook(book.id)
  }, [book.id])

  const refreshTags = useCallback(async () => {
    const [tagResult, assignmentResult] = await Promise.all([
      api.listTags(),
      api.listAnnotationTags(book.id),
    ])
    if (tagResult.ok) setTags(tagResult.data)
    if (assignmentResult.ok) setAnnotationTags(assignmentResult.data)
  }, [book.id])

  useEffect(() => {
    void refreshTags()
  }, [refreshTags])

  const toggleAnnotationTag = useCallback(
    async (tagId: string) => {
      const id = editingIdRef.current
      if (!id) return

      const current = annotationTagsRef.current
        .filter((item) => item.annotationId === id)
        .map((item) => item.tagId)
      const next = current.includes(tagId)
        ? current.filter((item) => item !== tagId)
        : [...current, tagId]

      const result = await api.setAnnotationTags(id, next)
      if (!result.ok) {
        showToast(result.message)
        return
      }
      setAnnotationTags((previous) => [
        ...previous.filter((item) => item.annotationId !== id),
        ...next.map((tagIdValue) => ({ annotationId: id, tagId: tagIdValue })),
      ])
      void refreshTags()
    },
    [refreshTags, showToast],
  )

  const createTagForAnnotation = useCallback(
    async (name: string) => {
      const result = await api.createTag(name)
      if (!result.ok) {
        showToast(result.message)
        return
      }

      const id = editingIdRef.current
      if (id) {
        const current = annotationTagsRef.current
          .filter((item) => item.annotationId === id)
          .map((item) => item.tagId)
        const next = [...current, result.data.id]
        const assigned = await api.setAnnotationTags(id, next)
        if (!assigned.ok) {
          showToast(assigned.message)
          return
        }
        setAnnotationTags((previous) => [
          ...previous.filter((item) => item.annotationId !== id),
          ...next.map((tagIdValue) => ({ annotationId: id, tagId: tagIdValue })),
        ])
      }

      await refreshTags()
      showToast(`已添加标签「${result.data.name}」`)
    },
    [refreshTags, showToast],
  )

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const runExport = useCallback(
    async (ids: string[] | null) => {
      setExporting(true)
      try {
        const result = await api.exportAnnotations({
          bookId: bookRef.current.id,
          ids: ids && ids.length > 0 ? ids : undefined,
        })
        if (!result.ok) {
          showToast(result.message)
          return
        }
        setExportPayload(result.data)
      } finally {
        setExporting(false)
      }
    },
    [showToast],
  )

  const copyExport = useCallback(async () => {
    if (!exportPayload) return
    try {
      await navigator.clipboard.writeText(exportPayload.markdown)
      showToast('已复制 Markdown')
    } catch {
      showToast('复制没有成功，请选中文本后按 Ctrl+C。')
    }
  }, [exportPayload, showToast])

  const saveExport = useCallback(async () => {
    if (!exportPayload) return
    const result = await api.saveText({
      suggestedName: `${bookRef.current.title}-标注.md`,
      content: exportPayload.markdown,
    })
    if (!result.ok) {
      showToast(result.message)
      return
    }
    if (result.data) {
      setExportPayload(null)
      showToast('已保存 Markdown 文件')
    }
  }, [exportPayload, showToast])

  useEffect(() => {
    let disposed = false
    let rendition: Rendition | null = null
    let epubBook: EpubBook | null = null
    let resizeTimer: number | undefined
    let locationsTimer: number | undefined

    const resolveChapter = (href: string, index: number): TocEntry => {
      const target = normalizeHref(href)
      const match = tocRef.current.find(
        (entry) => entry.href === target || basename(entry.href) === basename(target),
      )
      if (match) return match
      return { label: `第 ${index + 1} 节`, href: target, depth: 0 }
    }

    const setup = async () => {
      try {
        const bytes = await loadBookAsEpub(bookRef.current)
        if (disposed) return

        epubBook = ePub(bytes)
        await epubBook.ready
        if (disposed) return
        epubBookRef.current = epubBook

        const navigation = await epubBook.loaded.navigation
        if (disposed) return

        const flat = flattenToc(navigation.toc)
        const tocEntries = flat.length > 0 ? flat : spineFallback(epubBook)
        tocRef.current = tocEntries
        setEntries(tocEntries)

        const spineItems = (epubBook.spine as unknown as { spineItems?: unknown[] }).spineItems
        spineLengthRef.current = spineItems?.length ?? 0

        const container = viewRef.current
        if (!container) return

        rendition = epubBook.renderTo(container, {
          width: '100%',
          height: '100%',
          flow: prefsRef.current.flow === 'scrolled' ? 'scrolled-doc' : 'paginated',
          spread: 'none',
          allowScriptedContent: false,
        })
        renditionRef.current = rendition
        ;(window as unknown as { __lumenRendition?: Rendition }).__lumenRendition = rendition

        // 主题必须在 renderTo 之后注册，否则作用不到还不存在的 contents。
        applyReaderTheme(rendition, prefsRef.current)

        rendition.hooks.content.register((contents: Contents) => {
          contentsRef.current = contents
          contents.document.addEventListener('keydown', (event: KeyboardEvent) => {
            keyHandlerRef.current(event)
          })
          contents.document.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as HTMLElement | null
            const anchor = target?.closest?.('a')
            if (!anchor) return
            const href = anchor.getAttribute('href') ?? ''
            // 书内锚点照常跳转；外部地址一律拦下——应用不打开任何网络地址。
            if (/^(?:https?:|mailto:|tel:)/i.test(href)) event.preventDefault()
          })
        })

        rendition.on('relocated', (location: Location) => {
          if (disposed) return
          const start = location.start
          const chapter = resolveChapter(start.href, start.index)
          const displayed = start.displayed
          const pageFraction =
            displayed && displayed.total > 0 ? Math.min(1, displayed.page / displayed.total) : 0
          const spineLength = spineLengthRef.current || 1
          const estimate = Math.min(1, (start.index + pageFraction) / spineLength)
          // 定位表生成前 start.percentage 为 0，先用「章节序号 + 本章页码」估算。
          const nextPercent = start.percentage && start.percentage > 0 ? start.percentage : estimate

          setActiveHref(chapter.href)
          setChapterTitle(chapter.label)
          setPercent(nextPercent)
          setPageInfo({ current: displayed?.page ?? 0, total: displayed?.total ?? 0 })
          setSelection(null)
          chapterLocatorRef.current = {
            format: bookRef.current.format,
            cfi: start.cfi ?? null,
            href: chapter.href,
            chapterIndex: start.index,
            chapterTitle: chapter.label,
            page: displayed?.page ?? 0,
            percent: nextPercent,
            quote: '',
            prefix: '',
            suffix: '',
          }

          queueProgress({
            cfi: start.cfi ?? null,
            href: chapter.href,
            chapterIndex: start.index,
            page: displayed?.page ?? 0,
            percent: nextPercent,
            chapterTitle: chapter.label,
          })
        })

        rendition.on('selected', (_cfiRange: string, contents: Contents) => {
          if (disposed) return
          contentsRef.current = contents
          try {
            setSelection(
              readSelection(contents, chapterLocatorRef.current, bookRef.current.format),
            )
          } catch (error) {
            console.warn('[Lumen] 读取选区失败', error)
            setSelection(null)
          }
        })

        const saved = await api.getProgress(book.id)
        if (disposed) return
        const startCfi = saved.ok ? saved.data?.locator.cfi ?? null : null

        const listed = await api.listAnnotations(book.id)
        if (disposed) return
        const initialAnnotations = listed.ok ? listed.data : []
        if (listed.ok) setAnnotations(initialAnnotations)
        else console.warn('[Lumen] 标注读取失败', listed.message)

        // 从搜索进入时直接跳到命中章节；否则按上次进度续读。
        const jumpTarget = target && target.bookId === bookRef.current.id ? target : null
        if (jumpTarget && jumpTarget.href) {
          // 检索命中时直接落到原文片段，而不是只跳到章节开头。
          const located = epubBook
            ? await locateQuote(
                epubBook,
                jumpTarget.href,
                jumpTarget.chapterIndex,
                jumpTarget.quote,
              )
            : null
          const jumpCfi = located ? cfiFromOffsets(located, located.start, located.end) : null
          const fallbackHref = normalizeHref(jumpTarget.href)
          try {
            await rendition.display(jumpCfi ?? (fallbackHref.length > 0 ? fallbackHref : undefined))
          } catch {
            await rendition.display(startCfi ?? undefined)
          }
        } else {
          try {
            await rendition.display(startCfi ?? undefined)
          } catch {
            // 存下的 CFI 可能因文件被改写而失效，退回首页而不是让整本书打不开。
            await rendition.display()
          }
        }
        if (disposed) return
        setStatus('ready')

        if (jumpTarget) {
          void flashSearchHit(rendition, epubBook, jumpTarget)
        }

        // 重锚不阻塞首屏：先显示正文，再逐条核对 CFI / 原文片段。
        if (initialAnnotations.length > 0) {
          void reanchorAnnotations(epubBook, initialAnnotations)
            .then((checked) => {
              if (!disposed) setAnnotations(checked)
            })
            .catch((error: unknown) => {
              console.warn('[Lumen] 标注校验失败', error)
            })
        }

        // 索引统一交给隐藏窗口；这里只排队，避免前台阅读器和后台任务重复写同一本书。
        if (bookRef.current.indexedAt === null && bookRef.current.format !== 'pdf') {
          void api.requestIndex(bookRef.current.id)
        }

        // 章节定位表比较耗时，等首屏稳定后在后台生成，只用于更精确的百分比。
        locationsTimer = window.setTimeout(() => {
          if (disposed || !epubBook) return
          void epubBook.locations
            .generate(1600)
            .then(() => {
              if (disposed || !epubBook) return
              // epub.js 的类型把 currentLocation 标成 DisplayedLocation，实际返回 { start, end }。
              // 这里做一次局部断言，不去改 node_modules 的类型。
              const current = renditionRef.current?.currentLocation() as unknown as
                | Location
                | undefined
              const cfi = current?.start?.cfi
              if (!cfi) return
              const precise = epubBook.locations.percentageFromCfi(cfi)
              if (!Number.isFinite(precise) || precise <= 0) return
              setPercent(precise)
              const pending = pendingRef.current
              if (pending) queueProgress({ ...pending, percent: precise })
            })
            .catch(() => undefined)
        }, 1200)
      } catch (error) {
        if (disposed) return
        setErrorMessage(error instanceof Error ? error.message : '未知错误')
        setStatus('error')
      }
    }

    void setup()

    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        const element = viewRef.current
        if (!element || !rendition) return
        try {
          // 必须传显式尺寸，不传会沿用旧尺寸，缩窗后正文被裁。
          rendition.resize(element.clientWidth, element.clientHeight)
          refreshPageInfo(rendition)
        } catch {
          // 排版尚未就绪时忽略。
        }
      }, 220)
    })
    if (viewRef.current) observer.observe(viewRef.current)

    const onWindowKeyDown = (event: KeyboardEvent) => keyHandlerRef.current(event)
    window.addEventListener('keydown', onWindowKeyDown)

    return () => {
      disposed = true
      window.clearTimeout(resizeTimer)
      window.clearTimeout(locationsTimer)
      window.clearTimeout(saveTimerRef.current)
      window.clearTimeout(toastTimerRef.current)
      observer.disconnect()
      window.removeEventListener('keydown', onWindowKeyDown)
      void flushProgress()
      contentsRef.current = null
      highlightCfisRef.current = []
      renditionRef.current = null
      epubBookRef.current = null
      // 顺序不能反：先 rendition 再 book，各自兜住异常，避免留下 iframe。
      try {
        rendition?.destroy()
      } catch {
        // 未渲染完成时销毁会抛，忽略。
      }
      try {
        epubBook?.destroy()
      } catch {
        // 同上。
      }
    }
  }, [book.id, flushProgress, queueProgress, refreshPageInfo])

  // 标注变化后重画当前视图的高亮；章节切换时 epub.js 会自动把已注册的标注挂到新视图。
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition || status !== 'ready') return
    highlightCfisRef.current = syncHighlights(
      rendition,
      annotations,
      highlightCfisRef.current,
      handleHighlightClick,
    )
  }, [annotations, status, handleHighlightClick])

  // 删除标注后把已选项收敛到仍存在的条目，避免导出时 ids 指向已删除的记录。
  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) return previous
      const valid = new Set(annotations.map((annotation) => annotation.id))
      const next = new Set([...previous].filter((id) => valid.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [annotations])

  // 偏好变化立即写 localStorage 并作用到当前 contents。
  useEffect(() => {
    saveReaderPrefs(prefs)
    const rendition = renditionRef.current
    if (!rendition) return
    applyReaderTheme(rendition, prefs)
    // 字号/行距/页边距改变会重排，但不会触发 relocated，这里补一次页码刷新。
    const timer = window.setTimeout(() => refreshPageInfo(rendition), 240)
    return () => window.clearTimeout(timer)
  }, [prefs, refreshPageInfo])

  // 切换分页/滚动：epub.js 会重排并回到当前位置；页码只在分页模式有意义。
  useEffect(() => {
    if (flowRef.current === prefs.flow) return
    flowRef.current = prefs.flow
    const rendition = renditionRef.current
    if (!rendition) return
    try {
      rendition.flow(prefs.flow === 'scrolled' ? 'scrolled-doc' : 'paginated')
      const timer = window.setTimeout(() => refreshPageInfo(rendition), 260)
      return () => window.clearTimeout(timer)
    } catch (error) {
      console.warn('[Lumen] 切换阅读模式失败', error)
    }
  }, [prefs.flow, refreshPageInfo])

  const updatePrefs = (patch: Partial<ReaderPrefs>) => {
    setPrefs((current) => ({ ...current, ...patch }))
  }

  const goTo = (href: string) => {
    setTocOpen(false)
    const rendition = renditionRef.current
    if (!rendition) return
    void Promise.resolve(rendition.display(href)).catch((error: unknown) => {
      console.warn('[Lumen] 目录跳转失败', href, error)
    })
  }

  const chapterIndex = entries.findIndex((entry) => entry.href === activeHref)
  const editingAnnotation = editingId
    ? annotations.find((annotation) => annotation.id === editingId) ?? null
    : null

  /** 反向引用：哪几条批注的正文里引用了某条标注。引用关系只存在 Markdown 里。 */
  const backrefsByTarget = useMemo(() => {
    const map = new Map<string, Annotation[]>()
    for (const source of annotations) {
      for (const targetId of parseReferenceIds(source.noteMd)) {
        if (targetId === source.id) continue
        const list = map.get(targetId) ?? []
        list.push(source)
        map.set(targetId, list)
      }
    }
    return map
  }, [annotations])

  const goChapter = (step: 1 | -1) => {
    const next = entries[chapterIndex + step]
    if (next) goTo(next.href)
  }

  const jumpToSearchHit = useCallback(async (hit: TextSearchHit) => {
    const rendition = renditionRef.current
    const epubBook = epubBookRef.current
    if (!rendition) return

    // 先按片段（带前后文）定位到命中段落，再把范围缩到命中的那几个字：
    // 只拿命中词去搜，同一章里的重复词会把读者带到第一处。
    const matched = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)
    let cfi: string | null = null
    if (epubBook) {
      const located = await locateQuote(
        epubBook,
        hit.href,
        hit.chapterIndex,
        snippetQuote(hit.snippet),
      )
      if (located) {
        const inner = matched
          ? findQuoteWithin(
              located.document.body.textContent ?? '',
              located.start,
              located.end,
              matched,
            )
          : null
        cfi = inner
          ? cfiFromOffsets(located, inner.start, inner.end)
          : cfiFromOffsets(located, located.start, located.end)
      }
    }

    const fallback = normalizeHref(hit.href)
    try {
      // 有 CFI 就落到命中处；片段对不上时退回章节开头，不让点击变成无反应。
      await rendition.display(cfi ?? (fallback.length > 0 ? fallback : undefined))
    } catch (error) {
      console.warn('[Lumen] 书内搜索跳转失败', hit.href, error)
    }
    setSearchOpen(false)
    if (cfi) highlightSearchHit(rendition, cfi)
  }, [])

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      // 系统拒绝时静默，不打断阅读。
    }
  }

  const colors = READER_THEMES[prefs.theme]

  return (
    <div className={`reader ${colors.night ? 'is-night' : ''}`} data-theme={prefs.theme}>
      <header className="reader-head">
        <button type="button" className="ghost-btn" onClick={() => void exitReader()} title="返回书架">
          ← 书架
        </button>
        <div className="reader-title">
          <span className="reader-book" title={book.title}>
            {book.title}
          </span>
          {chapterTitle && <span className="reader-chapter">{chapterTitle}</span>}
        </div>
        <div className="reader-actions">
          {book.format !== 'pdf' && (
            <button
              type="button"
              className={`icon-btn ${searchOpen ? 'is-active' : ''}`}
              onClick={() => {
                setSearchOpen((open) => !open)
                setTocOpen(false)
                setSettingsOpen(false)
              }}
              title="书内搜索（Ctrl+F）"
            >
              搜索
            </button>
          )}
          <button
            type="button"
            className={`icon-btn ${railOpen ? 'is-active' : ''}`}
            onClick={() => setRailOpen((open) => !open)}
            title="本书标注（Ctrl+E）"
          >
            标注
            {annotations.length > 0 && <span className="icon-count">{annotations.length}</span>}
          </button>
          <button type="button" className="icon-btn" onClick={() => void addBookmark()} title="书签（Ctrl+B）">
            书签
          </button>
          <button
            type="button"
            className={`icon-btn ${tocOpen ? 'is-active' : ''}`}
            onClick={() => {
              setTocOpen((open) => !open)
              setSearchOpen(false)
              setSettingsOpen(false)
            }}
            title="目录"
          >
            目录
          </button>
          <button
            type="button"
            className={`icon-btn ${settingsOpen ? 'is-active' : ''}`}
            onClick={() => {
              setSettingsOpen((open) => !open)
              setSearchOpen(false)
              setTocOpen(false)
            }}
            title="排版"
          >
            排版
          </button>
          <button type="button" className="icon-btn" onClick={() => void toggleFullscreen()} title="全屏">
            ⛶
          </button>
        </div>
      </header>

      <div className="reader-stage" style={{ background: colors.bg }}>
        <div className="reader-view" ref={viewRef} />
        <button
          type="button"
          className="page-zone page-zone--prev"
          aria-label="上一页"
          onClick={() => turnPage(-1)}
        />
        <button
          type="button"
          className="page-zone page-zone--next"
          aria-label="下一页"
          onClick={() => turnPage(1)}
        />

        {status !== 'ready' && (
          <div className="reader-overlay">
            {status === 'loading' ? (
              <p className="reader-loading">正在排版…</p>
            ) : (
              <div className="reader-error">
                <p>打不开这本书：{errorMessage}</p>
                <button type="button" className="ghost-btn" onClick={() => void exitReader()}>
                  返回书架
                </button>
              </div>
            )}
          </div>
        )}

        {settingsOpen && (
          <div className="reader-settings" role="dialog" aria-label="排版设置">
            <div className="setting-row">
              <span className="setting-label">字号</span>
              <div className="setting-group">
                <button
                  type="button"
                  className="setting-btn"
                  onClick={() => updatePrefs({ fontSize: Math.max(FONT_MIN, prefs.fontSize - FONT_STEP) })}
                  disabled={prefs.fontSize <= FONT_MIN}
                  title="缩小字号"
                >
                  A−
                </button>
                <span className="setting-value">{prefs.fontSize}%</span>
                <button
                  type="button"
                  className="setting-btn"
                  onClick={() => updatePrefs({ fontSize: Math.min(FONT_MAX, prefs.fontSize + FONT_STEP) })}
                  disabled={prefs.fontSize >= FONT_MAX}
                  title="放大字号"
                >
                  A+
                </button>
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">行距</span>
              <div className="setting-group">
                {LINE_HEIGHT_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`setting-btn ${prefs.lineHeight === key ? 'is-active' : ''}`}
                    onClick={() => updatePrefs({ lineHeight: key })}
                  >
                    {LINE_HEIGHT_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">页边距</span>
              <div className="setting-group">
                {MARGIN_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`setting-btn ${prefs.margin === key ? 'is-active' : ''}`}
                    onClick={() => updatePrefs({ margin: key })}
                  >
                    {MARGIN_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">翻页方式</span>
              <div className="setting-group">
                {FLOW_ORDER.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`setting-btn ${prefs.flow === key ? 'is-active' : ''}`}
                    onClick={() => updatePrefs({ flow: key })}
                  >
                    {FLOW_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">配色</span>
              <div className="setting-group">
                {THEME_ORDER.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`swatch ${prefs.theme === key ? 'is-active' : ''}`}
                    style={{ background: READER_THEMES[key].bg, color: READER_THEMES[key].fg }}
                    onClick={() => updatePrefs({ theme: key })}
                    title={READER_THEMES[key].label}
                  >
                    {READER_THEMES[key].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tocOpen && (
          <TocDrawer
            entries={entries}
            activeHref={activeHref}
            onSelect={goTo}
            onClose={() => setTocOpen(false)}
          />
        )}

        {searchOpen && book.format !== 'pdf' && (
          <ReaderSearch
            bookId={book.id}
            indexed={book.indexedAt !== null}
            onJump={(hit) => void jumpToSearchHit(hit)}
            onClose={() => setSearchOpen(false)}
          />
        )}

        {selection && (
          <SelectionMenu
            anchor={selection.anchor}
            onHighlight={(color) => void createFromSelection(color, false)}
            onNote={() => void createFromSelection('yellow', true)}
            onCopy={() => void handleCopySelection()}
            onClose={() => setSelection(null)}
          />
        )}

        {editingAnnotation ? (
          <NoteEditor
            key={editingAnnotation.id}
            annotation={editingAnnotation}
            saving={savingNote}
            tags={tags}
            assignedTagIds={annotationTags
              .filter((item) => item.annotationId === editingAnnotation.id)
              .map((item) => item.tagId)}
            bookAnnotations={annotations}
            backrefs={backrefsByTarget.get(editingAnnotation.id) ?? []}
            onToggleTag={(tagId) => void toggleAnnotationTag(tagId)}
            onCreateTag={(name) => void createTagForAnnotation(name)}
            onSave={(patch) => void saveNote(patch)}
            onOpenAnnotation={handleSelectAnnotation}
            onDelete={() => void deleteAnnotation(editingAnnotation)}
            onClose={() => setEditingId(null)}
          />
        ) : (
          railOpen && (
            <AnnotationRail
              annotations={annotations}
              backrefs={backrefsByTarget}
              activeId={editingId}
              selectedIds={selectedIds}
              exporting={exporting}
              onToggleSelect={toggleSelect}
              onExport={(ids) => void runExport(ids)}
              onSelect={handleSelectAnnotation}
              onDelete={(annotation) => void deleteAnnotation(annotation)}
              onClose={() => setRailOpen(false)}
            />
          )
        )}

        {toast && (
          <div className="reader-toast" role="status">
            <span>{toast.message}</span>
            {toast.undo && toast.undo.length > 0 && (
              <button type="button" className="toast-undo" onClick={() => void undoDelete()}>
                撤销
              </button>
            )}
          </div>
        )}

        {exportPayload && (
          <ExportDialog
            payload={exportPayload}
            onSave={() => void saveExport()}
            onCopy={() => void copyExport()}
            onClose={() => setExportPayload(null)}
          />
        )}
      </div>

      <footer className="reader-foot">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${Math.max(1, percent * 100)}%` }} />
        </div>
        <span className="progress-text">{percentLabel(percent)}</span>
        {prefs.flow === 'paginated' && pageInfo.total > 0 && (
          <span className="page-text">
            第 {pageInfo.current} / {pageInfo.total} 页
          </span>
        )}
        <div className="chapter-nav">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => goChapter(-1)}
            disabled={chapterIndex <= 0}
            title="上一章"
          >
            上一章
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => goChapter(1)}
            disabled={chapterIndex < 0 || chapterIndex >= entries.length - 1}
            title="下一章"
          >
            下一章
          </button>
        </div>
      </footer>
    </div>
  )
}
