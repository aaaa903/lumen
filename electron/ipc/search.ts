import type { IndexChunk, SearchHit, SearchScope } from '../../shared/types'
import type { Db } from '../db/open'
import { getShelfBook } from '../db/repositories/books'
import { appendChunks, beginIndex, finishIndex, search } from '../db/repositories/search'
import { handle, IpcError, ok, readObject, readString } from './handle'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_CHUNK_LENGTH = 500_000
const MAX_CHUNKS_PER_CALL = 500
const MAX_TOTAL_LENGTH = 5_000_000

function readScope(value: unknown): SearchScope {
  return value === 'annotations' ? 'annotations' : 'text'
}

function requireBook(db: Db, bookId: string): string {
  if (!getShelfBook(db, bookId)) {
    throw new IpcError('NOT_FOUND', '这本书不在书库里，索引没有写入。')
  }
  return bookId
}

function readChunks(value: unknown): IndexChunk[] {
  if (!Array.isArray(value) || value.length > MAX_CHUNKS_PER_CALL) {
    throw new IpcError('TOO_LARGE', '一次提交的章节过多，请减少批次后再试。')
  }

  let total = 0
  const chunks: IndexChunk[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) {
      throw new IpcError('INTERNAL', '索引数据格式不正确。')
    }
    const item = raw as Record<string, unknown>
    if (typeof item['text'] !== 'string') {
      throw new IpcError('INTERNAL', '索引数据缺少正文。')
    }
    const text = item['text']
    if (text.length > MAX_CHUNK_LENGTH) {
      throw new IpcError('TOO_LARGE', '单章正文超过 50 万字符，索引已停止。')
    }
    total += text.length
    if (total > MAX_TOTAL_LENGTH) {
      throw new IpcError('TOO_LARGE', '单次索引数据过大，请减少批次后再试。')
    }
    if (text.trim().length === 0) continue

    const chapterIndex =
      typeof item['chapterIndex'] === 'number' && Number.isFinite(item['chapterIndex'])
        ? Math.max(0, Math.trunc(item['chapterIndex']))
        : 0
    chunks.push({
      chapterIndex,
      chapterTitle: typeof item['chapterTitle'] === 'string' ? item['chapterTitle'] : '',
      href: typeof item['href'] === 'string' ? item['href'] : '',
      text,
    })
  }
  return chunks
}

export function registerSearchIpc(db: Db): void {
  handle<null>('search:indexBegin', (payload) => {
    const bookId = requireBook(db, readString(readObject(payload)['bookId'], 'bookId'))
    beginIndex(db, bookId)
    return ok(null)
  })

  handle<null>('search:indexChunks', (payload) => {
    const raw = readObject(payload)
    const bookId = requireBook(db, readString(raw['bookId'], 'bookId'))
    appendChunks(db, bookId, readChunks(raw['chunks']))
    return ok(null)
  })

  handle<null>('search:indexFinish', (payload) => {
    const bookId = requireBook(db, readString(readObject(payload)['bookId'], 'bookId'))
    finishIndex(db, bookId, Date.now())
    return ok(null)
  })

  handle<SearchHit[]>('search:query', (payload) => {
    const raw = readObject(payload)
    const q = typeof raw['q'] === 'string' ? raw['q'].trim() : ''
    if (q.length === 0) return ok([])
    if (q.length > 200) {
      throw new IpcError('TOO_LARGE', '检索词太长，请缩短到 200 字以内。')
    }

    const limit = Math.min(
      MAX_LIMIT,
      Math.max(
        1,
        typeof raw['limit'] === 'number' && Number.isFinite(raw['limit'])
          ? Math.trunc(raw['limit'])
          : DEFAULT_LIMIT,
      ),
    )
    const tagId = typeof raw['tagId'] === 'string' && raw['tagId'].length > 0 ? raw['tagId'] : null

    return ok(
      search(db, {
        q,
        scope: readScope(raw['scope']),
        tagId,
        limit,
      }),
    )
  })
}
