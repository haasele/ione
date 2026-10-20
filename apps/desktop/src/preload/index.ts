import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { BrowserSnapshot, DiffBatch, Essential, Space, Tab } from '@ione/core'
import {
  IPC,
  type CreateEssentialInput,
  type CreateSpaceInput,
  type DesktopApi,
  type NavigateResult,
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
    ipcRenderer.invoke(IPC.resetPinnedTab, tabId)
}

contextBridge.exposeInMainWorld('ione', api)
