import type { BrowserWindow } from 'electron'
import type { IndexerJob } from '../shared/types'
import type { Db } from './db/open'

/**
 * 导入即索引的任务队列。真正的文本抽取在隐藏窗口里用 epub.js 做，
 * 主进程只负责排队、去重、通知；这样渲染层没有第二套 EPUB 解析器。
 */
export type Indexer = {
  /** 导入成功或打开未索引的书时调用；重复调用不会重复排队。 */
  enqueue: (bookId: string) => void
  /** 启动时把书库里所有未索引的可索引书补齐。 */
  enqueueMissing: () => void
  /** 隐藏窗口领取任务；同一时间只允许一个任务。 */
  takeNext: () => IndexerJob | null
  /** 隐藏窗口被卸载或热更新时把任务原样还给队列，不消耗重试次数。 */
  release: (bookId: string) => void
  /** 隐藏窗口报告结果。成功会通知所有窗口刷新书架。 */
  complete: (bookId: string, ok: boolean) => void
  /** 应用退出前停止定时器，不再创建新窗口。 */
  dispose: () => void
}

type IndexerOptions = {
  db: Db
  /** 创建隐藏索引窗口；返回的窗口关闭时会自动把未完成任务放回队列。 */
  createWorker: () => BrowserWindow
  /** 通知所有界面窗口某本书已索引。 */
  notifyIndexed: (bookId: string) => void
}

const MAX_ATTEMPTS = 2
const IDLE_CLOSE_MS = 20_000
const RETRY_DELAY_MS = 4_000
/**
 * 任务租约：隐藏窗口拿到任务后必须在这个时间内交回结果。
 * 页面被冻结、崩溃或热更新丢掉回调时，靠它把书重新排进队列，避免书架永远「未索引」。
 */
const LEASE_MS = 180_000

export function createIndexer(options: IndexerOptions): Indexer {
  const { db, createWorker, notifyIndexed } = options
  const queue: string[] = []
  const queued = new Set<string>()
  const attempts = new Map<string, number>()
  let active: string | null = null
  let worker: BrowserWindow | null = null
  let idleTimer: NodeJS.Timeout | undefined
  let leaseTimer: NodeJS.Timeout | undefined
  let disposed = false

  const eligible = (bookId: string): boolean => {
    const row = db
      .prepare(
        `SELECT 1 AS hit FROM books
         WHERE id = ? AND deleted_at IS NULL AND indexed_at IS NULL AND format != 'pdf'`,
      )
      .get(bookId)
    return Boolean(row)
  }

  const enqueueFront = (bookId: string): void => {
    if (!queued.has(bookId)) {
      queue.unshift(bookId)
      queued.add(bookId)
    }
    clearTimeout(idleTimer)
    ensureWorker()
  }

  const countAttempt = (bookId: string): number => {
    const tried = (attempts.get(bookId) ?? 0) + 1
    attempts.set(bookId, tried)
    return tried
  }

  const clearLease = (): void => {
    clearTimeout(leaseTimer)
    leaseTimer = undefined
  }

  const scheduleIdle = (): void => {
    clearTimeout(idleTimer)
    if (disposed) return
    idleTimer = setTimeout(() => {
      if (active || queue.length > 0) return
      if (worker && !worker.isDestroyed()) worker.close()
      worker = null
    }, IDLE_CLOSE_MS)
  }

  const ensureWorker = (): void => {
    if (disposed) return
    if (worker && !worker.isDestroyed()) return
    try {
      worker = createWorker()
      worker.on('closed', () => {
        worker = null
        clearLease()
        // 窗口被意外关掉时，正在处理的任务放回队列；次数用尽就让它在下次启动再试。
        if (active) {
          const interrupted = active
          active = null
          if (countAttempt(interrupted) < MAX_ATTEMPTS && !disposed) enqueueFront(interrupted)
        }
        if (!disposed && queue.length > 0) ensureWorker()
      })
    } catch (error) {
      worker = null
      console.error('[Lumen] 创建索引窗口失败', error)
    }
  }

  const enqueue = (bookId: string): void => {
    if (disposed || active === bookId || queued.has(bookId)) return
    if (!eligible(bookId)) return
    queue.push(bookId)
    queued.add(bookId)
    clearTimeout(idleTimer)
    ensureWorker()
  }

  const enqueueMissing = (): void => {
    const rows = db
      .prepare(
        `SELECT id FROM books
         WHERE deleted_at IS NULL AND indexed_at IS NULL AND format != 'pdf'
         ORDER BY added_at ASC`,
      )
      .all() as Array<{ id: string }>
    for (const row of rows) enqueue(row.id)
  }

  const takeNext = (): IndexerJob | null => {
    if (disposed || active) return null
    while (queue.length > 0) {
      const bookId = queue.shift()
      if (!bookId) break
      queued.delete(bookId)
      if (!eligible(bookId)) continue
      active = bookId
      clearTimeout(idleTimer)
      clearLease()
      leaseTimer = setTimeout(() => {
        if (active !== bookId) return
        console.warn('[Lumen] 索引任务超时，重新排队', bookId)
        active = null
        if (countAttempt(bookId) < MAX_ATTEMPTS && !disposed) enqueueFront(bookId)
        else scheduleIdle()
      }, LEASE_MS)
      return { bookId }
    }
    scheduleIdle()
    return null
  }

  /** 页面卸载前把任务还回来：不记重试次数，下个窗口接着做。 */
  const release = (bookId: string): void => {
    if (active !== bookId) return
    active = null
    clearLease()
    if (!disposed && eligible(bookId)) enqueueFront(bookId)
    else scheduleIdle()
  }

  const complete = (bookId: string, ok: boolean): void => {
    if (active === bookId) {
      active = null
      clearLease()
    }
    // 迟到的完成报告可能对应已经重新排队的任务，先把它从队列里摘掉，避免重复索引。
    const index = queue.indexOf(bookId)
    if (index >= 0) {
      queue.splice(index, 1)
      queued.delete(bookId)
    }

    if (ok) {
      attempts.delete(bookId)
      notifyIndexed(bookId)
    } else if (countAttempt(bookId) < MAX_ATTEMPTS && !disposed) {
      setTimeout(() => enqueue(bookId), RETRY_DELAY_MS)
    }

    if (!disposed && queue.length > 0) ensureWorker()
    else scheduleIdle()
  }

  const dispose = (): void => {
    disposed = true
    clearTimeout(idleTimer)
    clearLease()
    queue.length = 0
    queued.clear()
  }

  return {
    enqueue,
    enqueueMissing,
    takeNext,
    release,
    complete,
    dispose,
  }
}
