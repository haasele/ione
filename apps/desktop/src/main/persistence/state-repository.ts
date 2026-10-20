import {
  mostRecentTabInSpace,
  type BrowserSnapshot,
  type Essential,
  type Folder,
  type FolderKind,
  type Space,
  type StateDiff,
  type Tab
} from '@ione/core'
import type Database from 'better-sqlite3'

interface SpaceRow {
  id: string
  name: string
  icon: string
  theme: string
  partition_id: string | null
  sort_key: string
}

interface EssentialRow {
  id: string
  url: string
  title: string
  favicon: string
  sort_key: string
}

interface FolderRow {
  id: string
  space_id: string
  parent_id: string | null
  name: string
  collapsed: number
  kind: string
  feed_url: string | null
  sort_key: string
}

interface TabRow {
  id: string
  space_id: string
  folder_id: string | null
  url: string
  title: string
  favicon: string
  pinned: number
  pinned_url: string | null
  last_active: number
  scroll_y: number
  sleeping: number
  sort_key: string
}

interface AppStateRow {
  key: string
  value: string
}

const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/**
 * Orders folders so that every parent is inserted before its children.
 * Foreign keys are immediate, so this is required for nested inserts.
 */
function parentsFirst(folders: readonly Folder[]): Folder[] {
  const remaining = new Map(folders.map((folder) => [folder.id, folder]))
  const ordered: Folder[] = []

  while (remaining.size > 0) {
    let progressed = false
    for (const [id, folder] of remaining) {
      const parentId = folder.parentId
      if (parentId === undefined || !remaining.has(parentId)) {
        ordered.push(folder)
        remaining.delete(id)
        progressed = true
      }
    }
    if (!progressed) {
      // A malformed cycle cannot be inserted in any order; let SQLite report it.
      ordered.push(...remaining.values())
      break
    }
  }

  return ordered
}

/** SQLite-backed snapshot store with full-replace and incremental-diff writes. */
export class StateRepository {
  private readonly db: Database.Database

  private readonly loadSpaces: Database.Statement
  private readonly loadEssentials: Database.Statement
  private readonly loadFolders: Database.Statement
  private readonly loadTabs: Database.Statement
  private readonly loadAppState: Database.Statement

  private readonly deleteTabs: Database.Statement
  private readonly deleteFolders: Database.Statement
  private readonly deleteSpaces: Database.Statement
  private readonly deleteEssentials: Database.Statement
  private readonly deleteAppState: Database.Statement

  private readonly insertSpace: Database.Statement
  private readonly insertEssential: Database.Statement
  private readonly insertFolder: Database.Statement
  private readonly insertTab: Database.Statement

  private readonly upsertSpace: Database.Statement
  private readonly upsertEssential: Database.Statement
  private readonly upsertFolder: Database.Statement
  private readonly upsertTab: Database.Statement
  private readonly upsertAppState: Database.Statement

  private readonly removeTab: Database.Statement
  private readonly removeFolder: Database.Statement
  private readonly removeSpace: Database.Statement
  private readonly removeEssential: Database.Statement

