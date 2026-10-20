import { describe, expect, it } from 'vitest'
import type { BrowserAction } from './actions'
import { DomainError, reduce } from './commands'
import type { StateDiff } from './diff'
import { applyDiff, cloneSnapshot } from './diff'
import type { BrowserSnapshot, Essential, Folder, Space, Tab } from './model'

const T0 = 1_700_000_000_000

function space(id: string, order: string, name = id): Space {
  return { id, name, icon: 'circle', theme: 'system', order }
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
    lastActive: T0,
    scrollY: 0,
    sleeping: false,
    ...overrides
  }
}

function essential(id: string, order: string, url = `https://${id}.example/`): Essential {
  return { id, url, title: id, favicon: '', order }
}

function baseSnapshot(): BrowserSnapshot {
  return {
    version: 7,
    spaces: {
      s1: space('s1', 'a', 'Work'),
      s2: space('s2', 'b', 'Play')
    },
    essentials: {
      e1: essential('e1', 'a')
    },
    folders: {
      f1: folder({ id: 'f1', spaceId: 's1', order: 'a', name: 'Docs' }),
      f2: folder({ id: 'f2', spaceId: 's1', parentId: 'f1', order: 'b', name: 'Nested' }),
      f3: folder({ id: 'f3', spaceId: 's2', order: 'a', name: 'Other' })
    },
    tabs: {
      t1: tab({ id: 't1', spaceId: 's1', folderId: 'f1', order: 'a', lastActive: T0 + 1 }),
      t2: tab({ id: 't2', spaceId: 's1', order: 'b', lastActive: T0 + 2 }),
      t3: tab({ id: 't3', spaceId: 's1', folderId: 'f1', order: 'c', lastActive: T0 + 3 }),
      t4: tab({
        id: 't4',
        spaceId: 's2',
        folderId: 'f3',
        order: 'a',
        lastActive: T0 + 4,
        url: 'https://four.example/'
      })
    },
    activeSpaceId: 's1',
    activeTabId: 't2'
  }
}

function diffTypes(diffs: readonly StateDiff[]): string[] {
  return diffs.map((diff) => diff.type)
}

/**
 * Reduces and asserts the invariants every action must uphold: the input is
 * untouched, the version advances by exactly one, and the diffs alone rebuild
 * the resulting snapshot.
 */
function run(state: BrowserSnapshot, action: BrowserAction) {
  const before = structuredClone(state)
  const result = reduce(state, action)

  expect(state).toEqual(before)
  expect(result.diffs.length).toBeGreaterThan(0)
  expect(result.state).not.toBe(state)
  expect(result.state.version).toBe(state.version + 1)

  const rebuilt = cloneSnapshot(state)
  for (const diff of result.diffs) applyDiff(rebuilt, diff)
  rebuilt.version = result.state.version
  expect(rebuilt).toEqual(result.state)

  return result
}

function expectRejected(state: BrowserSnapshot, action: BrowserAction): void {
  const before = structuredClone(state)
  expect(() => reduce(state, action)).toThrow(DomainError)
  expect(state).toEqual(before)
}

