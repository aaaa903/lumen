import type { Book as EpubBook, NavItem } from 'epubjs'
import type { TocEntry } from './TocDrawer'

/** 目录 href 可能带锚点、URL 编码或相对路径；比较与 display 前统一成相对路径。 */
export function normalizeHref(href: string): string {
  const clean = href.split('#')[0]
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function flattenToc(items: NavItem[], depth = 0): TocEntry[] {
  return items.flatMap((item) => [
    { label: item.label.trim() || '未命名章节', href: normalizeHref(item.href), depth },
    ...(item.subitems ? flattenToc(item.subitems, depth + 1) : []),
  ])
}

/** 没有 nav 目录的 EPUB（不少 EPUB2 老书）退化成按 spine 顺序列章，上一章/下一章仍然可用。 */
export function spineFallback(book: EpubBook): TocEntry[] {
  const items =
    (book.spine as unknown as { spineItems?: Array<{ href?: string }> }).spineItems ?? []
  return items
    .map((item, index) => ({
      label: `第 ${index + 1} 节`,
      href: normalizeHref(item.href ?? ''),
      depth: 0,
    }))
    .filter((entry) => entry.href.length > 0)
}
