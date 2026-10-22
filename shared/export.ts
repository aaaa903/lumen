/**
 * 标注导出的 Markdown 生成。纯函数，便于单测与快照；
 * 文件写入由主进程的 app:saveText 完成，渲染层不碰文件系统。
 */

import type { Annotation, Book } from './types'
import { referenceLabel, replaceReferences } from './references'

export type ExportBook = Pick<Book, 'title' | 'author'>
export type ExportAnnotation = Pick<
  Annotation,
  'id' | 'kind' | 'color' | 'locator' | 'noteMd' | 'createdAt'
>

export type ExportOptions = {
  exportedAt?: Date
  /**
   * 解析批注之间引用时用的标注池。默认与导出的标注相同；
   * 只导出勾选的几条时，调用方要把整本书的标注传进来，
   * 否则引用会被误判成「已不存在」。
   */
  referencePool?: ExportAnnotation[]
}

/** YAML 双引号字符串与 JSON 字符串的转义规则一致。 */
function yamlString(input: string): string {
  return JSON.stringify(input)
}

function quoteBlock(text: string): string {
  const lines = text.split(/\r?\n/)
  return lines.map((line) => (line.length > 0 ? `> ${line}` : '>')).join('\n')
}

type ChapterGroup = {
  key: string
  title: string
  order: number
  items: ExportAnnotation[]
}

function groupByChapter(annotations: ExportAnnotation[]): ChapterGroup[] {
  const groups = new Map<string, ChapterGroup>()
  for (const annotation of annotations) {
    const locator = annotation.locator
    const key = `${locator.chapterIndex}|${locator.href}`
    const group = groups.get(key) ?? {
      key,
      title: locator.chapterTitle || `第 ${locator.chapterIndex + 1} 节`,
      order: locator.chapterIndex,
      items: [],
    }
    group.items.push(annotation)
    groups.set(key, group)
  }

  return [...groups.values()]
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
    .map((group) => ({
      ...group,
      items: group.items.sort(
        (left, right) =>
          (left.locator.cfi ?? '').localeCompare(right.locator.cfi ?? '') ||
          left.createdAt - right.createdAt,
      ),
    }))
}

/**
 * 一本书的标注 → Markdown。空输入也生成带 front matter 的文件，
 * 让用户明确知道「这本书没有标注」，而不是得到一个 0 字节文件。
 */
export function buildAnnotationsMarkdown(
  book: ExportBook,
  annotations: ExportAnnotation[],
  version: string,
  options: ExportOptions = {},
): string {
  const exportedAt = options.exportedAt ?? new Date()
  const pool = options.referencePool ?? annotations
  const byId = new Map(pool.map((item) => [item.id, item]))
  // 引用在 Markdown 里只有 id，导出时换成「章节 + 原文」，脱离应用也能读懂。
  const resolveReference = (id: string): string | null => {
    const target = byId.get(id)
    return target ? referenceLabel(target.locator, 40) : null
  }

  const lines: string[] = [
    '---',
    `title: ${yamlString(book.title)}`,
    `author: ${yamlString(book.author)}`,
    `exported_at: ${yamlString(exportedAt.toISOString())}`,
    `lumen_version: ${yamlString(version)}`,
    '---',
    '',
    `# ${book.title}`,
    '',
  ]

  if (book.author.trim()) lines.push(book.author.trim(), '')

  if (annotations.length === 0) {
    lines.push('这本书还没有标注。', '')
    return lines.join('\n')
  }

  for (const group of groupByChapter(annotations)) {
    lines.push(`## ${group.title}`, '')
    for (const annotation of group.items) {
      const quote = annotation.locator.quote.trim()
      const note = replaceReferences(annotation.noteMd.trim(), resolveReference)
      if (annotation.kind === 'bookmark') {
        lines.push(quoteBlock('（书签）'))
      } else if (quote) {
        lines.push(quoteBlock(quote))
      } else {
        lines.push(quoteBlock('（原文位置失效）'))
      }
      if (note) lines.push('', note)
      lines.push('', '---', '')
    }
  }

  return lines.join('\n').replace(/\n{3,}$/g, '\n')
}
