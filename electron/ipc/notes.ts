import type { Note, SaveNoteInput } from '../../shared/types'
import type { Db } from '../db/open'
import { getShelfBook } from '../db/repositories/books'
import { deleteNote, findNote, listNotes, saveNote } from '../db/repositories/notes'
import { handle, IpcError, ok, readObject, readString } from './handle'

const MAX_TITLE_LENGTH = 200
const MAX_BODY_LENGTH = 500_000

function readTitle(value: unknown, body: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length > 0) {
    if ([...raw].length > MAX_TITLE_LENGTH) {
      throw new IpcError('TOO_LARGE', `标题最多 ${MAX_TITLE_LENGTH} 个字。`)
    }
    return raw
  }
  // 没写标题时用正文第一行，仍为空就给一个可检索的占位名。
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 0)
  return firstLine ? [...firstLine].slice(0, 60).join('') : '未命名笔记'
}

function readBookId(db: Db, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') {
    throw new IpcError('INTERNAL', '关联的书不正确。')
  }
  if (!getShelfBook(db, value)) {
    throw new IpcError('NOT_FOUND', '关联的书不在书库里，换一本或取消关联。')
  }
  return value
}

export function registerNoteIpc(db: Db): void {
  handle<Note[]>('notes:list', () => ok(listNotes(db)))

  handle<Note>('notes:save', (payload) => {
    const raw = readObject(payload)
    const bodyMd = typeof raw['bodyMd'] === 'string' ? raw['bodyMd'] : ''
    if (bodyMd.length > MAX_BODY_LENGTH) {
      throw new IpcError('TOO_LARGE', '笔记超过 50 万字，请拆成多条。')
    }

    const input: SaveNoteInput = {
      id: typeof raw['id'] === 'string' && raw['id'].length > 0 ? raw['id'] : undefined,
      bookId: readBookId(db, raw['bookId']),
      title: readTitle(raw['title'], bodyMd),
      bodyMd,
    }

    if (input.id && !findNote(db, input.id)) {
      throw new IpcError('NOT_FOUND', '这条笔记已经删除了，刷新后再试。')
    }

    const saved = saveNote(db, input)
    if (!saved) {
      throw new IpcError('NOT_FOUND', '这条笔记已经删除了，刷新后再试。')
    }
    return ok(saved)
  })

  handle<null>('notes:delete', (payload) => {
    const id = readString(readObject(payload)['id'], 'id')
    if (!deleteNote(db, id, Date.now())) {
      throw new IpcError('NOT_FOUND', '这条笔记已经删除了。')
    }
    return ok(null)
  })
}
