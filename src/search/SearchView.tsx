import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OpenTarget, SearchHit, SearchScope, Tag } from '../../shared/types'
import { makeSnippet, snippetQuote } from '../../shared/search-query'
import { stripReferences } from '../../shared/references'
import { api } from '../lib/api'
import { relativeTime } from '../lib/format'
import Snippet from './Snippet'

type SearchViewProps = {
  onOpen: (target: OpenTarget) => void
}

type BookGroup = {
  bookId: string
  bookTitle: string
  author: string
  hits: SearchHit[]
}

function groupByBook(hits: SearchHit[]): BookGroup[] {
  const groups = new Map<string, BookGroup>()
  for (const hit of hits) {
    const group = groups.get(hit.bookId) ?? {
      bookId: hit.bookId,
      bookTitle: hit.bookTitle,
      author: hit.author,
      hits: [],
    }
    group.hits.push(hit)
    groups.set(hit.bookId, group)
  }
  return [...groups.values()]
}

function snippetFor(hit: SearchHit, query: string): { text: string; start: number; length: number } {
  if (hit.kind === 'text') {
    return { text: hit.snippet, start: hit.matchStart, length: hit.matchLength }
  }
  // 批注里的引用标记对读者没有意义，摘要里换成短标签再截片段。
  const snippet = makeSnippet(stripReferences(hit.quote || hit.noteMd), query)
  return { text: snippet.text, start: snippet.matchStart, length: snippet.matchLength }
}

/** 跨书检索：正文走 FTS 索引，标注直接查库；结果按书分组，点击跳回原文。 */
const SESSION_KEY = 'lumen:search'

type StoredSearch = {
  q?: string
  scope?: SearchScope
  tagId?: string | null
}

function readStoredSearch(): StoredSearch {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSearch) : {}
  } catch {
    return {}
  }
}

export default function SearchView({ onOpen }: SearchViewProps) {
  const [query, setQuery] = useState(() => readStoredSearch().q ?? '')
  const [scope, setScope] = useState<SearchScope>(() =>
    readStoredSearch().scope === 'annotations' ? 'annotations' : 'text',
  )
  const [tagId, setTagId] = useState<string | null>(() => readStoredSearch().tagId ?? null)
  const [tags, setTags] = useState<Tag[]>([])
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ q: query, scope, tagId }))
    } catch {
      // 会话存储不可用时只影响「返回后保留搜索条件」，不影响检索本身。
    }
  }, [query, scope, tagId])

  useEffect(() => {
    let disposed = false
    void api.listTags().then((result) => {
      if (disposed || !result.ok) return
      setTags(result.data)
    })
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length === 0) {
      setHits([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void api
        .search({
          q,
          scope,
          tagId: scope === 'annotations' ? tagId : null,
          limit: 100,
        })
        .then((result) => {
          if (cancelled) return
          if (result.ok) {
            setHits(result.data)
            setError(null)
          } else {
            setHits([])
            setError(result.message)
          }
          setLoading(false)
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          setError(cause instanceof Error ? cause.message : '搜索没有完成，请重试。')
          setLoading(false)
        })
    }, 260)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, scope, tagId])

  const groups = useMemo(() => groupByBook(hits), [hits])
  const hasQuery = query.trim().length > 0

  const openHit = useCallback(
    (hit: SearchHit) => {
      const matched =
        hit.kind === 'text'
          ? hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)
          : ''
      onOpen({
        bookId: hit.bookId,
        href: hit.href,
        chapterIndex: hit.chapterIndex,
        chapterTitle: hit.chapterTitle,
        // 带前后文的片段更容易贴准位置；命中的几个字单独标出。
        quote: hit.kind === 'text' ? snippetQuote(hit.snippet) : hit.quote || hit.noteMd.slice(0, 80),
        match: hit.kind === 'text' ? matched : undefined,
      })
    },
    [onOpen],
  )

  return (
    <main className="search-view">
      <header className="view-head">
        <div>
          <p className="view-kicker">知识库</p>
          <h1>搜索</h1>
        </div>
        <p className="view-hint">
          正文搜索依赖打开书时建立的索引；标注与批注随时可查。
        </p>
      </header>

      <div className="search-bar">
        <input
          className="search-input"
          type="search"
          value={query}
          placeholder={scope === 'text' ? '搜索书中的句子或词语' : '搜索标注原文与批注'}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="segmented" role="group" aria-label="搜索范围">
          <button
            type="button"
            className={scope === 'text' ? 'is-active' : ''}
            onClick={() => setScope('text')}
          >
            正文
          </button>
          <button
            type="button"
            className={scope === 'annotations' ? 'is-active' : ''}
            onClick={() => setScope('annotations')}
          >
            标注
          </button>
        </div>
      </div>

      {scope === 'annotations' && tags.length > 0 && (
        <div className="tag-chips" role="group" aria-label="按标签过滤">
          <button
            type="button"
            className={`tag-chip ${tagId === null ? 'is-active' : ''}`}
            onClick={() => setTagId(null)}
          >
            全部标签
          </button>
          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={`tag-chip tag-${tag.color} ${tagId === tag.id ? 'is-active' : ''}`}
              onClick={() => setTagId(tagId === tag.id ? null : tag.id)}
            >
              {tag.name}
              <span className="tag-count">{tag.count}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="view-error" role="alert">
          {error}
        </p>
      )}

      {!hasQuery ? (
        <section className="view-empty">
          <p>输入两个以上的字开始检索。</p>
          <p className="view-empty-hint">
            中文两字词按子串匹配；三字以上走全文索引。点一条结果会打开对应的书并定位到该段。
          </p>
        </section>
      ) : loading ? (
        <p className="view-loading">正在检索…</p>
      ) : hits.length === 0 ? (
        <section className="view-empty">
          <p>没有找到「{query.trim()}」。</p>
          <p className="view-empty-hint">
            {scope === 'text'
              ? '这本书可能还没建索引：打开一次就会自动建立。也可以换一个更短的词。'
              : '试试缩短关键词，或切换标签过滤。'}
          </p>
        </section>
      ) : (
        <div className="search-results">
          <p className="search-summary">
            共 {hits.length} 条结果，分布在 {groups.length} 本书
          </p>
          {groups.map((group) => (
            <section className="result-group" key={group.bookId}>
              <header className="result-head">
                <h2>{group.bookTitle}</h2>
                <span>{group.author || '作者未知'}</span>
                <span className="result-count">{group.hits.length} 条</span>
              </header>
              <ul className="result-list">
                {group.hits.map((hit) => {
                  const snippet = snippetFor(hit, query)
                  return (
                    <li key={hit.kind === 'text' ? `${hit.bookId}-${hit.chapterIndex}-${snippet.start}` : hit.annotationId}>
                      <button type="button" className="result-item" onClick={() => openHit(hit)}>
                        <span className="result-chapter">
                          {hit.chapterTitle || `第 ${hit.chapterIndex + 1} 节`}
                          {hit.kind === 'annotation' && (
                            <span className={`result-kind kind-${hit.color}`}>
                              {hit.annotationKind === 'bookmark' ? '书签' : '标注'}
                            </span>
                          )}
                        </span>
                        <span className="result-snippet">
                          <Snippet text={snippet.text} start={snippet.start} length={snippet.length} />
                        </span>
                        {hit.kind === 'annotation' && hit.noteMd.trim() && (
                          <span className="result-note">
                            {stripReferences(hit.noteMd).trim().slice(0, 120)}
                          </span>
                        )}
                        {hit.kind === 'annotation' && (
                          <span className="result-time">{relativeTime(hit.createdAt)}</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
