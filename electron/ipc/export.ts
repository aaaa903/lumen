import { app, dialog } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ExportPayload, LibraryExportResult } from '../../shared/types'
import { buildAnnotationsMarkdown } from '../../shared/export'
import type { Db } from '../db/open'
import { getShelfBook, listShelf } from '../db/repositories/books'
import { listAnnotations } from '../db/repositories/annotations'
import { handle, IpcError, ok, readObject, readString } from './handle'

const MAX_EXPORT_LENGTH = 20_000_000

/** 只取文件名，去掉 Windows 不允许的字符，避免路径穿越或保存失败。 */
function safeFileName(input: string): string {
  const name = basename(input).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim()
  return name.length > 0 ? name : 'Lumen-标注.md'
}

/** 同一本书名可能重复，导出时追加序号，不覆盖已经写出的文件。 */
function uniqueName(base: string, used: Set<string>): string {
  let candidate = `${base}.md`
  let index = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${index}).md`
    index += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function exportFolderName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `Lumen-标注-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}`
}

export function registerExportIpc(db: Db): void {
  handle<ExportPayload>('export:bookAnnotations', (payload) => {
    const raw = readObject(payload)
    const bookId = readString(raw['bookId'], 'bookId')
    const book = getShelfBook(db, bookId)
    if (!book) {
      throw new IpcError('NOT_FOUND', '这本书不在书库里，无法导出。')
    }

    const ids = Array.isArray(raw['ids'])
      ? (raw['ids'] as unknown[]).filter((item): item is string => typeof item === 'string')
      : []
    const all = listAnnotations(db, bookId)
    const selected = ids.length > 0 ? all.filter((item) => ids.includes(item.id)) : all

    const markdown = buildAnnotationsMarkdown(book, selected, app.getVersion(), {
      // 只导出勾选项时，引用解析仍要看到整本书，否则会显示「引用已不存在」。
      referencePool: all,
    })
    return ok({ markdown, count: selected.length })
  })

  /**
   * 整个书库的标注导出：用户选一个目录，应用在其中新建带时间戳的子目录，
   * 一本书一个 Markdown。没有标注的书不落文件，避免导出几百个空文件。
   */
  handle<LibraryExportResult | null>('export:library', async () => {
    const result = await dialog.showOpenDialog({
      title: '导出整个书库的标注',
      buttonLabel: '导出到此目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return ok(null)

    const target = join(result.filePaths[0] ?? app.getPath('documents'), exportFolderName(new Date()))
    const books = listShelf(db)
    const used = new Set<string>()
    let files = 0

    try {
      await mkdir(target, { recursive: true })
      for (const book of books) {
        const annotations = listAnnotations(db, book.id)
        if (annotations.length === 0) continue
        const markdown = buildAnnotationsMarkdown(book, annotations, app.getVersion())
        const name = uniqueName(safeFileName(book.title).replace(/\.md$/i, ''), used)
        await writeFile(join(target, name), markdown, 'utf8')
        files += 1
      }
    } catch (error) {
      throw new IpcError(
        'IO_ERROR',
        `导出没有完成：${error instanceof Error ? error.message : '未知错误'}。请换一个目录再试。`,
      )
    }

    return ok({ path: target, files })
  })

  handle<{ path: string } | null>('app:saveText', async (payload) => {
    const raw = readObject(payload)
    const suggestedName = safeFileName(
      typeof raw['suggestedName'] === 'string' ? raw['suggestedName'] : 'Lumen-标注.md',
    )
    const content = typeof raw['content'] === 'string' ? raw['content'] : ''
    if (content.length === 0) {
      throw new IpcError('INTERNAL', '没有可保存的内容。')
    }
    if (content.length > MAX_EXPORT_LENGTH) {
      throw new IpcError('TOO_LARGE', '导出内容过大，请分成多本书导出。')
    }

    const extension = suggestedName.includes('.')
      ? suggestedName.slice(suggestedName.lastIndexOf('.') + 1)
      : 'md'

    const result = await dialog.showSaveDialog({
      title: '保存 Markdown',
      defaultPath: join(app.getPath('documents'), suggestedName),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    })
    if (result.canceled || !result.filePath) return ok(null)

    try {
      await writeFile(result.filePath, content, 'utf8')
    } catch (error) {
      throw new IpcError(
        'IO_ERROR',
        `没有写入文件：${error instanceof Error ? error.message : '未知错误'}。请换一个目录再试。`,
      )
    }
    return ok({ path: result.filePath })
  })
}
