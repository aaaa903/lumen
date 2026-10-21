import initSql from './001_init.sql?raw'

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
]
