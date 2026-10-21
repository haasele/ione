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
  refreshFeed: 'ione:refresh-feed',
  markFeedRead: 'ione:mark-feed-read',
  listExtensions: 'ione:list-extensions',
  installExtension: 'ione:install-extension',
  uninstallExtension: 'ione:uninstall-extension',
  getAdblockState: 'ione:get-adblock-state',
  setAdblockEnabled: 'ione:set-adblock-enabled',
  navigateBack: 'ione:navigate-back',
  navigateForward: 'ione:navigate-forward',
  reloadTab: 'ione:reload-tab',
  stopLoading: 'ione:stop-loading',
  findInPage: 'ione:find-in-page',
  stopFindInPage: 'ione:stop-find-in-page',
  setSidebarWidth: 'ione:set-sidebar-width',
  listDownloads: 'ione:list-downloads',
  cancelDownload: 'ione:cancel-download',
  openDownload: 'ione:open-download',
  showDownload: 'ione:show-download',
  downloadsChanged: 'ione:downloads-changed',
  permissionRequest: 'ione:permission-request',
  respondPermission: 'ione:respond-permission'
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
  feedUrl?: string
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

export interface FindResult {
  matches: number
  activeMatch: number
}

export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadInfo {
  id: string
  filename: string
  url: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  savePath: string
  startedAt: number
}

export interface PermissionRequestInfo {
  id: string
  permission: string
  origin: string
  tabId: string | null
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
  refreshFeed(folderId: string): Promise<void>
  markFeedRead(itemId: string): Promise<void>
  listExtensions(): Promise<ExtensionInfo[]>
  installExtension(extensionId: string): Promise<ExtensionInfo>
  uninstallExtension(extensionId: string): Promise<void>
  getAdblockState(): Promise<AdblockState>
  setAdblockEnabled(enabled: boolean): Promise<AdblockState>
  navigateBack(): Promise<void>
  navigateForward(): Promise<void>
  reloadTab(): Promise<void>
  stopLoading(): Promise<void>
  findInPage(query: string, forward?: boolean): Promise<FindResult | null>
  stopFindInPage(): Promise<void>
  setSidebarWidth(width: number): Promise<void>
  listDownloads(): Promise<DownloadInfo[]>
  onDownloads(listener: (downloads: DownloadInfo[]) => void): () => void
  cancelDownload(id: string): Promise<void>
  openDownload(id: string): Promise<void>
  showDownloadInFolder(id: string): Promise<void>
  onPermissionRequest(listener: (request: PermissionRequestInfo) => void): () => void
  respondPermission(requestId: string, allow: boolean): Promise<void>
}
