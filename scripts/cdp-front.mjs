// 临时调试脚本：把窗口提到前台并检查 rAF 是否恢复。
const port = process.env.LUMEN_DEBUG_PORT ?? '9223'
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((target) => target.type === 'page')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

const pending = new Map()
let id = 0
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const resolver = pending.get(message.id)
  if (resolver) {
    pending.delete(message.id)
    resolver(message.result)
  }
})

const send = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })

await send('Page.bringToFront')
await new Promise((resolve) => setTimeout(resolve, 600))

const result = await send('Runtime.evaluate', {
  expression: `new Promise((resolve) => {
    requestAnimationFrame(() => resolve('raf-fired'))
    setTimeout(() => resolve('raf-timeout'), 2000)
  })`,
  awaitPromise: true,
  returnByValue: true,
})
console.log(JSON.stringify(result.result?.value))
socket.close()
