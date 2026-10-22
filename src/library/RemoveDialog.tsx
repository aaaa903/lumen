import { useEffect, useState } from 'react'
import type { ShelfBook } from '../../shared/types'

type RemoveDialogProps = {
  book: ShelfBook
  busy: boolean
  /** 已移除的书只能彻底删除，不再提供「只移出」的分支。 */
  purgeOnly?: boolean
  onCancel: () => void
  onRemove: (purge: boolean) => void
}

/** 移出书库：默认保留标注与笔记；彻底删除是单独的显式选择。 */
export default function RemoveDialog({
  book,
  busy,
  purgeOnly = false,
  onCancel,
  onRemove,
}: RemoveDialogProps) {
  const [purge, setPurge] = useState(purgeOnly)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const remove = purgeOnly || purge

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={purgeOnly ? '彻底删除' : '移出书库'}
    >
      <div className="modal-card">
        <header className="modal-head">
          <p className="modal-kicker">书库</p>
          <h2>
            {purgeOnly ? '彻底删除' : '移出'}《{book.title}》
          </h2>
        </header>

        {purgeOnly ? (
          <p className="modal-body">
            这本书已经移出书架。彻底删除会连同它的标注、笔记、索引与源文件一起清掉，重新导入也找不回。
          </p>
        ) : (
          <p className="modal-body">
            默认只把书移出书架，标注、批注与笔记都会保留。以后重新导入同一个文件，标注会回到原来的位置；
            也可以在书架底部的「已移除」里直接恢复。
          </p>
        )}

        {!purgeOnly && (
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
        )}

        <footer className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={remove ? 'danger-btn' : 'primary-btn'}
            onClick={() => onRemove(remove)}
            disabled={busy}
            autoFocus
          >
            {busy ? '处理中…' : remove ? '彻底删除' : '移出书库'}
          </button>
        </footer>
      </div>
    </div>
  )
}
