import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LumenApi } from '../shared/types'

// 只暴露白名单方法：不把 ipcRenderer 本体交给渲染层，渲染层就无法构造任意通道。
const api: LumenApi = {
  versions: () => ipcRenderer.invoke('app:versions'),
  openUserData: () => ipcRenderer.invoke('app:openUserData'),
  pickFiles: () => ipcRenderer.invoke('app:pickFiles'),
  importBooks: (paths) => ipcRenderer.invoke('books:import', { paths }),
  listBooks: () => ipcRenderer.invoke('books:list'),
  getBook: (id) => ipcRenderer.invoke('books:get', { id }),
  readBookFile: (id) => ipcRenderer.invoke('books:readFile', { id }),
  readCover: (id) => ipcRenderer.invoke('books:readCover', { id }),
  removeBook: (id) => ipcRenderer.invoke('books:remove', { id }),
  touchBook: (id) => ipcRenderer.invoke('books:touch', { id }),
  getProgress: (bookId) => ipcRenderer.invoke('progress:get', { bookId }),
  saveProgress: (input) => ipcRenderer.invoke('progress:save', input),
  // 拖放进来的 File 不在渲染层持有真实路径，必须由 preload 的 webUtils 取。
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
}

contextBridge.exposeInMainWorld('lumen', api)
