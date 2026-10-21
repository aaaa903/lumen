import type {
  Annotation,
  AnnotationColor,
  AnnotationKind,
  AnnotationLocator,
  CreateAnnotationInput,
} from '../../shared/types'
import { parseLocator } from '../../shared/locator'
import type { Db } from '../db/open'
import { getShelfBook } from '../db/repositories/books'
import {
  getAnnotation,
  insertAnnotation,
  listAnnotations,
  restoreAnnotation,
  softDeleteAnnotation,
  updateAnnotation,
} from '../db/repositories/annotations'
import { handle, IpcError, ok, readObject, readString } from './handle'

const COLORS: AnnotationColor[] = ['yellow', 'green', 'blue', 'pink', 'slate']
const KINDS: AnnotationKind[] = ['highlight', 'note', 'bookmark']
const MAX_NOTE_LENGTH = 200_000

function readColor(value: unknown, fallback: AnnotationColor = 'yellow'): AnnotationColor {
  return COLORS.includes(value as AnnotationColor) ? (value as AnnotationColor) : fallback
}

function readKind(value: unknown): AnnotationKind {
  if (!KINDS.includes(value as AnnotationKind)) {
    throw new IpcError('INTERNAL', '标注类型不正确，刷新页面后重试。')
  }
  return value as AnnotationKind
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 标注 locator 比进度 locator 多 quote/prefix/suffix，且 quote 不能为空（书签除外）。 */
function readAnnotationLocator(value: unknown, kind: AnnotationKind): AnnotationLocator {
  const parsed = parseLocator(value)
  if (!parsed) {
    throw new IpcError('PARSE_FAILED', '这条标注的位置信息不完整，请重新选中文字再试。')
  }
  if (!parsed.href) {
    throw new IpcError('PARSE_FAILED', '这条标注缺少章节信息，请重新选中文字再试。')
  }

  const locator: AnnotationLocator = {
    ...parsed,
    quote: parsed.quote ?? '',
    prefix: parsed.prefix ?? '',
    suffix: parsed.suffix ?? '',
  }

  if (kind !== 'bookmark' && locator.quote.trim().length === 0) {
    throw new IpcError('PARSE_FAILED', '没有读到选中的文字，请重新选中后再标注。')
  }
  return locator
}

function requireBook(db: Db, bookId: string): void {
  if (!getShelfBook(db, bookId)) {
    throw new IpcError('NOT_FOUND', '这本书不在书库里，标注没有保存。')
  }
}

export function registerAnnotationIpc(db: Db): void {
  handle<Annotation[]>('annotations:list', (payload) => {
    const bookId = readString(readObject(payload)['bookId'], 'bookId')
    return ok(listAnnotations(db, bookId))
  })

  handle<Annotation>('annotations:create', (payload) => {
    const raw = readObject(payload)
    const bookId = readString(raw['bookId'], 'bookId')
    requireBook(db, bookId)

    const kind = readKind(raw['kind'])
    const noteMd = readText(raw['noteMd'])
    if (noteMd.length > MAX_NOTE_LENGTH) {
      throw new IpcError('TOO_LARGE', '批注超过 20 万字，请分成多条再保存。')
    }

    const groupId = raw['groupId']
    const input: CreateAnnotationInput = {
      bookId,
      kind,
      color: readColor(raw['color']),
      locator: readAnnotationLocator(raw['locator'], kind),
      noteMd,
      groupId: typeof groupId === 'string' && groupId.length > 0 ? groupId : null,
    }
    return ok(insertAnnotation(db, input))
  })

  handle<Annotation>('annotations:update', (payload) => {
    const raw = readObject(payload)
    const id = readString(raw['id'], 'id')
    const current = getAnnotation(db, id)
    if (!current || current.deletedAt !== null) {
      throw new IpcError('NOT_FOUND', '这条标注已经被删除了，刷新侧栏后再试。')
    }

    const noteMd = 'noteMd' in raw ? readText(raw['noteMd']) : undefined
    if (noteMd !== undefined && noteMd.length > MAX_NOTE_LENGTH) {
      throw new IpcError('TOO_LARGE', '批注超过 20 万字，请分成多条再保存。')
    }

    const locator =
      'locator' in raw
        ? readAnnotationLocator(raw['locator'], current.kind)
        : undefined

    const updated = updateAnnotation(db, id, {
      color: 'color' in raw ? readColor(raw['color'], current.color) : undefined,
      noteMd,
      locator,
      orphaned:
        'orphaned' in raw && typeof raw['orphaned'] === 'boolean'
          ? raw['orphaned']
          : undefined,
    })
    if (!updated) throw new IpcError('NOT_FOUND', '这条标注已经不在了。')
    return ok(updated)
  })

  handle<Annotation>('annotations:delete', (payload) => {
    const id = readString(readObject(payload)['id'], 'id')
    const removed = softDeleteAnnotation(db, id)
    if (!removed) throw new IpcError('NOT_FOUND', '这条标注已经删除了。')
    return ok(removed)
  })

  handle<Annotation>('annotations:restore', (payload) => {
    const id = readString(readObject(payload)['id'], 'id')
    const restored = restoreAnnotation(db, id)
    if (!restored) throw new IpcError('NOT_FOUND', '找不到要恢复的标注。')
    return ok(restored)
  })
}
