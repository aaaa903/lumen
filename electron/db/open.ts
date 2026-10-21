import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { migrations } from './migrations'

/**
 * 数据库连接。使用 Electron 内置的 node:sqlite：
 * 与运行时同一个 SQLite，不需要原生模块编译，也不会在升级 Electron 后 ABI 失配。
 */
export type Db = DatabaseSync

let instance: Db | null = null

/** 打开（必要时创建）数据库并执行未应用的迁移。只在主进程调用一次。 */
export function openDatabase(): Db {
  if (instance) return instance

  const userData = app.getPath('userData')
  for (const dir of ['books', 'covers', 'logs']) {
    mkdirSync(join(userData, dir), { recursive: true })
  }

  const dbPath = join(userData, 'lumen.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA temp_store = MEMORY')

  migrate(db, dbPath)
  instance = db
  return db
}

export function getSchemaVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return row?.user_version ?? 0
}

/**
 * node:sqlite 没有 better-sqlite3 的 transaction 包装，这里补一个。
 * 统一用立即事务，避免两个写操作在 WAL 下互相升级锁。
 */
export function withTransaction<T>(db: Db, run: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = run()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 事务可能已经因错误自动回滚，忽略。
    }
    throw error
  }
}

function migrate(db: Db, dbPath: string): void {
  const current = getSchemaVersion(db)
  const pending = migrations
    .filter((migration) => migration.version > current)
    .sort((a, b) => a.version - b.version)

  if (pending.length === 0) return

  // 已有数据的库在升级前留一份完整副本；新库（version 0）没有可备份的内容。
  if (current > 0 && existsSync(dbPath)) backup(db, dbPath, current)

  for (const migration of pending) {
    withTransaction(db, () => {
      db.exec(migration.sql)
      // 版本号与结构改动在同一事务里前进，失败时不会留下「结构变了但版本没动」的库。
      db.exec(`PRAGMA user_version = ${migration.version}`)
    })
  }
}

function backup(db: Db, dbPath: string, version: number): void {
  const dir = join(dirname(dbPath), 'backups')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `lumen-v${version}-${Date.now()}.db`)
  // VACUUM INTO 在有 WAL 的情况下也能得到一致副本；直接复制文件会丢掉 WAL 里的数据。
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  pruneBackups(dir)
}

function pruneBackups(dir: string, keep = 3): void {
  const files = readdirSync(dir)
    .filter((name) => name.startsWith('lumen-v') && name.endsWith('.db'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)

  for (const file of files.slice(keep)) {
    try {
      unlinkSync(file)
    } catch {
      // 删不掉就留着，不影响启动。
    }
  }
}
