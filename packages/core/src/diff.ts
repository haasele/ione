import type {
  BrowserSnapshot,
  Essential,
  FeedItem,
  FeedState,
  Folder,
  Space,
  Tab
} from './model'

/**
 * Entity diffs are complete entity values, not JSON patches. This keeps the
 * renderer reducer trivial and avoids path-based patch bugs.
 */
export type StateDiff =
  | { type: 'space.upsert'; space: Space }
  | { type: 'space.remove'; id: string }
  | { type: 'essential.upsert'; essential: Essential }
  | { type: 'essential.remove'; id: string }
  | { type: 'folder.upsert'; folder: Folder }
  | { type: 'folder.remove'; id: string }
  | { type: 'tab.upsert'; tab: Tab }
  | { type: 'tab.remove'; id: string }
  | { type: 'session.activeSpace'; spaceId: string }
  | { type: 'session.activeTab'; tabId: string | null }
  | { type: 'feed.state'; state: FeedState }
  | { type: 'feed.state.remove'; folderId: string }
  | { type: 'feed.items.replace'; folderId: string; items: FeedItem[] }
  | { type: 'feed.item.upsert'; item: FeedItem }
  | { type: 'feed.item.remove'; id: string }

export interface DiffBatch {
  /** Snapshot version this batch applies to. */
  baseVersion: number
  /** Snapshot version after applying the batch. */
  version: number
  diffs: StateDiff[]
}

/** Applies one diff in place. Used by the renderer's fine-grained store. */
export function applyDiff(snapshot: BrowserSnapshot, diff: StateDiff): void {
  switch (diff.type) {
    case 'space.upsert':
      snapshot.spaces[diff.space.id] = diff.space
      break
    case 'space.remove':
      delete snapshot.spaces[diff.id]
      break
    case 'essential.upsert':
      snapshot.essentials[diff.essential.id] = diff.essential
      break
    case 'essential.remove':
      delete snapshot.essentials[diff.id]
      break
    case 'folder.upsert':
      snapshot.folders[diff.folder.id] = diff.folder
      break
    case 'folder.remove':
      delete snapshot.folders[diff.id]
      break
    case 'tab.upsert':
      snapshot.tabs[diff.tab.id] = diff.tab
      break
    case 'tab.remove':
      delete snapshot.tabs[diff.id]
      break
    case 'session.activeSpace':
      snapshot.activeSpaceId = diff.spaceId
      break
    case 'session.activeTab':
      snapshot.activeTabId = diff.tabId
      break
    case 'feed.state':
      snapshot.feedStates ??= {}
      snapshot.feedStates[diff.state.folderId] = diff.state
      break
    case 'feed.state.remove':
      if (snapshot.feedStates) delete snapshot.feedStates[diff.folderId]
      break
    case 'feed.items.replace': {
      const items: Record<string, FeedItem> = {}
      for (const item of diff.items) items[item.id] = item
      const next: Record<string, FeedItem> = {}
      for (const [id, item] of Object.entries(snapshot.feedItems ?? {})) {
        if (item.folderId !== diff.folderId) next[id] = item
      }
      snapshot.feedItems = { ...next, ...items }
      break
    }
    case 'feed.item.upsert':
      snapshot.feedItems ??= {}
      snapshot.feedItems[diff.item.id] = diff.item
      break
    case 'feed.item.remove':
      if (snapshot.feedItems) delete snapshot.feedItems[diff.id]
      break
  }
}

/**
 * Applies a batch in place when the versions line up.
 * Returns false on a version gap, which means the caller must resync.
 */
export function applyDiffBatch(snapshot: BrowserSnapshot, batch: DiffBatch): boolean {
  if (batch.baseVersion !== snapshot.version) return false
  for (const diff of batch.diffs) applyDiff(snapshot, diff)
  snapshot.version = batch.version
  return true
}

export function cloneSnapshot(snapshot: BrowserSnapshot): BrowserSnapshot {
  return {
    version: snapshot.version,
    spaces: { ...snapshot.spaces },
    essentials: { ...snapshot.essentials },
    folders: { ...snapshot.folders },
    tabs: { ...snapshot.tabs },
    feedItems: snapshot.feedItems ? { ...snapshot.feedItems } : undefined,
    feedStates: snapshot.feedStates ? { ...snapshot.feedStates } : undefined,
    activeSpaceId: snapshot.activeSpaceId,
    activeTabId: snapshot.activeTabId
  }
}
