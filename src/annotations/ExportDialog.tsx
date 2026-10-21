import type { ExportPayload } from '../../shared/types'

type ExportDialogProps = {
  payload: ExportPayload
  onSave: () => void
  onCopy: () => void
  onClose: () => void
}

/** 导出预览：先看 Markdown 再决定保存还是复制，不直接写盘。 */
export default function ExportDialog({ payload, onSave, onCopy, onClose }: ExportDialogProps) {
  return (
    <div className="export-backdrop" role="dialog" aria-modal="true" aria-label="导出标注">
      <div className="export-dialog">
        <header className="export-head">
          <div>
            <p className="export-kicker">导出</p>
            <h2>{payload.count} 条标注</h2>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </header>
        <textarea className="export-preview" value={payload.markdown} readOnly spellCheck={false} />
        <footer className="export-actions">
          <span className="export-hint">Markdown 含书名、章节、原文引用与批注。</span>
          <button type="button" className="ghost-btn" onClick={onCopy}>
            复制
          </button>
          <button type="button" className="primary-btn" onClick={onSave}>
            保存为文件
          </button>
        </footer>
      </div>
    </div>
  )
}
