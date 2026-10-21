import type { BookFormat, Locator, Progress } from '../../shared/types'
import type { Db } from '../db/open'
import { getProgress, saveProgress } from '../db/repositories/progress'
import { fail, handle, ok, readFiniteNumber, readObject, readString } from './handle'

const FORMATS: BookFormat[] = ['epub', 'markdown', 'txt']

function readFormat(value: unknown): BookFormat {
  return FORMATS.includes(value as BookFormat) ? (value as BookFormat) : 'epub'
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 逐字段取值：渲染层传来的 locator 只是数据，不信任它的形状。 */
function readLocator(value: unknown): Locator {
  const raw = readObject(value)
  const cfi = readText(raw['cfi'])
  return {
    format: readFormat(raw['format']),
    cfi: cfi.length > 0 ? cfi : null,
    href: readText(raw['href']),
    chapterIndex: Math.max(0, Math.trunc(readFiniteNumber(raw['chapterIndex'], 0))),
    chapterTitle: readText(raw['chapterTitle']),
    page: Math.max(0, Math.trunc(readFiniteNumber(raw['page'], 0))),
    percent: Math.min(1, Math.max(0, readFiniteNumber(raw['percent'], 0))),
  }
}

export function registerProgressIpc(db: Db): void {
  handle<Progress | null>('progress:get', (payload) => {
    const bookId = readString(readObject(payload)['bookId'], 'bookId')
    return ok(getProgress(db, bookId))
  })

  handle<null>('progress:save', (payload) => {
    const raw = readObject(payload)
    const bookId = readString(raw['bookId'], 'bookId')
    const saved = saveProgress(db, {
      bookId,
      locator: readLocator(raw['locator']),
      percent: readFiniteNumber(raw['percent'], 0),
      chapter: readText(raw['chapter']),
    })
    if (!saved) return fail('NOT_FOUND', '这本书不在书库里，进度没有保存。')
    return ok(null)
  })
}
