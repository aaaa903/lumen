import { useState } from 'react'
import DOMPurify from 'dompurify'
import type { Annotation, AnnotationColor } from '../../shared/types'
import { markdownToHtml } from '../lib/convert/markdown'
import { COLOR_ORDER, HIGHLIGHT_COLORS } from './colors'

type NoteEditorProps = {
  annotation: Annotation
  saving: boolean
  onSave: (patch: { color: AnnotationColor; noteMd: string }) => void
  onDelete: () => void
  onClose: () => void
}

/** 批注编辑器：只存 Markdown 源，预览时渲染并消毒，不把 HTML 写回数据库。 */
export default function NoteEditor({
  annotation,
  saving,
  onSave,
  onDelete,
  onClose,
}: NoteEditorProps) {
  const [note, setNote] = useState(annotation.noteMd)
  const [color, setColor] = useState<AnnotationColor>(annotation.color)
  const [preview, setPreview] = useState(false)

  const isBookmark = annotation.kind === 'bookmark'

  return (
    <aside className="note-editor" aria-label={isBookmark ? '书签备注' : '批注'}>
      <header className="note-head">
        <div>
          <p className="note-kicker">{isBookmark ? '书签' : '批注'}</p>
          <p className="note-chapter">{annotation.locator.chapterTitle || '当前章节'}</p>
        </div>
        <button type="button" className="ghost-btn" onClick={onClose} title="关闭">
          ×
        </button>
      </header>

      {annotation.locator.quote && (
        <blockquote className="note-quote">{annotation.locator.quote}</blockquote>
      )}

      <div className="note-colors" role="group" aria-label="标注颜色">
        {COLOR_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={`note-color ${color === key ? 'is-active' : ''}`}
            style={{ background: HIGHLIGHT_COLORS[key].swatch }}
            title={`${HIGHLIGHT_COLORS[key].label}色`}
            aria-label={`${HIGHLIGHT_COLORS[key].label}色`}
            onClick={() => setColor(key)}
          />
        ))}
        <span className="note-color-label">{HIGHLIGHT_COLORS[color].label}色</span>
      </div>

      <div className="note-toolbar">
        <button
          type="button"
          className={`ghost-btn ${preview ? '' : 'is-active'}`}
          onClick={() => setPreview(false)}
        >
          编辑
        </button>
        <button
          type="button"
          className={`ghost-btn ${preview ? 'is-active' : ''}`}
          onClick={() => setPreview(true)}
        >
          预览
        </button>
      </div>

      {preview ? (
        <div
          className="note-preview"
          // 先转成 HTML 再消毒，只允许排版标签；链接在书内不打开。
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(markdownToHtml(note), {
              FORBID_TAGS: ['a', 'img', 'iframe', 'script', 'style'],
              FORBID_ATTR: ['style', 'onerror', 'onload'],
            }),
          }}
        />
      ) : (
        <textarea
          className="note-textarea"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={isBookmark ? '给这个位置写一句备注（Markdown，可留空）' : '写下你的想法（Markdown，可留空）'}
          spellCheck={false}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              onSave({ color, noteMd: note })
            }
            if (event.key === 'Escape') {
              event.stopPropagation()
              onClose()
            }
          }}
        />
      )}

      <footer className="note-actions">
        <button type="button" className="danger-btn" onClick={onDelete}>
          删除
        </button>
        <span className="note-save-hint">Ctrl + Enter 保存</span>
        <button
          type="button"
          className="primary-btn"
          onClick={() => onSave({ color, noteMd: note })}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </footer>
    </aside>
  )
}
