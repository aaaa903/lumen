/**
 * 标注之间的引用（双向链接）。批注正文里写 `[[ann:<标注 id>]]`，
 * 渲染、侧栏摘要与导出时都换成「章节 + 原文片段」的可读标签。
 *
 * 不新增数据库字段：引用关系就存在批注 Markdown 里，
 * 反向引用（谁引用了我）由渲染层现算，旧数据与导出格式都不受影响。
 */

/** 标注 id 是 UUID；只认十六进制与连字符，避免把普通方括号文字当成引用。 */
const ID_SOURCE = '[0-9a-fA-F-]{8,64}'
export const REFERENCE_SOURCE = `\\[\\[ann:(${ID_SOURCE})\\]\\]`

/** 引用标记的完整写法，编辑器插入时用。 */
export function referenceToken(id: string): string {
  return `[[ann:${id}]]`
}

/** 解析出一段 Markdown 里引用了哪些标注，去重并保持出现顺序。 */
export function parseReferenceIds(markdown: string): string[] {
  const pattern = new RegExp(REFERENCE_SOURCE, 'g')
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of markdown.matchAll(pattern)) {
    const id = (match[1] ?? '').toLowerCase()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** 判断一段 Markdown 是否引用了某条标注。 */
export function referencesId(markdown: string, id: string): boolean {
  return parseReferenceIds(markdown).includes(id.toLowerCase())
}

export type ReferenceLabelResolver = (id: string) => string | null

export const MISSING_REFERENCE_LABEL = '（引用的标注已不存在）'

/**
 * 把引用标记换成可读文字。resolver 返回 null 表示目标已被删除，
 * 此时保留一句说明，导出后读者仍能知道这里原本有一条关联。
 */
export function replaceReferences(
  markdown: string,
  resolve: ReferenceLabelResolver,
  missing = MISSING_REFERENCE_LABEL,
): string {
  const pattern = new RegExp(REFERENCE_SOURCE, 'g')
  return markdown.replace(pattern, (_whole, rawId: string) => {
    const label = resolve(rawId.toLowerCase())
    return label && label.trim().length > 0 ? label : missing
  })
}

/** 侧栏与检索结果里的摘要：引用标记换成短标签，不展开成长句。 */
export function stripReferences(markdown: string, placeholder = '〔引用〕'): string {
  return replaceReferences(markdown, () => placeholder, placeholder)
}

export type ReferenceTarget = {
  chapterTitle: string
  chapterIndex: number
  quote: string
}

/** 「第 3 章「原文片段」」；书签没有原文时只留章节。 */
export function referenceLabel(target: ReferenceTarget, limit = 30): string {
  const chapter = target.chapterTitle.trim() || `第 ${target.chapterIndex + 1} 节`
  const quote = target.quote.replace(/\s+/g, ' ').trim()
  if (!quote) return chapter
  const clipped = quote.length > limit ? `${quote.slice(0, limit)}…` : quote
  return `${chapter}「${clipped}」`
}
