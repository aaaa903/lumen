import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LumenApi } from '../shared/types'

// 只暴露白名单方法：不把 ipcRenderer 本体交给渲染层，渲染层就无法构造任意通道。
const api: LumenApi = {
  versions: () => ipcRenderer.invoke('app:versions'),
  openUserData: () => ipcRenderer.invoke('app:openUserData'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', { url }),
  takePendingFiles: () => ipcRenderer.invoke('app:takePendingFiles'),
  clearData: () => ipcRenderer.invoke('app:clearData'),
  onOpenFiles: (callback) => {
    const listener = (_event: unknown, paths: string[]): void => callback(paths)
    ipcRenderer.on('app:openFiles', listener)
    return () => {
      ipcRenderer.removeListener('app:openFiles', listener)
    }
  },
  pickFiles: () => ipcRenderer.invoke('app:pickFiles'),
  importBooks: (paths) => ipcRenderer.invoke('books:import', { paths }),
  listBooks: () => ipcRenderer.invoke('books:list'),
  getBook: (id) => ipcRenderer.invoke('books:get', { id }),
  readBookFile: (id) => ipcRenderer.invoke('books:readFile', { id }),
  readCover: (id) => ipcRenderer.invoke('books:readCover', { id }),
  removeBook: (id, purge) =>
    ipcRenderer.invoke('books:remove', { id, purge: purge === true }),
  touchBook: (id) => ipcRenderer.invoke('books:touch', { id }),
  getProgress: (bookId) => ipcRenderer.invoke('progress:get', { bookId }),
  saveProgress: (input) => ipcRenderer.invoke('progress:save', input),
  listAnnotations: (bookId) => ipcRenderer.invoke('annotations:list', { bookId }),
  createAnnotation: (input) => ipcRenderer.invoke('annotations:create', input),
  updateAnnotation: (input) => ipcRenderer.invoke('annotations:update', input),
  deleteAnnotation: (id) => ipcRenderer.invoke('annotations:delete', { id }),
  restoreAnnotation: (id) => ipcRenderer.invoke('annotations:restore', { id }),
  indexBegin: (bookId) => ipcRenderer.invoke('search:indexBegin', { bookId }),
  indexChunks: (bookId, chunks) => ipcRenderer.invoke('search:indexChunks', { bookId, chunks }),
  indexFinish: (bookId) => ipcRenderer.invoke('search:indexFinish', { bookId }),
  search: (input) => ipcRenderer.invoke('search:query', input),
  listTags: () => ipcRenderer.invoke('tags:list'),
  createTag: (name) => ipcRenderer.invoke('tags:create', { name }),
  renameTag: (id, name) => ipcRenderer.invoke('tags:rename', { id, name }),
  deleteTag: (id) => ipcRenderer.invoke('tags:delete', { id }),
  mergeTags: (sourceId, targetId) => ipcRenderer.invoke('tags:merge', { sourceId, targetId }),
  listAnnotationTags: (bookId) => ipcRenderer.invoke('tags:forBook', { bookId }),
  setAnnotationTags: (annotationId, tagIds) =>
    ipcRenderer.invoke('tags:setForAnnotation', { annotationId, tagIds }),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  saveNote: (input) => ipcRenderer.invoke('notes:save', input),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', { id }),
  exportAnnotations: (input) => ipcRenderer.invoke('export:bookAnnotations', input),
  saveText: (input) => ipcRenderer.invoke('app:saveText', input),
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
