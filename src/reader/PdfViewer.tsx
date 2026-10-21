import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { GlobalWorkerOptions, TextLayer, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type {
  Annotation,
  AnnotationColor,
  AnnotationLocator,
  AnnotationTag,
  ExportPayload,
  Locator,
  OpenTarget,
  ShelfBook,
  Tag,
} from '../../shared/types'
import { buildContext, findBestQuote, normalizeText } from '../../shared/locator'
import AnnotationRail from '../annotations/AnnotationRail'
import ExportDialog from '../annotations/ExportDialog'
import NoteEditor from '../annotations/NoteEditor'
import SelectionMenu from '../annotations/SelectionMenu'
import { HIGHLIGHT_COLORS } from '../annotations/colors'
import { api } from '../lib/api'
import { percentLabel } from '../lib/format'
import {
  readReaderPrefs,
  saveLastBook,
  saveReaderPrefs,
  THEME_ORDER,
  type ReaderPrefs,
} from '../lib/prefs'
import { READER_THEMES } from './theme'
import TocDrawer, { type TocEntry } from './TocDrawer'

GlobalWorkerOptions.workerSrc = workerUrl

type PdfDocument = Awaited<ReturnType<typeof getDocument>['promise']>
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>
type RenderTask = ReturnType<PdfPage['render']>

type PdfViewerProps = {
  book: ShelfBook
  /** 从标注搜索进入时要跳到的页码；为空则按上次进度续读。 */
  target: OpenTarget | null
  onExit: () => void
}

type PdfStatus = 'loading' | 'ready' | 'error'

type PendingProgress = {
  href: string
  chapterIndex: number
  chapterTitle: string
  page: number
  percent: number
}

type PdfSelection = {
  locators: AnnotationLocator[]
  anchor: { left: number; right: number; top: number; bottom: number }
}

type TextNodeEntry = { node: Text; start: number }

type RawOutlineNode = {
  title: string
  dest: string | unknown[] | null
  items?: RawOutlineNode[]
}

const PROGRESS_DEBOUNCE_MS = 400
const ZOOM_MIN = 0.6
const ZOOM_MAX = 2.2
const ZOOM_STEP = 0.15
const PAGE_GAP = 18
const PAGE_PADDING = 32
/** 一次只校验这么多条，避免打开上千条标注的书时卡住。 */
const VALIDATE_LIMIT = 200

const PDF_RESOURCE_BASE = new URL('pdfjs/', document.baseURI).toString()

function parsePageHref(href: string): number | null {
  const match = /^page-(\d+)$/.exec(href)
  if (!match) return null
  const page = Number(match[1])
  return Number.isFinite(page) && page > 0 ? page : null
}

function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, total))
}

/** 当前页落在哪一节：取最后一个起始页不晚于当前页的目录项。 */
function labelForPage(entries: TocEntry[], page: number): string {
  let label = `第 ${page} 页`
  for (const entry of entries) {
    const entryPage = parsePageHref(entry.href)
    if (entryPage === null) continue
    if (entryPage > page) break
    label = entry.label
  }
  return label
}

function activeHrefForPage(entries: TocEntry[], page: number): string {
  let active = ''
  for (const entry of entries) {
    const entryPage = parsePageHref(entry.href)
    if (entryPage === null) continue
    if (entryPage > page) break
    active = entry.href
  }
  return active
}

function collectTextNodes(root: HTMLElement): TextNodeEntry[] {
  const result: TextNodeEntry[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let offset = 0
  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    result.push({ node: text, start: offset })
    offset += text.data.length
    node = walker.nextNode()
  }
  return result
}

/** 把文本层里的字符区间还原成 Range；高亮靠它算方块位置。 */
function rangeFromNodes(nodes: TextNodeEntry[], start: number, end: number): Range | null {
  if (end <= start) return null
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (const entry of nodes) {
    const next = entry.start + entry.node.data.length
    if (!startNode && start < next) {
      startNode = entry.node
      startOffset = Math.max(0, start - entry.start)
    }
    if (startNode && end <= next) {
      endNode = entry.node
      endOffset = Math.min(entry.node.data.length, end - entry.start)
      break
    }
  }

  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

function readTitleAuthor(meta: { info?: unknown } | null): { title: string; author: string } {
  const info = meta?.info as { Title?: unknown; Author?: unknown } | undefined
  const title = typeof info?.Title === 'string' ? info.Title.trim() : ''
  const author = typeof info?.Author === 'string' ? info.Author.trim() : ''
  return { title, author }
}

function errorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name
  if (name === 'PasswordException') return '这份 PDF 有密码，暂不支持打开。'
  if (name === 'InvalidPDFException') return '文件不是有效的 PDF，确认它没有损坏。'
  return error instanceof Error ? error.message : '未知错误'
}

