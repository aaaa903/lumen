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

/** 预加载暴露给渲染层的全部能力。新增通道时同步 electron/preload.ts 与 src/lib/api.ts。 */
export type LumenApi = {
  versions: () => Promise<IpcResult<AppVersions>>
  openUserData: () => Promise<IpcResult<null>>
}
