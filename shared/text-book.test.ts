import { describe, expect, it } from 'vitest'
import {
  decodeTextBytes,
  parseMarkdownBook,
  parseTxtBook,
  splitChapters,
} from './text-book'

describe('decodeTextBytes', () => {
  it('识别 UTF-8 BOM 并去掉它', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('灯下')])
    const result = decodeTextBytes(bytes)
    expect(result.encoding).toBe('utf-8')
    expect(result.text).toBe('灯下')
  })

  it('回退到 GB18030 解码 GBK 字节', () => {
    // 「中文」的 GBK 编码
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    const result = decodeTextBytes(bytes)
    expect(result.text).toBe('中文')
    expect(result.encoding).not.toBe('utf-8')
  })
})

describe('splitChapters', () => {
  it('按「第 N 章」切分并保留章节标题', () => {
    const text = ['第一章 开始', '正文一', '', '第二章 继续', '正文二'].join('\n')
    const chapters = splitChapters(text, '样书')
    expect(chapters).toHaveLength(2)
    expect(chapters[0]).toMatchObject({ title: '第一章 开始' })
    expect(chapters[0].body).toContain('正文一')
    expect(chapters[1].title).toBe('第二章 继续')
  })

  it('识别序章、Chapter 与 Markdown 标题', () => {
    const text = ['序章', '开场', 'Chapter 2', '中段', '## 尾声', '收束'].join('\n')
    const titles = splitChapters(text, '样书').map((chapter) => chapter.title)
    expect(titles).toEqual(['序章', 'Chapter 2', '尾声'])
  })

  it('超长章节按段落拆开', () => {
    const paragraph = '这是一段用来测试切分的文字。'.repeat(40)
    const body = Array.from({ length: 40 }, () => paragraph).join('\n')
    const chapters = splitChapters(`第一章 长\n${body}`, '样书')
    expect(chapters.length).toBeGreaterThan(1)
    expect(chapters[0].title).toBe('第一章 长')
    expect(chapters[1].title).toContain('续')
    for (const chapter of chapters) {
      expect(chapter.body.length).toBeLessThanOrEqual(18000 + paragraph.length)
    }
  })
})

describe('parseTxtBook', () => {
  it('读取书名与作者，并把它们从正文里去掉', () => {
    const text = ['书名：灯下漫读', '作者：测试作者', '', '第一章 灯', '正文'].join('\n')
    const book = parseTxtBook(text, '未知')
    expect(book.title).toBe('灯下漫读')
    expect(book.author).toBe('测试作者')
    expect(book.chapters[0].body).not.toContain('书名')
  })
})

describe('parseMarkdownBook', () => {
  it('读取 front matter 并按标题分章', () => {
    const text = ['---', 'title: 檐下笔记', 'author: 某人', '---', '', '# 檐下笔记', '', '开场白', '', '## 第一节', '内容一', '', '## 第二节', '内容二'].join('\n')
    const book = parseMarkdownBook(text, '未知')
    expect(book.title).toBe('檐下笔记')
    expect(book.author).toBe('某人')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['檐下笔记', '第一节', '第二节'])
  })

  it('没有标题时整篇作为一章', () => {
    const book = parseMarkdownBook('只有一段正文。', '随手记')
    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0].body).toBe('只有一段正文。')
  })
})
