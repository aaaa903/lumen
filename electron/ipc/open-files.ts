import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import { handle, ok } from './handle'

/**
 * 把「第二次启动时带的文件」交给已运行的窗口。
 * 启动参数可能早于渲染层挂载，所以先入队；渲染层挂载后主动取一次，
 * 之后的文件再通过 webContents.send 直接推送。
 */

const SUPPORTED = new Set(['.epub', '.md', '.markdown', '.txt'])

let rendererReady = false
let sender: ((paths: string[]) => void) | null = null
const queue: string[] = []

/** 只接受真实存在、扩展名受支持的文件；忽略 Electron 自己的开关参数。 */
export function collectFileArgs(argv: string[]): string[] {
  const files: string[] = []
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue
    if (!SUPPORTED.has(extname(arg).toLowerCase())) continue
    if (!existsSync(arg)) continue
    files.push(arg)
  }
  return [...new Set(files)]
}

export function enqueueOpenFiles(paths: string[]): void {
  const unique = [...new Set(paths)]
  if (unique.length === 0) return
  if (rendererReady && sender) {
    sender(unique)
    return
  }
  queue.push(...unique)
}

export function registerOpenFileIpc(send: (paths: string[]) => void): void {
  sender = send

  handle<string[]>('app:takePendingFiles', () => {
    rendererReady = true
    return ok(queue.splice(0))
  })
}
