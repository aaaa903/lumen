import { describe, expect, it } from 'vitest'
import { buildAnnotationsMarkdown } from './export'
import type { ExportAnnotation } from './export'

function locator(chapterIndex: number, chapterTitle: string, quote: string, cfi: string) {
  return {
    format: 'epub' as const,
    cfi,
    href: `chapter-${chapterIndex}.xhtml`,
    chapterIndex,
    chapterTitle,
    page: 0,
    percent: 0,
    quote,
    prefix: '',
    suffix: '',
  }
}

const annotations: ExportAnnotation[] = [
  {
    kind: 'highlight',
    color: 'yellow',
    locator: locator(1, '第二章', '第二段原文', 'epubcfi(/6/4!/4/2)'),
    noteMd: '',
    createdAt: 2,
  },
  {
    kind: 'note',
    color: 'blue',
    locator: locator(0, '第一章', '第一段原文', 'epubcfi(/6/2!/4/2)'),
    noteMd: '我的批注\n第二行',
    createdAt: 1,
  },
  {
    kind: 'bookmark',
    color: 'slate',
    locator: locator(0, '第一章', '', 'epubcfi(/6/2!/4/8)'),
    noteMd: '书签备注',
    createdAt: 3,
  },
]

describe('buildAnnotationsMarkdown', () => {
  const exportedAt = new Date('2026-10-21T12:00:00.000Z')

  it('生成 front matter、按章节排序并保留批注', () => {
    const markdown = buildAnnotationsMarkdown(
      { title: '测试"书"', author: '作者' },
      annotations,
      '0.0.4',
      exportedAt,
    )

    expect(markdown).toContain('title: "测试\\"书\\""')
    expect(markdown).toContain('lumen_version: "0.0.4"')
    expect(markdown).toContain('exported_at: "2026-10-21T12:00:00.000Z"')
    expect(markdown.indexOf('## 第一章')).toBeLessThan(markdown.indexOf('## 第二章'))
    expect(markdown).toContain('> 第一段原文')
    expect(markdown).toContain('我的批注\n第二行')
    expect(markdown).toContain('> （书签）')
    expect(markdown).toContain('书签备注')
    expect(markdown).toContain('> 第二段原文')
  })

  it('没有标注也生成可读文件', () => {
    const markdown = buildAnnotationsMarkdown(
      { title: '空书', author: '' },
      [],
      '0.0.4',
      exportedAt,
    )
    expect(markdown).toContain('# 空书')
    expect(markdown).toContain('这本书还没有标注。')
  })
})
