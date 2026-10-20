/**
 * Pure reducer for the browser snapshot. Every accepted mutation produces a
 * new snapshot and a list of complete-entity diffs; the input is never mutated.
 * Invalid actions throw DomainError before any state is returned.
 */

import type { BrowserAction, EssentialPatch, FolderPatch, SpacePatch, TabPatch } from './actions'
import type { StateDiff } from './diff'
import { cloneSnapshot } from './diff'
import { generateKeyBetween } from './fractional-index'
import type { BrowserSnapshot, Essential, Folder, Space, Tab } from './model'
import { compareOrder, mostRecentTabInSpace, sortByOrder } from './model'
import { getFolderTabs, isFolderDescendant } from './tree'

export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

export interface ReduceResult {
  state: BrowserSnapshot
  diffs: StateDiff[]
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError(`${field} must be a non-empty string`)
  }
}

const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function assertSafeId(value: unknown, field: string): asserts value is string {
  assertNonEmpty(value, field)
  if (RESERVED_OBJECT_KEYS.has(value)) {
    throw new DomainError(`${field} uses a reserved object key: ${value}`)
  }
}

function own<T>(map: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(map, id) ? map[id] : undefined
}

function shallowEqual(left: object, right: object): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) {
      return false
    }
  }
  return true
}

function requireSpace(state: BrowserSnapshot, id: string): Space {
  const space = own(state.spaces, id)
  if (!space) throw new DomainError(`Unknown space: ${id}`)
  return space
}

function requireFolder(state: BrowserSnapshot, id: string): Folder {
  const folder = own(state.folders, id)
  if (!folder) throw new DomainError(`Unknown folder: ${id}`)
  return folder
}

function requireTab(state: BrowserSnapshot, id: string): Tab {
  const tab = own(state.tabs, id)
  if (!tab) throw new DomainError(`Unknown tab: ${id}`)
  return tab
}

function requireEssential(state: BrowserSnapshot, id: string): Essential {
  const essential = own(state.essentials, id)
  if (!essential) throw new DomainError(`Unknown essential: ${id}`)
  return essential
}

function applySpacePatch(space: Space, patch: SpacePatch): Space {
  const next: Space = { ...space }
  if (patch.name !== undefined) {
    assertNonEmpty(patch.name, 'space.name')
    next.name = patch.name
  }
  if (patch.icon !== undefined) next.icon = patch.icon
  if (patch.theme !== undefined) next.theme = patch.theme
  if (patch.order !== undefined) {
    assertNonEmpty(patch.order, 'space.order')
    next.order = patch.order
  }
  if (patch.partitionId !== undefined) {
    if (patch.partitionId === null) delete next.partitionId
    else next.partitionId = patch.partitionId
  }
  return next
}

function applyFolderPatch(folder: Folder, patch: FolderPatch): Folder {
  const next: Folder = { ...folder }
  if (patch.name !== undefined) {
    assertNonEmpty(patch.name, 'folder.name')
    next.name = patch.name
  }
  if (patch.collapsed !== undefined) next.collapsed = patch.collapsed
  if (patch.order !== undefined) {
    assertNonEmpty(patch.order, 'folder.order')
    next.order = patch.order
  }
  if (patch.feedUrl !== undefined) {
    if (patch.feedUrl === null) delete next.feedUrl
    else next.feedUrl = patch.feedUrl
  }
  return next
}

function applyTabPatch(tab: Tab, patch: TabPatch): Tab {
  const next: Tab = { ...tab }
  if (patch.url !== undefined) {
    assertNonEmpty(patch.url, 'tab.url')
    next.url = patch.url
  }
  if (patch.title !== undefined) next.title = patch.title
  if (patch.favicon !== undefined) next.favicon = patch.favicon
  if (patch.lastActive !== undefined) {
    if (!Number.isFinite(patch.lastActive)) {
      throw new DomainError('tab.lastActive must be a finite number')
    }
    next.lastActive = patch.lastActive
  }
  if (patch.scrollY !== undefined) next.scrollY = patch.scrollY
  if (patch.sleeping !== undefined) next.sleeping = patch.sleeping
  if (patch.order !== undefined) {
    assertNonEmpty(patch.order, 'tab.order')
    next.order = patch.order
  }
  if (patch.pinnedUrl !== undefined) {
    if (patch.pinnedUrl === null) delete next.pinnedUrl
    else next.pinnedUrl = patch.pinnedUrl
  }
  return next
}

function folderDepth(folders: Record<string, Folder>, folderId: string): number {
  let depth = 0
  const seen = new Set<string>([folderId])
  let cursor = own(folders, folderId)
  while (cursor?.parentId !== undefined) {
    const parentId = cursor.parentId
    if (seen.has(parentId)) break
    const parent = own(folders, parentId)
    if (!parent) break
    seen.add(parentId)
    depth += 1
    cursor = parent
  }
  return depth
}

