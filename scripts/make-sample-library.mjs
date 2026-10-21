// 生成用于本地验证的测试书：node scripts/make-sample-library.mjs
// 输出到 public/sample-library/（已 gitignore），覆盖 EPUB、PDF、Markdown、UTF-8 TXT、GBK TXT 与一本五十万字的长篇。
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import iconv from 'iconv-lite'

const OUT_DIR = 'public/sample-library'

const SENTENCES = [
  '灯光落在纸页上，像一层薄薄的、温热的灰。',
  '他把书翻到上次停下的地方，那里夹着一张旧车票。',
  '窗外的雨下得很轻，几乎听不见，只有玻璃上缓慢移动的水痕。',
  '有些句子需要读三遍，不是因为难，而是因为舍不得往下读。',
  '书架最上层那本一直没有拆封，塑封的边缘已经泛黄。',
  '他忽然想起很多年前的一间图书馆，木地板踩上去会响。',
  '故事里的人也在读书，这件事让他觉得安心。',
  '茶凉了，他又倒了一杯，然后继续读下去。',
  '夜很深的时候，文字会变得像水一样，从眼睛里流过去。',
  '他在页边写下两个字：记住。',
  '屋檐下挂着一串风铃，风来的时候声音很碎。',
  '街道尽头有一家旧书店，门口总放着一把缺腿的椅子。',
  '她把信折成很小的方块，塞进书脊的缝隙里。',
  '窗台上晒着陈皮，气味缓慢地漫过整个下午。',
  '读到一半他停下来，去厨房烧水，回来时忘了刚才那一页。',
  '纸页的味道比内容更先让人安静下来。',
  '这本书的目录只有三行，却写满了整整一个夏天。',
  '他不太记得作者的姓名，只记得书里那场很长的雨。',
  '朋友说，读书是借别人的眼睛看一遍世界。',
  '他把这句话抄在本子上，字迹被后来的墨水洇开。',
  '黄昏时屋子里的光变成橘色，书页也跟着变暖。',
  '楼下的孩子背课文，声音一段一段地飘上来。',
  '他不急着读完，甚至希望最后几页慢一点。',
  '书签是一张过期的电影票，座位号已经看不清了。',
  '雨停之后，街上的人声重新变得清楚。',
  '有些段落适合在清晨读，有些只适合在深夜。',
  '她把读到的句子念出来，屋子里的空气就变轻了。',
  '关灯之前，他总要再看一眼昨天停下的那一行。',
  'reading is a quiet room with a window that never closes',
  'the library closes at dusk but the lamp stays on',
]

const CHAPTER_TITLES = [
  '灯下',
  '纸页的边缘',
  '一个安静的下午',
  '长夜',
  '折角',
  '旧书店',
  '没有寄出的信',
  '雨停以后',
  '页边的字',
  '第二天清晨',
  '木地板的响声',
  '借来的眼睛',
]