describe('space actions', () => {
  it('adds a space', () => {
    const result = run(baseSnapshot(), {
      type: 'space.add',
      space: space('s3', 'c', 'Third')
    })
    expect(result.state.spaces.s3?.name).toBe('Third')
    expect(diffTypes(result.diffs)).toEqual(['space.upsert'])
  })

  it.each<[string, BrowserSnapshot, BrowserAction]>([
    ['duplicate id', baseSnapshot(), { type: 'space.add', space: space('s1', 'c') } as const],
    [
      'empty order',
      baseSnapshot(),
      { type: 'space.add', space: space('s3', '  ') } as const
    ]
  ])('rejects space.add with %s', (_label, state, action) => {
    expectRejected(state, action)
  })

  it('updates space fields and clears the partition with null', () => {
    const state = baseSnapshot()
    const first = run(state, {
      type: 'space.update',
      id: 's1',
      patch: { name: 'Deep Work', partitionId: 'persist:work' }
    })
    expect(first.state.spaces.s1).toMatchObject({
      name: 'Deep Work',
      partitionId: 'persist:work'
    })
    const second = run(first.state, {
      type: 'space.update',
      id: 's1',
      patch: { partitionId: null }
    })
    expect(second.state.spaces.s1).not.toHaveProperty('partitionId')
  })

  it('treats an identical space patch as a no-op', () => {
    const state = baseSnapshot()
    const result = reduce(state, { type: 'space.update', id: 's1', patch: { name: 'Work' } })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })

  it('rejects updates to unknown spaces', () => {
    expectRejected(baseSnapshot(), { type: 'space.update', id: 'nope', patch: { name: 'x' } })
  })

  it('removes an inactive space with its tabs and folders', () => {
    const result = run(baseSnapshot(), { type: 'space.remove', id: 's2' })
    expect(result.state.spaces.s2).toBeUndefined()
    expect(result.state.tabs.t4).toBeUndefined()
    expect(result.state.folders.f3).toBeUndefined()
    expect(diffTypes(result.diffs)).toEqual([
      'tab.remove',
      'folder.remove',
      'space.remove'
    ])
    expect(result.state.activeSpaceId).toBe('s1')
    expect(result.state.activeTabId).toBe('t2')
  })

  it('removes folder descendants deepest-first when removing a space', () => {
    const result = run(baseSnapshot(), { type: 'space.remove', id: 's1' })
    const removals = result.diffs
      .filter((diff): diff is Extract<StateDiff, { type: 'folder.remove' }> =>
        diff.type === 'folder.remove'
      )
      .map((diff) => diff.id)
    expect(removals.indexOf('f2')).toBeLessThan(removals.indexOf('f1'))
  })

  it('activates the first remaining space and its most recent tab', () => {
    const state = baseSnapshot()
    state.activeTabId = 't1'
    const result = run(state, { type: 'space.remove', id: 's1' })
    expect(result.state.activeSpaceId).toBe('s2')
    expect(result.state.activeTabId).toBe('t4')
    expect(diffTypes(result.diffs)).toEqual(
      expect.arrayContaining(['session.activeSpace', 'session.activeTab'])
    )
  })

  it('rejects removing the last space', () => {
    const state = baseSnapshot()
    delete state.spaces['s2']
    delete state.folders['f3']
    delete state.tabs['t4']
    expectRejected(state, { type: 'space.remove', id: 's1' })
  })

  it('activates a space and selects its most recent tab', () => {
    const result = run(baseSnapshot(), { type: 'space.activate', id: 's2' })
    expect(result.state.activeSpaceId).toBe('s2')
    expect(result.state.activeTabId).toBe('t4')
    expect(diffTypes(result.diffs)).toEqual(['session.activeSpace', 'session.activeTab'])
  })

  it('wakes the most recent tab when switching to its space', () => {
    const state = baseSnapshot()
    state.tabs.t4 = { ...state.tabs.t4!, sleeping: true }
    const result = run(state, { type: 'space.activate', id: 's2' })
    expect(result.state.tabs.t4?.sleeping).toBe(false)
    expect(result.state.activeTabId).toBe('t4')
    expect(diffTypes(result.diffs)).toEqual([
      'tab.upsert',
      'session.activeSpace',
      'session.activeTab'
    ])
    expect(result.diffs[0]).toEqual({
      type: 'tab.upsert',
      tab: expect.objectContaining({ id: 't4', sleeping: false })
    })
  })

  it('leaves an awake most recent tab untouched when switching spaces', () => {
    const result = run(baseSnapshot(), { type: 'space.activate', id: 's2' })
    expect(diffTypes(result.diffs)).not.toContain('tab.upsert')
    expect(result.state.tabs.t4).toEqual(baseSnapshot().tabs.t4)
  })

  it('treats activating the active space as a no-op', () => {
    const state = baseSnapshot()
    const result = reduce(state, { type: 'space.activate', id: 's1' })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })

  it('does not wake tabs when the active space is already selected', () => {
    const state = baseSnapshot()
    state.tabs.t2 = { ...state.tabs.t2!, sleeping: true }
    const result = reduce(state, { type: 'space.activate', id: 's1' })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
    expect(result.state.tabs.t2?.sleeping).toBe(true)
  })

  it('rejects activating an unknown space', () => {
    expectRejected(baseSnapshot(), { type: 'space.activate', id: 'nope' })
  })

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects prototype-chain id %s',
    (id) => {
      expectRejected(baseSnapshot(), { type: 'space.activate', id })
      expectRejected(baseSnapshot(), { type: 'tab.activate', id, at: T0 })
      expectRejected(baseSnapshot(), { type: 'tab.add', tab: tab({ id, spaceId: 's1', order: 'z' }) })
      expectRejected(baseSnapshot(), { type: 'space.add', space: space(id, 'z') })
    }
  )
})

