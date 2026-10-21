import type { Annotation } from '../../shared/types'
import { HIGHLIGHT_COLORS } from './colors'

type AnnotationRailProps = {
  annotations: Annotation[]
  activeId: string | null
  onSelect: (annotation: Annotation) => void
  onDelete: (annotation: Annotation) => void
  onClose: () => void
}

type ChapterGroup = {
  key: string
  title: string
  order: number
  items: Annotation[]
}

function groupByChapter(annotations: Annotation[]): ChapterGroup[] {
  const groups = new Map<string, ChapterGroup>()
  for (const annotation of annotations) {
    const key = `${annotation.locator.chapterIndex}|${annotation.locator.href}`
    const group = groups.get(key) ?? {
      key,
      title: annotation.locator.chapterTitle || `第 ${annotation.locator.chapterIndex + 1} 节`,
      order: annotation.locator.chapterIndex,
      items: [],
    }
    group.items.push(annotation)
    groups.set(key, group)
  }

  return [...groups.values()]
    .sort((left, right) => left.order - right.order)
    .map((group) => ({
      ...group,
      items: group.items.sort(
        (left, right) =>
          (left.locator.cfi ?? '').localeCompare(right.locator.cfi ?? '') ||
          left.createdAt - right.createdAt,
      ),
    }))
}

/** 本书标注侧栏：按章节分组，点击跳转；位置失效的条目保留原文，只禁用跳转。 */
export default function AnnotationRail({
  annotations,
  activeId,
  onSelect,
  onDelete,
  onClose,
}: AnnotationRailProps) {
  const groups = groupByChapter(annotations)

  return (
    <aside className="annotation-rail" aria-label="本书标注">
      <header className="rail-head">
        <div>
          <p className="rail-kicker">标注</p>
          <p className="rail-count">{annotations.length} 条</p>
        </div>
        <button type="button" className="ghost-btn" onClick={onClose} title="关闭标注侧栏">
          ×
        </button>
      </header>

      {annotations.length === 0 ? (
        <div className="rail-empty">
          <p>这本书还没有标注。</p>
          <p className="rail-empty-hint">选中一段文字，点颜色即可高亮；写批注后也会出现在这里。</p>
        </div>
      ) : (
        <div className="rail-body">
          {groups.map((group) => (
            <section className="rail-group" key={group.key}>
              <h2 className="rail-chapter">{group.title}</h2>
              <ul className="rail-list">
                {group.items.map((annotation) => {
                  const colors = HIGHLIGHT_COLORS[annotation.color]
                  const isBookmark = annotation.kind === 'bookmark'
                  return (
                    <li
                      className={`rail-item ${annotation.id === activeId ? 'is-active' : ''} ${
                        annotation.orphaned ? 'is-orphaned' : ''
                      }`}
                      key={annotation.id}
                    >
                      <button
                        type="button"
                        className="rail-open"
                        onClick={() => onSelect(annotation)}
                        disabled={annotation.orphaned === 1}
                        title={
                          annotation.orphaned
                            ? '原文位置已失效，标注内容仍保留'
                            : '跳回原文'
                        }
                      >
                        <span className="rail-line">
                          <span
                            className={`rail-dot ${isBookmark ? 'is-bookmark' : ''}`}
                            style={{ background: isBookmark ? undefined : colors.swatch }}
                          />
                          <span className="rail-label">
                            {isBookmark ? '书签' : colors.label + '色高亮'}
                          </span>
                          {annotation.orphaned === 1 && (
                            <span className="rail-orphan">位置失效</span>
                          )}
                        </span>
                        <span className="rail-quote">
                          {annotation.locator.quote ||
                            annotation.locator.chapterTitle ||
                            '未命名位置'}
                        </span>
                        {annotation.noteMd.trim() && (
                          <span className="rail-note">{annotation.noteMd.trim()}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="rail-delete"
                        onClick={() => onDelete(annotation)}
                        title="删除这条标注"
                      >
                        删除
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </aside>
  )
}