  constructor(db: Database.Database) {
    this.db = db

    this.loadSpaces = db.prepare('SELECT * FROM spaces ORDER BY sort_key')
    this.loadEssentials = db.prepare('SELECT * FROM essentials ORDER BY sort_key')
    this.loadFolders = db.prepare('SELECT * FROM folders ORDER BY space_id, sort_key')
    this.loadTabs = db.prepare('SELECT * FROM tabs ORDER BY space_id, sort_key')
    this.loadAppState = db.prepare('SELECT key, value FROM app_state')

    this.deleteTabs = db.prepare('DELETE FROM tabs')
    this.deleteFolders = db.prepare('DELETE FROM folders')
    this.deleteSpaces = db.prepare('DELETE FROM spaces')
    this.deleteEssentials = db.prepare('DELETE FROM essentials')
    this.deleteAppState = db.prepare('DELETE FROM app_state')

    this.insertSpace = db.prepare(
      `INSERT INTO spaces (id, name, icon, theme, partition_id, sort_key)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    this.insertEssential = db.prepare(
      `INSERT INTO essentials (id, url, title, favicon, sort_key)
       VALUES (?, ?, ?, ?, ?)`
    )
    this.insertFolder = db.prepare(
      `INSERT INTO folders
         (id, space_id, parent_id, name, collapsed, kind, feed_url, sort_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    this.insertTab = db.prepare(
      `INSERT INTO tabs
         (id, space_id, folder_id, url, title, favicon, pinned, pinned_url,
          last_active, scroll_y, sleeping, sort_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    this.upsertSpace = db.prepare(
      `INSERT INTO spaces (id, name, icon, theme, partition_id, sort_key)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         icon = excluded.icon,
         theme = excluded.theme,
         partition_id = excluded.partition_id,
         sort_key = excluded.sort_key`
    )
    this.upsertEssential = db.prepare(
      `INSERT INTO essentials (id, url, title, favicon, sort_key)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         url = excluded.url,
         title = excluded.title,
         favicon = excluded.favicon,
         sort_key = excluded.sort_key`
    )
    this.upsertFolder = db.prepare(
      `INSERT INTO folders
         (id, space_id, parent_id, name, collapsed, kind, feed_url, sort_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         space_id = excluded.space_id,
         parent_id = excluded.parent_id,
         name = excluded.name,
         collapsed = excluded.collapsed,
         kind = excluded.kind,
         feed_url = excluded.feed_url,
         sort_key = excluded.sort_key`
    )
    this.upsertTab = db.prepare(
      `INSERT INTO tabs
         (id, space_id, folder_id, url, title, favicon, pinned, pinned_url,
          last_active, scroll_y, sleeping, sort_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         space_id = excluded.space_id,
         folder_id = excluded.folder_id,
         url = excluded.url,
         title = excluded.title,
         favicon = excluded.favicon,
         pinned = excluded.pinned,
         pinned_url = excluded.pinned_url,
         last_active = excluded.last_active,
         scroll_y = excluded.scroll_y,
         sleeping = excluded.sleeping,
         sort_key = excluded.sort_key`
    )
    this.upsertAppState = db.prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )

    this.removeTab = db.prepare('DELETE FROM tabs WHERE id = ?')
    this.removeFolder = db.prepare('DELETE FROM folders WHERE id = ?')
    this.removeSpace = db.prepare('DELETE FROM spaces WHERE id = ?')
    this.removeEssential = db.prepare('DELETE FROM essentials WHERE id = ?')
  }

  /** Returns `null` when the database has never held a space. */
  loadSnapshot(): BrowserSnapshot | null {
    const spaceRows = this.loadSpaces.all() as unknown as SpaceRow[]
    if (spaceRows.length === 0) return null

    const spaces: Record<string, Space> = {}
    for (const row of spaceRows) {
      if (RESERVED_OBJECT_KEYS.has(row.id)) continue
      const space: Space = {
        id: row.id,
        name: row.name,
        icon: row.icon,
        theme: row.theme,
        order: row.sort_key
      }
      if (row.partition_id !== null) space.partitionId = row.partition_id
      spaces[space.id] = space
    }
    if (Object.keys(spaces).length === 0) return null

    const essentials: Record<string, Essential> = {}
    for (const row of this.loadEssentials.all() as unknown as EssentialRow[]) {
      if (RESERVED_OBJECT_KEYS.has(row.id)) continue
      essentials[row.id] = {
        id: row.id,
        url: row.url,
        title: row.title,
        favicon: row.favicon,
        order: row.sort_key
      }
    }

    const folders: Record<string, Folder> = {}
    for (const row of this.loadFolders.all() as unknown as FolderRow[]) {
      if (RESERVED_OBJECT_KEYS.has(row.id)) continue
      const kind: FolderKind = row.kind === 'rss' ? 'rss' : 'normal'
      const folder: Folder = {
        id: row.id,
        spaceId: row.space_id,
        name: row.name,
        collapsed: row.collapsed !== 0,
        kind,
        order: row.sort_key
      }
      if (row.parent_id !== null) folder.parentId = row.parent_id
      if (row.feed_url !== null) folder.feedUrl = row.feed_url
      folders[folder.id] = folder
    }

    const tabs: Record<string, Tab> = {}
    for (const row of this.loadTabs.all() as unknown as TabRow[]) {
      if (RESERVED_OBJECT_KEYS.has(row.id)) continue
      const tab: Tab = {
        id: row.id,
        spaceId: row.space_id,
        url: row.url,
        title: row.title,
        favicon: row.favicon,
        pinned: row.pinned !== 0,
        lastActive: row.last_active,
        scrollY: row.scroll_y,
        sleeping: row.sleeping !== 0,
        order: row.sort_key
      }
      if (row.folder_id !== null) tab.folderId = row.folder_id
      if (row.pinned_url !== null) tab.pinnedUrl = row.pinned_url
      tabs[tab.id] = tab
    }

    const appState = new Map<string, string>()
    for (const row of this.loadAppState.all() as unknown as AppStateRow[]) {
      appState.set(row.key, row.value)
    }

    const snapshot: BrowserSnapshot = {
      version: 0,
      spaces,
      essentials,
      folders,
      tabs,
      activeSpaceId: '',
      activeTabId: null
    }

    const storedSpaceId = appState.get('activeSpaceId')
    const storedSpace = storedSpaceId === undefined ? undefined : own(spaces, storedSpaceId)
    const activeSpaceId = storedSpace ? storedSpace.id : (Object.keys(spaces)[0] ?? '')
    snapshot.activeSpaceId = activeSpaceId

    const recentTab = mostRecentTabInSpace(snapshot, activeSpaceId)
    const storedTabId = appState.get('activeTabId')
    if (storedTabId === undefined) {
      snapshot.activeTabId = recentTab?.id ?? null
    } else if (storedTabId === '') {
      snapshot.activeTabId = null
    } else {
      const storedTab = own(tabs, storedTabId)
      snapshot.activeTabId =
        storedTab !== undefined && storedTab.spaceId === activeSpaceId
          ? storedTabId
          : (recentTab?.id ?? null)
    }

    return snapshot
  }

  /** Replaces all persisted state with `snapshot` in one transaction. */
  saveSnapshot(snapshot: BrowserSnapshot): void {
    this.db.transaction(() => {
      this.deleteTabs.run()
      this.deleteFolders.run()
      this.deleteSpaces.run()
      this.deleteEssentials.run()
      this.deleteAppState.run()

      for (const space of Object.values(snapshot.spaces)) {
        this.insertSpace.run(
          space.id,
          space.name,
          space.icon,
          space.theme,
          space.partitionId ?? null,
          space.order
        )
      }

      for (const essential of Object.values(snapshot.essentials)) {
        this.insertEssential.run(
          essential.id,
          essential.url,
          essential.title,
          essential.favicon,
          essential.order
        )
      }

      for (const folder of parentsFirst(Object.values(snapshot.folders))) {
        this.insertFolder.run(
          folder.id,
          folder.spaceId,
          folder.parentId ?? null,
          folder.name,
          folder.collapsed ? 1 : 0,
          folder.kind,
          folder.feedUrl ?? null,
          folder.order
        )
      }

      for (const tab of Object.values(snapshot.tabs)) {
        this.insertTab.run(
          tab.id,
          tab.spaceId,
          tab.folderId ?? null,
          tab.url,
          tab.title,
          tab.favicon,
          tab.pinned ? 1 : 0,
          tab.pinnedUrl ?? null,
          tab.lastActive,
          tab.scrollY,
          tab.sleeping ? 1 : 0,
          tab.order
        )
      }

      this.writeSession(snapshot)
    })()
  }

  /**
   * Applies a batch of diffs atomically. Upserts are grouped in FK-safe order,
   * deletes run child-first, and the final session selection is always stored.
   */
  applyDiffs(diffs: StateDiff[], snapshot: BrowserSnapshot): void {
    this.db.transaction(() => {
      const spaces = new Map<string, Space>()
      const essentials = new Map<string, Essential>()
      const folders = new Map<string, Folder>()
      const tabs = new Map<string, Tab>()

      const removedSpaces = new Set<string>()
      const removedEssentials = new Set<string>()
      const removedFolders = new Set<string>()
      const removedTabs = new Set<string>()

      for (const diff of diffs) {
        switch (diff.type) {
          case 'space.upsert':
            spaces.set(diff.space.id, diff.space)
            break
          case 'space.remove':
            removedSpaces.add(diff.id)
            break
          case 'essential.upsert':
            essentials.set(diff.essential.id, diff.essential)
            break
          case 'essential.remove':
            removedEssentials.add(diff.id)
            break
          case 'folder.upsert':
            folders.set(diff.folder.id, diff.folder)
            break
          case 'folder.remove':
            removedFolders.add(diff.id)
            break
          case 'tab.upsert':
            tabs.set(diff.tab.id, diff.tab)
            break
          case 'tab.remove':
            removedTabs.add(diff.id)
            break
          case 'session.activeSpace':
          case 'session.activeTab':
            // Session keys are always written from the final snapshot below.
            break
        }
      }

      for (const space of spaces.values()) {
        this.upsertSpace.run(
          space.id,
          space.name,
          space.icon,
          space.theme,
          space.partitionId ?? null,
          space.order
        )
      }

      for (const essential of essentials.values()) {
        this.upsertEssential.run(
          essential.id,
          essential.url,
          essential.title,
          essential.favicon,
          essential.order
        )
      }

      for (const folder of parentsFirst([...folders.values()])) {
        this.upsertFolder.run(
          folder.id,
          folder.spaceId,
          folder.parentId ?? null,
          folder.name,
          folder.collapsed ? 1 : 0,
          folder.kind,
          folder.feedUrl ?? null,
          folder.order
        )
      }

      for (const tab of tabs.values()) {
        this.upsertTab.run(
          tab.id,
          tab.spaceId,
          tab.folderId ?? null,
          tab.url,
          tab.title,
          tab.favicon,
          tab.pinned ? 1 : 0,
          tab.pinnedUrl ?? null,
          tab.lastActive,
          tab.scrollY,
          tab.sleeping ? 1 : 0,
          tab.order
        )
      }

      for (const id of removedTabs) this.removeTab.run(id)
      for (const id of removedFolders) this.removeFolder.run(id)
      for (const id of removedSpaces) this.removeSpace.run(id)
      for (const id of removedEssentials) this.removeEssential.run(id)

      this.writeSession(snapshot)
    })()
  }

  private writeSession(snapshot: BrowserSnapshot): void {
    this.upsertAppState.run('activeSpaceId', snapshot.activeSpaceId)
    // An empty string distinguishes an explicit null tab from a missing key,
    // so the next load can fall back only when no selection was ever stored.
    this.upsertAppState.run('activeTabId', snapshot.activeTabId ?? '')
  }
}
