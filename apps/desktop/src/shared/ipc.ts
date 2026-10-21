import type {
  BrowserSnapshot,
  DiffBatch,
  Essential,
  Folder,
  FolderKind,
  Space,
  Tab
} from '@ione/core'

/** IPC channel names. Keep in one place so main/preload cannot drift. */
export const IPC = {
  getSnapshot: 'ione:get-snapshot',
  diffs: 'ione:diffs',
  navigate: 'ione:navigate',
  createTab: 'ione:create-tab',
  closeTab: 'ione:close-tab',
  activateTab: 'ione:activate-tab',
  activateSpace: 'ione:activate-space',
  createSpace: 'ione:create-space',
  updateSpace: 'ione:update-space',
  removeSpace: 'ione:remove-space',
  addEssential: 'ione:add-essential',
  removeEssential: 'ione:remove-essential',
  pinTab: 'ione:pin-tab',
  unpinTab: 'ione:unpin-tab',
  resetPinnedTab: 'ione:reset-pinned-tab',
  createTabInFolder: 'ione:create-tab-in-folder',
  createFolder: 'ione:create-folder',
  updateFolder: 'ione:update-folder',
  removeFolder: 'ione:remove-folder',
  moveFolder: 'ione:move-folder',
  moveTab: 'ione:move-tab',
  listExtensions: 'ione:list-extensions',
  installExtension: 'ione:install-extension',
  uninstallExtension: 'ione:uninstall-extension',
  getAdblockState: 'ione:get-adblock-state',
  setAdblockEnabled: 'ione:set-adblock-enabled'
} as const

export interface NavigateResult {
  tabId: string
  url: string
}

export interface CreateSpaceInput {
  name: string
  icon: string
  theme: string
  /** Optional isolated login session. Stored without the persist: prefix. */
  partitionId?: string
}

export interface UpdateSpaceInput {
  name?: string
  icon?: string
  theme?: string
}

export interface CreateEssentialInput {
  url: string
  title?: string
}

export interface CreateFolderInput {
  spaceId: string
  parentId?: string | null
  name: string
  kind?: FolderKind
}

export interface UpdateFolderInput {
  name?: string
  collapsed?: boolean
}

export interface MoveFolderInput {
  parentId: string | null
  beforeFolderId?: string | null
}

export interface MoveTabInput {
  spaceId: string
  folderId: string | null
  beforeTabId?: string | null
}

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  manifestVersion: number
  popupUrl: string | null
  optionsUrl: string | null
  hasWebRequestBlocking: boolean
}

export interface AdblockState {
  enabled: boolean
  ready: boolean
  skippedForExtension: boolean
  error: string | null
}

/**
 * Typed contextBridge surface exposed as `window.ione`.
 * Types only cross the bridge; no Node objects are exposed.
 */
export interface DesktopApi {
  getSnapshot(): Promise<BrowserSnapshot>
  /** Subscribes to versioned diff batches. Returns an unsubscribe function. */
  onDiffs(listener: (batch: DiffBatch) => void): () => void
  navigate(input: string): Promise<NavigateResult | null>
  createTab(input?: string): Promise<Tab>
  closeTab(tabId: string): Promise<void>
  activateTab(tabId: string): Promise<void>
  activateSpace(spaceId: string): Promise<void>
  createSpace(input: CreateSpaceInput): Promise<Space>
  updateSpace(spaceId: string, patch: UpdateSpaceInput): Promise<void>
  removeSpace(spaceId: string): Promise<void>
  addEssential(input: CreateEssentialInput): Promise<Essential>
  removeEssential(essentialId: string): Promise<void>
  pinTab(tabId: string): Promise<void>
  unpinTab(tabId: string): Promise<void>
  /** Returns null when the tab is not pinned or has no pinned URL. */
  resetPinnedTab(tabId: string): Promise<NavigateResult | null>
  createTabInFolder(folderId: string | null, input?: string): Promise<Tab>
  createFolder(input: CreateFolderInput): Promise<Folder>
  updateFolder(folderId: string, patch: UpdateFolderInput): Promise<void>
  removeFolder(folderId: string): Promise<void>
  moveFolder(folderId: string, target: MoveFolderInput): Promise<void>
  moveTab(tabId: string, target: MoveTabInput): Promise<void>
  listExtensions(): Promise<ExtensionInfo[]>
  installExtension(extensionId: string): Promise<ExtensionInfo>
  uninstallExtension(extensionId: string): Promise<void>
  getAdblockState(): Promise<AdblockState>
  setAdblockEnabled(enabled: boolean): Promise<AdblockState>
}