function pushSessionDiffs(
  previous: BrowserSnapshot,
  next: BrowserSnapshot,
  diffs: StateDiff[]
): void {
  if (previous.activeSpaceId !== next.activeSpaceId) {
    diffs.push({ type: 'session.activeSpace', spaceId: next.activeSpaceId })
  }
  if (previous.activeTabId !== next.activeTabId) {
    diffs.push({ type: 'session.activeTab', tabId: next.activeTabId })
  }
}

function finish(
  original: BrowserSnapshot,
  next: BrowserSnapshot,
  diffs: StateDiff[]
): ReduceResult {
  if (diffs.length === 0) return { state: original, diffs }
  next.version = original.version + 1
  return { state: next, diffs }
}

export function reduce(state: BrowserSnapshot, action: BrowserAction): ReduceResult {
  const next = cloneSnapshot(state)
  const diffs: StateDiff[] = []

  switch (action.type) {
    case 'space.add': {
      const space = action.space
      assertSafeId(space.id, 'space.id')
      assertNonEmpty(space.name, 'space.name')
      assertNonEmpty(space.order, 'space.order')
      if (own(next.spaces, space.id)) {
        throw new DomainError(`Space already exists: ${space.id}`)
      }
      const stored: Space = { ...space }
      next.spaces[stored.id] = stored
      diffs.push({ type: 'space.upsert', space: stored })
      break
    }

    case 'space.update': {
      const current = requireSpace(next, action.id)
      const updated = applySpacePatch(current, action.patch)
      if (!shallowEqual(current, updated)) {
        next.spaces[updated.id] = updated
        diffs.push({ type: 'space.upsert', space: updated })
      }
      break
    }

    case 'space.remove': {
      const space = requireSpace(next, action.id)
      if (Object.keys(next.spaces).length <= 1) {
        throw new DomainError('Cannot remove the last space')
      }
      delete next.spaces[space.id]

      for (const tab of sortByOrder(
        Object.values(next.tabs).filter((item) => item.spaceId === space.id)
      )) {
        delete next.tabs[tab.id]
        diffs.push({ type: 'tab.remove', id: tab.id })
      }

      const removedFolders = Object.values(next.folders).filter(
        (folder) => folder.spaceId === space.id
      )
      const depthOf = new Map(
        removedFolders.map((folder) => [folder.id, folderDepth(next.folders, folder.id)])
      )
      removedFolders.sort(
        (left, right) =>
          (depthOf.get(right.id) ?? 0) - (depthOf.get(left.id) ?? 0) ||
          compareOrder(left, right) ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      )
      for (const folder of removedFolders) {
        delete next.folders[folder.id]
        diffs.push({ type: 'folder.remove', id: folder.id })
      }
      diffs.push({ type: 'space.remove', id: space.id })

      if (next.activeSpaceId === space.id) {
        const fallback = sortByOrder(Object.values(next.spaces))[0]
        next.activeSpaceId = fallback ? fallback.id : ''
        const recent = fallback ? mostRecentTabInSpace(next, fallback.id) : null
        next.activeTabId = recent ? recent.id : null
      } else {
        const active = next.activeTabId === null ? undefined : own(next.tabs, next.activeTabId)
        if (!active || active.spaceId !== next.activeSpaceId) {
          const recent = mostRecentTabInSpace(next, next.activeSpaceId)
          const tabId = recent ? recent.id : null
          next.activeTabId = tabId
        }
      }
      break
    }

    case 'space.activate': {
      requireSpace(next, action.id)
      if (next.activeSpaceId !== action.id) {
        next.activeSpaceId = action.id
        const recent = mostRecentTabInSpace(next, action.id)
        next.activeTabId = recent ? recent.id : null
      }
      break
    }

    case 'tab.add': {
      const tab = action.tab
      assertSafeId(tab.id, 'tab.id')
      requireSpace(next, tab.spaceId)
      assertNonEmpty(tab.url, 'tab.url')
      assertNonEmpty(tab.order, 'tab.order')
      if (own(next.tabs, tab.id)) throw new DomainError(`Tab already exists: ${tab.id}`)
      if (tab.folderId !== undefined) {
        const folder = requireFolder(next, tab.folderId)
        if (folder.spaceId !== tab.spaceId) {
          throw new DomainError(`Folder ${folder.id} does not belong to space ${tab.spaceId}`)
        }
      }
      const stored: Tab = { ...tab }
      next.tabs[stored.id] = stored
      diffs.push({ type: 'tab.upsert', tab: stored })
      break
    }

    case 'tab.update': {
      const current = requireTab(next, action.id)
      const updated = applyTabPatch(current, action.patch)
      if (!shallowEqual(current, updated)) {
        next.tabs[updated.id] = updated
        diffs.push({ type: 'tab.upsert', tab: updated })
      }
      break
    }

    case 'tab.remove': {
      const tab = requireTab(next, action.id)
      const wasActive = next.activeTabId === tab.id
      delete next.tabs[tab.id]
      diffs.push({ type: 'tab.remove', id: tab.id })

      if (wasActive) {
        const folderId = tab.folderId ?? null
        const nextInFolder = getFolderTabs(next.tabs, tab.spaceId, folderId).find(
          (candidate) => candidate.order > tab.order
        )
        const replacement = nextInFolder ?? mostRecentTabInSpace(next, tab.spaceId)
        next.activeTabId = replacement ? replacement.id : null
      }
      break
    }

    case 'tab.activate': {
      const tab = requireTab(next, action.id)
      if (!Number.isFinite(action.at)) {
        throw new DomainError('tab.activate requires a finite timestamp')
      }
      const changed =
        tab.lastActive !== action.at ||
        next.activeSpaceId !== tab.spaceId ||
        next.activeTabId !== tab.id
      if (changed) {
        const updated: Tab = { ...tab, lastActive: action.at }
        next.tabs[updated.id] = updated
        next.activeSpaceId = tab.spaceId
        next.activeTabId = tab.id
        diffs.push({ type: 'tab.upsert', tab: updated })
      }
      break
    }

    case 'tab.pin': {
      const tab = requireTab(next, action.id)
      const pinnedUrl = tab.pinnedUrl ?? tab.url
      if (tab.pinned && tab.pinnedUrl === pinnedUrl) break
      const updated: Tab = { ...tab, pinned: true, pinnedUrl }
      next.tabs[updated.id] = updated
      diffs.push({ type: 'tab.upsert', tab: updated })
      break
    }

    case 'tab.unpin': {
      const tab = requireTab(next, action.id)
      if (!tab.pinned && tab.pinnedUrl === undefined) break
      const updated: Tab = { ...tab, pinned: false }
      delete updated.pinnedUrl
      next.tabs[updated.id] = updated
      diffs.push({ type: 'tab.upsert', tab: updated })
      break
    }

    case 'tab.resetToPinned': {
      const tab = requireTab(next, action.id)
      if (!tab.pinned || tab.pinnedUrl === undefined || tab.url === tab.pinnedUrl) break
      const updated: Tab = { ...tab, url: tab.pinnedUrl, sleeping: false }
      next.tabs[updated.id] = updated
      diffs.push({ type: 'tab.upsert', tab: updated })
      break
    }

    case 'tab.move': {
      const tab = requireTab(next, action.id)
      const destination = requireSpace(next, action.spaceId)
      assertNonEmpty(action.order, 'tab.order')
      if (action.folderId !== null) {
        const folder = requireFolder(next, action.folderId)
        if (folder.spaceId !== destination.id) {
          throw new DomainError(
            `Folder ${folder.id} does not belong to space ${destination.id}`
          )
        }
      }
      const currentFolder = tab.folderId ?? null
      if (
        tab.spaceId === destination.id &&
        currentFolder === action.folderId &&
        tab.order === action.order
      ) {
        break
      }
      const updated: Tab = { ...tab, spaceId: destination.id, order: action.order }
      if (action.folderId === null) delete updated.folderId
      else updated.folderId = action.folderId
      next.tabs[updated.id] = updated
      diffs.push({ type: 'tab.upsert', tab: updated })

      if (next.activeTabId === updated.id && next.activeSpaceId !== destination.id) {
        next.activeSpaceId = destination.id
      }
      break
    }

    case 'folder.add': {
      const folder = action.folder
      assertSafeId(folder.id, 'folder.id')
      assertNonEmpty(folder.name, 'folder.name')
      assertNonEmpty(folder.order, 'folder.order')
      requireSpace(next, folder.spaceId)
      if (own(next.folders, folder.id)) {
        throw new DomainError(`Folder already exists: ${folder.id}`)
      }
      if (folder.parentId !== undefined) {
        const parent = requireFolder(next, folder.parentId)
        if (parent.spaceId !== folder.spaceId) {
          throw new DomainError(
            `Parent folder ${parent.id} does not belong to space ${folder.spaceId}`
          )
        }
      }
      const stored: Folder = { ...folder }
      next.folders[stored.id] = stored
      diffs.push({ type: 'folder.upsert', folder: stored })
      break
    }

    case 'folder.update': {
      const current = requireFolder(next, action.id)
      const updated = applyFolderPatch(current, action.patch)
      if (!shallowEqual(current, updated)) {
        next.folders[updated.id] = updated
        diffs.push({ type: 'folder.upsert', folder: updated })
      }
      break
    }

    case 'folder.move': {
      const folder = requireFolder(next, action.id)
      assertNonEmpty(action.order, 'folder.order')
      if (action.parentId !== null) {
        const parent = requireFolder(next, action.parentId)
        if (parent.spaceId !== folder.spaceId) {
          throw new DomainError(`Cannot move folder across spaces: ${parent.id}`)
        }
        if (parent.id === folder.id) {
          throw new DomainError('Cannot move a folder into itself')
        }
        if (isFolderDescendant(next.folders, parent.id, folder.id)) {
          throw new DomainError('Cannot move a folder into one of its descendants')
        }
      }
      if ((folder.parentId ?? null) === action.parentId && folder.order === action.order) break
      const updated: Folder = { ...folder, order: action.order }
      if (action.parentId === null) delete updated.parentId
      else updated.parentId = action.parentId
      next.folders[updated.id] = updated
      diffs.push({ type: 'folder.upsert', folder: updated })
      break
    }

    case 'folder.remove': {
      const folder = requireFolder(next, action.id)
      const removedIds = new Set<string>([folder.id])
      let grew = true
      while (grew) {
        grew = false
        for (const candidate of Object.values(next.folders)) {
          if (removedIds.has(candidate.id)) continue
          if (candidate.parentId !== undefined && removedIds.has(candidate.parentId)) {
            removedIds.add(candidate.id)
            grew = true
          }
        }
      }

      const parentId = folder.parentId ?? null
      const promotion = parentId !== null && own(next.folders, parentId) ? parentId : null

      const survivors = sortByOrder(
        Object.values(next.tabs).filter(
          (candidate) =>
            candidate.spaceId === folder.spaceId &&
            (promotion === null
              ? candidate.folderId === undefined
              : candidate.folderId === promotion)
        )
      )
      let cursor = survivors.length > 0 ? survivors[survivors.length - 1]!.order : null

      const promotedTabs = Object.values(next.tabs)
        .filter(
          (candidate) =>
            candidate.folderId !== undefined && removedIds.has(candidate.folderId)
        )
        .sort(
          (left, right) =>
            compareOrder(left, right) ||
            (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
        )
      for (const tab of promotedTabs) {
        cursor = generateKeyBetween(cursor, null)
        const promoted: Tab = { ...tab, order: cursor }
        if (promotion === null) delete promoted.folderId
        else promoted.folderId = promotion
        next.tabs[promoted.id] = promoted
        diffs.push({ type: 'tab.upsert', tab: promoted })
      }

      const removedFolders = [...removedIds]
        .map((id) => next.folders[id])
        .filter((item): item is Folder => item !== undefined)
      const depthOf = new Map(
        removedFolders.map((item) => [item.id, folderDepth(next.folders, item.id)])
      )
      removedFolders.sort(
        (left, right) =>
          (depthOf.get(right.id) ?? 0) - (depthOf.get(left.id) ?? 0) ||
          compareOrder(left, right) ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      )
      for (const removed of removedFolders) {
        delete next.folders[removed.id]
        diffs.push({ type: 'folder.remove', id: removed.id })
      }
      break
    }

    case 'essential.add': {
      const essential = action.essential
      assertSafeId(essential.id, 'essential.id')
      assertNonEmpty(essential.url, 'essential.url')
      assertNonEmpty(essential.order, 'essential.order')
      if (own(next.essentials, essential.id)) {
        throw new DomainError(`Essential already exists: ${essential.id}`)
      }
      const stored: Essential = { ...essential }
      next.essentials[stored.id] = stored
      diffs.push({ type: 'essential.upsert', essential: stored })
      break
    }

    case 'essential.update': {
      const current = requireEssential(next, action.id)
      const patch: EssentialPatch = action.patch
      const updated: Essential = { ...current }
      if (patch.url !== undefined) {
        assertNonEmpty(patch.url, 'essential.url')
        updated.url = patch.url
      }
      if (patch.title !== undefined) updated.title = patch.title
      if (patch.favicon !== undefined) updated.favicon = patch.favicon
      if (patch.order !== undefined) {
        assertNonEmpty(patch.order, 'essential.order')
        updated.order = patch.order
      }
      if (!shallowEqual(current, updated)) {
        next.essentials[updated.id] = updated
        diffs.push({ type: 'essential.upsert', essential: updated })
      }
      break
    }

    case 'essential.remove': {
      const essential = requireEssential(next, action.id)
      delete next.essentials[essential.id]
      diffs.push({ type: 'essential.remove', id: essential.id })
      break
    }

    default: {
      const exhaustive: never = action
      throw new DomainError(`Unsupported action: ${JSON.stringify(exhaustive)}`)
    }
  }

  pushSessionDiffs(state, next, diffs)
  return finish(state, next, diffs)
}
