import { app, session } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// 应用自身需要的协议。devtools: 与 chrome-extension: 供开发者工具使用，不承载业务请求。
const ALLOWED_SCHEMES = new Set([
  'lumen:',
  'devtools:',
  'chrome-extension:',
  'chrome-devtools:',
  'data:',
  'blob:',
  'about:',
])

/**
 * 安装全局请求拦截：除应用自身源与开发服务器外，一律取消并记录。
 * 这是「零网络请求」的执行机制，不是靠代码里不写 fetch 来自律。
 */
export function installNetworkGuard(options: { devUrl?: string }): void {
  const devOrigins = new Set<string>()
  if (options.devUrl) {
    const url = new URL(options.devUrl)
    devOrigins.add(url.origin)
    devOrigins.add(`ws://${url.host}`)
    devOrigins.add(`wss://${url.host}`)
  }

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let url: URL
    try {
      url = new URL(details.url)
    } catch {
      callback({ cancel: true })
      return
    }

    if (ALLOWED_SCHEMES.has(url.protocol)) {
      callback({})
      return
    }

    if (devOrigins.has(url.origin) || devOrigins.has(`${url.protocol}//${url.host}`)) {
      callback({})
      return
    }

    logBlocked(details.url)
    callback({ cancel: true })
  })
}

function logBlocked(url: string): void {
  const line = `[${new Date().toISOString()}] blocked ${url}\n`
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'network.log'), line, 'utf8')
  } catch {
    // 日志失败不能影响拦截本身。
  }
  console.warn('[Lumen] 已拦截外部请求', url)
}
