import { useEffect, useMemo, useState } from 'react'
import type { ShelfBook } from '../../shared/types'
import { api } from '../lib/api'
import { percentLabel, relativeTime } from '../lib/format'
import { readShelfFilter, saveShelfFilter } from '../lib/prefs'
import BookCover from './BookCover'

const FORMAT_LABEL: Record<ShelfBook['format'], string> = {
  epub: 'EPUB',
  markdown: 'MD',
  txt: 'TXT',
  pdf: 'PDF',
}

type ShelfViewProps = {
  books: ShelfBook[]
  /** 已移出书库、标注仍在的书；用于底部分组。 */
  removed: ShelfBook[]
  loading: boolean
  importing: boolean
  restoringId: string | null
  onImport: (paths: string[]) => void
  onPick: () => void
  onOpen: (book: ShelfBook) => void
  onRemove: (book: ShelfBook) => void
  onRestore: (book: ShelfBook) => void
  onPurge: (book: ShelfBook) => void
}

export default function ShelfView({
  books,
  removed,
  loading,
  importing,
  restoringId,
  onImport,
  onPick,
  onOpen,
  onRemove,
  onRestore,
  onPurge,
}: ShelfViewProps) {
  const [filter, setFilter] = useState(readShelfFilter)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    saveShelfFilter(filter)
  }, [filter])

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return books
    return books.filter(
      (book) =>
        book.title.toLowerCase().includes(query) || book.author.toLowerCase().includes(query),
    )
  }, [books, filter])

  const pathsFromFiles = (files: FileList | null): string[] => {
    if (!files) return []
    return Array.from(files)
      .map((file) => api.pathForFile(file))
      .filter((path) => path.length > 0)
  }

  const removedSection = removed.length > 0 && (
    <section className="shelf-removed">
      <details>
        <summary>
          已移除 <span className="shelf-removed-count">{removed.length}</span>
        </summary>
        <p className="shelf-removed-hint">
          这些书的标注、笔记与进度都还在。点「恢复到书架」回到原来的位置，或重新导入同一个文件。
        </p>
        <ul className="removed-list">
          {removed.map((book) => (
            <li className="removed-item" key={book.id}>
              <span className="removed-title">{book.title}</span>
              <span className="removed-meta">
                {FORMAT_LABEL[book.format]}
                {book.author ? ` · ${book.author}` : ''} · 移出于{' '}
                {relativeTime(book.deletedAt ?? book.addedAt)}
              </span>
              <span className="removed-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => onRestore(book)}
                  disabled={restoringId === book.id}
                >
                  {restoringId === book.id ? '恢复中…' : '恢复到书架'}
                </button>
                <button type="button" className="removed-purge" onClick={() => onPurge(book)}>
                  彻底删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  )

  if (loading) {
    return (
      <main className="shelf">
        <p className="shelf-loading">正在读取书库…</p>
      </main>
    )
  }

  if (books.length === 0) {
    return (
      <main
        className={`shelf ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          onImport(pathsFromFiles(event.dataTransfer.files))
        }}
      >
        <section className="empty">
          <p className="empty-kicker">书架</p>
          <h1>书架还是空的</h1>
          <p className="empty-body">
            把 EPUB、PDF、Markdown 或 TXT 拖进这个窗口，或点下面的按钮选择文件。书只保存在本机，
            不会上传，也不会有任何网络请求。
          </p>
          <button type="button" className="primary-btn" onClick={onPick}>
            导入书籍
          </button>
          <p className="empty-hint">
            想先试读：运行 <code>npm run samples</code> 生成几本测试书，再导入它们。
          </p>
        </section>
        {removedSection}
      </main>
    )
  }

  return (
    <main
      className={`shelf ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        onImport(pathsFromFiles(event.dataTransfer.files))
      }}
    >
      <div className="shelf-bar">
        <div className="shelf-count">
          <span className="shelf-number">{books.length}</span>
          <span>本书</span>
          {importing && <span className="shelf-busy">正在导入…</span>}
        </div>
        <input
          className="shelf-filter"
          type="search"
          value={filter}
          placeholder="按书名或作者筛选"
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>

      {visible.length === 0 ? (
        <p className="shelf-empty-filter">没有匹配「{filter.trim()}」的书。</p>
      ) : (
        <div className="shelf-grid">
          {visible.map((book) => (
            <article className="book-card" key={book.id}>
              <button
                type="button"
                className="book-open"
                onClick={() => onOpen(book)}
                title={`打开《${book.title}》`}
              >
                <span className="book-cover">
                  <BookCover book={book} />
                </span>
                <span className="book-info">
                  <span className="book-title">{book.title}</span>
                  <span className="book-author">{book.author || '作者未知'}</span>
                </span>
                <span className="book-meta">
                  <span className={`format-badge format-${book.format}`}>
                    {FORMAT_LABEL[book.format]}
                  </span>
                  {book.indexedAt === null && (
                    <span className="index-badge" title="打开一次后会自动建立全文索引">
                      未索引
                    </span>
                  )}
                  <span className="book-percent">{percentLabel(book.percent)}</span>
                </span>
                <span className="book-foot">
                  {book.chapter ||
                    (book.lastOpenedAt ? `最近打开 ${relativeTime(book.lastOpenedAt)}` : '尚未打开')}
                </span>
              </button>
              <button
                type="button"
                className="card-remove"
                onClick={() => onRemove(book)}
                title="移出书库"
              >
                移除
              </button>
            </article>
          ))}
        </div>
      )}

      {removedSection}

      {dragging && <div className="drop-hint">松手即可导入</div>}
    </main>
  )
}
