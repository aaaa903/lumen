import type { Note, SaveNoteInput } from '../../../shared/types'
import type { Db } from '../open'

type NoteRow = {
  id: string
  book_id: string | null
  book_title: string | null
  title: string
  body_md: string
  created_at: number
  updated_at: number
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title ?? '',
    title: row.title,
    bodyMd: row.body_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 笔记随书保留：书被移出书库后仍显示书名，只是 book_id 指向的书已软删。 */
const SELECT_NOTES = `
  SELECT n.id AS id, n.book_id AS book_id, b.title AS book_title,
         n.title AS title, n.body_md AS body_md,
         n.created_at AS created_at, n.updated_at AS updated_at
  FROM notes n
  LEFT JOIN books b ON b.id = n.book_id
`

export function listNotes(db: Db): Note[] {
  const rows = db
    .prepare(`${SELECT_NOTES} WHERE n.deleted_at IS NULL ORDER BY n.updated_at DESC`)
    .all() as NoteRow[]
  return rows.map(toNote)
}

export function findNote(db: Db, id: string): Note | null {
  const row = db.prepare(`${SELECT_NOTES} WHERE n.id = ? AND n.deleted_at IS NULL`).get(id) as
    | NoteRow
    | undefined
  return row ? toNote(row) : null
}

export function saveNote(db: Db, input: SaveNoteInput): Note | null {
  const now = Date.now()
  const bookId = input.bookId && input.bookId.length > 0 ? input.bookId : null

  if (input.id) {
    const result = db
      .prepare(
        `UPDATE notes SET book_id = ?, title = ?, body_md = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(bookId, input.title, input.bodyMd, now, input.id)
    if (Number(result.changes) === 0) return null
    return findNote(db, input.id)
  }

  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO notes (id, book_id, title, body_md, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(id, bookId, input.title, input.bodyMd, now, now)
  return findNote(db, id)
}

export function deleteNote(db: Db, id: string, at: number): boolean {
  const result = db
    .prepare('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(at, at, id)
  return Number(result.changes) > 0
}
