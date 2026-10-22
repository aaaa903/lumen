import MarkdownIt from 'markdown-it'
import {
  MISSING_REFERENCE_LABEL,
  REFERENCE_SOURCE,
  type ReferenceLabelResolver,
} from '../../shared/references'

/**
 * 批注正文的渲染器：Markdown + 标注引用。
 *
 * 与 `lib/convert/markdown.ts`（把 Markdown 书转成 EPUB XHTML）分开：
 * 这里多一条行内规则，把 `[[ann:<id>]]` 变成带 data-annotation-id 的站内链接，
 * 由 NoteEditor 拦截点击后跳回被引用的标注。
 */

const md = new MarkdownIt({
  html: false,
  xhtmlOut: true,
  linkify: false,
  breaks: false,
  typographer: false,
})

/** 引用标记最长也就 80 个字符，按上限切片再匹配，避免每行都复制整段文本。 */
const MAX_REFERENCE_TOKEN = 80
const REFERENCE_HEAD = new RegExp(`^${REFERENCE_SOURCE}`)

/**
 * 当前这轮渲染用的引用标签解析器。
 * markdown-it 的 render 是同步的，所以一次渲染期间读写它不会串；
 * 走 env 需要迁就第三方类型，反而更绕。
 */
let activeResolver: ReferenceLabelResolver | undefined

md.inline.ruler.before('link', 'lumen_reference', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false
  const slice = state.src.slice(state.pos, state.pos + MAX_REFERENCE_TOKEN)
  const match = REFERENCE_HEAD.exec(slice)
  if (!match) return false

  const id = (match[1] ?? '').toLowerCase()
  if (!silent) {
    const label = activeResolver?.(id)?.trim() || MISSING_REFERENCE_LABEL
    const open = state.push('link_open', 'a', 1)
    open.attrs = [
      ['href', `#ann-${id}`],
      ['data-annotation-id', id],
      ['class', 'note-ref'],
    ]
    const text = state.push('text', '', 0)
    text.content = label
    state.push('link_close', 'a', -1)
  }
  state.pos += match[0].length
  return true
})

export function noteMarkdownToHtml(
  source: string,
  references?: ReferenceLabelResolver,
): string {
  activeResolver = references
  try {
    return md.render(source)
  } finally {
    activeResolver = undefined
  }
}