async function markOrphan(annotation: Annotation): Promise<Annotation> {
  const result = await api.updateAnnotation({ id: annotation.id, orphaned: true })
  return result.ok ? result.data : { ...annotation, orphaned: 1 }
}

/** 把 PDF 目录里的跳转目标解析成页码；解析不了就跳过这一条。 */
async function resolvePage(pdf: PdfDocument, dest: string | unknown[] | null): Promise<number | null> {
  try {
    const resolved = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    if (!Array.isArray(resolved) || resolved.length === 0) return null
    const reference = resolved[0]
    if (typeof reference === 'number') return reference + 1
    if (!reference || typeof reference !== 'object') return null
    const index = await pdf.getPageIndex(reference as Parameters<PdfDocument['getPageIndex']>[0])
    return index + 1
  } catch {
    return null
  }
}

async function buildOutline(pdf: PdfDocument): Promise<TocEntry[]> {
  const outline = (await pdf.getOutline()) as RawOutlineNode[] | null
  if (!outline || outline.length === 0) return []

  const entries: TocEntry[] = []
  const walk = async (items: RawOutlineNode[], depth: number): Promise<void> => {
    for (const item of items) {
      const pageNumber = await resolvePage(pdf, item.dest)
      if (pageNumber !== null) {
        const label = typeof item.title === 'string' ? item.title.trim() : ''
        entries.push({
          label: label || `第 ${pageNumber} 页`,
          href: `page-${pageNumber}`,
          depth,
        })
      }
      if (item.items && item.items.length > 0) await walk(item.items, depth + 1)
    }
  }
  await walk(outline, 0)
  return entries
}

/**
 * PDF 用页码 + 原文片段定位：pdf.js 没有 CFI，矩形坐标又会随缩放变化，
 * 所以每次打开时只用 quote 核对页码上的文字，对不上就标「位置失效」。
 */
async function validateAnnotations(pdf: PdfDocument, list: Annotation[]): Promise<Annotation[]> {
  const cache = new Map<number, string>()
  const pageText = async (pageNumber: number): Promise<string> => {
    const cached = cache.get(pageNumber)
    if (cached !== undefined) return cached
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
      .join(' ')
    cache.set(pageNumber, text)
    return text
  }

  const next: Annotation[] = []
  let checked = 0
  for (const annotation of list) {
    const quote = normalizeText(annotation.locator.quote)
    if (annotation.orphaned === 1 || quote.length === 0) {
      next.push(annotation)
      continue
    }
    if (checked >= VALIDATE_LIMIT) {
      next.push(annotation)
      continue
    }
    checked += 1

    const pageNumber = annotation.locator.page
    if (pageNumber < 1 || pageNumber > pdf.numPages) {
      next.push(await markOrphan(annotation))
      continue
    }

    try {
      const text = await pageText(pageNumber)
      if (normalizeText(text).includes(quote)) next.push(annotation)
      else next.push(await markOrphan(annotation))
    } catch {
      next.push(annotation)
    }
  }
  return next
}

