import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

/**
 * Ordered, immutable migrations. The database's `user_version` is the number
 * of migrations already applied, so index `user_version` is the next one.
 */
const MIGRATIONS: ReadonlyArray<(db: Database.Database) => void> = [
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        theme TEXT NOT NULL,
        partition_id TEXT,
        sort_key TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS essentials (
        id TEXT PRIMARY KEY NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        favicon TEXT NOT NULL,
        sort_key TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY NOT NULL,
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        collapsed INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL CHECK (kind IN ('normal', 'rss')),
        feed_url TEXT,
        sort_key TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tabs (
        id TEXT PRIMARY KEY NOT NULL,
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        favicon TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        pinned_url TEXT,
        last_active INTEGER NOT NULL,
        scroll_y REAL NOT NULL,
        sleeping INTEGER NOT NULL DEFAULT 0,
        sort_key TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tabs_space_sort ON tabs(space_id, sort_key);
      CREATE INDEX IF NOT EXISTS idx_folders_space_parent_sort
        ON folders(space_id, parent_id, sort_key);
      CREATE INDEX IF NOT EXISTS idx_tabs_folder ON tabs(folder_id);
    `)
  },
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feed_state (
        folder_id TEXT PRIMARY KEY NOT NULL
          REFERENCES folders(id) ON DELETE CASCADE,
        fetch_url TEXT NOT NULL,
        etag TEXT,
        last_modified TEXT,
        last_checked_at INTEGER NOT NULL,
        last_success_at INTEGER NOT NULL,
        next_poll_at INTEGER NOT NULL,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        title TEXT,
        site_url TEXT
      );

      CREATE TABLE IF NOT EXISTS feed_items (
        id TEXT PRIMARY KEY NOT NULL,
        folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        guid TEXT,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        summary TEXT NOT NULL,
        published_at INTEGER,
        fetched_at INTEGER NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        starred INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_feed_items_folder_date
        ON feed_items(folder_id, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feed_state_next_poll
        ON feed_state(next_poll_at);
    `)
  }
]

/** Applies every migration newer than `PRAGMA user_version`, each atomically. */
export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let index = current; index < MIGRATIONS.length; index += 1) {
    const migration = MIGRATIONS[index]
    if (!migration) continue
    db.transaction(() => {
      migration(db)
      db.pragma(`user_version = ${index + 1}`)
    })()
  }
}

/** Opens (creating parent directories when needed) and migrates a database. */
export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}
