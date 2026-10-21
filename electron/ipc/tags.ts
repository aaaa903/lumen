import type { AnnotationTag, Tag } from '../../shared/types'
import { getAnnotation } from '../db/repositories/annotations'
import type { Db } from '../db/open'
import {
  deleteTag,
  findTag,
  findTagByName,
  insertTag,
  listAnnotationTags,
  listTags,
  mergeTags,
  renameTag,
  setAnnotationTags,
} from '../db/repositories/tags'
import { handle, IpcError, ok, readObject, readString, readStringArray } from './handle'

const MAX_NAME_LENGTH = 40
const MAX_TAGS_PER_ANNOTATION = 20

/** 标签名去首尾空白；空名、换行、超长都拒绝，错误信息告诉用户怎么改。 */
function readName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new IpcError('INTERNAL', '标签名不正确。')
  }
  const name = value.trim()
  if (name.length === 0) {
    throw new IpcError('INTERNAL', '标签名不能为空，请输入一个词。')
  }
  if ([...name].length > MAX_NAME_LENGTH) {
    throw new IpcError('TOO_LARGE', `标签名最多 ${MAX_NAME_LENGTH} 个字，请缩短后再试。`)
  }
  if (/[\r\n\t]/.test(name)) {
    throw new IpcError('INTERNAL', '标签名不能包含换行或制表符。')
  }
  return name
}

export function registerTagIpc(db: Db): void {
  handle<Tag[]>('tags:list', () => ok(listTags(db)))

  handle<Tag>('tags:create', (payload) => {
    const name = readName(readObject(payload)['name'])
    if (findTagByName(db, name)) {
      throw new IpcError('DUPLICATE', `已经有「${name}」这个标签了，直接选择它即可。`)
    }
    return ok(insertTag(db, name))
  })

  handle<Tag>('tags:rename', (payload) => {
    const raw = readObject(payload)
    const id = readString(raw['id'], 'id')
    const name = readName(raw['name'])
    if (!findTag(db, id)) {
      throw new IpcError('NOT_FOUND', '这个标签已经不存在了，刷新后再试。')
    }
    const existing = findTagByName(db, name)
    if (existing && existing.id !== id) {
      throw new IpcError('DUPLICATE', `已经有「${name}」这个标签了，可以改用合并。`)
    }
    const renamed = renameTag(db, id, name)
    if (!renamed) throw new IpcError('NOT_FOUND', '这个标签已经不存在了。')
    return ok(renamed)
  })

  handle<null>('tags:delete', (payload) => {
    const id = readString(readObject(payload)['id'], 'id')
    if (!findTag(db, id)) {
      throw new IpcError('NOT_FOUND', '这个标签已经不存在了。')
    }
    deleteTag(db, id)
    return ok(null)
  })

  handle<Tag>('tags:merge', (payload) => {
    const raw = readObject(payload)
    const sourceId = readString(raw['sourceId'], 'sourceId')
    const targetId = readString(raw['targetId'], 'targetId')
    if (sourceId === targetId) {
      throw new IpcError('INTERNAL', '不能把标签合并到它自己。')
    }
    if (!findTag(db, sourceId)) {
      throw new IpcError('NOT_FOUND', '要合并的标签已经不存在了。')
    }
    const merged = mergeTags(db, sourceId, targetId)
    if (!merged) {
      throw new IpcError('NOT_FOUND', '目标标签已经不存在了。')
    }
    return ok(merged)
  })

  handle<AnnotationTag[]>('tags:forBook', (payload) => {
    const bookId = readString(readObject(payload)['bookId'], 'bookId')
    return ok(listAnnotationTags(db, bookId))
  })

  handle<null>('tags:setForAnnotation', (payload) => {
    const raw = readObject(payload)
    const annotationId = readString(raw['annotationId'], 'annotationId')
    const tagIds = readStringArray(raw['tagIds'], 'tagIds')

    const annotation = getAnnotation(db, annotationId)
    if (!annotation || annotation.deletedAt !== null) {
      throw new IpcError('NOT_FOUND', '这条标注已经不存在了，刷新后再试。')
    }
    if (tagIds.length > MAX_TAGS_PER_ANNOTATION) {
      throw new IpcError('TOO_LARGE', `一条标注最多 ${MAX_TAGS_PER_ANNOTATION} 个标签。`)
    }
    for (const tagId of tagIds) {
      if (!findTag(db, tagId)) {
        throw new IpcError('NOT_FOUND', '选中的标签已经不存在了，刷新后再试。')
      }
    }

    setAnnotationTags(db, annotationId, tagIds)
    return ok(null)
  })
}
