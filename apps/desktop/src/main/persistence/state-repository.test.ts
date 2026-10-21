import type { BrowserSnapshot, StateDiff } from '@ione/core'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { StateRepository } from './state-repository'

const databases: Database.Database[] = []

function createRepository(): { db: Database.Database; repository: StateRepository } {
  const db = openDatabase(':memory:')
  databases.push(db)
  return { db, repository: new StateRepository(db) }
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function baseSnapshot(): BrowserSnapshot {
  return {
    version: 3,
    spaces: {
      a: {
        id: 'a',
        name: 'Alpha',
        icon: 'alpha-icon',
        theme: 'dark',
        partitionId: 'persist:alpha',
        order: 'a0'
      },
      b: {
        id: 'b',
        name: 'Beta',
        icon: 'beta-icon',
        theme: 'light',
        order: 'b0'
      }
    },
    essentials: {
      e1: {
        id: 'e1',
        url: 'https://essential.example',
        title: 'Essential One',
        favicon: 'https://essential.example/favicon.ico',
        order: 'e0'
      }
    },
    folders: {
      root: {
        id: 'root',
        spaceId: 'a',
        name: 'Root',
        collapsed: false,
        kind: 'normal',
        order: 'f0'
      },
      child: {
        id: 'child',
        spaceId: 'a',
        parentId: 'root',
        name: 'Feed',
        collapsed: true,
        kind: 'rss',
        feedUrl: 'https://feed.example/rss',
        order: 'f1'
      },
      rootB: {
        id: 'rootB',
        spaceId: 'b',
        name: 'Root B',
        collapsed: false,
        kind: 'normal',
        order: 'f0'
      }
    },
    tabs: {
      t1: {
        id: 't1',
        spaceId: 'a',
        folderId: 'child',
        url: 'https://one.example',
        title: 'One',
        favicon: 'https://one.example/favicon.ico',
        pinned: true,
        pinnedUrl: 'https://one.example/pinned',
        lastActive: 100,
        scrollY: 12.5,
        sleeping: false,
        order: 't0'
      },
      t2: {
        id: 't2',
        spaceId: 'a',
        url: 'https://two.example',
        title: 'Two',
        favicon: 'https://two.example/favicon.ico',
        pinned: false,
        lastActive: 200,
        scrollY: 0,
        sleeping: true,
        order: 't1'
      },
      tb: {
        id: 'tb',
        spaceId: 'b',
        url: 'https://three.example',
        title: 'Three',
        favicon: 'https://three.example/favicon.ico',
        pinned: false,
        lastActive: 50,
        scrollY: 3,
        sleeping: false,
        order: 't0'
      }
    },
    activeSpaceId: 'a',
    activeTabId: 't2'
  }
}

describe('StateRepository', () => {
  it('loads null when no spaces have ever been stored', () => {
    const { repository } = createRepository()

    expect(repository.loadSnapshot()).toBeNull()
  })

  it('round-trips every model field, booleans, optional values and session ids', () => {
    const { repository } = createRepository()
    const snapshot = baseSnapshot()

    repository.saveSnapshot(snapshot)
    const loaded = repository.loadSnapshot()

    expect(loaded).not.toBeNull()
    if (!loaded) throw new Error('expected a snapshot')
    expect(loaded).toEqual({ ...snapshot, version: 0 })

    expect(loaded.spaces.a?.partitionId).toBe('persist:alpha')
    expect(loaded.folders.child?.parentId).toBe('root')
    expect(loaded.folders.child?.feedUrl).toBe('https://feed.example/rss')
    expect(loaded.tabs.t1?.pinnedUrl).toBe('https://one.example/pinned')
    expect(loaded.tabs.t1?.pinned).toBe(true)
    expect(loaded.tabs.t1?.sleeping).toBe(false)
    expect(loaded.tabs.t2?.sleeping).toBe(true)
    expect(loaded.tabs.t1?.scrollY).toBe(12.5)
    expect(loaded.activeSpaceId).toBe('a')
    expect(loaded.activeTabId).toBe('t2')

    expect(loaded.spaces.b && 'partitionId' in loaded.spaces.b).toBe(false)
    expect(loaded.folders.root && 'parentId' in loaded.folders.root).toBe(false)
    expect(loaded.folders.root && 'feedUrl' in loaded.folders.root).toBe(false)
    expect(loaded.tabs.t2 && 'folderId' in loaded.tabs.t2).toBe(false)
    expect(loaded.tabs.t2 && 'pinnedUrl' in loaded.tabs.t2).toBe(false)
  })

  it('round-trips feed state, validators and items', () => {
    const { repository } = createRepository()
    const snapshot = baseSnapshot()
    snapshot.feedStates = {
      child: {
        folderId: 'child',
        fetchUrl: 'https://feed.example/rss',
        etag: '"v1"',
        lastModified: 'Tue, 20 Oct 2026 10:00:00 GMT',
        lastCheckedAt: 10,
        lastSuccessAt: 11,
        nextPollAt: 12,
        consecutiveFailures: 2,
        lastError: 'timeout'
      }
    }
    snapshot.feedItems = {
      i1: {
        id: 'i1',
        folderId: 'child',
        guid: 'guid-1',
        url: 'https://feed.example/post',
        title: 'Post',
        author: 'Ada',
        summary: 'Summary',
        publishedAt: 1_700_000_000_000,
        fetchedAt: 1_700_000_000_100,
        read: true,
        starred: false
      }
    }

    repository.saveSnapshot(snapshot)
    const loaded = repository.loadSnapshot()
    expect(loaded?.feedStates?.child).toMatchObject({
      folderId: 'child',
      etag: '"v1"',
      lastModified: 'Tue, 20 Oct 2026 10:00:00 GMT',
      consecutiveFailures: 2,
      lastError: 'timeout'
    })
    expect(loaded?.feedItems?.i1).toMatchObject({
      guid: 'guid-1',
      folderId: 'child',
      read: true,
      starred: false
    })
  })

  it('applies feed item replacement and state removal diffs', () => {
    const { repository } = createRepository()
    const base = baseSnapshot()
    repository.saveSnapshot(base)
    const state = {
      folderId: 'child',
      fetchUrl: 'https://feed.example/rss',
      lastCheckedAt: 20,
      lastSuccessAt: 20,
      nextPollAt: 30,
      consecutiveFailures: 0
    }
    const item = {
      id: 'i1',
      folderId: 'child',
      url: 'https://feed.example/post',
      title: 'Post',
      author: '',
      summary: '',
      publishedAt: null,
      fetchedAt: 20,
      read: false,
      starred: false
    }
    const withFeed: BrowserSnapshot = {
      ...base,
      feedStates: { child: state },
      feedItems: { i1: item }
    }

    repository.applyDiffs(
      [
        { type: 'feed.state', state },
        { type: 'feed.items.replace', folderId: 'child', items: [item] }
      ],
      withFeed
    )
    expect(repository.loadSnapshot()?.feedItems?.i1?.title).toBe('Post')

    repository.applyDiffs(
      [
        { type: 'feed.items.replace', folderId: 'child', items: [] },
        { type: 'feed.state.remove', folderId: 'child' }
      ],
      { ...withFeed, feedItems: {}, feedStates: {} }
    )
    const loaded = repository.loadSnapshot()
    expect(loaded?.feedItems?.i1).toBeUndefined()
    expect(loaded?.feedStates?.child).toBeUndefined()
  })

  it('replaces state and preserves an explicitly null active tab', () => {
    const { repository } = createRepository()
    repository.saveSnapshot(baseSnapshot())

    const replacement: BrowserSnapshot = {
      version: 4,
      spaces: {
        a: { id: 'a', name: 'Alpha Two', icon: 'star', theme: 'light', order: 'a0' }
      },
      essentials: {},
      folders: {},
      tabs: {},
      activeSpaceId: 'a',
      activeTabId: null
    }

    repository.saveSnapshot(replacement)
    const loaded = repository.loadSnapshot()

    expect(loaded).not.toBeNull()
    if (!loaded) throw new Error('expected a snapshot')
    expect(loaded).toEqual({ ...replacement, version: 0 })
    expect(loaded.spaces.a && 'partitionId' in loaded.spaces.a).toBe(false)
  })

  it('falls back to the first space and most recent tab when session keys are missing', () => {
    const { db, repository } = createRepository()
    repository.saveSnapshot(baseSnapshot())
    db.prepare('DELETE FROM app_state').run()

    const loaded = repository.loadSnapshot()

    expect(loaded).not.toBeNull()
    if (!loaded) throw new Error('expected a snapshot')
    expect(loaded.activeSpaceId).toBe('a')
    expect(loaded.activeTabId).toBe('t2')
  })

  it('applies every diff kind in FK-safe order and persists the final session', () => {
    const { repository } = createRepository()
    const base = baseSnapshot()
    repository.saveSnapshot(base)

    const updatedA = {
      id: 'a',
      name: 'Alpha Updated',
      icon: 'star',
      theme: 'light',
      order: 'a5'
    }
    const spaceC = {
      id: 'c',
      name: 'Gamma',
      icon: 'gamma-icon',
      theme: 'dark',
      partitionId: 'persist:gamma',
      order: 'c0'
    }
    const essentialTwo = {
      id: 'e2',
      url: 'https://essential-two.example',
      title: 'Essential Two',
      favicon: 'https://essential-two.example/favicon.ico',
      order: 'e1'
    }
    const updatedRoot = {
      id: 'root',
      spaceId: 'a',
      name: 'Root Updated',
      collapsed: true,
      kind: 'normal' as const,
      order: 'f9'
    }
    const parentC = {
      id: 'parent-c',
      spaceId: 'c',
      name: 'Parent C',
      collapsed: false,
      kind: 'normal' as const,
      order: 'f0'
    }
    const childC = {
      id: 'child-c',
      spaceId: 'c',
      parentId: 'parent-c',
      name: 'Feed C',
      collapsed: false,
      kind: 'rss' as const,
      feedUrl: 'https://feed-c.example/rss',
      order: 'f1'
    }
    const updatedT1 = {
      id: 't1',
      spaceId: 'a',
      url: 'https://one-new.example',
      title: 'One New',
      favicon: 'https://one-new.example/favicon.ico',
      pinned: false,
      lastActive: 300,
      scrollY: 5.25,
      sleeping: true,
      order: 't9'
    }
    const tabC = {
      id: 'tc',
      spaceId: 'c',
      folderId: 'child-c',
      url: 'https://c.example',
      title: 'C',
      favicon: 'https://c.example/favicon.ico',
      pinned: true,
      pinnedUrl: 'https://c.example/pinned',
      lastActive: 400,
      scrollY: 1.5,
      sleeping: false,
      order: 't0'
    }

    const diffs: StateDiff[] = [
      { type: 'space.upsert', space: updatedA },
      { type: 'space.upsert', space: spaceC },
      { type: 'essential.upsert', essential: essentialTwo },
      { type: 'essential.remove', id: 'e1' },
      // Deliberately child-first: the repository must reorder folders.
      { type: 'folder.upsert', folder: childC },
      { type: 'folder.upsert', folder: parentC },
      { type: 'folder.upsert', folder: updatedRoot },
      { type: 'tab.upsert', tab: tabC },
      { type: 'tab.upsert', tab: updatedT1 },
      { type: 'tab.remove', id: 't2' },
      { type: 'folder.remove', id: 'child' },
      { type: 'space.remove', id: 'b' },
      { type: 'session.activeSpace', spaceId: 'c' },
      { type: 'session.activeTab', tabId: 'tc' }
    ]

    const finalSnapshot: BrowserSnapshot = {
      version: 8,
      spaces: { a: updatedA, c: spaceC },
      essentials: { e2: essentialTwo },
      folders: { root: updatedRoot, 'parent-c': parentC, 'child-c': childC },
      tabs: { t1: updatedT1, tc: tabC },
      activeSpaceId: 'c',
      activeTabId: 'tc'
    }

    repository.applyDiffs(diffs, finalSnapshot)

    const loaded = repository.loadSnapshot()
    expect(loaded).not.toBeNull()
    if (!loaded) throw new Error('expected a snapshot')
    expect(loaded).toEqual({ ...finalSnapshot, version: 0 })
    expect(loaded.tabs.t1 && 'folderId' in loaded.tabs.t1).toBe(false)
    expect(loaded.tabs.t1 && 'pinnedUrl' in loaded.tabs.t1).toBe(false)
    expect(loaded.spaces.a && 'partitionId' in loaded.spaces.a).toBe(false)
    expect(loaded.spaces.c?.partitionId).toBe('persist:gamma')
    expect(loaded.activeSpaceId).toBe('c')
    expect(loaded.activeTabId).toBe('tc')
  })
})
