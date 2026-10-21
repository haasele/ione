/**
 * Snapshot repair. Used when loading persisted state so the reducer can assume
 * a normalized tree: every entity belongs to a known space, folder parents are
 * acyclic, and the active selection points at live entities.
 */

import { cloneSnapshot } from './diff'
import type { BrowserSnapshot, FeedItem, FeedState, Folder, Tab } from './model'
import { activeTabOf, mostRecentTabInSpace, sortByOrder } from './model'

const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function own<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined
}

function normalizeVersion(version: number): number {
  const floored = Math.floor(Number(version))
  return Number.isFinite(floored) && floored > 0 ? floored : 0
}

export function normalizeSnapshot(input: BrowserSnapshot): BrowserSnapshot {
  const spaces = { ...input.spaces }
  const essentials = { ...input.essentials }

  const folders: Record<string, Folder> = {}
  for (const folder of Object.values(input.folders)) {
    if (RESERVED_OBJECT_KEYS.has(folder.id)) continue
    if (!own(spaces, folder.spaceId)) continue
    folders[folder.id] = { ...folder }
  }

  // Drop missing, foreign and self-referential parents.
  for (const folder of Object.values(folders)) {
    const parentId = folder.parentId
    if (parentId === undefined) continue
    const parent = own(folders, parentId)
    if (!parent || parent.spaceId !== folder.spaceId || parent.id === folder.id) {
      delete folder.parentId
    }
  }

  // Break cycles by reparenting the folder that closes the loop to the root.
  for (const folder of Object.values(folders)) {
    const seen = new Set<string>([folder.id])
    let cursor = folder
    while (cursor.parentId !== undefined) {
      const parentId = cursor.parentId
      const parent = own(folders, parentId)
      if (!parent) {
        delete cursor.parentId
        break
      }
      if (seen.has(parentId)) {
        delete cursor.parentId
        break
      }
      seen.add(parentId)
      cursor = parent
    }
  }

  const tabs: Record<string, Tab> = {}
  for (const tab of Object.values(input.tabs)) {
    if (RESERVED_OBJECT_KEYS.has(tab.id)) continue
    if (!own(spaces, tab.spaceId)) continue
    tabs[tab.id] = { ...tab }
  }

  const feedItems: Record<string, FeedItem> = {}
  for (const item of Object.values(input.feedItems ?? {})) {
    if (RESERVED_OBJECT_KEYS.has(item.id)) continue
    const folder = own(folders, item.folderId)
    if (!folder || folder.kind !== 'rss') continue
    feedItems[item.id] = { ...item }
  }

  const feedStates: Record<string, FeedState> = {}
  for (const state of Object.values(input.feedStates ?? {})) {
    const folder = own(folders, state.folderId)
    if (!folder || folder.kind !== 'rss') continue
    feedStates[state.folderId] = { ...state }
  }

  const normalized: BrowserSnapshot = {
    version: normalizeVersion(input.version),
    spaces,
    essentials,
    folders,
    tabs,
    feedItems,
    feedStates,
    activeSpaceId: '',
    activeTabId: null
  }

  const requestedSpace = own(spaces, input.activeSpaceId)
  const fallbackSpace = sortByOrder(Object.values(spaces))[0]
  normalized.activeSpaceId = requestedSpace
    ? requestedSpace.id
    : fallbackSpace
      ? fallbackSpace.id
      : ''

  if (normalized.activeSpaceId !== '') {
    const candidate =
      input.activeTabId === null ? undefined : own(tabs, input.activeTabId)
    if (candidate && candidate.spaceId === normalized.activeSpaceId) {
      normalized.activeTabId = candidate.id
    } else {
      const recent = mostRecentTabInSpace(normalized, normalized.activeSpaceId)
      normalized.activeTabId = recent ? recent.id : null
    }
  }

  return normalized
}

/**
 * Prepares a persisted snapshot for lazy restore: every tab is marked
 * sleeping except the valid active tab of the active space, which keeps a
 * live view. Version and all other data are preserved; the input is untouched.
 */
export function prepareLazyRestore(input: BrowserSnapshot): BrowserSnapshot {
  const snapshot = cloneSnapshot(input)
  const activeId = activeTabOf(input)?.id ?? null
  const tabs: Record<string, Tab> = {}
  for (const tab of Object.values(snapshot.tabs)) {
    tabs[tab.id] = { ...tab, sleeping: tab.id !== activeId }
  }
  snapshot.tabs = tabs
  return snapshot
}