describe('tab actions', () => {
  it('adds a tab to a folder', () => {
    const result = run(baseSnapshot(), {
      type: 'tab.add',
      tab: tab({ id: 't5', spaceId: 's1', folderId: 'f2', order: 'd' })
    })
    expect(result.state.tabs.t5).toEqual(
      tab({ id: 't5', spaceId: 's1', folderId: 'f2', order: 'd' })
    )
    expect(diffTypes(result.diffs)).toEqual(['tab.upsert'])
  })

  it.each<[string, Tab]>([
    ['a duplicate id', tab({ id: 't1', spaceId: 's1', order: 'z' })],
    ['a missing space', tab({ id: 't9', spaceId: 'nope', order: 'z' })],
    ['a foreign folder', tab({ id: 't9', spaceId: 's1', folderId: 'f3', order: 'z' })],
    ['an empty url', tab({ id: 't9', spaceId: 's1', order: 'z', url: '  ' })],
    ['an empty order', tab({ id: 't9', spaceId: 's1', order: '' })]
  ])('rejects tab.add with %s', (_label: string, candidate: Tab) => {
    expectRejected(baseSnapshot(), { type: 'tab.add', tab: candidate })
  })

  it('updates tab fields and clears pinnedUrl with null', () => {
    const state = baseSnapshot()
    const first = run(state, {
      type: 'tab.update',
      id: 't2',
      patch: { title: 'Renamed', pinnedUrl: 'https://pinned.example/' }
    })
    expect(first.state.tabs.t2).toMatchObject({
      title: 'Renamed',
      pinnedUrl: 'https://pinned.example/'
    })
    const second = run(first.state, {
      type: 'tab.update',
      id: 't2',
      patch: { pinnedUrl: null }
    })
    expect(second.state.tabs.t2).not.toHaveProperty('pinnedUrl')
  })

  it('treats an identical tab patch as a no-op', () => {
    const state = baseSnapshot()
    const result = reduce(state, { type: 'tab.update', id: 't2', patch: { title: 't2' } })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })

  it('rejects invalid tab updates', () => {
    expectRejected(baseSnapshot(), { type: 'tab.update', id: 'nope', patch: { title: 'x' } })
    expectRejected(baseSnapshot(), { type: 'tab.update', id: 't2', patch: { order: ' ' } })
  })

  it('removes an inactive tab without touching the session', () => {
    const result = run(baseSnapshot(), { type: 'tab.remove', id: 't1' })
    expect(result.state.tabs.t1).toBeUndefined()
    expect(result.state.activeTabId).toBe('t2')
    expect(diffTypes(result.diffs)).toEqual(['tab.remove'])
  })

  it('selects the next sibling when removing the active tab', () => {
    const state = baseSnapshot()
    state.activeTabId = 't1'
    const result = run(state, { type: 'tab.remove', id: 't1' })
    expect(result.state.activeTabId).toBe('t3')
    expect(diffTypes(result.diffs)).toEqual(['tab.remove', 'session.activeTab'])
  })

  it('falls back to the most recent tab in the space when no sibling follows', () => {
    const state = baseSnapshot()
    state.activeTabId = 't3'
    const result = run(state, { type: 'tab.remove', id: 't3' })
    expect(result.state.activeTabId).toBe('t2')
  })

  it('clears the active tab when the space becomes empty', () => {
    const state = baseSnapshot()
    state.activeSpaceId = 's2'
    state.activeTabId = 't4'
    const result = run(state, { type: 'tab.remove', id: 't4' })
    expect(result.state.activeTabId).toBeNull()
    expect(diffTypes(result.diffs)).toEqual(['tab.remove', 'session.activeTab'])
  })

  it('rejects removing an unknown tab', () => {
    expectRejected(baseSnapshot(), { type: 'tab.remove', id: 'nope' })
  })

  it('activates a tab across spaces', () => {
    const result = run(baseSnapshot(), { type: 'tab.activate', id: 't4', at: T0 + 99 })
    expect(result.state.activeSpaceId).toBe('s2')
    expect(result.state.activeTabId).toBe('t4')
    expect(result.state.tabs.t4?.lastActive).toBe(T0 + 99)
    expect(diffTypes(result.diffs)).toEqual([
      'tab.upsert',
      'session.activeSpace',
      'session.activeTab'
    ])
  })

  it('treats re-activating the active tab with the same timestamp as a no-op', () => {
    const state = baseSnapshot()
    const at = state.tabs.t2?.lastActive ?? 0
    const result = reduce(state, { type: 'tab.activate', id: 't2', at })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })

  it('wakes an active sleeping tab even with an unchanged timestamp', () => {
    const state = baseSnapshot()
    const at = state.tabs.t2?.lastActive ?? 0
    state.tabs.t2 = { ...state.tabs.t2!, sleeping: true }
    const result = run(state, { type: 'tab.activate', id: 't2', at })
    expect(result.state.tabs.t2).toMatchObject({ lastActive: at, sleeping: false })
    expect(diffTypes(result.diffs)).toEqual(['tab.upsert'])
  })

  it('wakes a sleeping tab when activating it in another space', () => {
    const state = baseSnapshot()
    state.tabs.t4 = { ...state.tabs.t4!, sleeping: true }
    const result = run(state, { type: 'tab.activate', id: 't4', at: T0 + 99 })
    expect(result.state.tabs.t4).toMatchObject({ lastActive: T0 + 99, sleeping: false })
    expect(diffTypes(result.diffs)).toEqual([
      'tab.upsert',
      'session.activeSpace',
      'session.activeTab'
    ])
  })

  it('rejects activating an unknown tab', () => {
    expectRejected(baseSnapshot(), { type: 'tab.activate', id: 'nope', at: 0 })
  })

  it('pins a tab and captures its current url', () => {
    const result = run(baseSnapshot(), { type: 'tab.pin', id: 't2' })
    expect(result.state.tabs.t2).toMatchObject({
      pinned: true,
      pinnedUrl: 'https://t2.example/'
    })
  })

  it('keeps an existing pinned url when pinning again', () => {
    const state = baseSnapshot()
    state.tabs.t1 = { ...state.tabs.t1!, pinned: false, pinnedUrl: 'https://kept.example/' }
    const result = run(state, { type: 'tab.pin', id: 't1' })
    expect(result.state.tabs.t1).toMatchObject({
      pinned: true,
      pinnedUrl: 'https://kept.example/'
    })
  })

  it('treats pinning an already pinned tab as a no-op', () => {
    const state = baseSnapshot()
    state.tabs.t2 = { ...state.tabs.t2!, pinned: true, pinnedUrl: 'https://t2.example/' }
    const result = reduce(state, { type: 'tab.pin', id: 't2' })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })

  it('unpins a tab and clears the pinned url', () => {
    const state = baseSnapshot()
    state.tabs.t2 = { ...state.tabs.t2!, pinned: true, pinnedUrl: 'https://t2.example/' }
    const result = run(state, { type: 'tab.unpin', id: 't2' })
    expect(result.state.tabs.t2?.pinned).toBe(false)
    expect(result.state.tabs.t2).not.toHaveProperty('pinnedUrl')
  })

  it('treats unpinning an unpinned tab as a no-op', () => {
    const state = baseSnapshot()
    const result = reduce(state, { type: 'tab.unpin', id: 't2' })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })

  it('resets a tab to its pinned url and wakes it', () => {
    const state = baseSnapshot()
    state.tabs.t2 = {
      ...state.tabs.t2!,
      pinned: true,
      pinnedUrl: 'https://t2.example/',
      url: 'https://elsewhere.example/',
      sleeping: true
    }
    const result = run(state, { type: 'tab.resetToPinned', id: 't2' })
    expect(result.state.tabs.t2).toMatchObject({
      url: 'https://t2.example/',
      sleeping: false
    })
  })

  it.each<[string, Partial<Tab>]>([
    ['not pinned', { pinned: false, pinnedUrl: 'https://t2.example/' }],
    ['already at the pinned url', { pinned: true, pinnedUrl: 'https://t2.example/' }],
    ['pinned without a pinned url', { pinned: true }]
  ])('treats resetToPinned as a no-op when %s', (_label: string, patch: Partial<Tab>) => {
    const state = baseSnapshot()
    state.tabs.t2 = { ...state.tabs.t2!, url: 'https://t2.example/', ...patch }
    const result = reduce(state, { type: 'tab.resetToPinned', id: 't2' })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })

  it('moves a tab between folders in the same space', () => {
    const result = run(baseSnapshot(), {
      type: 'tab.move',
      id: 't2',
      spaceId: 's1',
      folderId: 'f2',
      order: 'a'
    })
    expect(result.state.tabs.t2).toMatchObject({ spaceId: 's1', folderId: 'f2', order: 'a' })
    expect(diffTypes(result.diffs)).toEqual(['tab.upsert'])
  })

  it('moves the active tab to another space and follows it', () => {
    const result = run(baseSnapshot(), {
      type: 'tab.move',
      id: 't2',
      spaceId: 's2',
      folderId: null,
      order: 'b'
    })
    expect(result.state.activeSpaceId).toBe('s2')
    expect(result.state.activeTabId).toBe('t2')
    expect(result.state.tabs.t2?.folderId).toBeUndefined()
    expect(diffTypes(result.diffs)).toEqual(['tab.upsert', 'session.activeSpace'])
  })

  it('rejects tab moves into missing or foreign destinations', () => {
    const state = baseSnapshot()
    expectRejected(state, { type: 'tab.move', id: 't2', spaceId: 'nope', folderId: null, order: 'a' })
    expectRejected(state, { type: 'tab.move', id: 't2', spaceId: 's2', folderId: 'f1', order: 'a' })
    expectRejected(state, { type: 'tab.move', id: 't2', spaceId: 's2', folderId: null, order: '' })
    expectRejected(state, { type: 'tab.move', id: 'nope', spaceId: 's2', folderId: null, order: 'a' })
  })

  it('treats an identical move as a no-op', () => {
    const state = baseSnapshot()
    const result = reduce(state, {
      type: 'tab.move',
      id: 't1',
      spaceId: 's1',
      folderId: 'f1',
      order: 'a'
    })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })
})

