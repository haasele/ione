import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { BrowserSnapshot, DiffBatch, Essential, Folder, Space, Tab } from '@ione/core'
import {
  IPC,
  type CreateEssentialInput,
  type CreateFolderInput,
  type CreateSpaceInput,
  type DesktopApi,
  type AdblockState,
  type DownloadInfo,
  type ExtensionInfo,
  type FindResult,
  type PermissionRequestInfo,
  type MoveFolderInput,
  type MoveTabInput,
  type NavigateResult,
  type UpdateFolderInput,
  type UpdateSpaceInput
} from '../shared/ipc'

const api: DesktopApi = {
  getSnapshot: (): Promise<BrowserSnapshot> => ipcRenderer.invoke(IPC.getSnapshot),
  onDiffs: (listener: (batch: DiffBatch) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, batch: DiffBatch): void => listener(batch)
    ipcRenderer.on(IPC.diffs, wrapped)
    return () => ipcRenderer.removeListener(IPC.diffs, wrapped)
  },
  navigate: (input: string): Promise<NavigateResult | null> => ipcRenderer.invoke(IPC.navigate, input),
  createTab: (input?: string): Promise<Tab> => ipcRenderer.invoke(IPC.createTab, input),
  closeTab: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.closeTab, tabId),
  activateTab: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.activateTab, tabId),
  activateSpace: (spaceId: string): Promise<void> => ipcRenderer.invoke(IPC.activateSpace, spaceId),
  createSpace: (input: CreateSpaceInput): Promise<Space> =>
    ipcRenderer.invoke(IPC.createSpace, input),
  updateSpace: (spaceId: string, patch: UpdateSpaceInput): Promise<void> =>
    ipcRenderer.invoke(IPC.updateSpace, spaceId, patch),
  removeSpace: (spaceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.removeSpace, spaceId),
  addEssential: (input: CreateEssentialInput): Promise<Essential> =>
    ipcRenderer.invoke(IPC.addEssential, input),
  removeEssential: (essentialId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.removeEssential, essentialId),
  pinTab: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.pinTab, tabId),
  unpinTab: (tabId: string): Promise<void> => ipcRenderer.invoke(IPC.unpinTab, tabId),
  resetPinnedTab: (tabId: string): Promise<NavigateResult | null> =>
    ipcRenderer.invoke(IPC.resetPinnedTab, tabId),
  refreshFeed: (folderId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.refreshFeed, folderId),
  markFeedRead: (itemId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.markFeedRead, itemId),
  listExtensions: (): Promise<ExtensionInfo[]> => ipcRenderer.invoke(IPC.listExtensions),
  installExtension: (extensionId: string): Promise<ExtensionInfo> =>
    ipcRenderer.invoke(IPC.installExtension, extensionId),
  uninstallExtension: (extensionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.uninstallExtension, extensionId),
  getAdblockState: (): Promise<AdblockState> => ipcRenderer.invoke(IPC.getAdblockState),
  setAdblockEnabled: (enabled: boolean): Promise<AdblockState> =>
    ipcRenderer.invoke(IPC.setAdblockEnabled, enabled),
  navigateBack: (): Promise<void> => ipcRenderer.invoke(IPC.navigateBack),
  navigateForward: (): Promise<void> => ipcRenderer.invoke(IPC.navigateForward),
  reloadTab: (): Promise<void> => ipcRenderer.invoke(IPC.reloadTab),
  stopLoading: (): Promise<void> => ipcRenderer.invoke(IPC.stopLoading),
  findInPage: (query: string, forward?: boolean): Promise<FindResult | null> =>
    ipcRenderer.invoke(IPC.findInPage, query, forward),
  stopFindInPage: (): Promise<void> => ipcRenderer.invoke(IPC.stopFindInPage),
  setSidebarWidth: (width: number): Promise<void> =>
    ipcRenderer.invoke(IPC.setSidebarWidth, width),
  listDownloads: (): Promise<DownloadInfo[]> => ipcRenderer.invoke(IPC.listDownloads),
  onDownloads: (listener: (downloads: DownloadInfo[]) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, downloads: DownloadInfo[]): void =>
      listener(downloads)
    ipcRenderer.on(IPC.downloadsChanged, wrapped)
    return () => ipcRenderer.removeListener(IPC.downloadsChanged, wrapped)
  },
  cancelDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.cancelDownload, id),
  openDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.openDownload, id),
  showDownloadInFolder: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.showDownload, id),
  onPermissionRequest: (
    listener: (request: PermissionRequestInfo) => void
  ): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, request: PermissionRequestInfo): void =>
      listener(request)
    ipcRenderer.on(IPC.permissionRequest, wrapped)
    return () => ipcRenderer.removeListener(IPC.permissionRequest, wrapped)
  },
  respondPermission: (requestId: string, allow: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.respondPermission, requestId, allow),
  createTabInFolder: (folderId: string | null, input?: string): Promise<Tab> =>
    ipcRenderer.invoke(IPC.createTabInFolder, folderId, input),
  createFolder: (input: CreateFolderInput): Promise<Folder> =>
    ipcRenderer.invoke(IPC.createFolder, input),
  updateFolder: (folderId: string, patch: UpdateFolderInput): Promise<void> =>
    ipcRenderer.invoke(IPC.updateFolder, folderId, patch),
  removeFolder: (folderId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.removeFolder, folderId),
  moveFolder: (folderId: string, target: MoveFolderInput): Promise<void> =>
    ipcRenderer.invoke(IPC.moveFolder, folderId, target),
  moveTab: (tabId: string, target: MoveTabInput): Promise<void> =>
    ipcRenderer.invoke(IPC.moveTab, tabId, target)
}

contextBridge.exposeInMainWorld('ione', api)
