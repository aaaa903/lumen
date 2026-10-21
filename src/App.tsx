import { useCallback, useEffect, useState } from 'react'
import type { AppVersions, ImportResult, ShelfBook } from './lib/api'
import { api } from './lib/api'
import ShelfView from './library/ShelfView'
import ReaderView from './reader/ReaderView'

export default function App() {
  const [books, setBooks] = useState<ShelfBook[]>([])
  const [versions, setVersions] = useState<AppVersions | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
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

  const handleOpen = useCallback(async (book: ShelfBook) => {
    setNotice(null)
    setError(null)
    const result = await api.touchBook(book.id)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setActiveId(book.id)
  }, [])

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
    void refresh()
  }, [refresh])

  const activeBook = activeId ? books.find((book) => book.id === activeId) ?? null : null

  if (activeBook) {
    return <ReaderView book={activeBook} onExit={exitReader} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span className="brand-name">Lumen</span>
        </div>
        <span className="badge">{versions ? `v${versions.app}` : 'v0.0.2'}</span>
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

      <ShelfView
        books={books}
        loading={loading}
        importing={importing}
        onImport={(paths) => void handleImport(paths)}
        onPick={() => void handlePick()}
        onOpen={(book) => void handleOpen(book)}
        onRemove={(book) => void handleRemove(book)}
      />

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
