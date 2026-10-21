import { describe, expect, it } from 'vitest'
import {
  ANCHOR_THRESHOLD,
  buildContext,
  contextScore,
  findBestQuote,
  findQuoteCandidates,
  jaccard,
  normalizeText,
  parseLocator,
} from './locator'

const CHAPTER = `雨停之后，街上的人声重新变得清楚。窗台上晒着陈皮，气味缓慢地漫过整个下午。
夜很深的时候，文字会变得像水一样，从眼睛里流过去。
他在页边写下两个字：记住。黄昏时屋子里的光变成橘色，书页也跟着变暖。`

describe('normalizeText', () => {
  it('去掉半角／全角空白与换行', () => {
    expect(normalizeText(' 灯 下\u3000漫\n读 ')).toBe('灯下漫读')
  })

  it('保留标点与英文大小写', () => {
    expect(normalizeText('Lumen，你好。')).toBe('Lumen，你好。')
  })
})

describe('buildContext', () => {
  it('取原文片段与前后各 32 字', () => {
    const start = CHAPTER.indexOf('文字会变得')
    const end = start + '文字会变得像水一样'.length
    const context = buildContext(CHAPTER, start, end)
    expect(context.quote).toBe('文字会变得像水一样')
    expect(context.prefix.endsWith('夜很深的时候，')).toBe(true)
    expect(context.suffix.startsWith('，从眼睛里流过去')).toBe(true)
  })

  it('quote 超过 500 字时截断', () => {
    const long = '甲'.repeat(600)
    expect(buildContext(long, 0, long.length).quote.length).toBe(500)
  })
})

describe('jaccard', () => {
  it('完全相同为 1，完全无关为 0', () => {
    expect(jaccard('雨停之后', '雨停之后')).toBe(1)
    expect(jaccard('雨停之后', '完全不同')).toBe(0)
  })

  it('忽略空白差异', () => {
    expect(jaccard('雨 停\n之后', '雨停之后')).toBe(1)
  })
})

describe('findQuoteCandidates', () => {
  it('在带换行与空格的原文里定位', () => {
    const quote = '文字会变得像水一样'
    const candidate = findBestQuote(CHAPTER, quote)
    expect(candidate).not.toBeNull()
    expect(CHAPTER.slice(candidate!.start, candidate!.end)).toContain('文字会变得')
  })

  it('重复出现的同一句按上下文选对位置', () => {
    const text = '前言 灯下 甲。中间隔开。结尾 灯下 乙。'
    const first = text.indexOf('灯下')
    const expected = buildContext(text, first, first + 2)
    const candidate = findBestQuote(text, '灯下', expected.prefix, expected.suffix)
    expect(candidate?.start).toBe(first)
  })

  it('上下文完全不匹配时低于阈值', () => {
    const text = '第一段有灯下二字。第二段也有灯下二字。'
    const score = contextScore(text, 3, 5, '完全无关的前文', '完全无关的后文')
    expect(score).toBeLessThan(ANCHOR_THRESHOLD)
  })

  it('找不到 quote 时返回空数组', () => {
    expect(findQuoteCandidates(CHAPTER, '不存在的句子')).toEqual([])
  })

  it('空 quote 直接返回空，不把整章当成候选', () => {
    expect(findQuoteCandidates(CHAPTER, '  ')).toEqual([])
  })
})

describe('parseLocator', () => {
  it('接受完整 locator', () => {
    const parsed = parseLocator({
      format: 'epub',
      cfi: 'epubcfi(/6/4!/4/2/2/1:0)',
      href: 'chapter2.xhtml',
      chapterIndex: 1,
      chapterTitle: '第二章',
      page: 3,
      percent: 0.34,
      quote: '灯下',
      prefix: '前文',
      suffix: '后文',
    })
    expect(parsed?.cfi).toBe('epubcfi(/6/4!/4/2/2/1:0)')
    expect(parsed?.quote).toBe('灯下')
  })

  it('缺 href 或格式不认识时返回 null', () => {
    expect(parseLocator({ format: 'epub', cfi: 'x' })).toBeNull()
    expect(parseLocator({ format: 'pdf', href: 'a.xhtml' })).toBeNull()
    expect(parseLocator(null)).toBeNull()
  })
})
