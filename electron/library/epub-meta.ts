import JSZip from 'jszip'
import { ImportError } from './errors'

export type EpubMetadata = {
  title: string
  author: string
  chapterCount: number
  cover: { bytes: Uint8Array; extension: string } | null
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? '')
  }
  return attrs
}

function tagTexts(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  const values: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const text = decodeEntities(match[1].replace(/<[^>]+>/g, '')).trim()
    if (text) values.push(text)
  }
  return values
}

/** 把 OPF 里的相对 href 解析成 ZIP 内的绝对路径。 */
function resolveZipPath(baseDir: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0])
  const parts = `${baseDir}/${clean}`.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(0, index) : ''
}

type ManifestItem = { id: string; href: string; mediaType: string; properties: string }

function readManifest(opfXml: string): ManifestItem[] {
  const items: ManifestItem[] = []
  const pattern = /<item\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(opfXml)) !== null) {
    const attrs = parseAttributes(match[0])
    if (!attrs['href']) continue
    items.push({
      id: attrs['id'] ?? '',
      href: attrs['href'],
      mediaType: attrs['media-type'] ?? '',
      properties: attrs['properties'] ?? '',
    })
  }
  return items
}

function findCoverHref(opfXml: string, items: ManifestItem[]): string {
  const byProperty = items.find((item) => item.properties.split(/\s+/).includes('cover-image'))
  if (byProperty) return byProperty.href

  // EPUB 2 的写法：<meta name="cover" content="cover-image-id" />
  const metaPattern = /<meta\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = metaPattern.exec(opfXml)) !== null) {
    const attrs = parseAttributes(match[0])
    if (attrs['name'] === 'cover' && attrs['content']) {
      const target = items.find((item) => item.id === attrs['content'])
      if (target) return target.href
    }
  }

  // 最后按文件名兜底：不少制作粗糙的书只有 cover.jpg 而没有声明属性。
  const byName = items.find(
    (item) => item.mediaType.startsWith('image/') && /cover/i.test(item.href),
  )
  return byName?.href ?? ''
}

/**
 * 只读 container.xml 与 OPF，不实例化 epub.js。
 * 主进程没有 DOM，这里用定向的标签解析，只取书名、作者、章节数与封面。
 */
export async function readEpubMetadata(
  data: Uint8Array,
  fallbackTitle: string,
): Promise<EpubMetadata> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new ImportError('PARSE_FAILED', '这个文件不是有效的 EPUB：无法解压，确认后缀与文件内容一致。')
  }

  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) {
    throw new ImportError('PARSE_FAILED', '不是有效的 EPUB：缺少 META-INF/container.xml。')
  }

  const containerXml = await containerFile.async('text')
  const rootfileTag = containerXml.match(/<rootfile\b[^>]*>/i)
  const opfPath = rootfileTag ? parseAttributes(rootfileTag[0])['full-path'] : ''
  if (!opfPath) {
    throw new ImportError('PARSE_FAILED', '不是有效的 EPUB：container.xml 里没有 rootfile。')
  }

  const opfFile = zip.file(opfPath)
  if (!opfFile) {
    throw new ImportError('PARSE_FAILED', `不是有效的 EPUB：找不到 ${opfPath}。`)
  }

  const opfXml = await opfFile.async('text')
  const title = tagTexts(opfXml, 'dc:title')[0] ?? tagTexts(opfXml, 'title')[0] ?? ''
  const author = tagTexts(opfXml, 'dc:creator')[0] ?? tagTexts(opfXml, 'creator')[0] ?? ''
  const chapterCount = (opfXml.match(/<itemref\b/gi) ?? []).length || 1

  const items = readManifest(opfXml)
  const coverHref = findCoverHref(opfXml, items)
  let cover: EpubMetadata['cover'] = null

  if (coverHref) {
    const item = items.find((entry) => entry.href === coverHref)
    const zipPath = resolveZipPath(dirname(opfPath), coverHref)
    const coverFile = zip.file(zipPath)
    if (coverFile) {
      const mediaType = item?.mediaType ?? ''
      cover = {
        bytes: await coverFile.async('uint8array'),
        extension: IMAGE_EXTENSIONS[mediaType] ?? (zipPath.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg'),
      }
    }
  }

  return {
    title: title || fallbackTitle,
    author,
    chapterCount,
    cover,
  }
}
