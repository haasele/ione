import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from './database'

const open: Database.Database[] = []
const tempDirs: string[] = []

function memoryDatabase(): Database.Database {
  const db = openDatabase(':memory:')
  open.push(db)
  return db
}

afterEach(() => {
  for (const db of open.splice(0)) db.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('migrate', () => {
  it('creates the schema and records the schema version', () => {
    const db = memoryDatabase()

    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)

    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name)

    expect(tables).toEqual(['app_state', 'essentials', 'folders', 'spaces', 'tabs'])

    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name)

    expect(indexes).toEqual(['idx_folders_space_parent_sort', 'idx_tabs_folder', 'idx_tabs_space_sort'])
  })

  it('is idempotent and preserves existing rows', () => {
    const db = memoryDatabase()
    db.prepare("INSERT INTO spaces (id, name, icon, theme, sort_key) VALUES ('s1', 'One', 'i', 't', 'a0')").run()

    migrate(db)
    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS count FROM spaces').get()).toEqual({ count: 1 })
  })

  it('enables foreign key enforcement', () => {
    const db = memoryDatabase()

    expect(() =>
      db
        .prepare(
          `INSERT INTO tabs
             (id, space_id, url, title, favicon, last_active, scroll_y, sort_key)
           VALUES ('t1', 'missing', 'https://example.com', 'T', 'i', 0, 0, 'a0')`
        )
        .run()
    ).toThrow(/FOREIGN KEY constraint failed/)
  })
})

describe('openDatabase', () => {
  it('creates parent directories and opens a WAL database on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ione-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'nested', 'ione.sqlite')

    const db = openDatabase(path)
    open.push(db)

    expect(existsSync(path)).toBe(true)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(db.pragma('synchronous', { simple: true })).toBe(1)
  })
})
