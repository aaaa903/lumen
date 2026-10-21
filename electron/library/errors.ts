import type { IpcErrorCode } from '../../shared/types'

/** 导入阶段的可预期失败：带错误码，交给渲染层按码提示。 */
export class ImportError extends Error {
  readonly code: IpcErrorCode

  constructor(code: IpcErrorCode, message: string) {
    super(message)
    this.name = 'ImportError'
    this.code = code
  }
}
