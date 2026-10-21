import { randomUUID } from 'node:crypto'
import {
  activeTabOf,
  generateKeyBetween,
  getFolderChildren,
  getFolderTabs,
  isSafeNavigationUrl,
  keyBetweenSiblings,
  normalizeAddress,
  reduce,
  sortByOrder,
  type BrowserAction,
  type BrowserSnapshot,
  type Essential,
  type Folder,
  type Space,
  type StateDiff,
  type Tab,
  type TabPatch
} from '@ione/core'
import type {
  CreateEssentialInput,
  CreateFolderInput,
  CreateSpaceInput,
  MoveFolderInput,
  MoveTabInput,
  UpdateFolderInput,
  UpdateSpaceInput
} from '../shared/ipc'
import type { WriteBehindPersistence } from './persistence/write-behind'

export type DiffSink = (diffs: StateDiff[], fromVersion: number, toVersion: number) => void
export type CommitHook = (snapshot: BrowserSnapshot) => void

const MAX_TITLE_LENGTH = 1024
const MAX_URL_LENGTH = 8192
const MAX_FAVICON_LENGTH = 100_000

export interface NavigatePlan {
  tabId: string
  url: string
}

/**
 * Owns the main-process copy of browser state. Every mutation goes through the
 * pure core reducer, is persisted write-behind, and emits diffs for the chrome.
 */
export class BrowserController {
  private stateValue: BrowserSnapshot
  private readonly persistence: WriteBehindPersistence
  private readonly diffSink: DiffSink
  private commitHook: CommitHook | null = null

  constructor(
    initial: BrowserSnapshot,
    persistence: WriteBehindPersistence,
    diffSink: DiffSink,
    commitHook?: CommitHook
  ) {
    this.stateValue = initial
    this.persistence = persistence
    this.diffSink = diffSink
    this.commitHook = commitHook ?? null
  }

  get snapshot(): BrowserSnapshot {
    return this.stateValue
  }

  setCommitHook(hook: CommitHook | null): void {
    this.commitHook = hook
  }

  get activeTab(): Tab | null {
    return activeTabOf(this.stateValue)
  }

  /**
   * Resolves address-bar input and selects/creates the target tab. The returned
   * plan is executed by the window's tab manager; URL state is committed here
   * first so a newly created or sleeping view loads the right target.
   */
  prepareNavigation(input: string): NavigatePlan | null {
    const normalized = normalizeAddress(input)
    if (!normalized) return null
    if (!isSafeNavigationUrl(normalized.url)) {
      throw new Error(`Refusing to navigate to unsafe URL: ${normalized.url}`)
    }

    const current = this.activeTab
    if (!current) {
      const tab = this.createTab(normalized.url)
      return { tabId: tab.id, url: normalized.url }
    }

    this.updateTab(current.id, { url: normalized.url, sleeping: false })
    return { tabId: current.id, url: normalized.url }
  }

  createTab(input?: string): Tab {
    return this.createTabInFolder(null, input)
  }

  /**
   * Creates a tab at the end of `folderId` (null = active space root).
   * Collapsed target folders are expanded first so the new tab is visible.
   */
  createTabInFolder(folderId: string | null, input?: string): Tab {
    const folder = folderId === null ? null : this.requireFolder(folderId)
    const spaceId = folder ? folder.spaceId : this.stateValue.activeSpaceId
    if (folder?.collapsed) {
      this.dispatch({ type: 'folder.update', id: folder.id, patch: { collapsed: false } })
    }

    const normalized = normalizeAddress(input ?? '')
    const url =
      normalized &&
      normalized.url.length <= MAX_URL_LENGTH &&
      isSafeNavigationUrl(normalized.url)
        ? normalized.url
        : 'about:blank'
    const siblings = getFolderTabs(this.stateValue.tabs, spaceId, folderId)
    const now = Date.now()
    const tab: Tab = {
      id: randomUUID(),
      spaceId,
      url,
      title: '',
      favicon: '',
      pinned: false,
      lastActive: now,
      scrollY: 0,
      sleeping: false,
      order: keyBetweenSiblings(siblings, null)
    }
    if (folderId !== null) tab.folderId = folderId

    this.dispatch({ type: 'tab.add', tab })
    this.dispatch({ type: 'tab.activate', id: tab.id, at: now })
    return this.stateValue.tabs[tab.id] ?? tab
  }

