// 临时调试脚本：订阅 CDP 的控制台事件，收集 N 秒内渲染层的日志。
// 用法：node scripts/cdp-console.mjs [毫秒]
const port = process.env.LUMEN_DEBUG_PORT ?? '9223'
const duration = Number(process.argv[2] ?? '6000')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error('没有可用的页面目标')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

const logs = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = message.params.args
      .map((arg) => arg.value ?? arg.description ?? arg.type)
      .join(' ')
    logs.push(`[${message.params.type}] ${text}`)
  }
  if (message.method === 'Runtime.exceptionThrown') {
    logs.push(`[exception] ${message.params.exceptionDetails.exception?.description ?? ''}`)
  }
  if (message.method === 'Log.entryAdded') {
    logs.push(`[log:${message.params.entry.level}] ${message.params.entry.text}`)
  }
})

socket.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
socket.send(JSON.stringify({ id: 2, method: 'Log.enable' }))

await new Promise((resolve) => setTimeout(resolve, duration))
socket.close()
console.log(logs.join('\n') || '(没有日志)')
