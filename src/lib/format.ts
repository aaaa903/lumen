/** 展示层格式化：体积、百分比、相对时间、首字封面的色相。 */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function percentLabel(percent: number): string {
  const value = Number.isFinite(percent) ? Math.min(1, Math.max(0, percent)) : 0
  if (value <= 0) return '未读'
  const rounded = Math.round(value * 100)
  return rounded >= 100 ? '已读完' : `${rounded}%`
}

export function relativeTime(timestamp: number | null): string {
  if (!timestamp) return '未打开'
  const diff = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`

  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

/** 同一本书每次打开都得到同一色相，避免封面在书架里跳色。 */
export function coverHue(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360
  }
  return hash
}

export function coverInitial(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '书'
  const first = Array.from(trimmed)[0] ?? '书'
  return first.toUpperCase()
}
