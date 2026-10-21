import type {
  Annotation,
  AnnotationColor,
  AnnotationKind,
  AnnotationLocator,
  AppVersions,
  CreateAnnotationInput,
  ImportResult,
  LumenApi,
  Progress,
  ShelfBook,
  UpdateAnnotationInput,
} from '../../shared/types'

const bridge = (): LumenApi => {
  if (!window.lumen) {
    throw new Error('预加载桥接不可用：请通过 Electron 启动，不要直接用浏览器打开开发地址。')
  }
  return window.lumen
}

/**
 * 组件只依赖这一层：避免每个组件自己判断 window.lumen 是否存在，
 * 也保证渲染层没有第二条通往主进程的路。
 */
export const api: LumenApi = {
  versions: () => bridge().versions(),
  openUserData: () => bridge().openUserData(),
  pickFiles: () => bridge().pickFiles(),
  importBooks: (paths) => bridge().importBooks(paths),
  listBooks: () => bridge().listBooks(),
  getBook: (id) => bridge().getBook(id),
  readBookFile: (id) => bridge().readBookFile(id),
  readCover: (id) => bridge().readCover(id),
  removeBook: (id) => bridge().removeBook(id),
  touchBook: (id) => bridge().touchBook(id),
  getProgress: (bookId) => bridge().getProgress(bookId),
  saveProgress: (input) => bridge().saveProgress(input),
  listAnnotations: (bookId) => bridge().listAnnotations(bookId),
  createAnnotation: (input) => bridge().createAnnotation(input),
  updateAnnotation: (input) => bridge().updateAnnotation(input),
  deleteAnnotation: (id) => bridge().deleteAnnotation(id),
  restoreAnnotation: (id) => bridge().restoreAnnotation(id),
  pathForFile: (file) => bridge().pathForFile(file),
}

export type {
  Annotation,
  AnnotationColor,
  AnnotationKind,
  AnnotationLocator,
  AppVersions,
  CreateAnnotationInput,
  ImportResult,
  Progress,
  ShelfBook,
  UpdateAnnotationInput,
}
