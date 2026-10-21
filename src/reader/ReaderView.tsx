import { useCallback, useEffect, useRef, useState } from 'react'
import ePub from 'epubjs'
import type { Book as EpubBook, Contents, Location, NavItem, Rendition } from 'epubjs'
import type { ShelfBook } from '../../shared/types'
import { api } from '../lib/api'
import { loadBookAsEpub } from '../lib/convert/text-epub'
import { percentLabel } from '../lib/format'
import {
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
import TocDrawer, { type TocEntry } from './TocDrawer'

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
  onExit: () => void
}

const PROGRESS_DEBOUNCE_MS = 400

function normalizeHref(href: string): string {
  const clean = href.split('#')[0]
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function flattenToc(items: NavItem[], depth = 0): TocEntry[] {
  return items.flatMap((item) => [
    { label: item.label.trim() || '未命名章节', href: normalizeHref(item.href), depth },
    ...(item.subitems ? flattenToc(item.subitems, depth + 1) : []),
  ])
}

/** 没有 nav 目录的 EPUB（不少 EPUB2 老书）退化成按 spine 顺序列章，上一章/下一章仍然可用。 */
function spineFallback(book: EpubBook): TocEntry[] {
  const items =
    (book.spine as unknown as { spineItems?: Array<{ href?: string }> }).spineItems ?? []
  return items
    .map((item, index) => ({
      label: `第 ${index + 1} 节`,
      href: normalizeHref(item.href ?? ''),
      depth: 0,
    }))
    .filter((entry) => entry.href.length > 0)
}

export default function ReaderView({ book, onExit }: ReaderViewProps) {
  const viewRef = useRef<HTMLDivElement | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const tocRef = useRef<TocEntry[]>([])
  const spineLengthRef = useRef(0)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const pendingRef = useRef<PendingProgress | null>(null)

  const [prefs, setPrefs] = useState<ReaderPrefs>(readReaderPrefs)
  const [entries, setEntries] = useState<TocEntry[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chapterTitle, setChapterTitle] = useState('')
  const [activeHref, setActiveHref] = useState('')
  const [percent, setPercent] = useState(0)
  const [pageInfo, setPageInfo] = useState({ current: 0, total: 0 })
  const [status, setStatus] = useState<ReaderStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')

  // 异步回调与 iframe 内监听器要读最新值，闭包里的 state 会是旧的。
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const bookRef = useRef(book)
  bookRef.current = book
  const tocOpenRef = useRef(tocOpen)
  tocOpenRef.current = tocOpen
  const settingsOpenRef = useRef(settingsOpen)
  settingsOpenRef.current = settingsOpen

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
    if (direction === 1) void rendition.next()
    else void rendition.prev()
  }, [])

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
      switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault()
          turnPage(1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault()
          turnPage(-1)
          break
        case 'Escape':
          if (settingsOpenRef.current) {
            setSettingsOpen(false)
          } else if (tocOpenRef.current) {
            setTocOpen(false)
          } else {
            void exitReader()
          }
          break
        default:
          break
      }
    },
    [exitReader, turnPage],
  )

  // 键盘要注册两处：焦点在 iframe 内时事件不会冒泡到父窗口。
  const keyHandlerRef = useRef(handleKeyDown)
  keyHandlerRef.current = handleKeyDown

  useEffect(() => {
    saveLastBook(book.id)
  }, [book.id])

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
          flow: 'paginated',
          spread: 'none',
          allowScriptedContent: false,
        })
        renditionRef.current = rendition
        ;(window as unknown as { __lumenRendition?: Rendition }).__lumenRendition = rendition

        // 主题必须在 renderTo 之后注册，否则作用不到还不存在的 contents。
        applyReaderTheme(rendition, prefsRef.current)

        rendition.hooks.content.register((contents: Contents) => {
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

          queueProgress({
            cfi: start.cfi ?? null,
            href: chapter.href,
            chapterIndex: start.index,
            page: displayed?.page ?? 0,
            percent: nextPercent,
            chapterTitle: chapter.label,
          })
        })

        const saved = await api.getProgress(book.id)
        if (disposed) return
        const startCfi = saved.ok ? saved.data?.locator.cfi ?? null : null

        try {
          await rendition.display(startCfi ?? undefined)
        } catch {
          // 存下的 CFI 可能因文件被改写而失效，退回首页而不是让整本书打不开。
          await rendition.display()
        }
        if (disposed) return
        setStatus('ready')

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
      observer.disconnect()
      window.removeEventListener('keydown', onWindowKeyDown)
      void flushProgress()
      renditionRef.current = null
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
  }, [book.id, flushProgress, queueProgress])

  // 偏好变化立即写 localStorage 并作用到当前 contents。
  useEffect(() => {
    saveReaderPrefs(prefs)
    const rendition = renditionRef.current
    if (rendition) applyReaderTheme(rendition, prefs)
  }, [prefs])

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
  const goChapter = (step: 1 | -1) => {
    const next = entries[chapterIndex + step]
    if (next) goTo(next.href)
  }

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
