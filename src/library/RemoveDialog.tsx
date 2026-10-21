import { useEffect, useState } from 'react'
import type { ShelfBook } from '../../shared/types'

type RemoveDialogProps = {
  book: ShelfBook
  busy: boolean
  onCancel: () => void
  onRemove: (purge: boolean) => void
}

/** 移出书库：默认保留标注与笔记；彻底删除是单独的显式选择。 */
export default function RemoveDialog({ book, busy, onCancel, onRemove }: RemoveDialogProps) {
  const [purge, setPurge] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="移出书库">
      <div className="modal-card">
        <header className="modal-head">
          <p className="modal-kicker">书库</p>
          <h2>移出《{book.title}》</h2>
        </header>

        <p className="modal-body">
          默认只把书移出书架，标注、批注与笔记都会保留。以后重新导入同一个文件，标注会回到原来的位置。
        </p>

        <label className={`modal-check ${purge ? 'is-danger' : ''}`}>
          <input
            type="checkbox"
            checked={purge}
            onChange={(event) => setPurge(event.target.checked)}
          />
          <span>
            同时删除这本书的标注、笔记与源文件
            <small>不可撤销，也无法通过重新导入找回。</small>
          </span>
        </label>

        <footer className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={purge ? 'danger-btn' : 'primary-btn'}
            onClick={() => onRemove(purge)}
            disabled={busy}
            autoFocus
          >
            {busy ? '处理中…' : purge ? '彻底删除' : '移出书库'}
          </button>
        </footer>
      </div>
    </div>
  )
}
