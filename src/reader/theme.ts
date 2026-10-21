import type { Rendition } from 'epubjs'
import {
  LINE_HEIGHTS,
  MARGINS,
  type LineHeightKey,
  type MarginKey,
  type ReaderPrefs,
  type ReaderTheme,
} from '../lib/prefs'

export type ThemeColors = {
  label: string
  bg: string
  fg: string
  muted: string
  accent: string
  night: boolean
}

export const READER_THEMES: Record<ReaderTheme, ThemeColors> = {
  paper: {
    label: '白纸',
    bg: '#fbf9f4',
    fg: '#232019',
    muted: '#6b6255',
    accent: '#8a5a3b',
    night: false,
  },
  sepia: {
    label: '米黄',
    bg: '#f1e5cf',
    fg: '#3a2f23',
    muted: '#7b6a52',
    accent: '#96602b',
    night: false,
  },
  sage: {
    label: '灰绿',
    bg: '#e8eee3',
    fg: '#283227',
    muted: '#5f6f5b',
    accent: '#4f6b4a',
    night: false,
  },
  night: {
    label: '夜间',
    bg: '#161513',
    fg: '#ddd5c8',
    muted: '#8b8377',
    accent: '#c69a63',
    night: true,
  },
}

export const LINE_HEIGHT_KEYS: LineHeightKey[] = ['tight', 'normal', 'loose']
export const MARGIN_KEYS: MarginKey[] = ['narrow', 'normal', 'wide']

/**
 * epub.js 的硬约束：主题在 renderTo 之后注册并 select；规则必须带 !important，
 * 只给 html 设背景、body 设透明，否则书内自带 CSS 会把夜间模式重新刷成白底。
 */
export function applyReaderTheme(rendition: Rendition, prefs: ReaderPrefs): void {
  const colors = READER_THEMES[prefs.theme]
  const padding = MARGINS[prefs.margin]

  rendition.themes.register('lumen', {
    html: {
      background: `${colors.bg} !important`,
      color: `${colors.fg} !important`,
    },
    body: {
      background: 'transparent !important',
      color: 'inherit !important',
      'line-height': `${LINE_HEIGHTS[prefs.lineHeight]} !important`,
      padding: `0 ${padding}px !important`,
    },
    'p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, blockquote':
      'color: inherit !important;',
    'a, a:link, a:visited': {
      color: `${colors.accent} !important`,
      'text-decoration': 'none !important',
    },
    'img, svg': {
      'max-width': '100% !important',
      height: 'auto !important',
    },
    '::selection': {
      background: `${colors.accent}44 !important`,
    },
  })
  rendition.themes.select('lumen')
  rendition.themes.fontSize(`${prefs.fontSize}%`)
}
