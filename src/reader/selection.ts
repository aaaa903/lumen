import type { Contents } from 'epubjs'
import type { AnnotationLocator, BookFormat, Locator } from '../../shared/types'
import { buildContext, findBestQuote } from '../../shared/locator'

/**
 * 把 iframe 内的选区变成可入库的 locator。
 * 所有 DOM 操作都限制在 epub.js 提供的 contents.document 内。
 */

const BLOCK_SELECTOR =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, dd, dt, figcaption, div, section, article'

export type SelectionResult = {
  locators: AnnotationLocator[]
  /** 选区在父窗口坐标系里的位置，用于定位浮动工具条。 */
  anchor: { left: number; right: number; top: number; bottom: number }
}

type TextSlice = {
  node: Text
  start: number
  end: number
}

function nearestBlock(node: Node, root: Document): HTMLElement {
  let element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  while (element) {
    if (element.matches(BLOCK_SELECTOR)) return element as HTMLElement
    element = element.parentElement
  }
  return root.body
}

/**
 * 选区可能跨多个段落。按「最近的块级祖先」分组，每组生成一条标注；
 * 调用方用同一个 groupId 串起来，删除时按组操作。
 */
function splitByBlocks(range: Range, root: Document): Array<{ block: HTMLElement; range: Range }> {
  const container = range.commonAncestorContainer
  const walkRoot = container.nodeType === Node.TEXT_NODE ? container.parentElement : container
  if (!walkRoot) return []

  const walker = root.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT)
  const groups = new Map<HTMLElement, TextSlice[]>()

  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    if (text.data.trim().length > 0 && range.intersectsNode(text)) {
      const block = nearestBlock(text, root)
      const start = text === range.startContainer ? range.startOffset : 0
      const end = text === range.endContainer ? range.endOffset : text.data.length
      if (end > start) {
        const slices = groups.get(block) ?? []
        slices.push({ node: text, start, end })
        groups.set(block, slices)
      }
    }
    node = walker.nextNode()
  }

  const result: Array<{ block: HTMLElement; range: Range }> = []
  for (const [block, slices] of groups) {
    const first = slices[0]
    const last = slices[slices.length - 1]
    const blockRange = root.createRange()
    blockRange.setStart(first.node, first.start)
    blockRange.setEnd(last.node, last.end)
    if (blockRange.toString().trim().length > 0) result.push({ block, range: blockRange })
  }
  return result
}

function locatorForRange(
  range: Range,
  block: HTMLElement,
  contents: Contents,
  chapter: Locator,
  format: BookFormat,
): AnnotationLocator | null {
  const quote = range.toString().replace(/\s+/g, ' ').trim()
  if (!quote) return null

  let cfi = ''
  try {
    cfi = contents.cfiFromRange(range)
  } catch {
    return null
  }
  if (!cfi) return null

  const blockText = block.textContent ?? ''
  const candidate = findBestQuote(blockText, quote)
  const context = candidate
    ? buildContext(blockText, candidate.start, candidate.end)
    : {
        quote,
        prefix: '',
        suffix: '',
      }

  return {
    format,
    cfi,
    href: chapter.href,
    chapterIndex: chapter.chapterIndex,
    chapterTitle: chapter.chapterTitle,
    page: chapter.page,
    percent: chapter.percent,
    quote: context.quote,
    prefix: context.prefix,
    suffix: context.suffix,
  }
}

/** 读取 contents 里的当前选区；没有选区或选区为空返回 null。 */
export function readSelection(
  contents: Contents,
  chapter: Locator,
  format: BookFormat,
): SelectionResult | null {
  const selection = contents.window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null

  const root = contents.document
  const locators: AnnotationLocator[] = []
  let firstRect: DOMRect | null = null

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    if (range.collapsed) continue
    firstRect ??= range.getBoundingClientRect()

    for (const part of splitByBlocks(range, root)) {
      const locator = locatorForRange(part.range, part.block, contents, chapter, format)
      if (locator) locators.push(locator)
    }
  }

  if (locators.length === 0 || !firstRect) return null

  const frame = contents.window.frameElement as HTMLElement | null
  const frameRect = frame?.getBoundingClientRect()
  const offsetLeft = frameRect?.left ?? 0
  const offsetTop = frameRect?.top ?? 0

  return {
    locators,
    anchor: {
      left: offsetLeft + firstRect.left,
      right: offsetLeft + firstRect.right,
      top: offsetTop + firstRect.top,
      bottom: offsetTop + firstRect.bottom,
    },
  }
}

/**
 * 重锚用：把章节文本里的字符区间还原成 Range。
 * 文本节点之间可能有空白，按累加长度跨节点定位。
 */
export function rangeFromOffsets(root: Document, start: number, end: number): Range | null {
  if (end <= start) return null

  const walker = root.createTreeWalker(root.body, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    const next = consumed + text.data.length
    if (!startNode && start < next) {
      startNode = text
      startOffset = Math.max(0, start - consumed)
    }
    if (startNode && end <= next) {
      endNode = text
      endOffset = Math.min(text.data.length, end - consumed)
      break
    }
    consumed = next
    node = walker.nextNode()
  }

  if (!startNode || !endNode) return null
  const range = root.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}
