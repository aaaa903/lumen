type SnippetProps = {
  text: string
  /** 命中词在 text 中的起点；-1 或与 length 同时为 0 时原样显示。 */
  start: number
  length: number
}

/** 检索结果片段：用 mark 标出命中词，找不到位置时整段原样显示。 */
export default function Snippet({ text, start, length }: SnippetProps) {
  if (length <= 0) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + length)}</mark>
      {text.slice(start + length)}
    </span>
  )
}
