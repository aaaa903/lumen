import { readFile, unlink } from 'node:fs/promises'
import { extname } from 'node:path'
import { dialog } from 'electron'
import type { ImportResult, ShelfBook } from '../../shared/types'
import type { Db } from '../db/open'
import { getShelfBook, listShelf, removeBook, touchBook, updatePdfMeta } from '../db/repositories/books'
import type { Indexer } from '../indexer'
import { importBook } from '../library/import'
import { resolveUserDataPath } from '../library/paths'
import { fail, handle, IpcError, ok, readBoolean, readObject, readString, readStringArray } from './handle'

const COVER_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

function requireBook(db: Db, id: string): ShelfBook {
  const book = getShelfBook(db, id)
  if (!book) throw new IpcError('NOT_FOUND', '这本书不在书库里，可能已经被移除。')
  return book
}

/** 读成独立的 ArrayBuffer：Buffer 可能只是大内存池的一段视图，直接传会带出无关字节。 */
async function readFileBuffer(absolutePath: string): Promise<ArrayBuffer> {
  const buffer = await readFile(absolutePath)
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer
}

export function registerBookIpc(db: Db, indexer: Indexer): void {
  handle<ImportResult[]>('books:import', async (payload) => {
    const paths = readStringArray(readObject(payload)['paths'], 'paths')
    const results: ImportResult[] = []
    // 逐本处理：一本坏书不能拖垮整批导入。
    for (const path of paths) {
      const result = await importBook(db, path)
      results.push(result)
      // 导入完就排队建索引，用户不必先打开一次才能搜到。
      if (result.status === 'ok' && result.book.format !== 'pdf') {
        indexer.enqueue(result.book.id)
      }
    }
    return ok(results)
  })

  handle<ShelfBook[]>('books:list', () => ok(listShelf(db)))

  handle<ShelfBook>('books:get', (payload) => {
    const id = readString(readObject(payload)['id'], 'id')
    return ok(requireBook(db, id))
  })

  handle<ArrayBuffer>('books:readFile', async (payload) => {
    const id = readString(readObject(payload)['id'], 'id')
    const book = requireBook(db, id)
    try {
      return ok(await readFileBuffer(resolveUserDataPath(book.filePath)))
    } catch (error) {
      throw new IpcError(
        'IO_ERROR',
        `读不到这本书的文件（${error instanceof Error ? error.message : '未知原因'}）。可以尝试删除后重新导入。`,
      )
    }
  })

  handle<{ mime: string; data: ArrayBuffer } | null>('books:readCover', async (payload) => {
    const id = readString(readObject(payload)['id'], 'id')
    const book = requireBook(db, id)
    if (!book.coverPath) return ok(null)
    try {
      const data = await readFileBuffer(resolveUserDataPath(book.coverPath))
      const mime = COVER_MIME[extname(book.coverPath).toLowerCase()] ?? 'image/jpeg'
      return ok({ mime, data })
    } catch {
      // 封面丢了不影响阅读，交给书架显示首字封面。
      return ok(null)
    }
  })

  handle<ShelfBook>('books:updateMeta', (payload) => {
    const raw = readObject(payload)
    const id = readString(raw['id'], 'id')
    const book = requireBook(db, id)
    if (book.format !== 'pdf') {
      throw new IpcError('UNSUPPORTED', '只有 PDF 会在打开时回填元数据。')
    }

    const title = typeof raw['title'] === 'string' ? raw['title'].slice(0, 300) : undefined
    const author = typeof raw['author'] === 'string' ? raw['author'].slice(0, 200) : undefined
    const pageCount =
      typeof raw['pageCount'] === 'number' && Number.isFinite(raw['pageCount'])
        ? Math.max(0, Math.trunc(raw['pageCount']))
        : undefined
    updatePdfMeta(db, id, { title, author, pageCount })
    return ok(requireBook(db, id))
  })

  handle<null>('books:remove', async (payload) => {
    const raw = readObject(payload)
    const id = readString(raw['id'], 'id')
    const purge = readBoolean(raw['purge'])
    const book = getShelfBook(db, id)
    const removed = removeBook(db, id, purge, Date.now())
    if (!removed) return fail('NOT_FOUND', '这本书已经不在书库里了。')

    if (purge && book) {
      await unlink(resolveUserDataPath(book.filePath)).catch(() => undefined)
      if (book.coverPath) {
        await unlink(resolveUserDataPath(book.coverPath)).catch(() => undefined)
      }
    }
    return ok(null)
  })

  handle<null>('books:touch', (payload) => {
    const id = readString(readObject(payload)['id'], 'id')
    touchBook(db, id, Date.now())
    return ok(null)
  })

  handle<string[]>('app:pickFiles', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入书籍',
      buttonLabel: '导入',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '书籍文件', extensions: ['epub', 'pdf', 'md', 'markdown', 'txt'] }],
    })
    return ok(result.canceled ? [] : result.filePaths)
  })
}
