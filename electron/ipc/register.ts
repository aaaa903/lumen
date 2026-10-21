import { app, shell } from 'electron'
import type { AppVersions } from '../../shared/types'
import { getSchemaVersion, type Db } from '../db/open'
import { registerBookIpc } from './books'
import { fail, handle, ok } from './handle'
import { registerProgressIpc } from './progress'

/** 统一注册 IPC。每个通道只做参数校验与转发，业务逻辑留在 repositories 或 library。 */
export function registerIpc(db: Db): void {
  handle<AppVersions>('app:versions', () => {
    const row = db.prepare('SELECT sqlite_version() AS version').get() as { version: string }
    return ok({
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      sqlite: row.version,
      schema: getSchemaVersion(db),
    })
  })

  handle<null>('app:openUserData', async () => {
    const message = await shell.openPath(app.getPath('userData'))
    if (message) return fail('IO_ERROR', `打不开数据目录：${message}`)
    return ok(null)
  })

  registerBookIpc(db)
  registerProgressIpc(db)
}
