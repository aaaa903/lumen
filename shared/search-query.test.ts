import { describe, expect, it } from 'vitest'
import {
  escapeLike,
  makeSnippet,
  MATCH_MIN_LENGTH,
  normalizeForMatch,
  planSearch,
} from './search-query'

describe('planSearch', () => {
  it('空查询不产生语句', () => {
    expect(planSearch('   ')).toBeNull()
  })

  it('两字中文走 LIKE', () => {
    expect(planSearch('阅读')).toEqual({ mode: 'like', value: '%阅读%' })
  })

  it('达到三字走 MATCH 并加引号', () => {
    expect(planSearch('阅读器')).toEqual({ mode: 'match', value: '"阅读器"' })
    expect(MATCH_MIN_LENGTH).toBe(3)
  })

  it('双引号按 FTS5 规则转义', () => {
    expect(planSearch('a"b')).toEqual({ mode: 'match', value: '"a""b"' })
  })

  it('LIKE 转义百分号与下划线', () => {
    expect(planSearch('a%')).toEqual({ mode: 'like', value: '%a\\%%' })
    expect(planSearch('_x')).toEqual({ mode: 'like', value: '%\\_x%' })
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
  })
})

describe('makeSnippet', () => {
  it('命中时保留前后文并给出偏移', () => {
    const snippet = makeSnippet('前面一段话，命中词在这里，后面还有字。', '命中词', 5)
    expect(snippet.text).toContain('命中词')
    expect(snippet.text.slice(snippet.matchStart, snippet.matchStart + snippet.matchLength)).toBe(
      '命中词',
    )
    expect(snippet.text.startsWith('…')).toBe(true)
  })

  it('折叠空白后再定位', () => {
    const snippet = makeSnippet('第一行\n\n  关键词  出现在这里', '关键词')
    expect(snippet.matchLength).toBe(3)
    expect(snippet.text.slice(snippet.matchStart, snippet.matchStart + 3)).toBe('关键词')
  })

  it('找不到时退回开头', () => {
    const snippet = makeSnippet('一段完全无关的文字', '不存在')
    expect(snippet.matchLength).toBe(0)
    expect(snippet.text.startsWith('一段')).toBe(true)
  })

  it('英文大小写不敏感', () => {
    const snippet = makeSnippet('The Lumen Reader', 'lumen')
    expect(snippet.text.slice(snippet.matchStart, snippet.matchStart + 5)).toBe('Lumen')
  })
})

describe('normalizeForMatch', () => {
  it('压缩空白并转小写', () => {
    expect(normalizeForMatch('  A  B\nC ')).toBe('a b c')
  })
})
