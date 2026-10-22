import initSql from './001_init.sql?raw'
import pdfSql from './002_pdf.sql?raw'
import searchChunksSql from './003_search_chunks.sql?raw'

/**
 * 迁移清单。追加新脚本时只增不改，版本号连续递增。
 * 每个脚本在独立事务中执行，并同步推进 PRAGMA user_version。
 */
export type Migration = {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  { version: 1, name: '001_init', sql: initSql },
  { version: 2, name: '002_pdf', sql: pdfSql },
  { version: 3, name: '003_search_chunks', sql: searchChunksSql },
]
