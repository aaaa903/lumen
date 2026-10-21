import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 把打包产物的大小与 SHA-256 回填到官网数据源，并生成 SHA256SUMS.txt。
 * 本地与 CI 共用：先 `npm run pack`（或 `pack:portable`），再 `npm run release:assets`。
 *
 * 用法：
 *   node scripts/release-assets.mjs            # 默认读 desktop-dist/
 *   node scripts/release-assets.mjs --dir=...  # 指定产物目录
 *   node scripts/release-assets.mjs --check    # 只校验，不写文件
 *
 * 本地缺少某个产物时只警告（本机智能应用控制会挡住 NSIS 阶段）；
 * CI 环境要求两个产物齐全，缺一个就失败，避免发布不完整的版本。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEASES_PATH = path.join(ROOT, 'site', 'src', 'data', 'releases.json')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const inCI = Boolean(process.env['CI'])

const args = process.argv.slice(2)
const dirArg = args.find((item) => item.startsWith('--dir='))
const checkOnly = args.includes('--check')
const sourceDir = dirArg
  ? path.resolve(ROOT, dirArg.slice('--dir='.length))
  : path.join(ROOT, 'desktop-dist')

if (!existsSync(sourceDir)) {
  console.error(`找不到产物目录：${sourceDir}\n先运行 npm run pack，或用 --dir=<目录> 指定。`)
  process.exit(1)
}

const expected = {
  setup: `Lumen-${version}-setup.exe`,
  portable: `Lumen-${version}-portable.zip`,
}

const files = new Set(readdirSync(sourceDir))
const missing = Object.keys(expected).filter((key) => !files.has(expected[key]))

if (missing.length > 0) {
  const message =
    `缺少 ${version} 的产物：${missing.map((key) => expected[key]).join('、')}\n` +
    '本机智能应用控制会拦截 NSIS 的卸载器导出步骤，安装包需要由 CI 生成。'
  if (inCI) {
    console.error(message)
    process.exit(1)
  }
  console.warn(`${message}\n本地继续，只为已有产物写校验和。`)
}

const describe = (name) => {
  const filePath = path.join(sourceDir, name)
  const buffer = readFileSync(filePath)
  return {
    name,
    size: statSync(filePath).size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
}

const assets = {}
for (const [key, name] of Object.entries(expected)) {
  if (!files.has(name)) continue
  assets[key] = describe(name)
}

// NSIS 的卸载器中间产物只有几百 KB，误把它当成安装包会让官网给出错误链接
if (assets.setup && assets.setup.size < 20 * 1024 * 1024) {
  console.error(
    `安装包只有 ${Math.round(assets.setup.size / 1024)} KB，是未完成的中间产物。\n` +
      '删掉它，改用 npm run pack:portable，安装包交给 CI 构建。',
  )
  process.exit(1)
}

const sums = Object.values(assets)
  .map((asset) => `${asset.sha256}  ${asset.name}`)
  .join('\n')
writeFileSync(path.join(sourceDir, 'SHA256SUMS.txt'), `${sums}\n`, 'utf8')

const releases = JSON.parse(readFileSync(RELEASES_PATH, 'utf8'))
const release = releases.releases.find((item) => item.version === version)
if (!release) {
  console.error(`releases.json 里没有 ${version} 的条目。先补版本说明再回填资产。`)
  process.exit(1)
}

const old = release.assets ?? {}
// 保留已有 url（发布后地址固定），只更新名称、大小与校验和
release.assets = { ...old }
for (const [key, asset] of Object.entries(assets)) {
  release.assets[key] = { ...old[key], ...asset, url: old[key]?.url ?? '' }
}
for (const asset of Object.values(release.assets)) {
  if (!asset.url) delete asset.url
}

if (releases.latest !== version) {
  console.warn(`注意：releases.json 的 latest 是 ${releases.latest}，本次回填的是 ${version}。`)
}

if (checkOnly) {
  console.log(`校验通过：${Object.keys(assets).join('、')}，SHA256SUMS.txt 已生成。`)
  process.exit(0)
}

writeFileSync(RELEASES_PATH, `${JSON.stringify(releases, null, 2)}\n`, 'utf8')

const formatSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`
console.log(`已回填 ${version} 的资产信息：`)
for (const asset of Object.values(assets)) {
  console.log(`  ${asset.name}  ${formatSize(asset.size)}  ${asset.sha256.slice(0, 16)}…`)
}
console.log(`数据文件：${path.relative(ROOT, RELEASES_PATH)}`)
