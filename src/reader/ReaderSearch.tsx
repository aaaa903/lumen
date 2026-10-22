import { useEffect, useRef, useState } from 'react'
import type { TextSearchHit } from '../../shared/types'
import { api } from '../lib/api'
import Snippet from '../search/Snippet'

type ReaderSearchProps = {
  bookId: string
  /** 正文索引是否已完成；未完成时仍可搜，但结果可能不全。 */
  indexed: boolean
  onJump: (hit: TextSearchHit) => void
  onClose: () => void
}

const SEARCH_LIMIT = 80
const SEARCH_DEBOUNCE_MS = 260
/** 与整库搜索一致：一个字太容易命中，查出来也没有参考价值。 */
const MIN_QUERY_LENGTH = 2

/**
 * 书内搜索：只查当前书的正文索引，按章节顺序列出命中，点击跳到原文位置。
 * 检索走主进程 SQLite，和整库搜索共用一套 FTS / LIKE 规则。
 */
export default function ReaderSearch({ bookId, indexed, onJump, onClose }: ReaderSearchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<TextSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY_LENGTH) {
      setHits([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void api
        .search({ q, scope: 'text', bookId, limit: SEARCH_LIMIT })
        .then((result) => {
          if (cancelled) return
          if (result.ok) {
            setHits(result.data.filter((hit): hit is TextSearchHit => hit.kind === 'text'))
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
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, bookId])

  const trimmed = query.trim()
  const hasQuery = trimmed.length >= MIN_QUERY_LENGTH

  return (
    <aside className="toc-panel reader-search-panel" aria-label="书内搜索">
      <div className="toc-head">
        <span>书内搜索</span>
        <button type="button" className="ghost-btn" onClick={onClose}>
          关闭
        </button>
      </div>

      <div className="reader-search-form">
        <input
          ref={inputRef}
          className="reader-search-input"
          type="search"
          value={query}
          placeholder="在这本书里查找"
          aria-label="书内搜索关键词"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              onClose()
              return
            }
            if (event.key === 'Enter' && hits.length > 0) {
              event.preventDefault()
              onJump(hits[0])
            }
          }}
        />
        <p className="reader-search-hint">
          {!indexed
            ? '这本书还在后台建索引，现在只能搜到已写入的部分。'
            : hasQuery && !loading && !error
              ? `命中 ${hits.length} 处，点击跳到原文。`
              : '只检索这本书的正文，至少输入两个字。'}
        </p>
      </div>

      <div className="reader-search-list" aria-live="polite">
        {loading && <p className="reader-search-empty">正在查找…</p>}
        {!loading && error && <p className="reader-search-empty">{error}</p>}
        {!loading && !error && hasQuery && hits.length === 0 && (
          <p className="reader-search-empty">没有找到「{trimmed}」。</p>
        )}
        {!loading &&
          !error &&
          hits.map((hit, index) => (
            <button
              key={`${hit.chapterIndex}-${hit.matchStart}-${index}`}
              type="button"
              className="reader-search-hit"
              onClick={() => onJump(hit)}
              title={hit.chapterTitle}
            >
              <span className="reader-search-chapter">
                {hit.chapterTitle || `第 ${hit.chapterIndex + 1} 节`}
              </span>
              <span className="reader-search-snippet">
                <Snippet text={hit.snippet} start={hit.matchStart} length={hit.matchLength} />
              </span>
            </button>
          ))}
      </div>
    </aside>
  )
}
