import type { Progress } from '../../../shared/types'
import type { Db } from '../open'

type ProgressRow = {
  book_id: string
  locator: string
  percent: number
  chapter: string
  updated_at: number
}

/** locator 以 JSON 文本存库：坏数据只让这一本书退回首页，不阻断整页渲染。 */
export function getProgress(db: Db, bookId: string): Progress | null {
  const row = db
    .prepare('SELECT book_id, locator, percent, chapter, updated_at FROM progress WHERE book_id = ?')
    .get(bookId) as ProgressRow | undefined
  if (!row) return null

  try {
    const locator = JSON.parse(row.locator) as Progress['locator']
    if (!locator || typeof locator !== 'object') return null
    return {
      bookId: row.book_id,
      locator,
      percent: row.percent,
      chapter: row.chapter,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export type SaveProgressInput = {
  bookId: string
  locator: Progress['locator']
  percent: number
  chapter: string
}

export function saveProgress(db: Db, input: SaveProgressInput): boolean {
  const exists = db
    .prepare('SELECT 1 AS hit FROM books WHERE id = ? AND deleted_at IS NULL')
    .get(input.bookId)
  if (!exists) return false

  const percent = Number.isFinite(input.percent) ? Math.min(1, Math.max(0, input.percent)) : 0

  db.prepare(
    `INSERT INTO progress (book_id, locator, percent, chapter, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET
       locator = excluded.locator,
       percent = excluded.percent,
       chapter = excluded.chapter,
       updated_at = excluded.updated_at`,
  ).run(input.bookId, JSON.stringify(input.locator), percent, input.chapter, Date.now())

  return true
}
