import type { AppVersions, LumenApi } from '../../shared/types'

const bridge = (): LumenApi => {
  if (!window.lumen) {
    throw new Error('预加载桥接不可用：请通过 Electron 启动，不要直接用浏览器打开开发地址。')
  }
  return window.lumen
}

// 组件只依赖这一层，避免每个组件自己判断 window.lumen 是否存在。
export const api: LumenApi = {
  versions: () => bridge().versions(),
  openUserData: () => bridge().openUserData(),
}

export type { AppVersions }
