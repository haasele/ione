/**
 * Framework-free domain model. No Electron or Svelte imports are allowed here.
 */

export interface Space {
  id: string
  name: string
  /** Icon name or emoji. Interpretation belongs to the UI. */
  icon: string
  /** Theme identifier, resolved by the UI. */
  theme: string
  /** Optional Electron session partition for isolated logins. */
  partitionId?: string
  /** Fractional index within the space list. */
  order: string
}

/** Global, cross-space pinned tile. */
export interface Essential {
  id: string
  url: string
  title: string
  favicon: string
  /** Fractional index within the essentials list. */
  order: string
}

export type FolderKind = 'normal' | 'rss'

export interface Folder {
  id: string
  spaceId: string
  parentId?: string
  name: string
  collapsed: boolean
  kind: FolderKind
  /** RSS feed URL; only present for kind === 'rss'. */
  feedUrl?: string
  /** Fractional index among siblings in the same space/parent. */
  order: string
}

export interface Tab {
  id: string
  spaceId: string
  folderId?: string
  url: string
  title: string
  favicon: string
  pinned: boolean
  /** URL restored by "reset to pinned URL". Set when a tab is pinned. */
  pinnedUrl?: string
  /** Epoch milliseconds of the last activation. */
  lastActive: number
  scrollY: number
  /** True when the tab has no live WebContents. Phase 4 lifecycle feature. */
  sleeping: boolean
  /** Fractional index among siblings in the same space/folder. */
  order: string
}

export interface FeedItem {
  id: string
  folderId: string
  guid?: string
  url: string
  title: string
  author: string
  summary: string
  publishedAt: number | null
  fetchedAt: number
  read: boolean
  starred: boolean
}

export interface FeedState {
  folderId: string
  fetchUrl: string
  etag?: string
  lastModified?: string
  lastCheckedAt: number
  lastSuccessAt: number
  nextPollAt: number
  consecutiveFailures: number
  lastError?: string
  title?: string
  siteUrl?: string
}

export interface BrowserSnapshot {
  /** Monotonic state version. Incremented once per reducer call. */
  version: number
  spaces: Record<string, Space>
  essentials: Record<string, Essential>
  folders: Record<string, Folder>
  tabs: Record<string, Tab>
  feedItems?: Record<string, FeedItem>
  feedStates?: Record<string, FeedState>
  activeSpaceId: string
  activeTabId: string | null
}

export interface Ordered {
  order: string
}

/** Lexicographic fractional-index comparison. */
export function compareOrder(a: Ordered, b: Ordered): number {
  return a.order < b.order ? -1 : a.order > b.order ? 1 : 0
}

export function sortByOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort(compareOrder)
}

/** Returns the active tab only when it belongs to the active space. */
export function activeTabOf(snapshot: BrowserSnapshot): Tab | null {
  if (snapshot.activeTabId === null) return null
  if (!Object.hasOwn(snapshot.tabs, snapshot.activeTabId)) return null
  const tab = snapshot.tabs[snapshot.activeTabId]
  if (!tab || tab.spaceId !== snapshot.activeSpaceId) return null
  return tab
}

export function tabsInSpace(snapshot: BrowserSnapshot, spaceId: string): Tab[] {
  return sortByOrder(Object.values(snapshot.tabs).filter((tab) => tab.spaceId === spaceId))
}

export function mostRecentTabInSpace(snapshot: BrowserSnapshot, spaceId: string): Tab | null {
  let best: Tab | null = null
  for (const tab of Object.values(snapshot.tabs)) {
    if (tab.spaceId !== spaceId) continue
    if (!best || tab.lastActive > best.lastActive) best = tab
    else if (tab.lastActive === best.lastActive && compareOrder(tab, best) < 0) best = tab
  }
  return best
}
