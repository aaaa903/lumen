import { useEffect } from 'react'
import ePub from 'epubjs'
import { api } from '../lib/api'
import { loadBookAsEpub } from '../lib/convert/text-epub'
import { indexBook } from './indexer'
import { flattenToc, spineFallback } from './toc'

const IDLE_POLL_MS = 1200
const RETRY_POLL_MS = 2000

/**
 * 隐藏索引窗口挂载的组件。主进程通过 `?worker=index` 打开同一份渲染产物，
 * 这里循环领取任务，用 epub.js 逐章取文本后写进 FTS；界面上看不到任何东西。
 *
 * 任务采用「租约」而不是直接消费：页面被卸载（StrictMode 二次挂载、热更新）时
 * 必须把领到但没做完的任务还回去，否则主进程会一直等一个不会到来的完成报告。
 */
export default function IndexWorker() {
  useEffect(() => {
    let stopped = false
    let idleTimer: number | undefined

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        idleTimer = window.setTimeout(resolve, ms)
      })

    const processJob = async (bookId: string): Promise<void> => {
      let ok = false
      try {
        const shelf = await api.getBook(bookId)
        if (!shelf.ok) return
        if (shelf.data.format === 'pdf') {
          // PDF 不参与全文搜索，直接报告完成，避免任务在队列里反复出现。
          ok = true
          return
        }

        const bytes = await loadBookAsEpub(shelf.data)
        if (stopped) return
        const epub = ePub(bytes)
        try {
          await epub.ready
          const navigation = await epub.loaded.navigation
          const flat = flattenToc(navigation.toc)
          const entries = flat.length > 0 ? flat : spineFallback(epub)
          ok = await indexBook(epub, shelf.data, entries, () => stopped)
        } finally {
          try {
            epub.destroy()
          } catch {
            // 未完成渲染时销毁会抛，忽略。
          }
        }
      } catch (error) {
        console.warn('[Lumen] 后台索引失败', bookId, error)
      } finally {
        // 中途被卸载就把任务还回去，不计入重试次数。
        if (stopped) await api.indexerRelease(bookId)
        else await api.indexerComplete(bookId, ok)
      }
    }

    const loop = async (): Promise<void> => {
      while (!stopped) {
        const job = await api.indexerNext()
        if (!job.ok) {
          if (stopped) break
          await sleep(RETRY_POLL_MS)
          continue
        }
        if (!job.data) {
          if (stopped) break
          await sleep(IDLE_POLL_MS)
          continue
        }

        const bookId = job.data.bookId
        if (stopped) {
          // 已经拿到任务但页面正在卸载：立刻还回队列。
          await api.indexerRelease(bookId)
          break
        }
        await processJob(bookId)
      }
    }

    void loop()

    return () => {
      stopped = true
      window.clearTimeout(idleTimer)
    }
  }, [])

  return <div className="index-worker" aria-hidden="true" />
}
