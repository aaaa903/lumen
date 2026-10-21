// 纯文本 / Markdown 的解析：主进程用它取书名与章节数，渲染层用它生成内存 EPUB。
// 这里不能出现 DOM 或 Electron API，两边共用同一份实现。

export type TextChapter = {
  title: string
  /** 原始正文：TXT 是纯文本，Markdown 保留 Markdown 源，渲染时再转换。 */
  body: string
}

export type TextBook = {
  title: string
  author: string
  chapters: TextChapter[]
  encoding: string
  charCount: number
}

const MAX_CHAPTER_CHARS = 18000
const HEADING_MAX_LEN = 40
const MAX_HEADING_SCAN_LINES = 12

const HEADING_PATTERNS: RegExp[] = [
  /^第\s*[0-9０-９零一二三四五六七八九十百千万两〇]+\s*[章节節回卷部篇集]/,
  /^(?:序章|楔子|引子|前言|序言|自序|序|尾声|后记|终章|番外|附录|后序)/,
  /^(?:chapter|part|book)\s+[0-9ivxlc]+/i,
  /^#{1,3}\s+\S/,
  /^[0-9]{1,3}[、.．]\s*\S/,
]

const META_TITLE = /^(?:书名|書名|标题)\s*[:：]\s*(.+)$/
const META_AUTHOR = /^(?:作者|著者|作\s*者)\s*[:：]\s*(.+)$/

/** 按 BOM 与解码试错判定编码；中文 TXT 常见 GBK / GB18030。 */
export function decodeTextBytes(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    for (const encoding of ['gb18030', 'gbk', 'big5']) {
      try {
        return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding }
      } catch {
        // 换下一个编码再试。
      }
    }
    // 兜底：允许替换字符，至少让用户能看到内容，而不是直接打不开。
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8（含无法识别的字节）' }
  }
}

export function isChapterHeading(line: string): boolean {
  if (!line || line.length > HEADING_MAX_LEN) return false
  if (/[，。；：、,.;:]$/.test(line)) return false
  if (line.startsWith('#')) return true
  return HEADING_PATTERNS.some((pattern) => pattern.test(line))
}

function splitOversized(chapter: TextChapter): TextChapter[] {
  if (chapter.body.length <= MAX_CHAPTER_CHARS) return [chapter]

  const paragraphs = chapter.body.split('\n').filter((line) => line.trim())
  const parts: string[] = []
  let buffer = ''

  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length + 1 > MAX_CHAPTER_CHARS) {
      parts.push(buffer)
      buffer = paragraph
    } else {
      buffer = buffer ? `${buffer}\n${paragraph}` : paragraph
    }
  }
  if (buffer) parts.push(buffer)

  return parts.map((body, index) => ({
    title: index === 0 ? chapter.title : `${chapter.title}（续 ${index + 1}）`,
    body,
  }))
}