describe('folder actions', () => {
  it('adds a root folder and a nested folder', () => {
    const first = run(baseSnapshot(), {
      type: 'folder.add',
      folder: folder({ id: 'f4', spaceId: 's1', order: 'z', name: 'Later' })
    })
    expect(first.state.folders.f4?.name).toBe('Later')
    const second = run(first.state, {
      type: 'folder.add',
      folder: folder({ id: 'f5', spaceId: 's1', parentId: 'f4', order: 'a' })
    })
    expect(second.state.folders.f5?.parentId).toBe('f4')
  })

  it.each<[string, Folder]>([
    ['a duplicate id', folder({ id: 'f1', spaceId: 's1', order: 'z' })],
    ['a missing space', folder({ id: 'f9', spaceId: 'nope', order: 'z' })],
    ['a foreign parent', folder({ id: 'f9', spaceId: 's1', parentId: 'f3', order: 'z' })],
    ['a missing parent', folder({ id: 'f9', spaceId: 's1', parentId: 'nope', order: 'z' })]
  ])('rejects folder.add with %s', (_label: string, candidate: Folder) => {
    expectRejected(baseSnapshot(), { type: 'folder.add', folder: candidate })
  })

  it('updates folder fields and clears feedUrl with null', () => {
    const state = baseSnapshot()
    state.folders.f1 = { ...state.folders.f1!, kind: 'rss', feedUrl: 'https://feed.example/' }
    const first = run(state, {
      type: 'folder.update',
      id: 'f1',
      patch: { name: 'Reading', collapsed: true }
    })
    expect(first.state.folders.f1).toMatchObject({
      name: 'Reading',
      collapsed: true,
      feedUrl: 'https://feed.example/'
    })
    const second = run(first.state, {
      type: 'folder.update',
      id: 'f1',
      patch: { feedUrl: null }
    })
    expect(second.state.folders.f1).not.toHaveProperty('feedUrl')
  })

  it('treats an identical folder patch as a no-op', () => {
    const state = baseSnapshot()
    const result = reduce(state, {
      type: 'folder.update',
      id: 'f1',
      patch: { collapsed: false }
    })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })

  it('rejects updates to unknown folders', () => {
    expectRejected(baseSnapshot(), { type: 'folder.update', id: 'nope', patch: { name: 'x' } })
  })

  it('moves a folder to the root', () => {
    const result = run(baseSnapshot(), {
      type: 'folder.move',
      id: 'f2',
      parentId: null,
      order: 'c'
    })
    expect(result.state.folders.f2?.parentId).toBeUndefined()
    expect(result.state.folders.f2?.order).toBe('c')
  })

  it('moves a folder under another root folder', () => {
    const result = run(baseSnapshot(), {
      type: 'folder.move',
      id: 'f2',
      parentId: 'f1',
      order: 'z'
    })
    expect(result.state.folders.f2).toMatchObject({ parentId: 'f1', order: 'z' })
  })

  it.each<[string, BrowserAction]>([
    ['itself', { type: 'folder.move', id: 'f1', parentId: 'f1', order: 'a' } as const],
    ['one of its descendants', { type: 'folder.move', id: 'f1', parentId: 'f2', order: 'a' } as const],
    ['a foreign parent', { type: 'folder.move', id: 'f1', parentId: 'f3', order: 'a' } as const]
  ])('rejects moving a folder into %s', (_label: string, action) => {
    expectRejected(baseSnapshot(), action)
  })

  it('treats an identical folder move as a no-op', () => {
    const state = baseSnapshot()
    const result = reduce(state, {
      type: 'folder.move',
      id: 'f2',
      parentId: 'f1',
      order: 'b'
    })
    expect(result.state).toBe(state)
    expect(result.diffs).toEqual([])
  })

  it('removes a folder tree and promotes its tabs to the parent', () => {
    const result = run(baseSnapshot(), { type: 'folder.remove', id: 'f1' })
    expect(result.state.folders.f1).toBeUndefined()
    expect(result.state.folders.f2).toBeUndefined()
    expect(result.state.tabs.t1).toBeDefined()
    expect(result.state.tabs.t3).toBeDefined()
    expect(result.state.tabs.t1?.folderId).toBeUndefined()
    expect(result.state.tabs.t3?.folderId).toBeUndefined()

    const removals = result.diffs
      .filter((diff): diff is Extract<StateDiff, { type: 'folder.remove' }> =>
        diff.type === 'folder.remove'
      )
      .map((diff) => diff.id)
    expect(removals).toEqual(['f2', 'f1'])
    expect(diffTypes(result.diffs).filter((type) => type === 'tab.upsert')).toHaveLength(2)
    expect(diffTypes(result.diffs)).not.toContain('tab.remove')
  })

  it('re-keys tabs promoted from nested folders after surviving siblings', () => {
    const state = baseSnapshot()
    state.tabs.t5 = tab({ id: 't5', spaceId: 's1', folderId: 'f2', order: 'b' })
    const result = run(state, { type: 'folder.remove', id: 'f1' })

    const promotedIds = ['t1', 't5', 't3']
    expect(Object.keys(result.state.tabs).sort()).toEqual(['t1', 't2', 't3', 't4', 't5'])
    const promoted = promotedIds.map((id) => result.state.tabs[id]!)
    expect(promoted.every((item) => item.folderId === undefined)).toBe(true)
    expect(new Set(promoted.map((item) => item.order)).size).toBe(3)

    const rootTabs = Object.values(result.state.tabs)
      .filter((item) => item.spaceId === 's1' && item.folderId === undefined)
      .sort((left, right) => (left.order < right.order ? -1 : left.order > right.order ? 1 : 0))
    expect(rootTabs.map((item) => item.id)).toEqual(['t2', 't1', 't5', 't3'])
    for (let index = 1; index < rootTabs.length; index += 1) {
      expect((rootTabs[index - 1] as Tab).order < (rootTabs[index] as Tab).order).toBe(true)
    }
    for (const item of promoted) {
      expect(item.order > (state.tabs.t2 as Tab).order).toBe(true)
    }

    const upserts = result.diffs.filter(
      (diff): diff is Extract<StateDiff, { type: 'tab.upsert' }> => diff.type === 'tab.upsert'
    )
    expect(upserts.map((diff) => diff.tab.id).sort()).toEqual([...promotedIds].sort())
    for (const diff of upserts) {
      expect(diff.tab.order).toBe(result.state.tabs[diff.tab.id]?.order)
    }
  })

  it('removes a single leaf folder without touching unrelated tabs', () => {
    const result = run(baseSnapshot(), { type: 'folder.remove', id: 'f2' })
    expect(result.state.folders.f2).toBeUndefined()
    expect(result.state.tabs.t1?.folderId).toBe('f1')
    expect(diffTypes(result.diffs)).toEqual(['folder.remove'])
  })

  it('rejects removing an unknown folder', () => {
    expectRejected(baseSnapshot(), { type: 'folder.remove', id: 'nope' })
  })
})

