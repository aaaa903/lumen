import { app } from 'electron'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { clearLibrary } from '../db/repositories/maintenance'
import type { Db } from '../db/open'
import { handle, ok } from './handle'

/**
 * 设置页的「清空全部数据」。
 * 只删书库内容与书籍/封面文件，不碰窗口设置、日志与迁移备份。
 */
export function registerMaintenanceIpc(db: Db): void {
  handle<null>('app:clearData', () => {
    clearLibrary(db)

    const userData = app.getPath('userData')
    for (const dir of ['books', 'covers']) {
      let names: string[] = []
      try {
        names = readdirSync(join(userData, dir))
      } catch {
        continue
      }
      for (const name of names) {
        try {
          rmSync(join(userData, dir, name), { force: true })
        } catch {
          // 单个文件删不掉时继续，数据库已经清空，残留文件不会再被引用。
        }
      }
    }

    return ok(null)
  })
}
