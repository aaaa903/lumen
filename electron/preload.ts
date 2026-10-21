import { contextBridge, ipcRenderer } from 'electron'
import type { LumenApi } from '../shared/types'

// 只暴露白名单方法：不把 ipcRenderer 本体交给渲染层，渲染层就无法构造任意通道。
const api: LumenApi = {
  versions: () => ipcRenderer.invoke('app:versions'),
  openUserData: () => ipcRenderer.invoke('app:openUserData'),
}

contextBridge.exposeInMainWorld('lumen', api)
