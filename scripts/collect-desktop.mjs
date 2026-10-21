import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * electron-builder 的中间产物放在与项目同级的 lumen-next-desktop-build/：
 * 这个名字刻意与项目目录同名。项目是从旧的 lumen 仓库重写的，两个仓库并列存放；
 * 若共用 lumen-desktop-build/，旧仓库留下的同版本产物会被误收进 desktop-dist。
 * 编辑器会索引工作区里的 .asar，导致下一次构建无法删除旧文件（EPERM/EBUSY）。
 * 这里只把当前版本的分发包复制回项目内的 desktop-dist/，方便查找。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.resolve(ROOT, '..', 'lumen-next-desktop-build')
const TARGET = path.join(ROOT, 'desktop-dist')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version

if (!existsSync(SOURCE)) {
  console.error(`找不到打包输出目录：${SOURCE}`)
  process.exit(1)
}

mkdirSync(TARGET, { recursive: true })

// 只收当前版本的产物，避免目录里混进上一版
const pattern = new RegExp(`^Lumen-${version.replace(/\./g, '\\.')}-.*\\.(exe|zip|blockmap)$`, 'i')
const copied = []
let sawSetup = false

for (const name of readdirSync(SOURCE)) {
  if (!pattern.test(name)) continue
  const source = path.join(SOURCE, name)
  const size = statSync(source).size
  // NSIS 的「生成卸载器」中间产物只有几百 KB，不是真正的安装包
  if (name.endsWith('-setup.exe') && size < 20 * 1024 * 1024) {
    console.warn(`跳过 ${name}（${Math.round(size / 1024)} KB，是未完成的中间产物）`)
    continue
  }
  try {
    copyFileSync(source, path.join(TARGET, name))
    copied.push(name)
    if (name.endsWith('-setup.exe')) sawSetup = true
  } catch (error) {
    console.error(`复制 ${name} 失败：${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}

// 清掉旧版本的分发包，避免同时躺着多个版本
const current = new Set(copied)
for (const name of readdirSync(TARGET)) {
  if (!/^Lumen-.*\.(exe|zip|blockmap)$/i.test(name)) continue
  if (current.has(name)) continue
  try {
    rmSync(path.join(TARGET, name))
  } catch {
    /* 文件被占用时保留，不影响本次产物 */
  }
}

if (copied.length === 0) {
  console.error('没有找到可复制的产物，确认 electron-builder 是否成功结束')
  process.exit(1)
}

console.log(`已复制到 desktop-dist：${copied.join('、')}`)
console.log(`未压缩目录：${path.join(SOURCE, 'win-unpacked')}`)
if (!sawSetup) {
  console.warn('本次没有安装包。若这是本机智能应用控制拦截所致，发布时由 CI 生成 setup.exe。')
}
