import type { AnnotationTag, Tag } from '../../../shared/types'
import type { Db } from '../open'
import { withTransaction } from '../open'

type TagRow = {
  id: string
  name: string
  color: string
  created_at: number
  count: number
}

const TAG_COLORS = ['slate', 'yellow', 'green', 'blue', 'pink'] as const

/** 标签颜色只是视觉区分，按名称稳定分配，重命名后可能换色，可接受。 */
export function pickTagColor(name: string): string {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    count: row.count,
  }
}

const SELECT_TAGS = `
  SELECT t.id AS id, t.name AS name, t.color AS color, t.created_at AS created_at,
         count(DISTINCT a.id) AS count
  FROM tags t
  LEFT JOIN annotation_tags at ON at.tag_id = t.id
  LEFT JOIN annotations a ON a.id = at.annotation_id AND a.deleted_at IS NULL
`

export function listTags(db: Db): Tag[] {
  const rows = db
    .prepare(`${SELECT_TAGS} GROUP BY t.id ORDER BY t.created_at ASC, t.name ASC`)
    .all() as TagRow[]
  return rows.map(toTag)
}

export function findTag(db: Db, id: string): Tag | null {
  const row = db.prepare(`${SELECT_TAGS} WHERE t.id = ? GROUP BY t.id`).get(id) as
    | TagRow
    | undefined
  return row ? toTag(row) : null
}

export function findTagByName(db: Db, name: string): Tag | null {
  const row = db.prepare(`${SELECT_TAGS} WHERE lower(t.name) = lower(?) GROUP BY t.id`).get(name) as
    | TagRow
    | undefined
  return row ? toTag(row) : null
}

export function insertTag(db: Db, name: string): Tag {
  const id = crypto.randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    pickTagColor(name),
    now,
  )
  return { id, name, color: pickTagColor(name), createdAt: now, count: 0 }
}

export function renameTag(db: Db, id: string, name: string): Tag | null {
  db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(name, pickTagColor(name), id)
  return findTag(db, id)
}

export function deleteTag(db: Db, id: string): void {
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)
}

/**
 * 合并标签：把源标签的标注关系搬到目标标签，再删除源标签。
 * 同一条标注同时有两个标签时靠主键去重，不会重复。
 */
export function mergeTags(db: Db, sourceId: string, targetId: string): Tag | null {
  if (!findTag(db, targetId)) return null
  withTransaction(db, () => {
    db.prepare(
      `INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id)
       SELECT annotation_id, ? FROM annotation_tags WHERE tag_id = ?`,
    ).run(targetId, sourceId)
    db.prepare('DELETE FROM tags WHERE id = ?').run(sourceId)
  })
  return findTag(db, targetId)
}

/** 一本书里所有标注的标签关系，用于编辑面板预填。 */
export function listAnnotationTags(db: Db, bookId: string): AnnotationTag[] {
  const rows = db
    .prepare(
      `SELECT at.annotation_id AS annotation_id, at.tag_id AS tag_id
       FROM annotation_tags at
       JOIN annotations a ON a.id = at.annotation_id
       WHERE a.book_id = ? AND a.deleted_at IS NULL`,
    )
    .all(bookId) as Array<{ annotation_id: string; tag_id: string }>
  return rows.map((row) => ({ annotationId: row.annotation_id, tagId: row.tag_id }))
}

export function setAnnotationTags(db: Db, annotationId: string, tagIds: string[]): void {
  const unique = [...new Set(tagIds)]
  withTransaction(db, () => {
    db.prepare('DELETE FROM annotation_tags WHERE annotation_id = ?').run(annotationId)
    const insert = db.prepare(
      'INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id) VALUES (?, ?)',
    )
    for (const tagId of unique) insert.run(annotationId, tagId)
  })
}
