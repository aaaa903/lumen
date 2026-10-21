import { describe, expect, it } from 'vitest'
import { migrations } from './index'

describe('迁移清单', () => {
  it('版本号从 1 开始且连续递增', () => {
    const versions = migrations.map((migration) => migration.version)
    expect(versions).toEqual(versions.map((_, index) => index + 1))
  })

  it('每个脚本都有内容，且不改写已有版本', () => {
    for (const migration of migrations) {
      expect(migration.name).toMatch(/^\d{3}_[a-z0-9_]+$/)
      expect(migration.sql.trim().length).toBeGreaterThan(100)
      expect(migration.sql).not.toMatch(/DROP\s+TABLE/i)
    }
  })

  it('首版脚本包含全部核心表', () => {
    const first = migrations[0]
    for (const table of ['books', 'progress', 'annotations', 'tags', 'notes', 'search_chunks']) {
      expect(first.sql).toContain(`CREATE TABLE ${table}`)
    }
    expect(first.sql).toContain('CREATE VIRTUAL TABLE search_fts')
  })
})
