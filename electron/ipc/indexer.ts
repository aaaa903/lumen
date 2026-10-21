import type { IndexerJob } from '../../shared/types'
import type { Db } from '../db/open'
import { getShelfBook } from '../db/repositories/books'
import type { Indexer } from '../indexer'
import { handle, IpcError, ok, readBoolean, readObject, readString } from './handle'

/** 后台索引窗口与主进程的任务通道；不暴露给普通组件。 */
export function registerIndexerIpc(db: Db, indexer: Indexer): void {
  handle<null>('indexer:request', (payload) => {
    const bookId = readString(readObject(payload)['bookId'], 'bookId')
    if (!getShelfBook(db, bookId)) {
      throw new IpcError('NOT_FOUND', '这本书不在书库里，无法建立索引。')
    }
    indexer.enqueue(bookId)
    return ok(null)
  })

  handle<IndexerJob | null>('indexer:next', () => ok(indexer.takeNext()))

  handle<null>('indexer:release', (payload) => {
    const bookId = readString(readObject(payload)['bookId'], 'bookId')
    indexer.release(bookId)
    return ok(null)
  })

  handle<null>('indexer:complete', (payload) => {
    const raw = readObject(payload)
    const bookId = readString(raw['bookId'], 'bookId')
    indexer.complete(bookId, readBoolean(raw['ok']))
    return ok(null)
  })
}
