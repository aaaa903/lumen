import JSZip from 'jszip'
import type { BookFormat, ShelfBook } from '../../../shared/types'
import { decodeTextBytes, parseTextSource, type TextBook } from '../../../shared/text-book'
import { api } from '../api'
import { markdownToHtml } from './markdown'

/**
 * TXT / Markdown 的支持方式：切成章节后拼成一本内存 EPUB，再交给同一条
 * epub.js 渲染链路。翻页、目录、主题、进度、标注全部复用，不需要第二套分页器。
 */

const CACHE_LIMIT = 3
/** 同一本书的转换结果只放内存；书内容不可变（每次导入都是新 id），无需失效逻辑。 */
const cache = new Map<string, ArrayBuffer>()

function escapeXml(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 每行一段：中文 TXT 的常见排版，行首缩进交给 CSS。 */
function splitParagraphs(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.replace(/^[\s\u3000]+/, '').trim())
    .filter(Boolean)
}

function bodyHtml(body: string, format: BookFormat): string {
  if (format === 'markdown') return markdownToHtml(body)
  return splitParagraphs(body)
    .map((paragraph) => `      <p>${escapeXml(paragraph)}</p>`)
    .join('\n')
}

function chapterXhtml(title: string, body: string, format: BookFormat): string {
  const heading = title ? `    <h1>${escapeXml(title)}</h1>\n` : ''
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css" />
  </head>
  <body>
${heading}${bodyHtml(body, format)}
  </body>
</html>`
}

const BOOK_CSS = `body { margin: 0 2%; font-family: serif; }
h1 { font-size: 1.3em; font-weight: 600; margin: 1.4em 0 1.1em; text-align: center; }
h2 { font-size: 1.12em; margin: 1.3em 0 0.7em; }
h3 { font-size: 1em; margin: 1.2em 0 0.6em; }
p { margin: 0 0 0.92em; text-indent: 2em; }
blockquote { margin: 0.8em 0; padding-left: 0.9em; border-left: 3px solid #ccc; color: #555; }
blockquote p { text-indent: 0; }
pre { padding: 0.7em; background: rgba(0, 0, 0, 0.05); overflow-x: auto; }
pre code { font-family: monospace; }
code { font-family: monospace; }
img { max-width: 100%; }
ul, ol { padding-left: 1.6em; }
`

function hashString(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}

export async function buildEpubFromText(book: TextBook, format: BookFormat): Promise<ArrayBuffer> {
  const chapters = book.chapters.length > 0 ? book.chapters : [{ title: book.title, body: '' }]
  const zip = new JSZip()

  const manifest = chapters
    .map(
      (_, index) =>
        `    <item id="c${index + 1}" href="c${index + 1}.xhtml" media-type="application/xhtml+xml" />`,
    )
    .join('\n')
  const spine = chapters.map((_, index) => `    <itemref idref="c${index + 1}" />`).join('\n')
  const navItems = chapters
    .map(
      (chapter, index) =>
        `        <li><a href="c${index + 1}.xhtml">${escapeXml(chapter.title || `第 ${index + 1} 节`)}</a></li>`,
    )
    .join('\n')

  const identifier = `urn:uuid:lumen-${format}-${hashString(
    `${book.title}|${book.charCount}|${chapters.length}`,
  )}`

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${identifier}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:creator>${escapeXml(book.author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="css" href="style.css" media-type="text/css" />
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>目录</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol>
${navItems}
      </ol>
    </nav>
  </body>
</html>`

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', container)
  zip.file('OEBPS/content.opf', opf)
  zip.file('OEBPS/nav.xhtml', nav)
  zip.file('OEBPS/style.css', BOOK_CSS)

  chapters.forEach((chapter, index) => {
    zip.file(`OEBPS/c${index + 1}.xhtml`, chapterXhtml(chapter.title, chapter.body, format))
  })

  // 不压缩：省掉几 MB 文本的 deflate 时间，epub.js 解 STORE 条目也更快。
  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'STORE',
    mimeType: 'application/epub+zip',
  })
}

/** 打开书时统一产出 EPUB 字节：EPUB 用原文件，TXT / Markdown 现转成内存 EPUB。 */
export async function loadBookAsEpub(book: ShelfBook): Promise<ArrayBuffer> {
  const result = await api.readBookFile(book.id)
  if (!result.ok) throw new Error(result.message)

  if (book.format === 'epub') return result.data
  // PDF 由 PdfViewer 用 pdf.js 渲染，不能走 epub.js 链路。
  if (book.format === 'pdf') throw new Error('这本书是 PDF，请用 PDF 阅读器打开。')

  const cached = cache.get(book.id)
  if (cached) return cached

  const { text } = decodeTextBytes(new Uint8Array(result.data))
  const parsed = parseTextSource(book.format, text, book.title)
  const epub = await buildEpubFromText(
    {
      ...parsed,
      // 书名与作者以导入时入库的为准：用户在书库里看到什么，正文里就显示什么。
      title: book.title,
      author: parsed.author || book.author,
    },
    book.format,
  )

  cache.set(book.id, epub)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (!oldest) break
    cache.delete(oldest)
  }
  return epub
}