  createFolder(input: CreateFolderInput): Folder {
    this.requireSpace(input.spaceId)
    const parentId = input.parentId ?? null
    if (parentId !== null) {
      const parent = this.requireFolder(parentId)
      if (parent.spaceId !== input.spaceId) {
        throw new Error(
          `Parent folder ${parent.id} does not belong to space ${input.spaceId}`
        )
      }
    }

    const siblings = getFolderChildren(this.stateValue.folders, input.spaceId, parentId)
    const folder: Folder = {
      id: randomUUID(),
      spaceId: input.spaceId,
      name: input.name.trim(),
      collapsed: false,
      kind: input.kind ?? 'normal',
      order: keyBetweenSiblings(siblings, null)
    }
    if (parentId !== null) folder.parentId = parentId

    this.dispatch({ type: 'folder.add', folder })
    return this.stateValue.folders[folder.id] ?? folder
  }

  updateFolder(id: string, patch: UpdateFolderInput): void {
    this.dispatch({ type: 'folder.update', id, patch })
  }

  removeFolder(id: string): void {
    this.dispatch({ type: 'folder.remove', id })
  }

  moveFolder(id: string, target: MoveFolderInput): void {
    const folder = this.requireFolder(id)
    const parentId = target.parentId
    if (parentId !== null) {
      const parent = this.requireFolder(parentId)
      if (parent.spaceId !== folder.spaceId) {
        throw new Error(`Cannot move folder ${id} across spaces (parent ${parent.id})`)
      }
    }

    const siblings = getFolderChildren(this.stateValue.folders, folder.spaceId, parentId)
    const order = keyBetweenSiblings(siblings, target.beforeFolderId ?? null, id)
    this.dispatch({ type: 'folder.move', id, parentId, order })
  }

  moveTab(id: string, target: MoveTabInput): void {
    if (!Object.hasOwn(this.stateValue.tabs, id)) {
      throw new Error(`Tab not found: ${id}`)
    }
    this.requireSpace(target.spaceId)
    const folderId = target.folderId
    if (folderId !== null) {
      const folder = this.requireFolder(folderId)
      if (folder.spaceId !== target.spaceId) {
        throw new Error(`Folder ${folder.id} does not belong to space ${target.spaceId}`)
      }
      if (folder.collapsed) {
        this.dispatch({ type: 'folder.update', id: folder.id, patch: { collapsed: false } })
      }
    }

    const siblings = getFolderTabs(this.stateValue.tabs, target.spaceId, folderId)
    const order = keyBetweenSiblings(siblings, target.beforeTabId ?? null, id)
    this.dispatch({ type: 'tab.move', id, spaceId: target.spaceId, folderId, order })
  }

  closeTab(tabId: string): void {
    this.dispatch({ type: 'tab.remove', id: tabId })
  }

  activateTab(tabId: string): void {
    this.dispatch({ type: 'tab.activate', id: tabId, at: Date.now() })
  }

  activateSpace(spaceId: string): void {
    this.dispatch({ type: 'space.activate', id: spaceId })
  }

  createSpace(input: CreateSpaceInput): Space {
    const last = sortByOrder(Object.values(this.stateValue.spaces)).at(-1)
    const space: Space = {
      id: randomUUID(),
      name: input.name.trim(),
      icon: input.icon.trim(),
      theme: input.theme.trim(),
      order: generateKeyBetween(last?.order ?? null, null)
    }
    const partitionId = input.partitionId?.trim()
    if (partitionId) space.partitionId = partitionId

    this.dispatch({ type: 'space.add', space })
    this.dispatch({ type: 'space.activate', id: space.id })
    return this.stateValue.spaces[space.id] ?? space
  }

  updateSpace(id: string, patch: UpdateSpaceInput): void {
    this.dispatch({ type: 'space.update', id, patch })
  }

  removeSpace(id: string): void {
    this.dispatch({ type: 'space.remove', id })
  }

  addEssential(input: CreateEssentialInput): Essential {
    const normalized = normalizeAddress(input.url)
    if (
      !normalized ||
      normalized.kind !== 'url' ||
      normalized.url === 'about:blank' ||
      !isSafeNavigationUrl(normalized.url)
    ) {
      throw new Error(`Refusing to add an unsafe essential URL: ${input.url}`)
    }

    let hostname = ''
    try {
      hostname = new URL(normalized.url).hostname.replace(/^www\./, '')
    } catch {
      hostname = ''
    }
    const title = input.title?.trim() || hostname || normalized.url

    const last = sortByOrder(Object.values(this.stateValue.essentials)).at(-1)
    const essential: Essential = {
      id: randomUUID(),
      url: normalized.url,
      title,
      favicon: '',
      order: generateKeyBetween(last?.order ?? null, null)
    }

    this.dispatch({ type: 'essential.add', essential })
    return this.stateValue.essentials[essential.id] ?? essential
  }