export function splitChapters(text: string, fallbackTitle: string): TextChapter[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const chapters: TextChapter[] = []

  let currentTitle = ''
  let buffer: string[] = []

  const flush = () => {
    const body = buffer.join('\n').trim()
    buffer = []
    if (!body && !currentTitle) return
    chapters.push(...splitOversized({ title: currentTitle || fallbackTitle, body }))
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (isChapterHeading(line)) {
      flush()
      currentTitle = line.replace(/^#+\s*/, '')
      continue
    }
    buffer.push(raw)
  }
  flush()

  const kept = chapters.filter((chapter) => chapter.body.trim().length > 0 || chapter.title)
  return kept.length > 0 ? kept : [{ title: fallbackTitle, body: normalized.trim() }]
}

function readLeadingMeta(
  text: string,
  fallbackTitle: string,
): { title: string; author: string; body: string } {
  const lines = text.split('\n')
  let title = ''
  let author = ''
  let authorIndex = -1
  const consumed = new Set<number>()

  for (let i = 0; i < Math.min(lines.length, MAX_HEADING_SCAN_LINES); i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    const titleMatch = line.match(META_TITLE)
    const authorMatch = line.match(META_AUTHOR)
    if (titleMatch && !title) {
      title = titleMatch[1].trim()
      consumed.add(i)
      continue
    }
    if (authorMatch && !author) {
      author = authorMatch[1].trim()
      authorIndex = i
      consumed.add(i)
    }
  }

  // 常见排版是「书名」单独一行、下一行「作者：…」；此时把第一行当书名，
  // 否则它会变成只有一行正文的伪章节。
  if (!title) {
    const firstContent = lines.findIndex((line) => line.trim())
    if (firstContent >= 0) {
      const candidate = lines[firstContent].trim()
      const looksLikeTitle =
        candidate.length <= HEADING_MAX_LEN &&
        !isChapterHeading(candidate) &&
        !/[，。；：、,.;:]$/.test(candidate)
      const followedByAuthor = authorIndex >= 0 && firstContent < authorIndex
      if (looksLikeTitle && (followedByAuthor || candidate === fallbackTitle.trim())) {
        title = candidate
        consumed.add(firstContent)
      }
    }
  }

  const body = lines.filter((_, index) => !consumed.has(index)).join('\n')
  return { title, author, body }
}

export function parseTxtBook(text: string, fallbackTitle: string): TextBook {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  const leading = readLeadingMeta(normalized, fallbackTitle)
  const title = leading.title || fallbackTitle
  return {
    title,
    author: leading.author,
    chapters: splitChapters(leading.body, title),
    encoding: 'utf-8',
    charCount: normalized.length,
  }
}

/** 极简 front matter：只取 title / author，其余键忽略。 */
function readFrontMatter(text: string): { attrs: Record<string, string>; body: string } {
  if (!text.startsWith('---')) return { attrs: {}, body: text }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { attrs: {}, body: text }

  const attrs: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!pair) continue
    const value = pair[2].trim().replace(/^["']|["']$/g, '')
    if (value) attrs[pair[1].toLowerCase()] = value
  }
  return { attrs, body: text.slice(match[0].length) }
}

/** Markdown 按一级、二级标题切章；标题保留在正文里，渲染时由 markdown-it 转成 HTML。 */
export function parseMarkdownBook(text: string, fallbackTitle: string): TextBook {
  const normalized = text.replace(/\r\n?/g, '\n')
  const { attrs, body } = readFrontMatter(normalized)
  const lines = body.split('\n')

  const headingLevel = (line: string): number => {
    const match = line.match(/^(#{1,2})\s+\S/)
    return match ? match[1].length : 0
  }

  const chapters: TextChapter[] = []
  let title = attrs['title'] ?? ''
  let currentTitle = ''
  let buffer: string[] = []
  let beforeFirstHeading = true

  const flush = () => {
    const content = buffer.join('\n').trim()
    buffer = []
    if (!content) return
    chapters.push({ title: currentTitle || title || fallbackTitle, body: content })
  }

  for (const line of lines) {
    const level = headingLevel(line)
    if (level > 0) {
      if (level === 1 && !title) title = line.replace(/^#\s+/, '').trim()
      flush()
      beforeFirstHeading = false
      currentTitle = line.replace(/^#+\s+/, '').trim()
      continue
    }
    if (beforeFirstHeading && !line.trim()) continue
    buffer.push(line)
  }
  flush()

  if (chapters.length === 0) {
    chapters.push({ title: title || fallbackTitle, body: body.trim() })
  }

  return {
    title: title || fallbackTitle,
    author: attrs['author'] ?? '',
    chapters,
    encoding: 'utf-8',
    charCount: normalized.length,
  }
}

export function parseTextSource(
  format: 'markdown' | 'txt',
  text: string,
  fallbackTitle: string,
): TextBook {
  return format === 'markdown' ? parseMarkdownBook(text, fallbackTitle) : parseTxtBook(text, fallbackTitle)
}
