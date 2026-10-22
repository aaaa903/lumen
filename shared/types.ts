// 主进程与渲染层共用的类型。主进程是唯一可信方，这里的结构体只描述数据形状。

/** 应用与运行时版本，用于设置页与问题排查。 */
export type AppVersions = {
  app: string
  electron: string
  chrome: string
  node: string
  sqlite: string
  schema: number
  /** 用户数据目录的绝对路径，设置页展示用。 */
  userData: string
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

export type BookFormat = 'epub' | 'markdown' | 'txt' | 'pdf'

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
  /** 仅 PDF 使用；打开一次后由阅读器回填。 */
  pageCount: number
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

/** 索引器按章节提交的纯文本；渲染层负责从 epub.js 取文本，主进程只写库。 */
export type IndexChunk = {
  chapterIndex: number
  chapterTitle: string
  href: string
  text: string
}

export type SearchScope = 'text' | 'annotations'

export type SearchInput = {
  q: string
  scope: SearchScope
  /** 只搜某个标签下的标注；scope 为 text 时忽略。 */
  tagId?: string | null
  /** 只搜这一本书；为空表示整库。书内搜索用它。 */
  bookId?: string | null
  limit?: number
}

export type TextSearchHit = {
  kind: 'text'
  bookId: string
  bookTitle: string
  author: string
  chapterIndex: number
  chapterTitle: string
  href: string
  snippet: string
  matchStart: number
  matchLength: number
}

export type AnnotationSearchHit = {
  kind: 'annotation'
  annotationId: string
  bookId: string
  bookTitle: string
  author: string
  chapterIndex: number
  chapterTitle: string
  href: string
  quote: string
  noteMd: string
  color: AnnotationColor
  annotationKind: AnnotationKind
  createdAt: number
}

export type SearchHit = TextSearchHit | AnnotationSearchHit

/** 从搜索结果或外部入口打开一本书时要跳到的位置。 */
export type OpenTarget = {
  bookId: string
  href: string
  chapterIndex: number
  chapterTitle: string
  /** 定位用的原文片段；检索结果会带上前后文，避免重复词贴错位置。 */
  quote: string
  /** 片段里真正要标出的那几个字；为空时整段高亮。 */
  match?: string
}

export type Tag = {
  id: string
  name: string
  color: string
  createdAt: number
  /** 使用该标签的未删除标注数量。 */
  count: number
}

export type AnnotationTag = {
  annotationId: string
  tagId: string
}

export type Note = {
  id: string
  bookId: string | null
  bookTitle: string
  title: string
  bodyMd: string
  createdAt: number
  updatedAt: number
}

export type SaveNoteInput = {
  /** 不传表示新建。 */
  id?: string
  bookId: string | null
  title: string
  bodyMd: string
}

export type ExportRequest = {
  bookId: string
  /** 不传或空数组表示导出整本书的标注。 */
  ids?: string[]
}

export type ExportPayload = {
  markdown: string
  count: number
}

export type SaveTextInput = {
  suggestedName: string
  content: string
}

/** PDF 首次打开时回填元数据；只允许改 PDF，避免 EPUB 元数据被书内内容覆盖。 */
export type UpdateBookMetaInput = {
  id: string
  title?: string
  author?: string
  pageCount?: number
}

export type LibraryExportResult = {
  path: string
  files: number
}

/** 后台索引窗口领取到的任务；为空表示队列暂时没有活。 */
export type IndexerJob = {
  bookId: string
}

/** 预加载暴露给渲染层的全部能力。新增通道时同步 electron/preload.ts 与 src/lib/api.ts。 */
export type LumenApi = {
  versions: () => Promise<IpcResult<AppVersions>>
  openUserData: () => Promise<IpcResult<null>>
  /** 只允许 https 外链，交给系统浏览器；其余协议一律拒绝。 */
  openExternal: (url: string) => Promise<IpcResult<null>>
  /** 启动参数或第二实例带来的文件路径；渲染层挂载后取一次，避免早于订阅丢失。 */
  takePendingFiles: () => Promise<IpcResult<string[]>>
  /** 第二实例送来文件时触发；返回取消订阅函数。 */
  onOpenFiles: (callback: (paths: string[]) => void) => () => void
  /** 清空全部书、标注、笔记与索引；不可撤销。 */
  clearData: () => Promise<IpcResult<null>>
  pickFiles: () => Promise<IpcResult<string[]>>
  importBooks: (paths: string[]) => Promise<IpcResult<ImportResult[]>>
  listBooks: () => Promise<IpcResult<ShelfBook[]>>
  getBook: (id: string) => Promise<IpcResult<ShelfBook>>
  readBookFile: (id: string) => Promise<IpcResult<ArrayBuffer>>
  readCover: (id: string) => Promise<IpcResult<{ mime: string; data: ArrayBuffer } | null>>
  /** PDF 首次打开后回填标题、作者与页数。 */
  updateBookMeta: (input: UpdateBookMetaInput) => Promise<IpcResult<ShelfBook>>
  removeBook: (id: string, purge?: boolean) => Promise<IpcResult<null>>
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
  indexBegin: (bookId: string) => Promise<IpcResult<null>>
  indexChunks: (bookId: string, chunks: IndexChunk[]) => Promise<IpcResult<null>>
  indexFinish: (bookId: string) => Promise<IpcResult<null>>
  /** 请求后台索引；导入与打开未索引的书都会调用，主进程去重。 */
  requestIndex: (bookId: string) => Promise<IpcResult<null>>
  /** 后台索引窗口领取任务。 */
  indexerNext: () => Promise<IpcResult<IndexerJob | null>>
  /** 索引窗口被卸载或热更新时把任务还回队列。 */
  indexerRelease: (bookId: string) => Promise<IpcResult<null>>
  /** 后台索引窗口报告结果；主进程据此通知所有窗口刷新书架。 */
  indexerComplete: (bookId: string, ok: boolean) => Promise<IpcResult<null>>
  onIndexed: (callback: (bookId: string) => void) => () => void
  search: (input: SearchInput) => Promise<IpcResult<SearchHit[]>>
  listTags: () => Promise<IpcResult<Tag[]>>
  createTag: (name: string) => Promise<IpcResult<Tag>>
  renameTag: (id: string, name: string) => Promise<IpcResult<Tag>>
  deleteTag: (id: string) => Promise<IpcResult<null>>
  mergeTags: (sourceId: string, targetId: string) => Promise<IpcResult<Tag>>
  listAnnotationTags: (bookId: string) => Promise<IpcResult<AnnotationTag[]>>
  setAnnotationTags: (annotationId: string, tagIds: string[]) => Promise<IpcResult<null>>
  listNotes: () => Promise<IpcResult<Note[]>>
  saveNote: (input: SaveNoteInput) => Promise<IpcResult<Note>>
  deleteNote: (id: string) => Promise<IpcResult<null>>
  exportAnnotations: (input: ExportRequest) => Promise<IpcResult<ExportPayload>>
  /** 整个书库按「一本书一个 Markdown」导出到用户选择的目录。 */
  exportLibrary: () => Promise<IpcResult<LibraryExportResult | null>>
  saveText: (input: SaveTextInput) => Promise<IpcResult<{ path: string } | null>>
}
