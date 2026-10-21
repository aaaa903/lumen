import { useCallback, useEffect, useState } from 'react'
import type { AppVersions, ImportResult, OpenTarget, ShelfBook } from './lib/api'
import { api } from './lib/api'
import ShelfView from './library/ShelfView'
import NotesView from './notes/NotesView'
import ReaderView from './reader/ReaderView'
import SearchView from './search/SearchView'

type View = 'shelf' | 'search' | 'notes'

const VIEW_LABEL: Record<View, string> = {
  shelf: '书架',
  search: '搜索',
  notes: '笔记',
}

export default function App() {
  const [books, setBooks] = useState<ShelfBook[]>([])
  const [versions, setVersions] = useState<AppVersions | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [openTarget, setOpenTarget] = useState<OpenTarget | null>(null)
  const [view, setView] = useState<View>('shelf')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await api.listBooks()
    if (result.ok) setBooks(result.data)
    else setError(result.message)
    setLoading(false)
  }, [])

  useEffect(() => {
    let disposed = false

    void refresh()
    api
      .versions()
      .then((result) => {
        if (disposed) return
        if (result.ok) setVersions(result.data)
        else setError(result.message)
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      disposed = true
    }
  }, [refresh])

  const handleImport = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      setImporting(true)
      setNotice(null)
      setError(null)

      try {
        const result = await api.importBooks(paths)
        if (!result.ok) {
          setError(result.message)
          return
        }

        const added = result.data.filter((item) => item.status === 'ok').length
        const duplicated = result.data.filter((item) => item.status === 'duplicate').length
        const failures = result.data.filter(
          (item): item is Extract<ImportResult, { status: 'error' }> => item.status === 'error',
        )

        const parts: string[] = []
        if (added > 0) parts.push(`导入 ${added} 本`)
        if (duplicated > 0) parts.push(`${duplicated} 本已在书库`)
        if (failures.length > 0) parts.push(`${failures.length} 本失败`)
        setNotice(parts.length > 0 ? `${parts.join('，')}。` : '没有可导入的文件。')
        if (failures.length > 0) {
          setError(failures.map((item) => `《${item.fileName}》：${item.message}`).join(' '))
        }

        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '导入没有完成，请重试。')
      } finally {
        setImporting(false)
      }
    },
    [refresh],
  )

  const handlePick = useCallback(async () => {
    const result = await api.pickFiles()
    if (!result.ok) {
      setError(result.message)
      return
    }
    await handleImport(result.data)
  }, [handleImport])

  const openBook = useCallback(
    async (bookId: string, target: OpenTarget | null) => {
      const book = books.find((item) => item.id === bookId)
      if (!book) {
        setError('这本书不在书库里，可能已被移出。刷新后再试。')
        return
      }

      setNotice(null)
      setError(null)
      const result = await api.touchBook(book.id)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setOpenTarget(target)
      setActiveId(book.id)
    },
    [books],
  )

  const handleOpen = useCallback(
    (book: ShelfBook) => {
      void openBook(book.id, null)
    },
    [openBook],
  )

  const handleSearchOpen = useCallback(
    (target: OpenTarget) => {
      void openBook(target.bookId, target)
    },
    [openBook],
  )

  const handleRemove = useCallback(
    async (book: ShelfBook) => {
      const confirmed = window.confirm(
        `把《${book.title}》移出书库？\n\n标注与笔记会保留；重新导入同一个文件即可回到原文。`,
      )
      if (!confirmed) return

      const result = await api.removeBook(book.id)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setNotice(`已把《${book.title}》移出书库。`)
      await refresh()
    },
    [refresh],
  )

  const handleOpenUserData = useCallback(async () => {
    const result = await api.openUserData()
    if (!result.ok) setError(result.message)
    else setNotice('已在资源管理器中打开数据目录。')
  }, [])

  const exitReader = useCallback(() => {
    setActiveId(null)
    setOpenTarget(null)
    void refresh()
  }, [refresh])

  const activeBook = activeId ? books.find((book) => book.id === activeId) ?? null : null

  if (activeBook) {
    return (
      <ReaderView
        book={activeBook}
        target={openTarget}
        onIndexed={() => void refresh()}
        onExit={exitReader}
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => setView('shelf')}>
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span className="brand-name">Lumen</span>
        </button>
        <span className="badge">{versions ? `v${versions.app}` : 'v0.0.4'}</span>

        <nav className="topnav" aria-label="主导航">
          {(['shelf', 'search', 'notes'] as View[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`topnav-item ${view === item ? 'is-active' : ''}`}
              onClick={() => {
                setView(item)
                setNotice(null)
                setError(null)
              }}
            >
              {VIEW_LABEL[item]}
            </button>
          ))}
        </nav>

        <div className="topbar-spacer" />
        <button type="button" className="ghost-button" onClick={() => void handleOpenUserData()}>
          数据目录
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => void handlePick()}
          disabled={importing}
        >
          {importing ? '导入中…' : '导入书籍'}
        </button>
      </header>

      {view === 'shelf' && (
        <ShelfView
          books={books}
          loading={loading}
          importing={importing}
          onImport={(paths) => void handleImport(paths)}
          onPick={() => void handlePick()}
          onOpen={handleOpen}
          onRemove={(book) => void handleRemove(book)}
        />
      )}
      {view === 'search' && <SearchView onOpen={handleSearchOpen} />}
      {view === 'notes' && <NotesView books={books} />}

      <footer className="statusbar">
        {error ? (
          <p className="status-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="status-line">
            {notice ??
              (versions
                ? `本地书库 · 数据库 schema v${versions.schema} · Electron ${versions.electron} · SQLite ${versions.sqlite}`
                : '正在读取运行时版本…')}
          </p>
        )}
        <span className="status-version">{versions ? `v${versions.app}` : ''}</span>
      </footer>
    </div>
  )
}
