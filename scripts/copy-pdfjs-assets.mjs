/**
 * 把 pdf.js 的 cMap 与标准字体复制到 public/pdfjs/。
 * 这两份资源不进版本库，由 predev / prebuild 在构建前准备好；
 * 缺了它们，中文等非嵌入字体的 PDF 会出现方块或取不到文字。
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'node_modules', 'pdfjs-dist')
const target = join(root, 'public', 'pdfjs')

async function copyFolder(name) {
  const from = join(source, name)
  const to = join(target, name)
  try {
    const info = await stat(from)
    if (!info.isDirectory()) throw new Error('不是目录')
  } catch {
    console.warn(`[pdfjs] 跳过 ${name}：${from} 不存在，先执行 npm install。`)
    return
  }
  await rm(to, { recursive: true, force: true })
  await cp(from, to, { recursive: true })
  console.log(`[pdfjs] ${name} → public/pdfjs/${name}`)
}

await mkdir(target, { recursive: true })
await copyFolder('cmaps')
await copyFolder('standard_fonts')
