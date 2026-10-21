import { app, BrowserWindow, protocol, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { openDatabase, type Db } from './db/open'
import { registerIpc } from './ipc/register'
import { collectFileArgs, enqueueOpenFiles } from './ipc/open-files'
import { installNetworkGuard } from './security/network'
import { readWindowState, trackWindowState } from './window-state'

// 开发期与打包后都必须落到同一个用户数据目录，否则书和标注会「换个启动方式就丢」。
// LUMEN_USER_DATA 只用于隔离测试：指向临时目录即可在不碰真实书库的情况下验证清空、迁移等操作。
app.setName('Lumen')
app.setPath(
  'userData',
  process.env['LUMEN_USER_DATA']
    ? resolve(process.env['LUMEN_USER_DATA'])
    : join(app.getPath('appData'), 'Lumen'),
)

const RENDERER_DIR = join(__dirname, '..', 'renderer')
const PRELOAD_PATH = join(__dirname, '..', 'preload', 'index.js')
const DEV_URL = process.env['ELECTRON_RENDERER_URL']

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
].join('; ')

let mainWindow: BrowserWindow | null = null

// Windows 上窗口被完全遮挡时 Chromium 会暂停 requestAnimationFrame，而 epub.js 的渲染队列
// 依赖 rAF，分页会永久停在「正在排版…」。backgroundThrottling 只挡住一部分节流，
// 这三个开关一起关掉后台/遮挡节流。
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

// 调试用：LUMEN_DEBUG_PORT=9223 启动后可用 CDP 检查渲染层与数据库状态。
const debugPort = process.env['LUMEN_DEBUG_PORT']
if (debugPort) app.commandLine.appendSwitch('remote-debugging-port', debugPort)

// 自定义协议必须在 ready 之前登记，且 standard + secure 才能让 localStorage 与 fetch 正常工作。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lumen',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    enqueueOpenFiles(collectFileArgs(argv))
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // 首次启动也可能带文件参数（例如「用 Lumen 打开」或命令行拖入）。
  enqueueOpenFiles(collectFileArgs(process.argv))

  app.whenReady().then(start).catch(handleFatal)
}

function start(): void {
  const db = openDatabase()

  registerLumenProtocol()
  installNetworkGuard({ devUrl: DEV_URL })
  registerIpc(db, (paths) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('app:openFiles', paths)
  })
  createWindow(db)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(db)
  })
}

function createWindow(db: Db): void {
  const state = readWindowState(db)
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'Lumen',
    backgroundColor: '#f6f2ea',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // 窗口被遮挡时 Chromium 会暂停 requestAnimationFrame，epub.js 分页会永久卡住。
      backgroundThrottling: false,
      spellcheck: false,
    },
  })

  if (state.maximized) mainWindow.maximize()
  trackWindowState(db, mainWindow)
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 外链只交给系统浏览器，应用内不允许打开第二个窗口或导航到其他源。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfHttps(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) return
    event.preventDefault()
    openExternalIfHttps(url)
  })

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const isDevTools =
        input.key === 'F12' ||
        (input.control && input.shift && input.key.toLowerCase() === 'i')
      if (isDevTools) {
        mainWindow?.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  } else {
    void mainWindow.loadURL('lumen://app/index.html')
  }
}

function registerLumenProtocol(): void {
  protocol.handle('lumen', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'app') return new Response('未找到', { status: 404 })

    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const root = resolve(RENDERER_DIR)
    let filePath = resolve(root, relative || 'index.html')

    // 阻断 ../ 穿越；未知路径回落到 index.html，交给前端路由。
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      return new Response('禁止访问', { status: 403 })
    }
    if (!existsSync(filePath)) filePath = join(root, 'index.html')

    // 直接读文件而不是 net.fetch(file://)：后者会被我们自己的请求拦截器当成外部请求取消。
    const data = await readFile(filePath)
    return new Response(data, {
      headers: {
        'content-type': contentType(filePath),
        'content-security-policy': CSP,
        'cache-control': 'no-store',
      },
    })  })
}

function contentType(filePath: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
  }
  return types[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function isAllowedNavigation(url: string): boolean {
  if (url.startsWith('lumen://app/')) return true
  if (!DEV_URL) return false
  try {
    return new URL(url).origin === new URL(DEV_URL).origin
  } catch {
    return false
  }
}

/** 只把 https 链接交给系统浏览器；http、file、javascript 等一律忽略。 */
function openExternalIfHttps(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') void shell.openExternal(parsed.toString())
  } catch {
    // 解析失败说明不是合法链接，直接丢弃。
  }
}

function handleFatal(error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'main.log'), `[${new Date().toISOString()}] ${detail}\n`, 'utf8')
  } catch {
    // 日志写不进去时不再抛，避免掩盖原始错误。
  }
  console.error('[Lumen] 启动失败', detail)
  app.exit(1)
}

// 窗口全关时退出（Windows 习惯）。macOS 不在 MVP 范围，但保留标准行为。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
