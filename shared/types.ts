// 主进程与渲染层共用的类型。主进程是唯一可信方，这里的结构体只描述数据形状。

/** 应用与运行时版本，用于设置页与问题排查。 */
export type AppVersions = {
  app: string
  electron: string
  chrome: string
  node: string
  sqlite: string
  schema: number
}

/** IPC 错误码。渲染层按码决定提示文案与下一步，不解析 message。 */
export type IpcErrorCode =
  | 'DUPLICATE'
  | 'ENCRYPTED'
  | 'UNSUPPORTED'
  | 'TOO_LARGE'
  | 'PARSE_FAILED'
  | 'NOT_FOUND'
  | 'DB_ERROR'
  | 'IO_ERROR'
  | 'INTERNAL'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: IpcErrorCode; message: string }

export type BookFormat = 'epub' | 'markdown' | 'txt'

/** 书库里的书。filePath / coverPath 都是相对 userData 的路径。 */
export type Book = {
  id: string
  title: string
  author: string
  format: BookFormat
  filePath: string
  sha256: string
  size: number
  coverPath: string | null
  chapterCount: number
  indexedAt: number | null
  addedAt: number
  lastOpenedAt: number | null
  deletedAt: number | null
}

/** 书架卡片需要的书 + 进度摘要。 */
export type ShelfBook = Book & {
  percent: number
  chapter: string
}

/**
 * 阅读位置。M1 先写 cfi 与章节信息；
 * quote / prefix / suffix 由 M2 的标注体系填充，这里预留可选字段。
 */
export type Locator = {
  format: BookFormat
  /** epub.js 生成；定位表尚未就绪或书签以外的情况可能为空。 */
  cfi: string | null
  href: string
  chapterIndex: number
  chapterTitle: string
  page: number
  percent: number
  quote?: string
  prefix?: string
  suffix?: string
}

export type Progress = {
  bookId: string
  locator: Locator
  percent: number
  chapter: string
  updatedAt: number
}

/** 标注必须带原文片段；书签的 quote 为空串。 */
export type AnnotationLocator = Locator & {
  quote: string
  prefix: string
  suffix: string
}

export type AnnotationKind = 'highlight' | 'note' | 'bookmark'

export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'slate'

export type Annotation = {
  id: string
  bookId: string
  /** 跨段落高亮共用；单段标注为 null。 */
  groupId: string | null
  kind: AnnotationKind
  color: AnnotationColor
  locator: AnnotationLocator
  noteMd: string
  /** 1 = CFI 与原文都对不上，只保留 quote 供用户手动处理。 */
  orphaned: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type CreateAnnotationInput = {
  bookId: string
  kind: AnnotationKind
  color: AnnotationColor
  locator: AnnotationLocator
  noteMd: string
  groupId: string | null
}

export type UpdateAnnotationInput = {
  id: string
  color?: AnnotationColor
  noteMd?: string
  locator?: AnnotationLocator
  orphaned?: boolean
}

export type ImportResult =
  | { status: 'ok'; book: ShelfBook }
  | { status: 'duplicate'; bookId: string; title: string }
  | { status: 'error'; fileName: string; code: IpcErrorCode; message: string }

/** 预加载暴露给渲染层的全部能力。新增通道时同步 electron/preload.ts 与 src/lib/api.ts。 */
export type LumenApi = {
  versions: () => Promise<IpcResult<AppVersions>>
  openUserData: () => Promise<IpcResult<null>>
  pickFiles: () => Promise<IpcResult<string[]>>
  importBooks: (paths: string[]) => Promise<IpcResult<ImportResult[]>>
  listBooks: () => Promise<IpcResult<ShelfBook[]>>
  getBook: (id: string) => Promise<IpcResult<ShelfBook>>
  readBookFile: (id: string) => Promise<IpcResult<ArrayBuffer>>
  readCover: (id: string) => Promise<IpcResult<{ mime: string; data: ArrayBuffer } | null>>
  removeBook: (id: string) => Promise<IpcResult<null>>
  touchBook: (id: string) => Promise<IpcResult<null>>
  getProgress: (bookId: string) => Promise<IpcResult<Progress | null>>
  saveProgress: (input: {
    bookId: string
    locator: Locator
    percent: number
    chapter: string
  }) => Promise<IpcResult<null>>
  listAnnotations: (bookId: string) => Promise<IpcResult<Annotation[]>>
  createAnnotation: (input: CreateAnnotationInput) => Promise<IpcResult<Annotation>>
  updateAnnotation: (input: UpdateAnnotationInput) => Promise<IpcResult<Annotation>>
  deleteAnnotation: (id: string) => Promise<IpcResult<Annotation>>
  restoreAnnotation: (id: string) => Promise<IpcResult<Annotation>>
  pathForFile: (file: File) => string
}
