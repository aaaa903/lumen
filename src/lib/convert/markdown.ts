import MarkdownIt from 'markdown-it'

/**
 * 把 Markdown 转成可嵌进 XHTML 的片段。
 * html: false 让原始 HTML 被转义而不是执行，书里的内容不能带脚本进来；
 * xhtmlOut: true 输出自闭合空标签，避免 epub.js 用 XML 解析章节时整章失败。
 */
const md = new MarkdownIt({
  html: false,
  xhtmlOut: true,
  linkify: false,
  breaks: false,
  typographer: false,
})

export function markdownToHtml(source: string): string {
  return md.render(source)
}
