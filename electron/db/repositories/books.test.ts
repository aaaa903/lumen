import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { Book } from '../../../shared/types'
import { migrations } from '../migrations'
import {
  findByHash,
  findRemovedByHash,
  insertBook,
  listRemoved,
  listShelf,
  removeBook,
  restoreBook,
} from './books'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const migration of migrations) db.exec(migration.sql)
  return db
}

function sampleBook(overrides: Partial<Book> = {}): Book {
  const id = overrides.id ?? 'book-1'
  return {
    id,
    title: '测试书',
    author: '某人',
    format: 'epub',
    filePath: `books/${id}.epub`,
    sha256: `sha-${id}`,
    size: 1024,
    coverPath: null,
    chapterCount: 3,
    pageCount: 0,
    indexedAt: 1000,
    addedAt: 1000,
    lastOpenedAt: 2000,
    deletedAt: null,
    ...overrides,
  }
}

function seedChildRows(db: DatabaseSync, bookId: string): void {
  db.prepare(
    'INSERT INTO progress (book_id, locator, percent, chapter, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(bookId, '{"cfi":null,"href":"c1.xhtml"}', 0.42, '第一章', 3000)
  db.prepare(
    `INSERT INTO annotations (id, book_id, group_id, kind, color, locator, note_md,
                              orphaned, created_at, updated_at, deleted_at)
     VALUES (?, ?, NULL, 'highlight', 'yellow', ?, '', 0, ?, ?, NULL)`,
  ).run('ann-1', bookId, '{"quote":"一句话"}', 3000, 3000)
}

describe('书库的移出与恢复', () => {
  it('移出的书不再参与导入去重，但仍能按哈希找回', () => {
    const db = makeDb()
    const book = sampleBook()
    insertBook(db, book)

    expect(findByHash(db, book.sha256)?.id).toBe(book.id)

    expect(removeBook(db, book.id, false, 5000)).toBe(true)

    // 去重只针对书架上的书，否则重新导入会被误判成「已在书库」。
    expect(findByHash(db, book.sha256)).toBeNull()
    expect(findRemovedByHash(db, book.sha256)?.id).toBe(book.id)
    expect(listShelf(db)).toHaveLength(0)
    expect(listRemoved(db).map((item) => item.id)).toEqual([book.id])
    expect(listRemoved(db)[0].deletedAt).toBe(5000)
  })

  it('恢复只清 deleted_at，标注、进度与打开时间原样保留', () => {
    const db = makeDb()
    const book = sampleBook()
    insertBook(db, book)
    seedChildRows(db, book.id)

    removeBook(db, book.id, false, 5000)
    const restored = restoreBook(db, book.id)

    expect(restored?.id).toBe(book.id)
    expect(restored?.deletedAt).toBeNull()
    expect(restored?.lastOpenedAt).toBe(2000)
    expect(listShelf(db).map((item) => item.id)).toEqual([book.id])
    expect(listRemoved(db)).toHaveLength(0)

    const progress = db.prepare('SELECT count(*) AS n FROM progress WHERE book_id = ?').get(book.id) as {
      n: number
    }
    const annotations = db
      .prepare('SELECT count(*) AS n FROM annotations WHERE book_id = ?')
      .get(book.id) as { n: number }
    expect(progress.n).toBe(1)
    expect(annotations.n).toBe(1)

    // 已经在书架上的书不能重复恢复。
    expect(restoreBook(db, book.id)).toBeNull()
  })

  it('彻底删除会连同进度与标注一起清掉', () => {
    const db = makeDb()
    const book = sampleBook()
    insertBook(db, book)
    seedChildRows(db, book.id)

    expect(removeBook(db, book.id, true, 5000)).toBe(true)

    expect(findByHash(db, book.sha256)).toBeNull()
    expect(findRemovedByHash(db, book.sha256)).toBeNull()
    expect(listShelf(db)).toHaveLength(0)
    expect(listRemoved(db)).toHaveLength(0)
    expect((db.prepare('SELECT count(*) AS n FROM progress').get() as { n: number }).n).toBe(0)
    expect((db.prepare('SELECT count(*) AS n FROM annotations').get() as { n: number }).n).toBe(0)
  })

  it('「已移除」按移出时间倒序排列', () => {
    const db = makeDb()
    insertBook(db, sampleBook({ id: 'book-1', sha256: 'sha-1' }))
    insertBook(db, sampleBook({ id: 'book-2', sha256: 'sha-2' }))
    removeBook(db, 'book-1', false, 5000)
    removeBook(db, 'book-2', false, 9000)

    expect(listRemoved(db).map((item) => item.id)).toEqual(['book-2', 'book-1'])
  })
})
