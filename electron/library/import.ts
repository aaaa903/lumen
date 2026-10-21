import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app } from 'electron'
import type { Book, BookFormat, ImportResult } from '../../shared/types'
import { decodeTextBytes, parseTextSource } from '../../shared/text-book'
import type { Db } from '../db/open'
import { withTransaction } from '../db/open'
import { findByHash, insertBook } from '../db/repositories/books'
import { readEpubMetadata } from './epub-meta'
import { ImportError } from './errors'

/** 单文件上限：超过直接拒绝，避免把整本书读进内存后才发现太大。 */
const MAX_FILE_BYTES = 200 * 1024 * 1024

const FORMATS: Record<string, BookFormat> = {
  '.epub': 'epub',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'txt',
}

type ImportMeta = {
  title: string
  author: string
  chapterCount: number
  cover: { bytes: Uint8Array; extension: string } | null
}

function detectFormat(filePath: string): BookFormat | null {
  return FORMATS[extname(filePath).toLowerCase()] ?? null
}

function readTextMetadata(
  format: BookFormat,
  bytes: Uint8Array,
  fallbackTitle: string,
): ImportMeta {
  const { text } = decodeTextBytes(bytes)
  if (!text.trim()) {
    throw new ImportError('PARSE_FAILED', '这个文件没有正文，换一个文件再试。')
  }
  if (format !== 'markdown' && format !== 'txt') {
    throw new ImportError('UNSUPPORTED', '暂不支持这种格式。')
  }
  const parsed = parseTextSource(format, text, fallbackTitle)
  return {
    title: parsed.title || fallbackTitle,
    author: parsed.author,
    chapterCount: Math.max(1, parsed.chapters.length),
    cover: null,
  }
}

/**
 * 导入一本书。全程只做一次磁盘读取：字节先读进内存，同一份数据用于
 * 算 hash、解析元数据与写入书库，避免大文件被读两遍。
 */
export async function importBook(db: Db, sourcePath: string): Promise<ImportResult> {
  const fileName = basename(sourcePath)

  try {
    const info = await stat(sourcePath)
    if (!info.isFile()) {
      throw new ImportError('IO_ERROR', '这不是文件，选择一个书文件再试。')
    }
    if (info.size === 0) {
      throw new ImportError('PARSE_FAILED', '文件是空的，换一个文件再试。')
    }
    if (info.size > MAX_FILE_BYTES) {
      throw new ImportError('TOO_LARGE', '文件超过 200 MB，暂不支持导入。')
    }

    const format = detectFormat(sourcePath)
    if (!format) {
      throw new ImportError('UNSUPPORTED', '只支持 EPUB、Markdown（.md）与 TXT 文件。')
    }

    const bytes = await readFile(sourcePath)
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    const existing = findByHash(db, sha256)
    if (existing) {
      return { status: 'duplicate', bookId: existing.id, title: existing.title }
    }

    const fallbackTitle = basename(sourcePath, extname(sourcePath)).trim() || '未命名'
    const meta: ImportMeta =
      format === 'epub'
        ? await readEpubMetadata(bytes, fallbackTitle)
        : readTextMetadata(format, bytes, fallbackTitle)

    const id = randomUUID()
    const extension = extname(sourcePath).toLowerCase()
    const bookRelative = `books/${id}${extension}`
    const userData = app.getPath('userData')

    await writeFile(join(userData, bookRelative), bytes)

    let coverPath: string | null = null
    if (meta.cover) {
      coverPath = `covers/${id}${meta.cover.extension}`
      await writeFile(join(userData, coverPath), meta.cover.bytes)
    }

    const book: Book = {
      id,
      title: meta.title,
      author: meta.author,
      format,
      filePath: bookRelative,
      sha256,
      size: info.size,
      coverPath,
      chapterCount: meta.chapterCount,
      indexedAt: null,
      addedAt: Date.now(),
      lastOpenedAt: null,
      deletedAt: null,
    }

    try {
      withTransaction(db, () => insertBook(db, book))
    } catch (error) {
      // 入库失败时把刚写的文件收掉，别留下没有记录的孤儿文件。
      await unlink(join(userData, bookRelative)).catch(() => undefined)
      if (coverPath) await unlink(join(userData, coverPath)).catch(() => undefined)
      throw error
    }

    return { status: 'ok', book: { ...book, percent: 0, chapter: '' } }
  } catch (error) {
    if (error instanceof ImportError) {
      return { status: 'error', fileName, code: error.code, message: error.message }
    }
    console.error('[Lumen] 导入失败', sourcePath, error)
    return {
      status: 'error',
      fileName,
      code: 'IO_ERROR',
      message: '无法读取这个文件，确认它没有被其他程序占用，或换一个位置再试。',
    }
  }
}