/** 固定种子的伪随机，保证每次生成的样书内容一致，便于对比测试结果。 */
function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function makeParagraphs(count, seed) {
  const random = createRandom(seed)
  const paragraphs = []
  for (let i = 0; i < count; i += 1) {
    const sentenceCount = 3 + Math.floor(random() * 3)
    const parts = []
    for (let j = 0; j < sentenceCount; j += 1) {
      parts.push(SENTENCES[Math.floor(random() * SENTENCES.length)])
    }
    paragraphs.push(parts.join(''))
  }
  return paragraphs
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function chapterXhtml(title, paragraphs) {
  const body = paragraphs.map((text) => `      <p>${escapeXml(text)}</p>`).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css" />
  </head>
  <body>
    <section epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>${escapeXml(title)}</h1>
${body}
    </section>
  </body>
</html>`
}

async function buildEpub(target) {
  const chapters = ['第一章 灯下', '第二章 纸页的边缘', '第三章 一个安静的下午', '第四章 长夜', '第五章 折角']
  const files = chapters.map((title, index) => ({
    id: `chapter${index + 1}`,
    href: `chapter${index + 1}.xhtml`,
    title,
    xhtml: chapterXhtml(title, makeParagraphs(12 + index * 2, 17 + index * 31)),
  }))

  const manifest = files
    .map((file) => `    <item id="${file.id}" href="${file.href}" media-type="application/xhtml+xml" />`)
    .join('\n')
  const spine = files.map((file) => `    <itemref idref="${file.id}" />`).join('\n')
  const navItems = files.map((file) => `        <li><a href="${file.href}">${file.title}</a></li>`).join('\n')

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:8f2a1c4e-lumen-sample</dc:identifier>
    <dc:title>灯下漫读</dc:title>
    <dc:creator>测试作者</dc:creator>
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

  const css = `body { font-family: serif; margin: 2em; line-height: 1.8; }
h1 { font-size: 1.4em; margin: 1.6em 0 1em; }
p { margin: 0 0 1em; text-indent: 2em; }
`

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`

  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', container)
  zip.file('OEBPS/content.opf', opf)
  zip.file('OEBPS/nav.xhtml', nav)
  zip.file('OEBPS/style.css', css)
  for (const file of files) {
    zip.file(`OEBPS/${file.href}`, file.xhtml)
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' })
  await writeFile(target, buffer)
  return buffer.length
}

function buildMarkdown() {
  const lines = [
    '---',
    'title: 檐下笔记',
    'author: 测试作者',
    '---',
    '',
    '# 檐下笔记',
    '',
    '这是一本用 Markdown 写成的书，用来验证转换管线与章节切分。',
    '',
  ]

  for (let chapter = 1; chapter <= 4; chapter += 1) {
    lines.push(`## 第${chapter}节 ${CHAPTER_TITLES[chapter]}`, '')
    for (const paragraph of makeParagraphs(5, 41 + chapter * 13)) {
      lines.push(paragraph, '')
    }
    lines.push('> 页边的一句话，用来验证引用块。', '')
  }

  return lines.join('\n')
}

function buildTxt(encoding) {
  const chapters = []
  for (let index = 0; index < 5; index += 1) {
    const lines = [`第${index + 1}章 ${CHAPTER_TITLES[index]}`, '']
    for (const paragraph of makeParagraphs(8, 91 + index * 7)) {
      lines.push(`　　${paragraph}`, '')
    }
    chapters.push(lines.join('\n'))
  }
  const text = `旧文钞\n测试作者\n\n${chapters.join('\n\n')}`
  return encoding === 'gbk' ? iconv.encode(text, 'gbk') : Buffer.from(text, 'utf8')
}

function buildLongTxt() {
  const chapterCount = 40
  const paragraphsPerChapter = 40
  const parts = ['长篇小说样本', '测试作者', '']

  for (let index = 0; index < chapterCount; index += 1) {
    parts.push(`第${index + 1}章 ${CHAPTER_TITLES[index % CHAPTER_TITLES.length]}`)
    parts.push('')
    for (const paragraph of makeParagraphs(paragraphsPerChapter, 1000 + index * 17)) {
      parts.push(`　　${paragraph}`)
    }
    parts.push('')
  }

  return Buffer.from(parts.join('\n'), 'utf8')
}

/**
 * PDF 文本串：ASCII 写括号，中文写成带 BOM 的 UTF-16BE 十六进制串。
 * 只用于元数据与书签标题，正文用 Helvetica 渲染英文，避免嵌入字体。
 */
function pdfTextString(text) {
  if (/^[\x20-\x7e]*$/.test(text)) {
    return `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`
  }
  const hex = Buffer.from(`\uFEFF${text}`, 'utf16le').swap16().toString('hex').toUpperCase()
  return `<${hex}>`
}

/** 手写一份六页、带三层书签的 PDF，用来验证导入、分页、目录与标注。 */
function buildPdf() {
  const pageCount = 6
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const number = index + 1
    const lines = [
      `Page ${number} keeps one window open all night.`,
      'A quiet room, a slow lamp, and a book left open on the table.',
      'The lamp hums. The pages turn without any hurry at all.',
      'Some sentences are worth reading three times, not because they are hard,',
      'but because leaving them behind feels like a small loss.',
      '',
      'The rain outside is soft enough to be mistaken for breathing.',
      'He folds the corner of the page and promises to come back tomorrow.',
      '',
      `This is sample page ${number} of ${pageCount}.`,
    ]
    return {
      label: `第 ${number} 节 灯下`,
      lines,
    }
  })

  const pageIds = pages.map((_, index) => 5 + index)
  const contentIds = pages.map((_, index) => 5 + pageCount + index)
  const outlinesId = 5 + pageCount * 2
  const outlineIds = pages.map((_, index) => outlinesId + 1 + index)

  const objects = []
  const setObject = (id, body) => {
    objects[id - 1] = body
  }

  setObject(
    1,
    `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlinesId} 0 R /PageMode /UseOutlines >>`,
  )
  setObject(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  )
  setObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  setObject(
    4,
    `<< /Title ${pdfTextString('流明 PDF 样本')} /Author ${pdfTextString('测试作者')} /Producer (Lumen) >>`,
  )

  pages.forEach((page, index) => {
    const body = [
      'BT',
      '/F1 12 Tf',
      '72 770 Td',
      '22 TL',
      ...page.lines.map((line) => {
        const escaped = line.replace(/[\\()]/g, (char) => `\\${char}`)
        return `(${escaped}) Tj T*`
      }),
      'ET',
    ].join('\n')

    setObject(
      pageIds[index],
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[index]} 0 R >>`,
    )
    setObject(
      contentIds[index],
      `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`,
    )
  })

  setObject(
    outlinesId,
    `<< /Type /Outlines /First ${outlineIds[0]} 0 R /Last ${outlineIds[outlineIds.length - 1]} 0 R /Count ${pageCount} >>`,
  )
  pages.forEach((page, index) => {
    const id = outlineIds[index]
    const next = index + 1 < pageCount ? ` /Next ${outlineIds[index + 1]} 0 R` : ''
    const prev = index > 0 ? ` /Prev ${outlineIds[index - 1]} 0 R` : ''
    setObject(
      id,
      `<< /Title ${pdfTextString(page.label)} /Parent ${outlinesId} 0 R${prev}${next} /Dest [${pageIds[index]} 0 R /Fit] >>`,
    )
  })

  const header = '%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n'
  const chunks = [Buffer.from(header, 'latin1')]
  const offsets = []
  let offset = chunks[0].length

  objects.forEach((body, index) => {
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1')
    offsets.push(offset)
    chunks.push(chunk)
    offset += chunk.length
  })

  const xrefOffset = offset
  const entries = ['0000000000 65535 f \n']
  for (const item of offsets) entries.push(`${String(item).padStart(10, '0')} 00000 n \n`)
  const trailer = `xref\n0 ${objects.length + 1}\n${entries.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  chunks.push(Buffer.from(trailer, 'latin1'))

  return Buffer.concat(chunks)
}


await mkdir(OUT_DIR, { recursive: true })

const outputs = [
  { name: '灯下漫读.epub', build: () => buildEpub(join(OUT_DIR, '灯下漫读.epub')) },
  { name: '流明样本.pdf', build: async () => (await writeFile(join(OUT_DIR, '流明样本.pdf'), buildPdf())) ?? 0 },
  { name: '檐下笔记.md', build: async () => (await writeFile(join(OUT_DIR, '檐下笔记.md'), buildMarkdown(), 'utf8')) ?? 0 },
  { name: 'utf8-散文.txt', build: async () => (await writeFile(join(OUT_DIR, 'utf8-散文.txt'), buildTxt('utf8'))) ?? 0 },
  { name: 'gbk-旧文.txt', build: async () => (await writeFile(join(OUT_DIR, 'gbk-旧文.txt'), buildTxt('gbk'))) ?? 0 },
  { name: '长篇小说-五十万字.txt', build: async () => (await writeFile(join(OUT_DIR, '长篇小说-五十万字.txt'), buildLongTxt())) ?? 0 },
]

for (const item of outputs) {
  await item.build()
}

const entries = await readdir(OUT_DIR)
let total = 0
for (const name of entries.sort()) {
  const info = await stat(join(OUT_DIR, name))
  total += info.size
  console.log(`${name.padEnd(28)} ${(info.size / 1024).toFixed(1).padStart(9)} KB`)
}
console.log(`\n${OUT_DIR}：${entries.length} 个文件，合计 ${(total / 1024 / 1024).toFixed(2)} MB`)
