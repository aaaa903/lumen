import { useEffect, useState } from 'react'
import type { AppVersions } from '../../shared/types'
import { api } from '../lib/api'

type SettingsDialogProps = {
  versions: AppVersions | null
  onClose: () => void
  onNotice: (message: string) => void
  onError: (message: string) => void
  /** 清空成功后通知外层刷新书架并回到初始视图。 */
  onCleared: () => void
}

/** 设置：只放排查与数据位置，不做主题或账号；阅读偏好仍在阅读器里。 */
export default function SettingsDialog({
  versions,
  onClose,
  onNotice,
  onError,
  onCleared,
}: SettingsDialogProps) {
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyPath = async (): Promise<void> => {
    if (!versions) return
    try {
      await navigator.clipboard.writeText(versions.userData)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      onError('复制失败，请手动选中路径复制。')
    }
  }

  const openFolder = async (): Promise<void> => {
    const result = await api.openUserData()
    if (result.ok) onNotice('已在资源管理器中打开数据目录。')
    else onError(result.message)
  }

  const exportLibrary = async (): Promise<void> => {
    setExporting(true)
    try {
      const result = await api.exportLibrary()
      if (!result.ok) {
        onError(result.message)
        return
      }
      if (!result.data) return
      onNotice(`已导出 ${result.data.files} 本书的标注到 ${result.data.path}`)
    } finally {
      setExporting(false)
    }
  }

  const clearData = async (): Promise<void> => {
    setClearing(true)
    try {
      const result = await api.clearData()
      if (!result.ok) {
        onError(result.message)
        return
      }
      setConfirmClear(false)
      onCleared()
      onNotice('已清空全部数据，书架现在是空的。')
      onClose()
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="设置">
      <div className="modal-card settings-card">
        <header className="modal-head">
          <p className="modal-kicker">设置</p>
          <h2>数据与版本</h2>
        </header>

        <section className="settings-section">
          <h3>数据目录</h3>
          <code className="settings-path">{versions?.userData ?? '正在读取…'}</code>
          <div className="settings-actions">
            <button type="button" className="ghost-btn" onClick={() => void copyPath()}>
              {copied ? '已复制' : '复制路径'}
            </button>
            <button type="button" className="ghost-btn" onClick={() => void openFolder()}>
              在资源管理器中打开
            </button>
          </div>
          <p className="settings-hint">
            书、标注、笔记与索引都在这里。卸载应用不会删除这个目录；备份时整目录复制即可。
          </p>
        </section>

        <section className="settings-section">
          <h3>版本</h3>
          <dl className="settings-grid">
            <dt>Lumen</dt>
            <dd>{versions ? `v${versions.app}` : '—'}</dd>
            <dt>Electron</dt>
            <dd>{versions?.electron ?? '—'}</dd>
            <dt>Chromium</dt>
            <dd>{versions?.chrome ?? '—'}</dd>
            <dt>Node</dt>
            <dd>{versions?.node ?? '—'}</dd>
            <dt>SQLite</dt>
            <dd>{versions?.sqlite ?? '—'}</dd>
            <dt>数据库 schema</dt>
            <dd>{versions ? `v${versions.schema}` : '—'}</dd>
          </dl>
        </section>

        <section className="settings-section">
          <h3>导出</h3>
          <p className="settings-hint">
            把书库里每本书的标注导出为单独的 Markdown 文件，按书名命名，可直接放进 Obsidian 或
            Typora。没有标注的书不会生成空文件。
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void exportLibrary()}
              disabled={exporting}
            >
              {exporting ? '正在导出…' : '导出全部标注…'}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>危险操作</h3>
          {confirmClear ? (
            <div className="settings-danger">
              <p>
                将删除全部书籍、标注、笔记、标签与搜索索引，并删除数据目录下的书籍与封面文件。此操作不可撤销。
              </p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setConfirmClear(false)}
                  disabled={clearing}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  onClick={() => void clearData()}
                  disabled={clearing}
                >
                  {clearing ? '正在清空…' : '确认清空'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" className="danger-btn" onClick={() => setConfirmClear(true)}>
                清空全部数据…
              </button>
              <p className="settings-hint">
                只删阅读数据；窗口位置、日志与迁移备份保留。清空前建议先退出应用并复制一份数据目录。
              </p>
            </>
          )}
        </section>

        <p className="settings-foot">
          本应用不登录、不联网、不上报使用数据。所有请求都由主进程拦截，外部链接只会交给系统浏览器。
        </p>

        <footer className="modal-actions">
          <button type="button" className="primary-btn" onClick={onClose} autoFocus>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
