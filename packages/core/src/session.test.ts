import { describe, expect, it } from 'vitest'
import type { BrowserSnapshot, Folder, Space, Tab } from './model'
import { normalizeSnapshot, prepareLazyRestore } from './session'

function space(id: string, order: string): Space {
  return { id, name: id, icon: 'circle', theme: 'system', order }
}

function folder(overrides: Partial<Folder> & Pick<Folder, 'id' | 'spaceId' | 'order'>): Folder {
  return {
    name: overrides.id,
    collapsed: false,
    kind: 'normal',
    ...overrides
  }
}

function tab(overrides: Partial<Tab> & Pick<Tab, 'id' | 'spaceId' | 'order'>): Tab {
  return {
    url: `https://${overrides.id}.example/`,
    title: overrides.id,
    favicon: '',
    pinned: false,
    lastActive: 0,
    scrollY: 0,
    sleeping: false,
    ...overrides
  }
}

function repairedSnapshot(): BrowserSnapshot {
  return {
    version: 4,
    spaces: {
      s1: space('s1', 'a'),
      s2: space('s2', 'b')
    },
    essentials: {},
    folders: {
      s1Root: folder({ id: 's1Root', spaceId: 's1', order: 'a' }),
      child: folder({ id: 'child', spaceId: 's1', parentId: 's1Root', order: 'b' }),
      missingParent: folder({ id: 'missingParent', spaceId: 's1', parentId: 'ghost', order: 'c' }),
      foreignParent: folder({ id: 'foreignParent', spaceId: 's1', parentId: 's2Root', order: 'd' }),
      selfParent: folder({ id: 'selfParent', spaceId: 's1', parentId: 'selfParent', order: 'e' }),
      cycleA: folder({ id: 'cycleA', spaceId: 's1', parentId: 'cycleB', order: 'f' }),
      cycleB: folder({ id: 'cycleB', spaceId: 's1', parentId: 'cycleA', order: 'g' }),
      s2Root: folder({ id: 's2Root', spaceId: 's2', order: 'a' }),
      lostFolder: folder({ id: 'lostFolder', spaceId: 'gone', order: 'a' })
    },
    tabs: {
      t1: tab({ id: 't1', spaceId: 's1', order: 'a', lastActive: 5 }),
      t2: tab({ id: 't2', spaceId: 's1', folderId: 'child', order: 'b', lastActive: 10 }),
      foreignTab: tab({ id: 'foreignTab', spaceId: 's2', order: 'a', lastActive: 50 }),
      lostTab: tab({ id: 'lostTab', spaceId: 'gone', order: 'a' })
    },
    activeSpaceId: 'gone',
    activeTabId: 't1'
  }
}

function assertAcyclic(folders: Record<string, Folder>): void {
  for (const folder of Object.values(folders)) {
    const seen = new Set<string>([folder.id])
    let cursor: Folder | undefined = folder
    while (cursor?.parentId !== undefined) {
      expect(seen.has(cursor.parentId)).toBe(false)
      seen.add(cursor.parentId)
      cursor = folders[cursor.parentId]
      if (cursor === undefined) break
    }
  }
}

describe('normalizeSnapshot', () => {
  it('drops entities that belong to missing spaces', () => {
    const result = normalizeSnapshot(repairedSnapshot())
    expect(result.folders.lostFolder).toBeUndefined()
    expect(result.tabs.lostTab).toBeUndefined()
    expect(Object.keys(result.folders).sort()).toEqual([
      'child',
      'cycleA',
      'cycleB',
      'foreignParent',
      'missingParent',
      's1Root',
      's2Root',
      'selfParent'
    ])
  })

  it('reparents folders with missing, foreign or self parents to the root', () => {
    const result = normalizeSnapshot(repairedSnapshot())
    expect(result.folders.missingParent?.parentId).toBeUndefined()
    expect(result.folders.foreignParent?.parentId).toBeUndefined()
    expect(result.folders.selfParent?.parentId).toBeUndefined()
  })

  it('breaks parent cycles', () => {
    const result = normalizeSnapshot(repairedSnapshot())
    assertAcyclic(result.folders)
  })

  it('keeps valid folder parents intact', () => {
    const result = normalizeSnapshot(repairedSnapshot())
    expect(result.folders.child?.parentId).toBe('s1Root')
  })

  it('falls back to the first sorted space when the active space is missing', () => {
    const result = normalizeSnapshot(repairedSnapshot())
    expect(result.activeSpaceId).toBe('s1')
  })

  it('keeps the active tab when it lives in the repaired active space', () => {
    const result = normalizeSnapshot(repairedSnapshot())
    expect(result.activeTabId).toBe('t1')
  })

  it('selects the most recent tab in the active space when the active tab is invalid', () => {
    const state = repairedSnapshot()
    state.activeSpaceId = 's1'
    state.activeTabId = 'foreignTab'
    const result = normalizeSnapshot(state)
    expect(result.activeSpaceId).toBe('s1')
    expect(result.activeTabId).toBe('t2')
  })

  it('clears the active tab when the active space has no tabs', () => {
    const state = repairedSnapshot()
    state.spaces.s3 = space('s3', '0')
    state.activeSpaceId = 's3'
    state.activeTabId = 't1'
    const result = normalizeSnapshot(state)
    expect(result.activeSpaceId).toBe('s3')
    expect(result.activeTabId).toBeNull()
  })

  it('clears the selection when there are no spaces', () => {
    const result = normalizeSnapshot({
      ...repairedSnapshot(),
      spaces: {},
      folders: {},
      tabs: {},
      activeSpaceId: 'gone',
      activeTabId: 't1'
    })
    expect(result.activeSpaceId).toBe('')
    expect(result.activeTabId).toBeNull()
    expect(result.spaces).toEqual({})
  })

  it.each([
    [5, 5],
    [5.9, 5],
    [-4, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0]
  ])('coerces version %s to %s', (input, expected) => {
    const result = normalizeSnapshot({ ...repairedSnapshot(), version: input })
    expect(result.version).toBe(expected)
  })

  it('returns a new object without mutating the input', () => {
    const state = repairedSnapshot()
    const before = structuredClone(state)
    const result = normalizeSnapshot(state)
    expect(result).not.toBe(state)
    expect(result.spaces).not.toBe(state.spaces)
    expect(result.folders).not.toBe(state.folders)
    expect(result.tabs).not.toBe(state.tabs)
    expect(state).toEqual(before)
  })

  it('is stable when run twice', () => {
    const once = normalizeSnapshot(repairedSnapshot())
    const twice = normalizeSnapshot(once)
    expect(twice).toEqual(once)
    expect(twice).not.toBe(once)
  })
})

