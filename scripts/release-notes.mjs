import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 用官网同一份 releases.json 生成 GitHub Release 的说明，避免两处各写一遍。
 * 用法：node scripts/release-notes.mjs [--out=release-notes.md]
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releases = JSON.parse(
  readFileSync(path.join(ROOT, 'site', 'src', 'data', 'releases.json'), 'utf8'),
)
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const version = pkg.version
const release = releases.releases.find((item) => item.version === version)
if (!release) {
  console.error(`releases.json 里没有 ${version} 的条目，先补版本说明。`)
  process.exit(1)
}

const outArg = process.argv.find((item) => item.startsWith('--out='))
const outPath = path.join(ROOT, outArg ? outArg.slice('--out='.length) : 'release-notes.md')

const setup = release.assets?.setup?.name ?? `Lumen-${version}-setup.exe`
const portable = release.assets?.portable?.name ?? `Lumen-${version}-portable.zip`

const body = `# Lumen ${version}

${release.date}

${release.notes.map((note) => `- ${note}`).join('\n')}

## 下载

- 安装包：\`${setup}\`
- 免安装包：\`${portable}\`
- 校验和：\`SHA256SUMS.txt\`

安装包未做代码签名，Windows 可能提示「未知发布者」；系统开启智能应用控制时请用免安装包。

数据全部保存在 \`%APPDATA%\\Lumen\`，卸载应用不会删除。
`

writeFileSync(outPath, body, 'utf8')
console.log(`已生成 ${path.relative(ROOT, outPath)}`)
