import { describe, expect, it } from 'vitest'
import {
  MISSING_REFERENCE_LABEL,
  parseReferenceIds,
  referenceLabel,
  referenceToken,
  referencesId,
  replaceReferences,
  stripReferences,
} from './references'

const A = '3f1c6f3e-9d1a-4c1e-8f3a-2b5c7d9e1a44'
const B = 'a1b2c3d4-0000-4000-8000-000000000002'

describe('parseReferenceIds', () => {
  it('按出现顺序去重', () => {
    const md = `先看 ${referenceToken(A)}，再看 ${referenceToken(B)}，最后又是 ${referenceToken(A)}。`
    expect(parseReferenceIds(md)).toEqual([A, B])
  })

  it('没有引用时返回空数组', () => {
    expect(parseReferenceIds('只有普通文字与[[方括号]]。')).toEqual([])
  })

  it('识别单条引用', () => {
    expect(referencesId(`见 ${referenceToken(A)}`, A)).toBe(true)
    expect(referencesId(`见 ${referenceToken(A)}`, B)).toBe(false)
  })
})

describe('replaceReferences', () => {
  it('用 resolver 的结果替换引用', () => {
    const md = `参见 ${referenceToken(A)}。`
    expect(replaceReferences(md, (id) => (id === A ? '第 2 章「雨停之后」' : null))).toBe(
      '参见 第 2 章「雨停之后」。',
    )
  })

  it('目标不存在时给出说明，不吞掉原文', () => {
    const md = `参见 ${referenceToken(A)}。`
    expect(replaceReferences(md, () => null)).toBe(`参见 ${MISSING_REFERENCE_LABEL}。`)
  })

  it('保留引用前后的其它 Markdown', () => {
    const md = `- 重点 ${referenceToken(A)}\n- 次要`
    expect(replaceReferences(md, () => '第一条')).toBe('- 重点 第一条\n- 次要')
  })
})

describe('stripReferences', () => {
  it('摘要里换成短标签', () => {
    expect(stripReferences(`见 ${referenceToken(A)}`)).toBe('见 〔引用〕')
  })
})

describe('referenceLabel', () => {
  it('章节与原文片段都取', () => {
    expect(referenceLabel({ chapterTitle: '第二章', chapterIndex: 1, quote: '雨停之后' })).toBe(
      '第二章「雨停之后」',
    )
  })

  it('长原文截断，书签只留章节', () => {
    const label = referenceLabel({
      chapterTitle: '',
      chapterIndex: 4,
      quote: '很长的原文'.repeat(10),
    })
    expect(label.startsWith('第 5 节「')).toBe(true)
    expect(label.endsWith('…」')).toBe(true)
    expect(referenceLabel({ chapterTitle: '第三章', chapterIndex: 2, quote: '  ' })).toBe('第三章')
  })
})
