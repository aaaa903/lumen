import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ShelfBook } from '../../shared/types'
import { api } from '../lib/api'
import { coverHue, coverInitial } from '../lib/format'

/**
 * 封面优先用导入时抽出的图片；没有封面时用书名首字 + 按 id 固定的色相，
 * 保证同一本书在书架里始终是同一种颜色。
 */
export default function BookCover({ book }: { book: ShelfBook }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!book.coverPath) {
      setUrl(null)
      return
    }

    let disposed = false
    let objectUrl: string | null = null

    void api.readCover(book.id).then((result) => {
      if (disposed || !result.ok || !result.data) return
      objectUrl = URL.createObjectURL(new Blob([result.data.data], { type: result.data.mime }))
      setUrl(objectUrl)
    })

    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [book.id, book.coverPath])

  if (url) {
    return <img className="cover-image" src={url} alt={`《${book.title}》封面`} />
  }

  const style = { '--cover-hue': `${coverHue(book.id)}` } as CSSProperties

  return (
    <div className="cover-fallback" style={style}>
      <span className="cover-initial" aria-hidden="true">
        {coverInitial(book.title)}
      </span>
      <span className="cover-title">{book.title}</span>
    </div>
  )
}
