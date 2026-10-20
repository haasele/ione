import { describe, expect, it } from 'vitest'
import type { Folder, Tab } from './model'
import {
  getFolderChildren,
  getFolderPath,
  getFolderTabs,
  getOrderedSiblings,
  getTabSiblings,
  isFolderDescendant
} from './tree'

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
    url: `https://${overrides.id}.example`,
    title: overrides.id,
    favicon: '',
    pinned: false,
    lastActive: 0,
    scrollY: 0,
    sleeping: false,
    ...overrides
  }
}

const folders: Record<string, Folder> = {
  root2: folder({ id: 'root2', spaceId: 's1', order: 'V' }),
  root1: folder({ id: 'root1', spaceId: 's1', order: 'F' }),
  child2: folder({ id: 'child2', spaceId: 's1', parentId: 'root1', order: 'b' }),
  child1: folder({ id: 'child1', spaceId: 's1', parentId: 'root1', order: 'a' }),
  grandchild: folder({ id: 'grandchild', spaceId: 's1', parentId: 'child1', order: 'a' }),
  foreign: folder({ id: 'foreign', spaceId: 's2', order: 'a' }),
  foreignChild: folder({ id: 'foreignChild', spaceId: 's2', parentId: 'foreign', order: 'a' })
}

const tabs: Record<string, Tab> = {
  rootTab2: tab({ id: 'rootTab2', spaceId: 's1', order: 'b' }),
  rootTab1: tab({ id: 'rootTab1', spaceId: 's1', order: 'a' }),
  childTab: tab({ id: 'childTab', spaceId: 's1', folderId: 'child1', order: 'a' }),
  grandchildTab: tab({ id: 'grandchildTab', spaceId: 's1', folderId: 'grandchild', order: 'a' }),
  foreignTab: tab({ id: 'foreignTab', spaceId: 's2', folderId: 'foreign', order: 'a' })
}

describe('getFolderChildren', () => {
  it('returns root folders sorted by order', () => {
    expect(getFolderChildren(folders, 's1', null).map((item) => item.id)).toEqual([
      'root1',
      'root2'
    ])
  })

  it('returns nested folders sorted by order', () => {
    expect(getFolderChildren(folders, 's1', 'root1').map((item) => item.id)).toEqual([
      'child1',
      'child2'
    ])
  })

  it('treats a missing parent as empty', () => {
    expect(getFolderChildren(folders, 's1', 'nope')).toEqual([])
  })

  it('rejects a parent owned by another space', () => {
    expect(getFolderChildren(folders, 's1', 'foreign')).toEqual([])
  })

  it('does not leak folders from another space at the root', () => {
    expect(getFolderChildren(folders, 's1', null).map((item) => item.id)).not.toContain('foreign')
  })
})

describe('getOrderedSiblings', () => {
  it('matches getFolderChildren', () => {
    expect(getOrderedSiblings(folders, 's1', 'root1')).toEqual(
      getFolderChildren(folders, 's1', 'root1')
    )
  })
})

describe('getFolderTabs / getTabSiblings', () => {
  it('returns root tabs sorted by order', () => {
    expect(getFolderTabs(tabs, 's1', null).map((item) => item.id)).toEqual([
      'rootTab1',
      'rootTab2'
    ])
  })

  it('returns tabs of a folder sorted by order', () => {
    expect(getFolderTabs(tabs, 's1', 'child1').map((item) => item.id)).toEqual(['childTab'])
  })

  it('does not include tabs from other spaces', () => {
    expect(getFolderTabs(tabs, 's1', 'foreign')).toEqual([])
  })

  it('exposes the same list through getTabSiblings', () => {
    expect(getTabSiblings(tabs, 's1', null)).toEqual(getFolderTabs(tabs, 's1', null))
  })
})

describe('isFolderDescendant', () => {
  it('detects nested descendants at any depth', () => {
    expect(isFolderDescendant(folders, 'child1', 'root1')).toBe(true)
    expect(isFolderDescendant(folders, 'grandchild', 'root1')).toBe(true)
    expect(isFolderDescendant(folders, 'grandchild', 'child1')).toBe(true)
  })

  it('is false for self and ancestors', () => {
    expect(isFolderDescendant(folders, 'root1', 'root1')).toBe(false)
    expect(isFolderDescendant(folders, 'root1', 'child1')).toBe(false)
  })

  it('is false for unknown folders', () => {
    expect(isFolderDescendant(folders, 'missing', 'root1')).toBe(false)
    expect(isFolderDescendant(folders, 'root1', 'missing')).toBe(false)
  })

  it('terminates safely on cycles', () => {
    const cyclic: Record<string, Folder> = {
      a: folder({ id: 'a', spaceId: 's1', parentId: 'b', order: 'a' }),
      b: folder({ id: 'b', spaceId: 's1', parentId: 'a', order: 'b' })
    }
    expect(isFolderDescendant(cyclic, 'a', 'b')).toBe(true)
    expect(isFolderDescendant(cyclic, 'a', 'outside')).toBe(false)
    expect(isFolderDescendant(cyclic, 'a', 'a')).toBe(false)
  })
})

describe('getFolderPath', () => {
  it('returns a root-to-leaf path', () => {
    expect(getFolderPath(folders, 'grandchild').map((item) => item.id)).toEqual([
      'root1',
      'child1',
      'grandchild'
    ])
  })

  it('returns a single entry for a root folder', () => {
    expect(getFolderPath(folders, 'root2').map((item) => item.id)).toEqual(['root2'])
  })

  it('returns an empty path for a missing folder', () => {
    expect(getFolderPath(folders, 'nope')).toEqual([])
  })

  it('stops at a missing parent', () => {
    const orphan: Record<string, Folder> = {
      leaf: folder({ id: 'leaf', spaceId: 's1', parentId: 'gone', order: 'a' })
    }
    expect(getFolderPath(orphan, 'leaf').map((item) => item.id)).toEqual(['leaf'])
  })

  it('stops safely on a cycle', () => {
    const cyclic: Record<string, Folder> = {
      a: folder({ id: 'a', spaceId: 's1', parentId: 'b', order: 'a' }),
      b: folder({ id: 'b', spaceId: 's1', parentId: 'a', order: 'b' })
    }
    const path = getFolderPath(cyclic, 'a')
    expect(path.length).toBeLessThanOrEqual(2)
    expect(new Set(path.map((item) => item.id)).size).toBe(path.length)
  })
})