describe('essential actions', () => {
  it('adds an essential', () => {
    const result = run(baseSnapshot(), {
      type: 'essential.add',
      essential: essential('e2', 'b', 'https://two.example/')
    })
    expect(result.state.essentials.e2?.url).toBe('https://two.example/')
    expect(diffTypes(result.diffs)).toEqual(['essential.upsert'])
  })

  it('rejects duplicate and invalid essentials', () => {
    expectRejected(baseSnapshot(), {
      type: 'essential.add',
      essential: essential('e1', 'b')
    })
    expectRejected(baseSnapshot(), {
      type: 'essential.add',
      essential: essential('e2', 'b', ' ')
    })
  })

  it('updates an essential and treats an identical patch as a no-op', () => {
    const first = run(baseSnapshot(), {
      type: 'essential.update',
      id: 'e1',
      patch: { title: 'Alpha' }
    })
    expect(first.state.essentials.e1?.title).toBe('Alpha')
    const second = reduce(first.state, {
      type: 'essential.update',
      id: 'e1',
      patch: { title: 'Alpha' }
    })
    expect(second.state).toBe(first.state)
    expect(second.diffs).toEqual([])
  })

  it('rejects updates to unknown essentials', () => {
    expectRejected(baseSnapshot(), {
      type: 'essential.update',
      id: 'nope',
      patch: { title: 'x' }
    })
  })

  it('removes an essential', () => {
    const result = run(baseSnapshot(), { type: 'essential.remove', id: 'e1' })
    expect(result.state.essentials.e1).toBeUndefined()
    expect(diffTypes(result.diffs)).toEqual(['essential.remove'])
  })

  it('rejects removing an unknown essential', () => {
    expectRejected(baseSnapshot(), { type: 'essential.remove', id: 'nope' })
  })
})

