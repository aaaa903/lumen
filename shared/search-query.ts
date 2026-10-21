/**
 * 检索语句与结果片段的纯逻辑。
 * 三条硬规则：
 * 1. FTS5 的 MATCH 参数只从这里生成，调用点不拼字符串；
 * 2. 不足 3 个字符的查询走 LIKE（中文两字词很常见，trigram 索引不到）；
 * 3. 片段永远按归一化空白后的文本计算，避免把换行当命中的一部分。
 */

/** trigram 分词至少要 3 个字符才能进 MATCH；更短的查询退化为 LIKE。 */
export const MATCH_MIN_LENGTH = 3

export type SearchPlan =
  | { mode: 'match'; value: string }
  | { mode: 'like'; value: string }

export type Snippet = {
  text: string
  /** 命中词在 text 中的起点（UTF-16 下标）。没有命中时为 0。 */
  matchStart: number
  matchLength: number
}

/** 把用户输入变成可安全交给 SQLite 的参数。空查询返回 null。 */
export function planSearch(raw: string): SearchPlan | null {
  const query = raw.trim()
  if (query.length === 0) return null

  if ([...query].length < MATCH_MIN_LENGTH) {
    return { mode: 'like', value: `%${escapeLike(query)}%` }
  }

  // FTS5 字符串字面量用双引号包裹，内部的双引号写成两个。
  return { mode: 'match', value: `"${query.replace(/"/g, '""')}"` }
}

/** LIKE 的转义字符固定为反斜杠，SQL 里必须同时写 ESCAPE '\'。 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** 检索框里输入的原始文本，用于片段定位与高亮。 */
export function cleanQuery(raw: string): string {
  return raw.trim()
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 截取命中位置周围的一段文本。
 * 命中词可能在大小写或空白上与原书不同，先归一化再找；找不到就给开头一段，
 * 让用户至少能判断这本书是否相关。
 */
export function makeSnippet(text: string, query: string, radius = 42): Snippet {
  const flat = collapse(text)
  const needle = collapse(query)
  if (flat.length === 0) return { text: '', matchStart: 0, matchLength: 0 }
  if (needle.length === 0) {
    return { text: flat.slice(0, radius * 2), matchStart: 0, matchLength: 0 }
  }

  const haystack = flat.toLowerCase()
  const index = haystack.indexOf(needle.toLowerCase())
  if (index < 0) {
    return { text: flat.slice(0, radius * 2), matchStart: 0, matchLength: 0 }
  }

  const start = Math.max(0, index - radius)
  const end = Math.min(flat.length, index + needle.length + radius)
  const leading = start > 0 ? '…' : ''
  const trailing = end < flat.length ? '…' : ''
  return {
    text: `${leading}${flat.slice(start, end)}${trailing}`,
    matchStart: leading.length + index - start,
    matchLength: needle.length,
  }
}

/** SQLite 的 LIKE 与 JS 的 toLowerCase 对中文没有区别，这里只处理 ASCII 边界。 */
export function normalizeForMatch(input: string): string {
  return collapse(input).toLowerCase()
}
