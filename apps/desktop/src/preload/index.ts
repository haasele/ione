import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { BrowserSnapshot, DiffBatch, Tab } from '@ione/core'
import { IPC, type DesktopApi, type NavigateResult } from '../shared/ipc'

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
  activateSpace: (spaceId: string): Promise<void> => ipcRenderer.invoke(IPC.activateSpace, spaceId)
}

contextBridge.exposeInMainWorld('ione', api)