  removeEssential(id: string): void {
    this.dispatch({ type: 'essential.remove', id })
  }

  pinTab(tabId: string): void {
    this.dispatch({ type: 'tab.pin', id: tabId })
  }

  unpinTab(tabId: string): void {
    this.dispatch({ type: 'tab.unpin', id: tabId })
  }

  /**
   * Restores a pinned tab's URL in state and returns the navigation plan for
   * the window to execute. Returns null when the tab is not resettable.
   */
  resetPinnedTab(tabId: string): NavigatePlan | null {
    if (!Object.hasOwn(this.stateValue.tabs, tabId)) return null
    const tab = this.stateValue.tabs[tabId]
    if (!tab || !tab.pinned || tab.pinnedUrl === undefined) return null

    const plan = { tabId, url: tab.pinnedUrl }
    this.dispatch({ type: 'tab.resetToPinned', id: tabId })
    return plan
  }

  /**
   * Deduplicates page events before they reach the reducer. Title/URL events
   * fire often and must not churn versions or SQLite.
   */
  updateTab(tabId: string, patch: TabPatch): boolean {
    if (!Object.hasOwn(this.stateValue.tabs, tabId)) return false
    const tab = this.stateValue.tabs[tabId]
    if (!tab) return false

    const next: TabPatch = {}
    let changed = false

    if (
      patch.url !== undefined &&
      patch.url !== tab.url &&
      patch.url.length <= MAX_URL_LENGTH &&
      isSafeNavigationUrl(patch.url)
    ) {
      next.url = patch.url
      changed = true
    }
    if (patch.title !== undefined) {
      const title = patch.title.slice(0, MAX_TITLE_LENGTH)
      if (title !== tab.title) {
        next.title = title
        changed = true
      }
    }
    if (patch.favicon !== undefined) {
      const favicon = patch.favicon.slice(0, MAX_FAVICON_LENGTH)
      if (favicon !== tab.favicon) {
        next.favicon = favicon
        changed = true
      }
    }
    if (patch.pinnedUrl !== undefined && (patch.pinnedUrl ?? undefined) !== tab.pinnedUrl) {
      next.pinnedUrl = patch.pinnedUrl
      changed = true
    }
    if (patch.lastActive !== undefined && patch.lastActive !== tab.lastActive) {
      next.lastActive = patch.lastActive
      changed = true
    }
    if (patch.scrollY !== undefined && patch.scrollY !== tab.scrollY) {
      next.scrollY = patch.scrollY
      changed = true
    }
    if (patch.sleeping !== undefined && patch.sleeping !== tab.sleeping) {
      next.sleeping = patch.sleeping
      changed = true
    }
    if (patch.order !== undefined && patch.order !== tab.order) {
      next.order = patch.order
      changed = true
    }

    if (!changed) return false
    this.dispatch({ type: 'tab.update', id: tabId, patch: next })
    return true
  }

  dispose(): void {
    this.persistence.dispose()
  }

  private requireSpace(id: string): Space {
    if (!Object.hasOwn(this.stateValue.spaces, id)) {
      throw new Error(`Space not found: ${id}`)
    }
    const space = this.stateValue.spaces[id]
    if (!space) throw new Error(`Space not found: ${id}`)
    return space
  }

  private requireFolder(id: string): Folder {
    if (!Object.hasOwn(this.stateValue.folders, id)) {
      throw new Error(`Folder not found: ${id}`)
    }
    const folder = this.stateValue.folders[id]
    if (!folder) throw new Error(`Folder not found: ${id}`)
    return folder
  }

  private dispatch(action: BrowserAction): BrowserSnapshot {
    const previous = this.stateValue
    const result = reduce(previous, action)
    if (result.diffs.length === 0) return previous

    this.stateValue = result.state
    this.persistence.enqueue(result.diffs, result.state)
    this.diffSink(result.diffs, previous.version, result.state.version)
    this.commitHook?.(result.state)
    return result.state
  }
}
