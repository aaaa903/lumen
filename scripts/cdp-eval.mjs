// 临时调试脚本：通过 CDP 在渲染层执行一段表达式并打印结果。
// 用法：node scripts/cdp-eval.mjs <表达式文件>
import { readFile } from 'node:fs/promises'

const port = process.env.LUMEN_DEBUG_PORT ?? '9223'
const source = await readFile(process.argv[2], 'utf8')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error('没有可用的页面目标')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP 超时')), 30000)
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== 1) return
    clearTimeout(timer)
    resolve(message)
  })
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: source, awaitPromise: true, returnByValue: true },
    }),
  )
})

socket.close()
if (result.result?.exceptionDetails) {
  console.error('异常：', JSON.stringify(result.result.exceptionDetails, null, 2))
  process.exit(1)
}
console.log(JSON.stringify(result.result?.result?.value ?? null, null, 2))