describe('reduce sequences', () => {
  it('keeps versions and diffs consistent across a long action sequence', () => {
    let state = baseSnapshot()
    const actions: BrowserAction[] = [
      { type: 'space.add', space: space('s3', 'c', 'Third') },
      { type: 'tab.add', tab: tab({ id: 't5', spaceId: 's1', folderId: 'f2', order: 'd' }) },
      { type: 'tab.activate', id: 't5', at: T0 + 100 },
      { type: 'tab.pin', id: 't5' },
      { type: 'tab.move', id: 't5', spaceId: 's3', folderId: null, order: 'a' },
      { type: 'folder.add', folder: folder({ id: 'f4', spaceId: 's3', order: 'a' }) },
      { type: 'folder.move', id: 'f4', parentId: null, order: 'b' },
      { type: 'tab.add', tab: tab({ id: 't6', spaceId: 's3', folderId: 'f4', order: 'a' }) },
      { type: 'tab.remove', id: 't6' },
      { type: 'folder.remove', id: 'f4' },
      { type: 'essential.add', essential: essential('e2', 'b') },
      { type: 'essential.remove', id: 'e1' },
      { type: 'space.remove', id: 's1' }
    ]

    for (const action of actions) {
      state = run(state, action).state
    }
    expect(state.version).toBe(7 + actions.length)
    expect(Object.keys(state.spaces).sort()).toEqual(['s2', 's3'])
    expect(state.activeSpaceId).toBe('s3')
  })

  it('never mutates the input when an action is rejected midway', () => {
    const state = baseSnapshot()
    expectRejected(state, {
      type: 'tab.move',
      id: 't1',
      spaceId: 's2',
      folderId: 'f1',
      order: 'a'
    })
    expect(state).toEqual(baseSnapshot())
  })
})
