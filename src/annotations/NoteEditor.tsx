import { useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { Annotation, AnnotationColor, Tag } from '../../shared/types'
import { referenceLabel, referenceToken } from '../../shared/references'
import { noteMarkdownToHtml } from '../lib/note-markdown'
import { COLOR_ORDER, HIGHLIGHT_COLORS } from './colors'

type NoteEditorProps = {
  annotation: Annotation
  saving: boolean
  tags: Tag[]
  assignedTagIds: string[]
  /** 本书全部标注：引用选择器与引用标签都从这里取。 */
  bookAnnotations: Annotation[]
  /** 引用了当前这条标注的其它批注，用来显示反向引用。 */
  backrefs: Annotation[]
  onToggleTag: (tagId: string) => void
  onCreateTag: (name: string) => void
  onSave: (patch: { color: AnnotationColor; noteMd: string }) => void
  /** 跳到另一条标注；带上当前草稿，调用方先落库再跳，避免刚写的引用丢失。 */
  onOpenAnnotation: (
    annotation: Annotation,
    draft: { color: AnnotationColor; noteMd: string },
  ) => void
  onDelete: () => void
  onClose: () => void
}

/** 引用选择器里最多列出的条数，再多就让用户先收窄关键词。 */
const PICKER_LIMIT = 8

function shortChapter(annotation: Annotation): string {
  return annotation.locator.chapterTitle || `第 ${annotation.locator.chapterIndex + 1} 节`
}

function matchesQuery(annotation: Annotation, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [annotation.locator.quote, annotation.locator.chapterTitle, annotation.noteMd].some(
    (value) => value.toLowerCase().includes(needle),
  )
}

/** 批注编辑器：只存 Markdown 源，预览时渲染并消毒，不把 HTML 写回数据库。 */
export default function NoteEditor({
  annotation,
  saving,
  tags,
  assignedTagIds,
  bookAnnotations,
  backrefs,
  onToggleTag,
  onCreateTag,
  onSave,
  onOpenAnnotation,
  onDelete,
  onClose,
}: NoteEditorProps) {
  const [note, setNote] = useState(annotation.noteMd)
  const [color, setColor] = useState<AnnotationColor>(annotation.color)
  const [preview, setPreview] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const isBookmark = annotation.kind === 'bookmark'

  const byId = useMemo(() => {
    const map = new Map<string, Annotation>()
    for (const item of bookAnnotations) map.set(item.id, item)
    return map
  }, [bookAnnotations])

  const candidates = useMemo(() => {
    return bookAnnotations
      .filter((item) => item.id !== annotation.id && matchesQuery(item, pickerQuery))
      .slice(0, PICKER_LIMIT)
  }, [bookAnnotations, annotation.id, pickerQuery])

  /** 在光标处插入引用标记；没有焦点时补在末尾。 */
  const insertReference = (target: Annotation): void => {
    const token = referenceToken(target.id)
    const element = textareaRef.current
    const at = element ? element.selectionStart : note.length
    setNote(`${note.slice(0, at)}${token}${note.slice(at)}`)
    setPickerOpen(false)
    setPickerQuery('')
    window.requestAnimationFrame(() => {
      const next = at + token.length
      element?.focus()
      element?.setSelectionRange(next, next)
    })
  }

  const openReferenced = (target: Annotation): void => {
    // 带上当前草稿：跳走前由调用方落库，否则刚写的引用说明会丢。
    onOpenAnnotation(target, { color, noteMd: note })
  }

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

      <div className="note-tags">
        <p className="note-tags-label">标签</p>
        <div className="tag-chips">
          {tags.length === 0 && <span className="note-tags-empty">还没有标签，在下面新建一个。</span>}
          {tags.map((tag) => {
            const active = assignedTagIds.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                className={`tag-chip tag-${tag.color} ${active ? 'is-active' : ''}`}
                onClick={() => onToggleTag(tag.id)}
                title={active ? '取消这个标签' : '加上这个标签'}
              >
                {tag.name}
              </button>
            )
          })}
        </div>
        <div className="tag-create">
          <input
            value={newTag}
            maxLength={40}
            placeholder="新建标签"
            onChange={(event) => setNewTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                const name = newTag.trim()
                if (name) {
                  onCreateTag(name)
                  setNewTag('')
                }
              }
            }}
          />
          <button
            type="button"
            className="ghost-btn"
            disabled={newTag.trim().length === 0}
            onClick={() => {
              const name = newTag.trim()
              if (name) {
                onCreateTag(name)
                setNewTag('')
              }
            }}
          >
            添加
          </button>
        </div>
      </div>

      {backrefs.length > 0 && (
        <div className="note-refs">
          <p className="note-refs-label">被 {backrefs.length} 条批注引用</p>
          {backrefs.map((item) => (
            <button
              key={item.id}
              type="button"
              className="note-refs-item"
              onClick={() => openReferenced(item)}
              title="跳到引用它的批注"
            >
              {shortChapter(item)}「{item.locator.quote.slice(0, 24)}」
            </button>
          ))}
        </div>
      )}

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
        <button
          type="button"
          className={`ghost-btn ${pickerOpen ? 'is-active' : ''}`}
          onClick={() => {
            setPreview(false)
            setPickerOpen((open) => !open)
          }}
          title="在批注里引用另一条标注"
        >
          引用标注
        </button>
      </div>

      {pickerOpen && (
        <div className="note-ref-picker">
          <input
            autoFocus
            value={pickerQuery}
            placeholder="按原文或批注筛选"
            onChange={(event) => setPickerQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setPickerOpen(false)
              }
              if (event.key === 'Enter' && candidates.length > 0) {
                event.preventDefault()
                insertReference(candidates[0]!)
              }
            }}
          />
          {candidates.length === 0 ? (
            <p className="note-ref-empty">这本书里没有可引用的标注。</p>
          ) : (
            <ul>
              {candidates.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => insertReference(item)}>
                    <span className="note-ref-chapter">{shortChapter(item)}</span>
                    <span className="note-ref-quote">
                      {item.locator.quote || '（书签）'}
                      {item.noteMd.trim() ? ` · ${item.noteMd.trim().slice(0, 40)}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview ? (
        <div
          className="note-preview"
          // 先转成 HTML 再消毒：批注里的引用渲染成站内链接，其它链接与图片一律去掉。
          onClick={(event) => {
            const anchor = (event.target as HTMLElement).closest('a[data-annotation-id]')
            if (!anchor) return
            event.preventDefault()
            const id = anchor.getAttribute('data-annotation-id')
            const target = id ? byId.get(id) : undefined
            if (target) openReferenced(target)
          }}
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(
              noteMarkdownToHtml(note, (id) => {
                const target = byId.get(id)
                return target ? referenceLabel(target.locator) : null
              }),
              {
                FORBID_TAGS: ['img', 'iframe', 'script', 'style'],
                FORBID_ATTR: ['style', 'onerror', 'onload'],
                // 只保留站内引用链接，批注里的外链不打开。
                ALLOWED_URI_REGEXP: /^#/,
                ADD_ATTR: ['data-annotation-id'],
              },
            ),
          }}
        />
      ) : (
        <textarea
          ref={textareaRef}
          className="note-textarea"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            isBookmark ? '给这个位置写一句备注（Markdown，可留空）' : '写下你的想法（Markdown，可留空）'
          }
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
