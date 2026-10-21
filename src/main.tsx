import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import IndexWorker from './reader/IndexWorker'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('找不到挂载点 #root')

// 隐藏窗口用同一个入口加载，靠查询参数区分职责；正式界面永远走 App。
const isIndexWorker = new URLSearchParams(window.location.search).get('worker') === 'index'

createRoot(container).render(
  <StrictMode>{isIndexWorker ? <IndexWorker /> : <App />}</StrictMode>,
)
