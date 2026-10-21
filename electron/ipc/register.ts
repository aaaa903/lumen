import { app, ipcMain, shell } from 'electron'
import type { AppVersions, IpcResult } from '../../shared/types'
import { getSchemaVersion, type Db } from '../db/open'

/** 统一注册 IPC。每个通道只做参数校验与转发，业务逻辑留在 repositories。 */
export function registerIpc(db: Db): void {
  ipcMain.handle('app:versions', (): IpcResult<AppVersions> => {
    const row = db.prepare('SELECT sqlite_version() AS version').get() as { version: string }
    return {
      ok: true,
      data: {
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        sqlite: row.version,
        schema: getSchemaVersion(db),
      },
    }
  })

  ipcMain.handle('app:openUserData', async (): Promise<IpcResult<null>> => {
    const message = await shell.openPath(app.getPath('userData'))
    if (message) {
      return { ok: false, code: 'IO_ERROR', message: `打不开数据目录：${message}` }
    }
    return { ok: true, data: null }
  })
}
