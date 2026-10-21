import { ipcMain } from 'electron'
import type { IpcErrorCode, IpcResult } from '../../shared/types'

/** IPC 层的可预期失败：带错误码，渲染层只按码决定提示文案。 */
export class IpcError extends Error {
  readonly code: IpcErrorCode

  constructor(code: IpcErrorCode, message: string) {
    super(message)
    this.name = 'IpcError'
    this.code = code
  }
}

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function fail(code: IpcErrorCode, message: string): IpcResult<never> {
  return { ok: false, code, message }
}

/**
 * 统一注册：参数校验与异常都在这里收口，通道实现只关心正常路径。
 * 未预期的异常不把堆栈丢给渲染层，只写主进程控制台。
 */
export function handle<T>(
  channel: string,
  run: (payload: unknown) => Promise<IpcResult<T>> | IpcResult<T>,
): void {
  ipcMain.handle(channel, async (_event, payload: unknown) => {
    try {
      return await run(payload)
    } catch (error) {
      if (error instanceof IpcError) return fail(error.code, error.message)
      console.error(`[Lumen] IPC ${channel} 失败`, error)
      return fail('INTERNAL', '操作没有完成，请重试；若反复失败，打开数据目录查看 logs/main.log。')
    }
  })
}

export function readObject(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) {
    throw new IpcError('INTERNAL', '请求参数格式不正确。')
  }
  return payload as Record<string, unknown>
}

export function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IpcError('INTERNAL', `请求参数 ${field} 不正确。`)
  }
  return value
}

export function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new IpcError('INTERNAL', `请求参数 ${field} 不正确。`)
  }
  return value as string[]
}

export function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readBoolean(value: unknown): boolean {
  return value === true
}
