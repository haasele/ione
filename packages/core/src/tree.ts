/**
 * Read-only helpers for navigating the folder tree. All returned lists are
 * sorted by fractional index. Missing or foreign parents are treated as
 * non-existent so a corrupt snapshot cannot produce a foreign folder list.
 */

import { generateKeyBetween } from './fractional-index'
import { sortByOrder } from './model'
import type { Folder, Ordered, Tab } from './model'

function normalizeParent(parentId: string | null | undefined): string | null {
  return parentId === undefined || parentId === null || parentId === '' ? null : parentId
}

/** Direct child folders of `parentId` (null = root) inside `spaceId`. */
export function getFolderChildren(
  folders: Record<string, Folder>,
  spaceId: string,
  parentId: string | null
): Folder[] {
  const parent = normalizeParent(parentId)
  if (parent !== null) {
    const owner = folders[parent]
    if (!owner || owner.spaceId !== spaceId) return []
  }
  return sortByOrder(
    Object.values(folders).filter(
      (folder) => folder.spaceId === spaceId && normalizeParent(folder.parentId) === parent
    )
  )
}

/** Tabs directly inside `folderId` (null = space root) inside `spaceId`. */
export function getFolderTabs(
  tabs: Record<string, Tab>,
  spaceId: string,
  folderId: string | null
): Tab[] {
  const folder = normalizeParent(folderId)
  return sortByOrder(
    Object.values(tabs).filter(
      (tab) => tab.spaceId === spaceId && normalizeParent(tab.folderId) === folder
    )
  )
}

/** Tabs that share `folderId` inside `spaceId`; alias of getFolderTabs. */
export function getTabSiblings(
  tabs: Record<string, Tab>,
  spaceId: string,
  folderId: string | null
): Tab[] {
  return getFolderTabs(tabs, spaceId, folderId)
}

/** Ordered folder siblings of `parentId` inside `spaceId`. */
export function getOrderedSiblings(
  folders: Record<string, Folder>,
  spaceId: string,
  parentId: string | null
): Folder[] {
  return getFolderChildren(folders, spaceId, parentId)
}

/**
 * True when `folderId` sits somewhere below `ancestorId`.
 * A folder is not its own descendant. Cycles terminate safely.
 */
export function isFolderDescendant(
  folders: Record<string, Folder>,
  folderId: string,
  ancestorId: string
): boolean {
  if (folderId === ancestorId) return false
  const seen = new Set<string>([folderId])
  let cursor = folders[folderId]
  while (cursor) {
    const parentId = normalizeParent(cursor.parentId)
    if (parentId === null) return false
    if (parentId === ancestorId) return true
    if (seen.has(parentId)) return false
    seen.add(parentId)
    cursor = folders[parentId]
  }
  return false
}

/**
 * Path from the root folder down to `folderId`, inclusive.
 * Missing folders yield an empty path; cycles stop at the first repeat.
 */
export function getFolderPath(folders: Record<string, Folder>, folderId: string): Folder[] {
  const path: Folder[] = []
  const seen = new Set<string>()
  let cursor = folders[folderId]
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    path.push(cursor)
    const parentId = normalizeParent(cursor.parentId)
    cursor = parentId === null ? undefined : folders[parentId]
  }
  return path.reverse()
}

function orderedId(item: unknown): string | undefined {
  if (typeof item !== 'object' || item === null || !('id' in item)) return undefined
  const id = item.id
  return typeof id === 'string' ? id : undefined
}

/**
 * Generates a fractional key for a new sibling inserted before `beforeId`.
 * `excludeId` removes the item being moved/re-keyed from the calculation.
 * Missing or null `beforeId` appends after the last remaining sibling.
 * The input list is never mutated.
 */
export function keyBetweenSiblings<T extends Ordered>(
  siblings: readonly T[],
  beforeId: string | null,
  excludeId?: string
): string {
  const ordered = sortByOrder(
    excludeId === undefined
      ? siblings
      : siblings.filter((sibling) => orderedId(sibling) !== excludeId)
  )
  const targetIndex =
    beforeId === null
      ? -1
      : ordered.findIndex((sibling) => orderedId(sibling) === beforeId)

  if (targetIndex === -1) {
    const last = ordered[ordered.length - 1]
    return generateKeyBetween(last ? last.order : null, null)
  }

  const upper = ordered[targetIndex]!.order
  const lower = targetIndex > 0 ? ordered[targetIndex - 1]!.order : null
  return generateKeyBetween(lower, upper)
}
