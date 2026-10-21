import { useEffect, useRef } from 'react'

export type TocEntry = {
  label: string
  href: string
  depth: number
}

type TocDrawerProps = {
  entries: TocEntry[]
  activeHref: string
  onSelect: (href: string) => void
  onClose: () => void
}

/** 抽屉式目录：递归展平后按缩进呈现，打开时把当前章滚到可见位置。 */
export default function TocDrawer({ entries, activeHref, onSelect, onClose }: TocDrawerProps) {
  const listRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>('.toc-item.is-current')
        ?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeHref, entries])

  return (
    <aside className="toc-panel" aria-label="目录">
      <div className="toc-head">
        <span>目录</span>
        <button type="button" className="ghost-btn" onClick={onClose}>
          关闭
        </button>
      </div>
      <nav className="toc-list" ref={listRef}>
        {entries.length === 0 && <p className="toc-empty">这本书没有可用目录</p>}
        {entries.map((entry, index) => {
          const active = entry.href === activeHref
          return (
            <button
              key={`${entry.href}-${index}`}
              type="button"
              className={`toc-item ${active ? 'is-current' : ''}`}
              style={{ paddingLeft: 16 + entry.depth * 14 }}
              onClick={() => onSelect(entry.href)}
              title={entry.label}
            >
              {entry.label}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
