/** 阅读器偏好。全部落在 localStorage，键名统一 `lumen:` 前缀（见 TECH_DESIGN §12）。 */

export type ReaderTheme = 'paper' | 'sepia' | 'sage' | 'night'
export type LineHeightKey = 'tight' | 'normal' | 'loose'
export type MarginKey = 'narrow' | 'normal' | 'wide'
export type ReaderFlow = 'paginated' | 'scrolled'

export const THEME_ORDER: ReaderTheme[] = ['paper', 'sepia', 'sage', 'night']
export const FLOW_ORDER: ReaderFlow[] = ['paginated', 'scrolled']
export const FONT_MIN = 80
export const FONT_MAX = 170
export const FONT_STEP = 10

export const LINE_HEIGHTS: Record<LineHeightKey, number> = {
  tight: 1.55,
  normal: 1.8,
  loose: 2.05,
}

export const MARGINS: Record<MarginKey, number> = {
  narrow: 8,
  normal: 24,
  wide: 48,
}

export const LINE_HEIGHT_LABEL: Record<LineHeightKey, string> = {
  tight: '紧凑',
  normal: '标准',
  loose: '宽松',
}

export const MARGIN_LABEL: Record<MarginKey, string> = {
  narrow: '窄',
  normal: '中',
  wide: '宽',
}

export const FLOW_LABEL: Record<ReaderFlow, string> = {
  paginated: '分页',
  scrolled: '滚动',
}

const KEYS = {
  theme: 'lumen:theme',
  fontSize: 'lumen:font-size',
  lineHeight: 'lumen:line-height',
  margin: 'lumen:margin',
  flow: 'lumen:reader-flow',
  lastBook: 'lumen:last-book',
  shelfFilter: 'lumen:shelf-filter',
} as const

export type ReaderPrefs = {
  theme: ReaderTheme
  fontSize: number
  lineHeight: LineHeightKey
  margin: MarginKey
  /** 滚动模式是 V1 增加的；老用户的 localStorage 没有这个键，默认分页。 */
  flow: ReaderFlow
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 存储被禁用时偏好只在本次会话生效，不打断阅读。
  }
}

export function readReaderPrefs(): ReaderPrefs {
  const theme = readStored(KEYS.theme) as ReaderTheme | null
  const fontSize = Number(readStored(KEYS.fontSize))
  const lineHeight = readStored(KEYS.lineHeight) as LineHeightKey | null
  const margin = readStored(KEYS.margin) as MarginKey | null
  const flow = readStored(KEYS.flow) as ReaderFlow | null

  return {
    theme: theme && THEME_ORDER.includes(theme) ? theme : 'paper',
    fontSize:
      Number.isFinite(fontSize) && fontSize >= FONT_MIN && fontSize <= FONT_MAX ? fontSize : 100,
    lineHeight: lineHeight && lineHeight in LINE_HEIGHTS ? lineHeight : 'normal',
    margin: margin && margin in MARGINS ? margin : 'normal',
    flow: flow && FLOW_ORDER.includes(flow) ? flow : 'paginated',
  }
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  writeStored(KEYS.theme, prefs.theme)
  writeStored(KEYS.fontSize, String(prefs.fontSize))
  writeStored(KEYS.lineHeight, prefs.lineHeight)
  writeStored(KEYS.margin, prefs.margin)
  writeStored(KEYS.flow, prefs.flow)
}

export function readLastBook(): string | null {
  return readStored(KEYS.lastBook)
}

export function saveLastBook(bookId: string): void {
  writeStored(KEYS.lastBook, bookId)
}

export function readShelfFilter(): string {
  return readStored(KEYS.shelfFilter) ?? ''
}

export function saveShelfFilter(value: string): void {
  writeStored(KEYS.shelfFilter, value)
}
