import { app } from 'electron'
import { join, resolve, sep } from 'node:path'

/**
 * 数据库里只存相对 userData 的路径；读文件前统一经过这里，
 * 避免历史脏数据或手改数据库把读写引到数据目录之外。
 */
export function resolveUserDataPath(relativePath: string): string {
  const root = resolve(app.getPath('userData'))
  const target = resolve(join(root, relativePath))
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`路径越界：${relativePath}`)
  }
  return target
}