export default function PdfViewer({ book, target, onExit }: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pagesRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const pdfRef = useRef<PdfDocument | null>(null)
  const disposedRef = useRef(false)
  const numPagesRef = useRef(0)
  const pageRatioRef = useRef(1.414)
  const layoutWidthRef = useRef(0)
  const renderedRef = useRef<Map<number, number>>(new Map())
  const renderingRef = useRef<Set<number>>(new Set())
  const renderTasksRef = useRef<Map<number, RenderTask>>(new Map())
  const annotationsRef = useRef<Annotation[]>([])
  const selectionRef = useRef<PdfSelection | null>(null)
  const editingIdRef = useRef<string | null>(null)
  const railOpenRef = useRef(false)
  const tocOpenRef = useRef(false)
  const settingsOpenRef = useRef(false)
  const entriesRef = useRef<TocEntry[]>([])
  const currentPageRef = useRef(1)
  const pendingRef = useRef<PendingProgress | null>(null)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const toastTimerRef = useRef<number | undefined>(undefined)
  const scrollTimerRef = useRef<number | undefined>(undefined)
  const bookRef = useRef(book)
  bookRef.current = book

  const [prefs, setPrefs] = useState<ReaderPrefs>(readReaderPrefs)
  const [zoom, setZoom] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [title, setTitle] = useState(book.title)
  const [status, setStatus] = useState<PdfStatus>('loading')
  const [errorText, setErrorText] = useState('')
  const [entries, setEntries] = useState<TocEntry[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chapterTitle, setChapterTitle] = useState('')
  const [activeHref, setActiveHref] = useState('')
  const [percent, setPercent] = useState(0)
  const [pageInfo, setPageInfo] = useState({ current: 1, total: 0 })
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [railOpen, setRailOpen] = useState(false)
  const [selection, setSelection] = useState<PdfSelection | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const [toast, setToast] = useState<{ message: string; undo?: Annotation[] } | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [annotationTags, setAnnotationTags] = useState<AnnotationTag[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [exportPayload, setExportPayload] = useState<ExportPayload | null>(null)
  const [exporting, setExporting] = useState(false)

  const layoutWidth =
    viewportWidth > 0
      ? Math.max(280, Math.round((viewportWidth - PAGE_PADDING) * zoom))
      : 0

  annotationsRef.current = annotations
  selectionRef.current = selection
  editingIdRef.current = editingId
  railOpenRef.current = railOpen
  tocOpenRef.current = tocOpen
  settingsOpenRef.current = settingsOpen

  const annotationTagsRef = useRef(annotationTags)
  annotationTagsRef.current = annotationTags

  const flushProgress = useCallback(async () => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    const locator: Locator = {
      format: 'pdf',
      cfi: null,
      href: pending.href,
      chapterIndex: pending.chapterIndex,
      chapterTitle: pending.chapterTitle,
      page: pending.page,
      percent: pending.percent,
    }
    const result = await api.saveProgress({
      bookId: bookRef.current.id,
      locator,
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

  const showToast = useCallback((message: string, undo?: Annotation[]) => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ message, undo })
    toastTimerRef.current = window.setTimeout(
      () => setToast(null),
      undo && undo.length > 0 ? 5000 : 2600,
    )
  }, [])

  const paintPageHighlights = useCallback((pageNumber: number) => {
    const pageEl = pagesRef.current.get(pageNumber)
    const textLayer = pageEl?.querySelector<HTMLElement>('.pdf-text-layer')
    const overlay = pageEl?.querySelector<HTMLElement>('.pdf-highlights')
    if (!pageEl || !textLayer || !overlay) return

    overlay.replaceChildren()
    const nodes = collectTextNodes(textLayer)
    if (nodes.length === 0) return
    const fullText = nodes.map((entry) => entry.node.data).join('')
    const pageRect = pageEl.getBoundingClientRect()

    for (const annotation of annotationsRef.current) {
      if (annotation.kind === 'bookmark' || !annotation.locator.quote) continue
      if (annotation.locator.page !== pageNumber) continue
      const hit = findBestQuote(
        fullText,
        annotation.locator.quote,
        annotation.locator.prefix,
        annotation.locator.suffix,
      )
      if (!hit) continue
      const range = rangeFromNodes(nodes, hit.start, hit.end)
      if (!range) continue

      const color = HIGHLIGHT_COLORS[annotation.color]
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1 || rect.height < 1) continue
        const mark = document.createElement('div')
        mark.className = 'pdf-mark'
        mark.dataset['annotationId'] = annotation.id
        mark.style.left = `${rect.left - pageRect.left}px`
        mark.style.top = `${rect.top - pageRect.top}px`
        mark.style.width = `${rect.width}px`
        mark.style.height = `${rect.height}px`
        mark.style.background = color.fill
        overlay.append(mark)
      }
    }
  }, [])

  const renderPage = useCallback(
    async (pageNumber: number, width: number) => {
      const pdf = pdfRef.current
      const pageEl = pagesRef.current.get(pageNumber)
      if (!pdf || !pageEl || disposedRef.current) return
      const rendered = renderedRef.current.get(pageNumber)
      if (rendered !== undefined && Math.abs(rendered - width) < 0.5) return
      if (renderingRef.current.has(pageNumber)) return

      renderingRef.current.add(pageNumber)
      try {
        const page = await pdf.getPage(pageNumber)
        if (disposedRef.current) return
        const base = page.getViewport({ scale: 1 })
        const scale = width / base.width
        const viewport = page.getViewport({ scale })
        const pixelRatio = window.devicePixelRatio || 1

        pageEl.replaceChildren()
        pageEl.style.width = `${viewport.width}px`
        pageEl.style.height = `${viewport.height}px`

        const canvas = document.createElement('canvas')
        canvas.className = 'pdf-canvas'
        canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio))
        canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio))
        const context = canvas.getContext('2d')
        if (!context) return

        const textDiv = document.createElement('div')
        textDiv.className = 'textLayer pdf-text-layer'
        textDiv.style.setProperty('--scale-factor', String(scale))
        textDiv.style.setProperty('--total-scale-factor', String(scale))
        textDiv.style.setProperty('--scale-round-x', '1px')
        textDiv.style.setProperty('--scale-round-y', '1px')

        const overlay = document.createElement('div')
        overlay.className = 'pdf-highlights'
        pageEl.append(canvas, textDiv, overlay)

        const task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined,
        })
        renderTasksRef.current.set(pageNumber, task)
        await task.promise
        if (disposedRef.current) return

        const textContent = await page.getTextContent()
        if (disposedRef.current) return
        const layer = new TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport,
        })
        await layer.render()
        if (disposedRef.current) return

        renderedRef.current.set(pageNumber, width)
        paintPageHighlights(pageNumber)
      } catch (error) {
        const name = (error as { name?: string } | null)?.name
        if (name !== 'RenderingCancelledException') {
          console.warn('[Lumen] PDF 页面渲染失败', pageNumber, error)
        }
      } finally {
        renderingRef.current.delete(pageNumber)
        renderTasksRef.current.delete(pageNumber)
      }
    },
    [paintPageHighlights],
  )

  const ensureRendered = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const width = layoutWidthRef.current
    if (width <= 0) return
    const top = scroll.scrollTop
    const bottom = top + scroll.clientHeight
    const targets: number[] = []
    for (const [pageNumber, element] of pagesRef.current) {
      const pageTop = element.offsetTop
      if (pageTop + element.offsetHeight >= top - 700 && pageTop <= bottom + 700) {
        targets.push(pageNumber)
      }
    }
    targets.sort((left, right) => left - right)
    for (const pageNumber of targets) void renderPage(pageNumber, width)
  }, [renderPage])

  const scrollToPage = useCallback((pageNumber: number) => {
    const scroll = scrollRef.current
    const element = pagesRef.current.get(pageNumber)
    if (!scroll || !element) return
    scroll.scrollTop = Math.max(0, element.offsetTop - PAGE_GAP)
  }, [])

  const syncCurrentPage = useCallback(
    (pageNumber: number, entriesValue: TocEntry[], total: number) => {
      const page = clampPage(pageNumber, total)
      const label = labelForPage(entriesValue, page)
      const nextPercent = total > 0 ? page / total : 0
      currentPageRef.current = page
      setPageInfo({ current: page, total })
      setPercent(nextPercent)
      setChapterTitle(label)
      setActiveHref(activeHrefForPage(entriesValue, page))
      queueProgress({
        href: `page-${page}`,
        chapterIndex: page - 1,
        chapterTitle: label,
        page,
        percent: nextPercent,
      })
    },
    [queueProgress],
  )

  const handleScroll = useCallback(() => {
    const scroll = scrollRef.current
    const total = numPagesRef.current
    if (!scroll || total === 0) return

    let current = 1
    for (const [pageNumber, element] of pagesRef.current) {
      if (element.offsetTop - 10 <= scroll.scrollTop + 24) current = Math.max(current, pageNumber)
    }
    if (current !== currentPageRef.current) {
      syncCurrentPage(current, entriesRef.current, total)
    }
    ensureRendered()
  }, [ensureRendered, syncCurrentPage])

  const clearSelection = useCallback(() => {
    try {
      window.getSelection()?.removeAllRanges()
    } catch {
      // 没有选区时忽略。
    }
    setSelection(null)
  }, [])

  const handleHighlightClick = useCallback((id: string) => {
    setSelection(null)
    setRailOpen(true)
    setEditingId(id)
  }, [])

  const createFromSelection = useCallback(
    async (color: AnnotationColor, openNote: boolean) => {
      const current = selectionRef.current
      if (!current) return

      const created: Annotation[] = []
      let failure = ''
      for (const locator of current.locators) {
        const result = await api.createAnnotation({
          bookId: bookRef.current.id,
          kind: 'highlight',
          color,
          locator,
          noteMd: '',
          groupId: null,
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
        setEditingId(created[0]?.id ?? null)
      }
      showToast('已高亮')
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
    const pageNumber = currentPageRef.current
    const total = numPagesRef.current
    if (total === 0) {
      showToast('PDF 还在加载，稍后再加书签。')
      return
    }
    const label = labelForPage(entriesRef.current, pageNumber)
    const result = await api.createAnnotation({
      bookId: bookRef.current.id,
      kind: 'bookmark',
      color: 'slate',
      locator: {
        format: 'pdf',
        cfi: null,
        href: `page-${pageNumber}`,
        chapterIndex: pageNumber - 1,
        chapterTitle: label,
        page: pageNumber,
        percent: pageNumber / total,
        quote: '',
        prefix: '',
        suffix: '',
      },
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

  const handleSelectAnnotation = useCallback((annotation: Annotation) => {
    setSelection(null)
    setRailOpen(true)
    setEditingId(annotation.id)
    if (annotation.orphaned === 1) return
    const pageNumber = clampPage(annotation.locator.page, numPagesRef.current)
    scrollToPage(pageNumber)
  }, [scrollToPage])

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
      const removed: Annotation[] = []
      const result = await api.deleteAnnotation(annotation.id)
      if (result.ok) removed.push(result.data)
      if (removed.length === 0) {
        showToast('删除没有完成，请重试。')
        return
      }
      const removedIds = new Set(removed.map((item) => item.id))
      setAnnotations((previous) => previous.filter((item) => !removedIds.has(item.id)))
      if (editingIdRef.current && removedIds.has(editingIdRef.current)) setEditingId(null)
      showToast('已删除标注', removed)
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

  const exitReader = useCallback(async () => {
    try {
      await flushProgress()
    } finally {
      onExit()
    }
  }, [flushProgress, onExit])

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      // 系统拒绝时静默，不打断阅读。
    }
  }

  const refreshTags = useCallback(async () => {
    const [tagResult, assignmentResult] = await Promise.all([
      api.listTags(),
      api.listAnnotationTags(book.id),
    ])
    if (tagResult.ok) setTags(tagResult.data)
    if (assignmentResult.ok) setAnnotationTags(assignmentResult.data)
  }, [book.id])

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

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
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

      const scroll = scrollRef.current
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ': {
          event.preventDefault()
          if (scroll) scroll.scrollTop += scroll.clientHeight * 0.88
          break
        }
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp': {
          event.preventDefault()
          if (scroll) scroll.scrollTop -= scroll.clientHeight * 0.88
          break
        }
        case 'Escape':
          if (selectionRef.current) setSelection(null)
          else if (editingIdRef.current) setEditingId(null)
          else if (railOpenRef.current) setRailOpen(false)
          else if (settingsOpenRef.current) setSettingsOpen(false)
          else if (tocOpenRef.current) setTocOpen(false)
          else void exitReader()
          break
        default:
          break
      }
    },
    [addBookmark, exitReader],
  )

  const keyHandlerRef = useRef(handleKeyDown)
  keyHandlerRef.current = handleKeyDown

  useEffect(() => {
    saveLastBook(book.id)
  }, [book.id])

  useEffect(() => {
    void refreshTags()
  }, [refreshTags])

  // 偏好只有配色对 PDF 生效；字号与页边距由 pdf.js 的缩放接管。
  useEffect(() => {
    saveReaderPrefs(prefs)
  }, [prefs])

  // 标注变化后重画所有已渲染页面的高亮。
  useEffect(() => {
    annotationsRef.current = annotations
    for (const pageNumber of renderedRef.current.keys()) paintPageHighlights(pageNumber)
  }, [annotations, paintPageHighlights])

  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) return previous
      const valid = new Set(annotations.map((annotation) => annotation.id))
      const next = new Set([...previous].filter((id) => valid.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [annotations])

  // 容器宽度变化时重新排版；页宽也决定 canvas 的清晰度。
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const update = (): void => setViewportWidth(scroll.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [])

  // 页宽变化：清掉旧画布，按新宽度重排，并保持当前页在视口里。
  useLayoutEffect(() => {
    layoutWidthRef.current = layoutWidth
    if (layoutWidth <= 0) return

    for (const task of renderTasksRef.current.values()) {
      try {
        task.cancel()
      } catch {
        // 渲染已完成时取消失败，忽略。
      }
    }
    renderTasksRef.current.clear()
    renderingRef.current.clear()
    renderedRef.current.clear()

    for (const element of pagesRef.current.values()) {
      element.replaceChildren()
      element.style.width = `${layoutWidth}px`
      element.style.height = `${layoutWidth * pageRatioRef.current}px`
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToPage(currentPageRef.current)
      ensureRendered()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [layoutWidth, pageCount, ensureRendered, scrollToPage])

  useEffect(() => {
    let disposed = false
    disposedRef.current = false
    setStatus('loading')
    setErrorText('')
    setAnnotations([])
    setSelectedIds(new Set())
    setEditingId(null)
    setRailOpen(false)
    setTocOpen(false)
    setPageCount(0)
    numPagesRef.current = 0
    renderedRef.current.clear()
    renderTasksRef.current.clear()

    const load = async () => {
      try {
        const bytes = await api.readBookFile(book.id)
        if (!bytes.ok) throw new Error(bytes.message)
        if (disposed) return

        const task = getDocument({
          data: new Uint8Array(bytes.data),
          cMapUrl: `${PDF_RESOURCE_BASE}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${PDF_RESOURCE_BASE}standard_fonts/`,
        })
        const pdf = await task.promise
        if (disposed) {
          void pdf.destroy()
          return
        }
        pdfRef.current = pdf
        numPagesRef.current = pdf.numPages

        const firstPage = await pdf.getPage(1)
        const base = firstPage.getViewport({ scale: 1 })
        pageRatioRef.current = base.height / base.width
        if (disposed) return
        setPageCount(pdf.numPages)

        const meta = await pdf.getMetadata().catch(() => null)
        const info = readTitleAuthor(meta)
        if (info.title) setTitle(info.title)
        void api
          .updateBookMeta({
            id: book.id,
            title: info.title || undefined,
            author: info.author || undefined,
            pageCount: pdf.numPages,
          })
          .catch(() => undefined)

        const outline = await buildOutline(pdf)
        if (disposed) return
        entriesRef.current = outline
        setEntries(outline)

        const saved = await api.getProgress(book.id)
        if (disposed) return
        const targetPage =
          target && target.bookId === book.id
            ? parsePageHref(target.href) ?? target.chapterIndex + 1
            : saved.ok
              ? saved.data?.locator.page ?? 1
              : 1
        const startPage = clampPage(targetPage, pdf.numPages)
        currentPageRef.current = startPage

        const listed = await api.listAnnotations(book.id)
        if (disposed) return
        const initial = listed.ok ? listed.data : []
        if (listed.ok) setAnnotations(initial)
        else console.warn('[Lumen] 标注读取失败', listed.message)

        setStatus('ready')
        setPageInfo({ current: startPage, total: pdf.numPages })
        setPercent(startPage / pdf.numPages)
        setChapterTitle(labelForPage(outline, startPage))
        setActiveHref(activeHrefForPage(outline, startPage))
        queueProgress({
          href: `page-${startPage}`,
          chapterIndex: startPage - 1,
          chapterTitle: labelForPage(outline, startPage),
          page: startPage,
          percent: startPage / pdf.numPages,
        })

        window.requestAnimationFrame(() => {
          if (disposed) return
          scrollToPage(startPage)
          ensureRendered()
        })

        if (initial.length > 0) {
          void validateAnnotations(pdf, initial)
            .then((checked) => {
              if (!disposed) setAnnotations(checked)
            })
            .catch((error: unknown) => console.warn('[Lumen] PDF 标注校验失败', error))
        }
      } catch (error) {
        if (disposed) return
        setErrorText(errorMessage(error))
        setStatus('error')
      }
    }

    void load()

    return () => {
      disposed = true
      disposedRef.current = true
      window.clearTimeout(saveTimerRef.current)
      window.clearTimeout(toastTimerRef.current)
      window.clearTimeout(scrollTimerRef.current)
      for (const renderTask of renderTasksRef.current.values()) {
        try {
          renderTask.cancel()
        } catch {
          // 忽略。
        }
      }
      renderTasksRef.current.clear()
      renderedRef.current.clear()
      pagesRef.current.clear()
      const pdf = pdfRef.current
      pdfRef.current = null
      if (pdf) void pdf.destroy()
      void flushProgress()
    }
    // 换书时整体重挂载；target 只在进入时决定起始页。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, flushProgress, ensureRendered, queueProgress, scrollToPage])

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent): void => keyHandlerRef.current(event)
    window.addEventListener('keydown', onWindowKeyDown)
    return () => window.removeEventListener('keydown', onWindowKeyDown)
  }, [])

  // 滚动事件很密集：先合并 60 ms，再更新页码与可见页渲染。
  const onScroll = (): void => {
    window.clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = window.setTimeout(handleScroll, 60)
  }

  const onMouseUp = (): void => {
    const selected = window.getSelection()
    if (!selected || selected.isCollapsed || selected.rangeCount === 0) return
    const range = selected.getRangeAt(0)
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement
    const endElement =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement
    const startPageEl = startElement?.closest<HTMLElement>('.pdf-page')
    const endPageEl = endElement?.closest<HTMLElement>('.pdf-page')
    if (!startPageEl || !endPageEl) return
    if (startPageEl !== endPageEl) {
      showToast('PDF 暂不支持跨页标注，请分两次选。')
      return
    }

    const pageNumber = Number(startPageEl.dataset['page'])
    const total = numPagesRef.current
    const layer = startPageEl.querySelector<HTMLElement>('.pdf-text-layer')
    if (!layer || !Number.isFinite(pageNumber) || total === 0) return

    const quote = range.toString().replace(/\s+/g, ' ').trim()
    if (!quote) return
    const text = layer.textContent ?? ''
    const hit = findBestQuote(text, quote)
    const context = hit
      ? buildContext(text, hit.start, hit.end)
      : { quote, prefix: '', suffix: '' }
    const rect = range.getBoundingClientRect()
    const label = labelForPage(entriesRef.current, pageNumber)

    setSelection({
      locators: [
        {
          format: 'pdf',
          cfi: null,
          href: `page-${pageNumber}`,
          chapterIndex: pageNumber - 1,
          chapterTitle: label,
          page: pageNumber,
          percent: pageNumber / total,
          quote: context.quote,
          prefix: context.prefix,
          suffix: context.suffix,
        },
      ],
      anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    })
  }

  const onClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const targetElement = event.target as HTMLElement | null
    const mark = targetElement?.closest<HTMLElement>('.pdf-mark')
    const annotationId = mark?.dataset['annotationId']
    if (annotationId) handleHighlightClick(annotationId)
  }

  const goTo = (href: string): void => {
    setTocOpen(false)
    const pageNumber = parsePageHref(href)
    if (pageNumber === null) return
    scrollToPage(clampPage(pageNumber, numPagesRef.current))
  }

  const chapterIndex = entries.findIndex((entry) => entry.href === activeHref)
  const goChapter = (step: 1 | -1): void => {
    const next = entries[chapterIndex + step]
    if (next) goTo(next.href)
  }

  const editingAnnotation = editingId
    ? annotations.find((annotation) => annotation.id === editingId) ?? null
    : null
  const colors = READER_THEMES[prefs.theme]

  const updatePrefs = (patch: Partial<ReaderPrefs>): void => {
    setPrefs((current) => ({ ...current, ...patch }))
  }

  return (
    <div className={`reader pdf-reader ${colors.night ? 'is-night' : ''}`} data-theme={prefs.theme}>
      <header className="reader-head">
        <button type="button" className="ghost-btn" onClick={() => void exitReader()} title="返回书架">
          ← 书架
        </button>
        <div className="reader-title">
          <span className="reader-book" title={title}>
            {title}
          </span>
          {chapterTitle && <span className="reader-chapter">{chapterTitle}</span>}
        </div>
        <div className="reader-actions">
          <button
            type="button"
            className={`icon-btn ${railOpen ? 'is-active' : ''}`}
            onClick={() => setRailOpen((open) => !open)}
            title="本书标注（Ctrl+E）"
          >
            标注
            {annotations.length > 0 && <span className="icon-count">{annotations.length}</span>}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void addBookmark()}
            title="书签（Ctrl+B）"
          >
            书签
          </button>
          <button
            type="button"
            className={`icon-btn ${tocOpen ? 'is-active' : ''}`}
            onClick={() => setTocOpen((open) => !open)}
            title="目录"
          >
            目录
          </button>
          <button
            type="button"
            className={`icon-btn ${settingsOpen ? 'is-active' : ''}`}
            onClick={() => setSettingsOpen((open) => !open)}
            title="配色与缩放"
          >
            排版
          </button>
          <button type="button" className="icon-btn" onClick={() => void toggleFullscreen()} title="全屏">
            ⛶
          </button>
        </div>
      </header>

      <div className="reader-stage" style={{ background: colors.bg }}>
        <div
          className="pdf-scroll"
          ref={scrollRef}
          onScroll={onScroll}
          onMouseUp={onMouseUp}
          onClick={onClick}
        >
          <div className="pdf-pages">
            {Array.from({ length: pageCount }, (_, index) => {
              const pageNumber = index + 1
              return (
                <div
                  className="pdf-page"
                  key={pageNumber}
                  data-page={pageNumber}
                  ref={(element) => {
                    if (element) pagesRef.current.set(pageNumber, element)
                    else pagesRef.current.delete(pageNumber)
                  }}
                />
              )
            })}
          </div>
        </div>

        {status !== 'ready' && (
          <div className="reader-overlay">
            {status === 'loading' ? (
              <p className="reader-loading">正在打开 PDF…</p>
            ) : (
              <div className="reader-error">
                <p>打不开这份 PDF：{errorText}</p>
                <button type="button" className="ghost-btn" onClick={() => void exitReader()}>
                  返回书架
                </button>
              </div>
            )}
          </div>
        )}

        {settingsOpen && (
          <div className="reader-settings" role="dialog" aria-label="PDF 排版设置">
            <div className="setting-row">
              <span className="setting-label">缩放</span>
              <div className="setting-group">
                <button
                  type="button"
                  className="setting-btn"
                  onClick={() => setZoom((value) => Math.max(ZOOM_MIN, Number((value - ZOOM_STEP).toFixed(2))))}
                  disabled={zoom <= ZOOM_MIN}
                  title="缩小"
                >
                  A−
                </button>
                <span className="setting-value">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  className="setting-btn"
                  onClick={() => setZoom((value) => Math.min(ZOOM_MAX, Number((value + ZOOM_STEP).toFixed(2))))}
                  disabled={zoom >= ZOOM_MAX}
                  title="放大"
                >
                  A+
                </button>
                <button type="button" className="setting-btn" onClick={() => setZoom(1)}>
                  适应宽度
                </button>
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
            <p className="setting-hint">夜间配色会给 PDF 页面反转颜色，扫描件可能显得偏暗。</p>
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
            onToggleTag={(tagId) => void toggleAnnotationTag(tagId)}
            onCreateTag={(name) => void createTagForAnnotation(name)}
            onSave={(patch) => void saveNote(patch)}
            onDelete={() => void deleteAnnotation(editingAnnotation)}
            onClose={() => setEditingId(null)}
          />
        ) : (
          railOpen && (
            <AnnotationRail
              annotations={annotations}
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
        {pageInfo.total > 0 && (
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
            title="上一节"
          >
            上一节
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => goChapter(1)}
            disabled={chapterIndex < 0 || chapterIndex >= entries.length - 1}
            title="下一节"
          >
            下一节
          </button>
        </div>
      </footer>
    </div>
  )
}
