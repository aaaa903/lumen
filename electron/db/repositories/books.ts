import type { Book, BookFormat, ShelfBook } from '../../../shared/types'
import type { Db } from '../open'

type BookRow = {
  id: string
  title: string
  author: string
  format: BookFormat
  file_path: string
  sha256: string
  size: number
  cover_path: string | null
  chapter_count: number
  indexed_at: number | null
  added_at: number
  last_opened_at: number | null
  deleted_at: number | null
}

type ShelfRow = BookRow & {
  percent: number | null
  chapter: string | null
}

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format,
    filePath: row.file_path,
    sha256: row.sha256,
    size: row.size,
    coverPath: row.cover_path,
    chapterCount: row.chapter_count,
    indexedAt: row.indexed_at,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at,
    deletedAt: row.deleted_at,
  }
}

function toShelfBook(row: ShelfRow): ShelfBook {
  return {
    ...toBook(row),
    percent: row.percent ?? 0,
    chapter: row.chapter ?? '',
  }
}

const SELECT_SHELF = `
  SELECT b.*, p.percent AS percent, p.chapter AS chapter
  FROM books b
  LEFT JOIN progress p ON p.book_id = b.id
`

export function findByHash(db: Db, sha256: string): Book | null {
  const row = db.prepare('SELECT * FROM books WHERE sha256 = ?').get(sha256) as BookRow | undefined
  return row ? toBook(row) : null
}

export function insertBook(db: Db, book: Book): void {
  db.prepare(
    `INSERT INTO books (id, title, author, format, file_path, sha256, size, cover_path,
                        chapter_count, indexed_at, added_at, last_opened_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    book.id,
    book.title,
    book.author,
    book.format,
    book.filePath,
    book.sha256,
    book.size,
    book.coverPath,
    book.chapterCount,
    book.indexedAt,
    book.addedAt,
    book.lastOpenedAt,
    book.deletedAt,
  )
}

/** 书架排序：最近打开优先；从未打开过的按导入时间倒序。 */
export function listShelf(db: Db): ShelfBook[] {
  const rows = db
    .prepare(
      `${SELECT_SHELF}
       WHERE b.deleted_at IS NULL
       ORDER BY COALESCE(b.last_opened_at, b.added_at) DESC`,
    )
    .all() as ShelfRow[]
  return rows.map(toShelfBook)
}

export function getShelfBook(db: Db, id: string): ShelfBook | null {
  const row = db.prepare(`${SELECT_SHELF} WHERE b.id = ?`).get(id) as ShelfRow | undefined
  return row ? toShelfBook(row) : null
}

export function touchBook(db: Db, id: string, at: number): void {
  db.prepare('UPDATE books SET last_opened_at = ? WHERE id = ? AND deleted_at IS NULL').run(at, id)
}

/** 默认只移出书库（软删），标注与笔记保留；purge 才真正删除行。 */
export function removeBook(db: Db, id: string, purge: boolean, at: number): boolean {
  const exists = db.prepare('SELECT 1 AS hit FROM books WHERE id = ?').get(id)
  if (!exists) return false
  if (purge) {
    db.prepare('DELETE FROM books WHERE id = ?').run(id)
  } else {
    db.prepare('UPDATE books SET deleted_at = ? WHERE id = ?').run(at, id)
  }
  return true
}

export function countBooks(db: Db): number {
  const row = db.prepare('SELECT count(*) AS n FROM books WHERE deleted_at IS NULL').get() as {
    n: number
  }
  return row.n
}
