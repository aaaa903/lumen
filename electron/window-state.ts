import { screen, type BrowserWindow } from 'electron'
import type { Db } from './db/open'
import { getSetting, setSetting } from './db/repositories/settings'

/**
 * 记住窗口尺寸、位置与最大化状态。
 * 存进 settings 表而不是 localStorage：窗口尺寸要在窗口创建前读到，
 * 而且它属于桌面行为，不该跟渲染层偏好混在一起。
 */

const KEY = 'window-state'
const SAVE_DEBOUNCE_MS = 400
const MIN_WIDTH = 880
const MIN_HEIGHT = 600

export type WindowState = {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 判断保存的位置是否仍落在某块屏幕的工作区内，避免拔掉外接屏后窗口跑到看不见的地方。 */
function isVisible(x: number, y: number, width: number, height: number): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const overlapX = Math.max(0, Math.min(x + width, area.x + area.width) - Math.max(x, area.x))
    const overlapY = Math.max(0, Math.min(y + height, area.y + area.height) - Math.max(y, area.y))
    return overlapX >= 120 && overlapY >= 80
  })
}

export function readWindowState(db: Db): WindowState {
  const fallback: WindowState = { width: 1180, height: 800, maximized: false }
  const raw = getSetting(db, KEY)
  if (!raw) return fallback

  try {
    const parsed = JSON.parse(raw) as Partial<WindowState>
    const width = Math.max(MIN_WIDTH, isFiniteNumber(parsed.width) ? parsed.width : fallback.width)
    const height = Math.max(
      MIN_HEIGHT,
      isFiniteNumber(parsed.height) ? parsed.height : fallback.height,
    )
    const hasPosition = isFiniteNumber(parsed.x) && isFiniteNumber(parsed.y)
    const visible = hasPosition && isVisible(parsed.x!, parsed.y!, width, height)
    return {
      width,
      height,
      x: visible ? parsed.x : undefined,
      y: visible ? parsed.y : undefined,
      maximized: parsed.maximized === true,
    }
  } catch {
    return fallback
  }
}

export function trackWindowState(db: Db, win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined

  const save = (): void => {
    if (win.isDestroyed()) return
    const bounds = win.getNormalBounds()
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: win.isMaximized(),
    }
    setSetting(db, KEY, JSON.stringify(state))
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}