describe('prepareLazyRestore', () => {
  it('sleeps every tab except the valid active tab', () => {
    const state = repairedSnapshot()
    state.activeSpaceId = 's1'
    state.activeTabId = 't2'
    const result = prepareLazyRestore(state)
    expect(result.activeSpaceId).toBe('s1')
    expect(result.activeTabId).toBe('t2')
    expect(result.tabs.t1?.sleeping).toBe(true)
    expect(result.tabs.t2?.sleeping).toBe(false)
    expect(result.tabs.foreignTab?.sleeping).toBe(true)
    expect(result.tabs.lostTab?.sleeping).toBe(true)
  })

  it('sleeps every tab when the active tab is null', () => {
    const state = repairedSnapshot()
    state.activeSpaceId = 's1'
    state.activeTabId = null
    const result = prepareLazyRestore(state)
    expect(result.activeTabId).toBeNull()
    expect(Object.values(result.tabs).every((tab) => tab.sleeping)).toBe(true)
  })

  it('sleeps every tab when the active tab is unknown', () => {
    const state = repairedSnapshot()
    state.activeSpaceId = 's1'
    state.activeTabId = 'ghost'
    const result = prepareLazyRestore(state)
    expect(result.activeTabId).toBe('ghost')
    expect(Object.values(result.tabs).every((tab) => tab.sleeping)).toBe(true)
  })

  it('sleeps every tab when the active tab belongs to another space', () => {
    const state = repairedSnapshot()
    state.activeSpaceId = 's1'
    state.activeTabId = 'foreignTab'
    const result = prepareLazyRestore(state)
    expect(result.tabs.foreignTab?.sleeping).toBe(true)
    expect(Object.values(result.tabs).every((tab) => tab.sleeping)).toBe(true)
  })

  it('wakes the active tab even when it was persisted as sleeping', () => {
    const state = repairedSnapshot()
    state.activeSpaceId = 's1'
    state.activeTabId = 't1'
    state.tabs.t1 = { ...state.tabs.t1!, sleeping: true }
    state.tabs.t2 = { ...state.tabs.t2!, sleeping: false }
    const result = prepareLazyRestore(state)
    expect(result.tabs.t1?.sleeping).toBe(false)
    expect(result.tabs.t2?.sleeping).toBe(true)
  })

  it('preserves version and data without mutating the input', () => {
    const state = repairedSnapshot()
    state.activeSpaceId = 's1'
    state.activeTabId = 't1'
    state.tabs.t1 = { ...state.tabs.t1!, sleeping: false }
    const before = structuredClone(state)
    const result = prepareLazyRestore(state)

    expect(state).toEqual(before)
    expect(result).not.toBe(state)
    expect(result.tabs).not.toBe(state.tabs)
    expect(result.spaces).toEqual(state.spaces)
    expect(result.folders).toEqual(state.folders)
    expect(result.essentials).toEqual(state.essentials)

    for (const tab of Object.values(result.tabs)) {
      expect(tab).not.toBe(state.tabs[tab.id])
      expect({ ...tab, sleeping: state.tabs[tab.id]!.sleeping }).toEqual(state.tabs[tab.id])
    }
    expect(result.version).toBe(state.version)
  })
})
