import { useCallback, useEffect, useState } from 'react'
import { api } from './lib/api'
import type { AppVersions } from './lib/api'

export default function App() {
  const [versions, setVersions] = useState<AppVersions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false

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
  }, [])

  const handleOpenUserData = useCallback(async () => {
    setNotice(null)
    const result = await api.openUserData()
    if (!result.ok) setError(result.message)
    else setNotice('已在资源管理器中打开数据目录。')
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span className="brand-name">Lumen</span>
        </div>
        <span className="badge">0.0.1 · 骨架</span>
        <div className="topbar-spacer" />
        <button type="button" className="ghost-button" onClick={() => void handleOpenUserData()}>
          数据目录
        </button>
      </header>

      <main className="shelf">
        <section className="empty">
          <p className="empty-kicker">书架</p>
          <h1>书架还是空的</h1>
          <p className="empty-body">
            导入 EPUB、Markdown、TXT 的能力在 0.0.2 接入。这一版只验证启动链路：自定义协议、SQLite
            与主进程通信。
          </p>
          <p className="empty-hint">
            运行 <code>npm run samples</code> 可以先生成几本测试书，供下一版验证导入。
          </p>
        </section>
      </main>

      <footer className="statusbar">
        {error ? (
          <p className="status-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="status-line">
            {notice ??
              (versions
                ? `数据库 schema v${versions.schema} · Electron ${versions.electron} · Node ${versions.node} · SQLite ${versions.sqlite}`
                : '正在读取运行时版本…')}
          </p>
        )}
        <span className="status-version">{versions ? `v${versions.app}` : ''}</span>
      </footer>
    </div>
  )
}
