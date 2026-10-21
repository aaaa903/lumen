import { app, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ExportPayload } from '../../shared/types'
import { buildAnnotationsMarkdown } from '../../shared/export'
import type { Db } from '../db/open'
import { getShelfBook } from '../db/repositories/books'
import { listAnnotations } from '../db/repositories/annotations'
import { handle, IpcError, ok, readObject, readString } from './handle'

const MAX_EXPORT_LENGTH = 20_000_000

/** 只取文件名，去掉 Windows 不允许的字符，避免路径穿越或保存失败。 */
function safeFileName(input: string): string {
  const name = basename(input).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim()
  return name.length > 0 ? name : 'Lumen-标注.md'
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

    const markdown = buildAnnotationsMarkdown(book, selected, app.getVersion())
    return ok({ markdown, count: selected.length })
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
