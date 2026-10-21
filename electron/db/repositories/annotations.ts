import type {
  Annotation,
  AnnotationColor,
  AnnotationKind,
  AnnotationLocator,
  CreateAnnotationInput,
} from '../../../shared/types'
import { parseLocator } from '../../../shared/locator'
import type { Db } from '../open'

type AnnotationRow = {
  id: string
  book_id: string
  group_id: string | null
  kind: AnnotationKind
  color: AnnotationColor
  locator: string
  note_md: string
  orphaned: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** 库里只有 JSON 文本；损坏时退化成「位置失效」，不能让整本书打不开。 */
function toAnnotation(row: AnnotationRow): Annotation {
  const parsed = parseLocator(safeJson(row.locator))
  const locator: AnnotationLocator = {
    format: parsed?.format ?? 'epub',
    cfi: parsed?.cfi ?? null,
    href: parsed?.href ?? '',
    chapterIndex: parsed?.chapterIndex ?? 0,
    chapterTitle: parsed?.chapterTitle ?? '',
    page: parsed?.page ?? 0,
    percent: parsed?.percent ?? 0,
    quote: parsed?.quote ?? '',
    prefix: parsed?.prefix ?? '',
    suffix: parsed?.suffix ?? '',
  }

  return {
    id: row.id,
    bookId: row.book_id,
    groupId: row.group_id,
    kind: row.kind,
    color: row.color,
    locator,
    noteMd: row.note_md,
    orphaned: parsed ? row.orphaned : 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

function safeJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown
  } catch {
    return null
  }
}

export function listAnnotations(db: Db, bookId: string): Annotation[] {
  const rows = db
    .prepare(
      `SELECT * FROM annotations
       WHERE book_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`,
    )
    .all(bookId) as AnnotationRow[]
  return rows.map(toAnnotation)
}

export function getAnnotation(db: Db, id: string): Annotation | null {
  const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as
    | AnnotationRow
    | undefined
  return row ? toAnnotation(row) : null
}

export function insertAnnotation(db: Db, input: CreateAnnotationInput): Annotation {
  const now = Date.now()
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO annotations (id, book_id, group_id, kind, color, locator, note_md,
                              orphaned, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
  ).run(
    id,
    input.bookId,
    input.groupId,
    input.kind,
    input.color,
    JSON.stringify(input.locator),
    input.noteMd,
    now,
    now,
  )
  return {
    id,
    bookId: input.bookId,
    groupId: input.groupId,
    kind: input.kind,
    color: input.color,
    locator: input.locator,
    noteMd: input.noteMd,
    orphaned: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

/** 更新只覆盖传入的字段；没传的保持原值，避免一次改颜色把批注清空。 */
export function updateAnnotation(
  db: Db,
  id: string,
  patch: {
    color?: AnnotationColor
    noteMd?: string
    locator?: AnnotationLocator
    orphaned?: boolean
  },
): Annotation | null {
  const current = getAnnotation(db, id)
  if (!current || current.deletedAt !== null) return null

  const next: Annotation = {
    ...current,
    color: patch.color ?? current.color,
    noteMd: patch.noteMd ?? current.noteMd,
    locator: patch.locator ?? current.locator,
    orphaned: patch.orphaned === undefined ? current.orphaned : patch.orphaned ? 1 : 0,
    updatedAt: Date.now(),
  }

  db.prepare(
    `UPDATE annotations
     SET color = ?, note_md = ?, locator = ?, orphaned = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.color,
    next.noteMd,
    JSON.stringify(next.locator),
    next.orphaned,
    next.updatedAt,
    id,
  )
  return next
}

export function softDeleteAnnotation(db: Db, id: string): Annotation | null {
  const current = getAnnotation(db, id)
  if (!current || current.deletedAt !== null) return null
  const now = Date.now()
  db.prepare('UPDATE annotations SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
    now,
    now,
    id,
  )
  return { ...current, deletedAt: now, updatedAt: now }
}

export function restoreAnnotation(db: Db, id: string): Annotation | null {
  const current = getAnnotation(db, id)
  if (!current) return null
  const now = Date.now()
  db.prepare('UPDATE annotations SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, id)
  return { ...current, deletedAt: null, updatedAt: now }
}

export function countAnnotations(db: Db, bookId: string): number {
  const row = db
    .prepare(
      'SELECT count(*) AS n FROM annotations WHERE book_id = ? AND deleted_at IS NULL',
    )
    .get(bookId) as { n: number }
  return row.n
}
