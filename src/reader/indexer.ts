import type { Book as EpubBook } from 'epubjs'
import type { IndexChunk, ShelfBook } from '../../shared/types'
import { api } from '../lib/api'
import type { TocEntry } from './TocDrawer'

/**
 * 打开一本书后把正文写进 FTS 索引。
 * 只在这里接触 epub.js 的 Section；主进程只收纯文本，不解析 EPUB。
 */

/** 每批提交的字符数上限，避免一次 IPC 传几十兆。 */
const BATCH_CHARS = 300_000
const MAX_CHAPTER_CHARS = 500_000

type SpineItem = { href?: string }

function normalizeHref(href: string): string {
  const clean = href.split('#')[0]
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function chapterTitleFor(toc: TocEntry[], href: string, index: number): string {
  const match = toc.find(
    (entry) => entry.href === href || basename(entry.href) === basename(href),
  )
  return match?.label ?? `第 ${index + 1} 节`
}

type LoadableSection = {
  href?: string
  document?: Document
  load?: (loader: unknown) => unknown
  unload?: () => void
  cfiFromRange?: (range: Range) => string
}

/**
 * 逐章取文本并分批提交。返回 false 表示中途失败或被取消——
 * 此时 books.indexed_at 保持为空，下次打开会重新索引。
 */
export async function indexBook(
  book: EpubBook,
  shelf: ShelfBook,
  toc: TocEntry[],
  shouldStop: () => boolean,
): Promise<boolean> {
  const spineItems =
    (book.spine as unknown as { spineItems?: SpineItem[] }).spineItems ?? []
  if (spineItems.length === 0) return false

  const begin = await api.indexBegin(shelf.id)
  if (!begin.ok) return false

  let batch: IndexChunk[] = []
  let batchChars = 0

  const flush = async (): Promise<boolean> => {
    if (batch.length === 0) return true
    const result = await api.indexChunks(shelf.id, batch)
    batch = []
    batchChars = 0
    return result.ok
  }

  try {
    for (let index = 0; index < spineItems.length; index += 1) {
      if (shouldStop()) return false

      const raw = book.spine.get(index) as unknown as LoadableSection | null
      if (!raw) continue

      try {
        // epub.js 的类型把 load 写成同步，实际返回 Promise；这里局部断言。
        await (raw.load?.(book.load.bind(book)) as unknown as Promise<unknown>)
      } catch {
        // 单章解析失败不应中断整本书的索引。
        continue
      }
      if (shouldStop()) return false

      const text = raw.document?.body?.textContent ?? ''
      const href = normalizeHref(raw.href ?? spineItems[index]?.href ?? '')
      try {
        raw.unload?.()
      } catch {
        // 章节尚未完整加载时 unload 会抛，忽略。
      }

      if (text.trim().length === 0) continue
      batch.push({
        chapterIndex: index,
        chapterTitle: chapterTitleFor(toc, href, index),
        href,
        text: text.slice(0, MAX_CHAPTER_CHARS),
      })
      batchChars += Math.min(text.length, MAX_CHAPTER_CHARS)

      if (batchChars >= BATCH_CHARS) {
        if (!(await flush())) return false
      }
    }

    if (!(await flush())) return false
    const finish = await api.indexFinish(shelf.id)
    return finish.ok
  } catch (error) {
    console.warn('[Lumen] 索引没有完成', error)
    return false
  }
}
