import type {
  AnnotationSearchHit,
  IndexChunk,
  SearchHit,
  TextSearchHit,
} from '../../../shared/types'
import { cleanQuery, makeSnippet, planSearch } from '../../../shared/search-query'
import { parseLocator } from '../../../shared/locator'
import type { Db } from '../open'
import { withTransaction } from '../open'

type ChunkRow = {
  book_id: string
  book_title: string
  author: string
  chapter_index: number
  chapter_title: string
  href: string
  text: string
}

type AnnotationRow = {
  id: string
  book_id: string
  book_title: string
  author: string
  kind: 'highlight' | 'note' | 'bookmark'
  color: 'yellow' | 'green' | 'blue' | 'pink' | 'slate'
  locator: string
  note_md: string
  created_at: number
}

/** 重新索引一本书：先清空旧块，避免改版后残留重复命中。 */
export function beginIndex(db: Db, bookId: string): void {
  withTransaction(db, () => {
    db.prepare('DELETE FROM search_chunks WHERE book_id = ?').run(bookId)
    db.prepare('UPDATE books SET indexed_at = NULL WHERE id = ?').run(bookId)
  })
}

export function appendChunks(db: Db, bookId: string, chunks: IndexChunk[]): void {
  if (chunks.length === 0) return
  const insert = db.prepare(
    `INSERT INTO search_chunks (book_id, chapter_index, chapter_title, href, text)
     VALUES (?, ?, ?, ?, ?)`,
  )
  withTransaction(db, () => {
    for (const chunk of chunks) {
      insert.run(bookId, chunk.chapterIndex, chunk.chapterTitle, chunk.href, chunk.text)
    }
  })
}

export function finishIndex(db: Db, bookId: string, at: number): void {
  db.prepare('UPDATE books SET indexed_at = ? WHERE id = ?').run(at, bookId)
}

function toTextHit(row: ChunkRow, query: string): TextSearchHit {
  const snippet = makeSnippet(row.text, query)
  return {
    kind: 'text',
    bookId: row.book_id,
    bookTitle: row.book_title,
    author: row.author,
    chapterIndex: row.chapter_index,
    chapterTitle: row.chapter_title,
    href: row.href,
    snippet: snippet.text,
    matchStart: snippet.matchStart,
    matchLength: snippet.matchLength,
  }
}

/** 正文检索：3 字以上走 FTS5，短查询（中文两字词）退化为 LIKE。 */
export function searchText(db: Db, rawQuery: string, limit: number): TextSearchHit[] {
  const plan = planSearch(rawQuery)
  if (!plan) return []
  const query = cleanQuery(rawQuery)

  if (plan.mode === 'match') {
    const rows = db
      .prepare(
        `SELECT c.book_id AS book_id, b.title AS book_title, b.author AS author,
                c.chapter_index AS chapter_index, c.chapter_title AS chapter_title,
                c.href AS href, c.text AS text
         FROM search_fts
         JOIN search_chunks c ON c.id = search_fts.rowid
         JOIN books b ON b.id = c.book_id
         WHERE search_fts MATCH ? AND b.deleted_at IS NULL
         ORDER BY bm25(search_fts)
         LIMIT ?`,
      )
      .all(plan.value, limit) as ChunkRow[]
    return rows.map((row) => toTextHit(row, query))
  }

  const rows = db
    .prepare(
      `SELECT c.book_id AS book_id, b.title AS book_title, b.author AS author,
              c.chapter_index AS chapter_index, c.chapter_title AS chapter_title,
              c.href AS href, c.text AS text
       FROM search_chunks c
       JOIN books b ON b.id = c.book_id
       WHERE c.text LIKE ? ESCAPE '\\' AND b.deleted_at IS NULL
       ORDER BY COALESCE(b.last_opened_at, b.added_at) DESC, c.chapter_index ASC
       LIMIT ?`,
    )
    .all(plan.value, limit) as ChunkRow[]
  return rows.map((row) => toTextHit(row, query))
}

function toAnnotationHit(row: AnnotationRow): AnnotationSearchHit {
  const locator = parseLocator(safeJson(row.locator))
  return {
    kind: 'annotation',
    annotationId: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    author: row.author,
    chapterIndex: locator?.chapterIndex ?? 0,
    chapterTitle: locator?.chapterTitle ?? '',
    href: locator?.href ?? '',
    quote: locator?.quote ?? '',
    noteMd: row.note_md,
    color: row.color,
    annotationKind: row.kind,
    createdAt: row.created_at,
  }
}

function safeJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown
  } catch {
    return null
  }
}

/** 标注检索：原文片段、批注正文、标签名都能命中；标签过滤只作用于这个分支。 */
export function searchAnnotations(
  db: Db,
  rawQuery: string,
  limit: number,
  tagId: string | null,
): AnnotationSearchHit[] {
  const plan = planSearch(rawQuery)
  if (!plan) return []
  const like = `%${cleanQuery(rawQuery)
    .replace(/[\\%_]/g, (char) => `\\${char}`)
    .toLowerCase()}%`

  const tagClause = tagId
    ? `AND EXISTS (
         SELECT 1 FROM annotation_tags at
         WHERE at.annotation_id = a.id AND at.tag_id = ?
       )`
    : ''

  const params: Array<string | number> = [like, like]
  if (tagId) params.push(tagId)
  params.push(limit)

  const rows = db
    .prepare(
      `SELECT a.id AS id, a.book_id AS book_id, b.title AS book_title, b.author AS author,
              a.kind AS kind, a.color AS color, a.locator AS locator,
              a.note_md AS note_md, a.created_at AS created_at
       FROM annotations a
       JOIN books b ON b.id = a.book_id
       WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
         AND (lower(a.locator) LIKE ? ESCAPE '\\' OR lower(a.note_md) LIKE ? ESCAPE '\\')
         ${tagClause}
       ORDER BY a.updated_at DESC
       LIMIT ?`,
    )
    .all(...params) as AnnotationRow[]

  return rows.map(toAnnotationHit)
}

export function search(
  db: Db,
  input: { q: string; scope: 'text' | 'annotations'; tagId: string | null; limit: number },
): SearchHit[] {
  if (input.scope === 'annotations') {
    return searchAnnotations(db, input.q, input.limit, input.tagId)
  }
  return searchText(db, input.q, input.limit)
}
