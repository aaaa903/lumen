import { useCallback, useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import type { Note, ShelfBook, Tag } from '../../shared/types'
import { api } from '../lib/api'
import { markdownToHtml } from '../lib/convert/markdown'
import { relativeTime } from '../lib/format'

type NotesViewProps = {
  books: ShelfBook[]
}

type Draft = {
  id: string | null
  title: string
  bodyMd: string
  bookId: string | null
}

const EMPTY_DRAFT: Draft = { id: null, title: '', bodyMd: '', bookId: null }

/** 独立笔记：不属于任何一本书也能写；标签在左侧管理，可直接合并同名概念。 */
export default function NotesView({ books }: NotesViewProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [tagBusy, setTagBusy] = useState(false)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [tagEditValue, setTagEditValue] = useState('')
  const [mergingTagId, setMergingTagId] = useState<string | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')

  const load = useCallback(async () => {
    const [notesResult, tagsResult] = await Promise.all([api.listNotes(), api.listTags()])
    if (notesResult.ok) setNotes(notesResult.data)
    else setError(notesResult.message)
    if (tagsResult.ok) setTags(tagsResult.data)
    else setError(tagsResult.message)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selected = useMemo(
    () => (draft.id ? notes.find((note) => note.id === draft.id) ?? null : null),
    [draft.id, notes],
  )

  const openNote = (note: Note) => {
    setDraft({
      id: note.id,
      title: note.title,
      bodyMd: note.bodyMd,
      bookId: note.bookId,
    })
    setPreview(false)
    setError(null)
  }

  const startNew = () => {
    setDraft(EMPTY_DRAFT)
    setPreview(false)
    setError(null)
  }

  const save = async () => {
    if (draft.title.trim().length === 0 && draft.bodyMd.trim().length === 0) {
      setError('标题和正文都是空的，写一点再保存。')
      return
    }

    setSaving(true)
    try {
      const result = await api.saveNote({
        id: draft.id ?? undefined,
        bookId: draft.bookId,
        title: draft.title,
        bodyMd: draft.bodyMd,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setDraft({
        id: result.data.id,
        title: result.data.title,
        bodyMd: result.data.bodyMd,
        bookId: result.data.bookId,
      })
      setNotice('笔记已保存')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!draft.id) return
    if (!window.confirm('删除这条笔记？删除后无法恢复。')) return
    const result = await api.deleteNote(draft.id)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setDraft(EMPTY_DRAFT)
    setNotice('笔记已删除')
    await load()
  }

  const createTag = async () => {
    const name = tagDraft.trim()
    if (!name) return
    setTagBusy(true)
    try {
      const result = await api.createTag(name)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setTagDraft('')
      setNotice(`已创建标签「${result.data.name}」`)
      await load()
    } finally {
      setTagBusy(false)
    }
  }

  const renameTag = async (tag: Tag) => {
    const name = tagEditValue.trim()
    if (!name) return
    setTagBusy(true)
    try {
      const result = await api.renameTag(tag.id, name)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setEditingTagId(null)
      setNotice('标签已改名')
      await load()
    } finally {
      setTagBusy(false)
    }
  }

  const deleteTag = async (tag: Tag) => {
    if (!window.confirm(`删除标签「${tag.name}」？标注本身不会删除，只解除关联。`)) return
    const result = await api.deleteTag(tag.id)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setNotice('标签已删除')
    await load()
  }

  const mergeTag = async (source: Tag) => {
    if (!mergeTargetId) return
    setTagBusy(true)
    try {
      const result = await api.mergeTags(source.id, mergeTargetId)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setMergingTagId(null)
      setMergeTargetId('')
      setNotice(`已合并到「${result.data.name}」`)
      await load()
    } finally {
      setTagBusy(false)
    }
  }

  return (
    <main className="notes-view">
      <header className="view-head">
        <div>
          <p className="view-kicker">知识库</p>
          <h1>笔记</h1>
        </div>
        <p className="view-hint">独立笔记不绑定书也能写；需要出处时再关联一本。</p>
      </header>

      {error && (
        <p className="view-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="view-notice">{notice}</p>}

      <div className="notes-layout">
        <aside className="notes-side">
          <div className="notes-side-head">
            <span>{notes.length} 条笔记</span>
            <button type="button" className="ghost-btn" onClick={startNew}>
              新建
            </button>
          </div>

          <ul className="notes-list">
            {notes.length === 0 ? (
              <li className="notes-empty">还没有笔记。点「新建」写第一条。</li>
            ) : (
              notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className={`notes-item ${draft.id === note.id ? 'is-active' : ''}`}
                    onClick={() => openNote(note)}
                  >
                    <span className="notes-item-title">{note.title}</span>
                    <span className="notes-item-meta">
                      {note.bookTitle || '未关联书籍'} · {relativeTime(note.updatedAt)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <section className="tag-panel">
            <div className="tag-panel-head">
              <h2>标签</h2>
              <span>{tags.length}</span>
            </div>
            <div className="tag-create">
              <input
                value={tagDraft}
                placeholder="新标签名"
                maxLength={40}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createTag()
                }}
              />
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void createTag()}
                disabled={tagBusy || tagDraft.trim().length === 0}
              >
                添加
              </button>
            </div>

            {tags.length === 0 ? (
              <p className="tag-empty">标签用来给标注分类，也可以在这里合并同义标签。</p>
            ) : (
              <ul className="tag-manage">
                {tags.map((tag) => (
                  <li key={tag.id}>
                    {editingTagId === tag.id ? (
                      <div className="tag-row-editing">
                        <input
                          value={tagEditValue}
                          maxLength={40}
                          autoFocus
                          onChange={(event) => setTagEditValue(event.target.value)}
                        />
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => void renameTag(tag)}
                          disabled={tagBusy}
                        >
                          保存
                        </button>
                        <button type="button" className="ghost-btn" onClick={() => setEditingTagId(null)}>
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="tag-row">
                        <span className={`tag-chip tag-${tag.color}`}>{tag.name}</span>
                        <span className="tag-count">{tag.count}</span>
                        <div className="tag-actions">
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => {
                              setEditingTagId(tag.id)
                              setTagEditValue(tag.name)
                            }}
                          >
                            改名
                          </button>
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => {
                              setMergingTagId(tag.id)
                              setMergeTargetId('')
                            }}
                            disabled={tags.length < 2}
                          >
                            合并
                          </button>
                          <button
                            type="button"
                            className="ghost-btn danger-text"
                            onClick={() => void deleteTag(tag)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    )}

                    {mergingTagId === tag.id && (
                      <div className="tag-merge">
                        <span>合并到</span>
                        <select
                          value={mergeTargetId}
                          onChange={(event) => setMergeTargetId(event.target.value)}
                        >
                          <option value="">选择目标标签</option>
                          {tags
                            .filter((item) => item.id !== tag.id)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => void mergeTag(tag)}
                          disabled={tagBusy || mergeTargetId.length === 0}
                        >
                          确认
                        </button>
                        <button type="button" className="ghost-btn" onClick={() => setMergingTagId(null)}>
                          取消
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <section className="note-pane">
          <div className="note-pane-head">
            <input
              className="note-title-input"
              value={draft.title}
              placeholder="笔记标题"
              maxLength={200}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
            <select
              className="note-book-select"
              value={draft.bookId ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  bookId: event.target.value || null,
                }))
              }
            >
              <option value="">不关联书籍</option>
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
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
            {selected && <span className="note-updated">更新于 {relativeTime(selected.updatedAt)}</span>}
          </div>

          {preview ? (
            <div
              className="note-preview notes-preview"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(markdownToHtml(draft.bodyMd), {
                  FORBID_TAGS: ['img', 'iframe', 'script', 'style'],
                  FORBID_ATTR: ['style', 'onerror', 'onload'],
                }),
              }}
            />
          ) : (
            <textarea
              className="note-textarea notes-textarea"
              value={draft.bodyMd}
              placeholder="用 Markdown 写。Ctrl + S 保存。"
              spellCheck={false}
              onChange={(event) =>
                setDraft((current) => ({ ...current, bodyMd: event.target.value }))
              }
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault()
                  void save()
                }
              }}
            />
          )}

          <footer className="note-actions">
            {draft.id && (
              <button type="button" className="danger-btn" onClick={() => void remove()}>
                删除
              </button>
            )}
            <span className="note-save-hint">Ctrl + S 保存</span>
            <button type="button" className="primary-btn" onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </footer>
        </section>
      </div>
    </main>
  )
}
