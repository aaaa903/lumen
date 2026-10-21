import type { CSSProperties } from 'react'
import type { AnnotationColor } from '../../shared/types'
import { COLOR_ORDER, HIGHLIGHT_COLORS } from './colors'

type SelectionMenuProps = {
  anchor: { left: number; right: number; top: number; bottom: number }
  onHighlight: (color: AnnotationColor) => void
  onNote: () => void
  onCopy: () => void
  onClose: () => void
}

/** 选中文字后的浮动工具条。位置由父组件按 iframe 偏移算好，这里只负责避让窗口边缘。 */
export default function SelectionMenu({
  anchor,
  onHighlight,
  onNote,
  onCopy,
  onClose,
}: SelectionMenuProps) {
  const halfWidth = 150
  const left = Math.min(
    Math.max(anchor.left, halfWidth + 12),
    Math.max(halfWidth + 12, window.innerWidth - halfWidth - 12),
  )
  const above = anchor.top > 96
  const style: CSSProperties = above
    ? { left, top: anchor.top - 10, transform: 'translate(-50%, -100%)' }
    : { left, top: anchor.bottom + 10, transform: 'translate(-50%, 0)' }

  return (
    <div className="selection-menu" style={style} role="toolbar" aria-label="标注选中文字">
      <span className="selection-quote" aria-hidden="true">
        标记
      </span>
      {COLOR_ORDER.map((color) => (
        <button
          key={color}
          type="button"
          className="selection-swatch"
          style={{ background: HIGHLIGHT_COLORS[color].swatch }}
          title={`${HIGHLIGHT_COLORS[color].label}色高亮`}
          aria-label={`${HIGHLIGHT_COLORS[color].label}色高亮`}
          onClick={() => onHighlight(color)}
        />
      ))}
      <span className="selection-sep" aria-hidden="true" />
      <button type="button" className="selection-action" onClick={onNote}>
        批注
      </button>
      <button type="button" className="selection-action" onClick={onCopy}>
        复制
      </button>
      <button
        type="button"
        className="selection-close"
        onClick={onClose}
        title="关闭"
        aria-label="关闭工具条"
      >
        ×
      </button>
    </div>
  )
}
