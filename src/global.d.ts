import type { LumenApi } from '../../shared/types'

declare global {
  interface Window {
    lumen: LumenApi
  }
}

export {}
