import { app, shell } from 'electron'
import type { AppVersions } from '../../shared/types'
import type { Indexer } from '../indexer'
import { getSchemaVersion, type Db } from '../db/open'
import { registerBookIpc } from './books'
import { registerAnnotationIpc } from './annotations'
import { registerExportIpc } from './export'
import { fail, handle, ok, readObject, readString } from './handle'
import { registerIndexerIpc } from './indexer'
import { registerNoteIpc } from './notes'
import { registerMaintenanceIpc } from './maintenance'
import { registerOpenFileIpc } from './open-files'
import { registerProgressIpc } from './progress'
import { registerSearchIpc } from './search'
import { registerTagIpc } from './tags'

/** 统一注册 IPC。每个通道只做参数校验与转发，业务逻辑留在 repositories 或 library。 */
export function registerIpc(
  db: Db,
  sendOpenFiles: (paths: string[]) => void,
  indexer: Indexer,
): void {
  handle<AppVersions>('app:versions', () => {
    const row = db.prepare('SELECT sqlite_version() AS version').get() as { version: string }
    return ok({
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      sqlite: row.version,
      schema: getSchemaVersion(db),
      userData: app.getPath('userData'),
    })
  })

  handle<null>('app:openUserData', async () => {
    const message = await shell.openPath(app.getPath('userData'))
    if (message) return fail('IO_ERROR', `打不开数据目录：${message}`)
    return ok(null)
  })

  handle<null>('app:openExternal', async (payload) => {
    const raw = readObject(payload)
    const value = readString(raw['url'], 'url')
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return fail('INTERNAL', '链接格式不正确。')
    }
    // 只放行 https：http、file、自定义协议一律拒绝，避免被书内内容利用。
    if (url.protocol !== 'https:') {
      return fail('INTERNAL', '只打开 https 链接。')
    }
    await shell.openExternal(url.toString())
    return ok(null)
  })

  registerOpenFileIpc(sendOpenFiles)
  registerMaintenanceIpc(db)
  registerBookIpc(db, indexer)
  registerIndexerIpc(db, indexer)
  registerProgressIpc(db)
  registerAnnotationIpc(db)
  registerSearchIpc(db)
  registerTagIpc(db)
  registerNoteIpc(db)
  registerExportIpc(db)
}
