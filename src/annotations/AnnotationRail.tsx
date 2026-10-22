import type { Annotation } from '../../shared/types'
import { parseReferenceIds, stripReferences } from '../../shared/references'
import { HIGHLIGHT_COLORS } from './colors'

type AnnotationRailProps = {
  annotations: Annotation[]
  /** 反向引用：目标标注 id → 引用它的批注。 */
  backrefs: Map<string, Annotation[]>
  activeId: string | null
  selectedIds: Set<string>
  exporting: boolean
  onToggleSelect: (id: string) => void
  onExport: (ids: string[] | null) => void
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
  backrefs,
  activeId,
  selectedIds,
  exporting,
  onToggleSelect,
  onExport,
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
        <div className="rail-head-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onExport(null)}
            disabled={annotations.length === 0 || exporting}
            title="把这本书的全部标注导出为 Markdown"
          >
            导出全部
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onExport([...selectedIds])}
            disabled={selectedIds.size === 0 || exporting}
            title="只导出勾选的标注"
          >
            导出所选（{selectedIds.size}）
          </button>
          <button type="button" className="ghost-btn" onClick={onClose} title="关闭标注侧栏">
            ×
          </button>
        </div>
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
                  const referenceCount = parseReferenceIds(annotation.noteMd).length
                  const backrefCount = backrefs.get(annotation.id)?.length ?? 0
                  return (
                    <li
                      className={`rail-item ${annotation.id === activeId ? 'is-active' : ''} ${
                        annotation.orphaned ? 'is-orphaned' : ''
                      }`}
                      key={annotation.id}
                    >
                      <input
                        type="checkbox"
                        className="rail-check"
                        checked={selectedIds.has(annotation.id)}
                        onChange={() => onToggleSelect(annotation.id)}
                        aria-label={`选择这条标注：${annotation.locator.quote.slice(0, 20)}`}
                      />
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
                          {referenceCount > 0 && (
                            <span className="rail-ref" title={`这条批注引用了 ${referenceCount} 条标注`}>
                              引用 {referenceCount}
                            </span>
                          )}
                          {backrefCount > 0 && (
                            <span
                              className="rail-ref is-back"
                              title={`有 ${backrefCount} 条批注引用了它`}
                            >
                              被引 {backrefCount}
                            </span>
                          )}
                        </span>
                        <span className="rail-quote">
                          {annotation.locator.quote ||
                            annotation.locator.chapterTitle ||
                            '未命名位置'}
                        </span>
                        {annotation.noteMd.trim() && (
                          <span className="rail-note">
                            {stripReferences(annotation.noteMd.trim())}
                          </span>
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
