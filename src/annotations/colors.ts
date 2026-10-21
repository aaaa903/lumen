import type { AnnotationColor } from '../../shared/types'

export const HIGHLIGHT_COLORS: Record<
  AnnotationColor,
  { label: string; fill: string; stroke: string; swatch: string }
> = {
  yellow: { label: '黄', fill: '#f2c94c', stroke: '#d9a92f', swatch: '#f2c94c' },
  green: { label: '绿', fill: '#7fc8a9', stroke: '#5aa387', swatch: '#7fc8a9' },
  blue: { label: '蓝', fill: '#7fb2e5', stroke: '#5b8fc2', swatch: '#7fb2e5' },
  pink: { label: '粉', fill: '#e89ab4', stroke: '#c47790', swatch: '#e89ab4' },
  slate: { label: '灰', fill: '#a8b0ba', stroke: '#828b96', swatch: '#a8b0ba' },
}

export const COLOR_ORDER: AnnotationColor[] = ['yellow', 'green', 'blue', 'pink', 'slate']
