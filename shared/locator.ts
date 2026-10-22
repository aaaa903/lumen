/**
 * 标注定位与重锚的纯逻辑。这里不碰 DOM，方便单测：
 * 渲染层负责把 Range 变成文本与 CFI，主进程只存 JSON。
 */

import type { BookFormat, Locator } from './types'

export const QUOTE_LIMIT = 500
export const CONTEXT_LENGTH = 32
/** 重锚成功的相似度下限；低于它宁可标为「位置失效」，也不把标注贴到错误段落。 */
export const ANCHOR_THRESHOLD = 0.6
/** 同一段里重复出现的句子最多核对 50 次，避免病态输入拖慢打开速度。 */
const MAX_CANDIDATES = 50

export type QuoteCandidate = {
  /** 原文中的起止下标（按 UTF-16 code unit，与 Range 的 offset 一致）。 */
  start: number
  end: number
  score: number
}

export type Context = {
  quote: string
  prefix: string
  suffix: string
}

type Normalized = {
  text: string
  /** 归一化文本的每个字符在原文中的下标。 */
  indexMap: number[]
}

/**
 * 比较用的归一化：去掉所有空白差异（含全角空格、换行），不做标点或繁简转换。
 * 这样 EPUB 重新排版、换行位置变化不会让 quote 对不上。
 */
export function normalizeText(input: string): string {
  return input.replace(/[\s\u3000\u00A0]+/g, '')
}

function normalizeWithMap(input: string): Normalized {
  let text = ''
  const indexMap: number[] = []
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (/[\s\u3000\u00A0]/.test(char)) continue
    text += char
    indexMap.push(index)
  }
  return { text, indexMap }
}

function clampQuote(quote: string): string {
  return quote.length > QUOTE_LIMIT ? quote.slice(0, QUOTE_LIMIT) : quote
}

/** 从原文区间取 quote 与前后文，供重锚时消歧。 */
export function buildContext(
  text: string,
  start: number,
  end: number,
  contextLength = CONTEXT_LENGTH,
): Context {
  const safeStart = Math.max(0, Math.min(start, text.length))
  const safeEnd = Math.max(safeStart, Math.min(end, text.length))
  return {
    quote: clampQuote(text.slice(safeStart, safeEnd).trim()),
    prefix: text.slice(Math.max(0, safeStart - contextLength), safeStart),
    suffix: text.slice(safeEnd, safeEnd + contextLength),
  }
}

function charSet(input: string): Set<string> {
  return new Set(normalizeText(input))
}

/** 字符级 Jaccard：只关心两边共享了哪些字，顺序与长短差异不敏感。 */
export function jaccard(a: string, b: string): number {
  const left = charSet(a)
  const right = charSet(b)
  if (left.size === 0 && right.size === 0) return 0
  let shared = 0
  for (const char of left) {
    if (right.has(char)) shared += 1
  }
  return shared / (left.size + right.size - shared)
}

/**
 * 用前后文给候选位置打分。两边都有上下文时各占一半；只存了一边就只看那一边；
 * 没有任何上下文时，归一化后的 quote 完全一致即视为可信（1）。
 */
export function contextScore(
  text: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
): number {
  const actual = buildContext(text, start, end)
  const trimmedPrefix = prefix.trim()
  const trimmedSuffix = suffix.trim()
  if (!trimmedPrefix && !trimmedSuffix) return 1

  const scores: number[] = []
  if (trimmedPrefix) scores.push(jaccard(trimmedPrefix, actual.prefix))
  if (trimmedSuffix) scores.push(jaccard(trimmedSuffix, actual.suffix))
  return scores.reduce((sum, value) => sum + value, 0) / scores.length
}

/**
 * 在章节原文里找 quote 的所有候选，并按前后文相似度排序。
 * 返回的 start/end 可直接用于 Range；没有命中返回空数组。
 */
export function findQuoteCandidates(
  text: string,
  quote: string,
  prefix = '',
  suffix = '',
): QuoteCandidate[] {
  const normalizedQuote = normalizeText(quote)
  if (!normalizedQuote) return []

  const { text: haystack, indexMap } = normalizeWithMap(text)
  if (haystack.length < normalizedQuote.length) return []

  const candidates: QuoteCandidate[] = []
  let from = 0
  while (candidates.length < MAX_CANDIDATES) {
    const position = haystack.indexOf(normalizedQuote, from)
    if (position < 0) break
    const last = position + normalizedQuote.length - 1
    const start = indexMap[position]
    const end = indexMap[last] + 1
    candidates.push({
      start,
      end,
      score: contextScore(text, start, end, prefix, suffix),
    })
    from = position + 1
  }

  return candidates.sort((left, right) => right.score - left.score || left.start - right.start)
}

/**
 * 在已知区间里找 quote，返回原文下标。
 * 书内搜索先定位到命中片段所在的区间，再用它把范围缩到命中的那几个字。
 */
export function findQuoteWithin(
  text: string,
  start: number,
  end: number,
  quote: string,
): QuoteCandidate | null {
  const normalizedQuote = normalizeText(quote)
  if (!normalizedQuote) return null

  const safeStart = Math.max(0, Math.min(start, text.length))
  const safeEnd = Math.max(safeStart, Math.min(end, text.length))
  const slice = text.slice(safeStart, safeEnd)
  const { text: haystack, indexMap } = normalizeWithMap(slice)
  const position = haystack.indexOf(normalizedQuote)
  if (position < 0) return null

  const offsetStart = safeStart + indexMap[position]
  const offsetEnd = safeStart + indexMap[position + normalizedQuote.length - 1] + 1
  return { start: offsetStart, end: offsetEnd, score: 1 }
}

/** 取相似度最高的候选；没有候选或低于阈值时返回 null。 */
export function findBestQuote(
  text: string,
  quote: string,
  prefix = '',
  suffix = '',
): QuoteCandidate | null {
  const best = findQuoteCandidates(text, quote, prefix, suffix)[0]
  if (!best) return null
  return best.score >= ANCHOR_THRESHOLD ? best : null
}

const FORMATS: BookFormat[] = ['epub', 'markdown', 'txt', 'pdf']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 解析库里存的 locator。形状不对返回 null，由调用方按「位置失效」处理。 */
export function parseLocator(value: unknown): Locator | null {
  if (!isRecord(value)) return null
  const format = value['format']
  if (!FORMATS.includes(format as BookFormat)) return null

  const href = readString(value['href'])
  if (!href) return null

  const cfiValue = value['cfi']
  const cfi = typeof cfiValue === 'string' && cfiValue.length > 0 ? cfiValue : null

  return {
    format: format as BookFormat,
    cfi,
    href,
    chapterIndex: Math.max(0, Math.trunc(readNumber(value['chapterIndex'], 0))),
    chapterTitle: readString(value['chapterTitle']),
    page: Math.max(0, Math.trunc(readNumber(value['page'], 0))),
    percent: Math.min(1, Math.max(0, readNumber(value['percent'], 0))),
    quote: readString(value['quote']),
    prefix: readString(value['prefix']),
    suffix: readString(value['suffix']),
  }
}
