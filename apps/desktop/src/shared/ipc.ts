import type { BrowserSnapshot, DiffBatch, Tab } from '@ione/core'

/** IPC channel names. Keep in one place so main/preload cannot drift. */
export const IPC = {
  getSnapshot: 'ione:get-snapshot',
  diffs: 'ione:diffs',
  navigate: 'ione:navigate',
  createTab: 'ione:create-tab',
  closeTab: 'ione:close-tab',
  activateTab: 'ione:activate-tab',
  activateSpace: 'ione:activate-space'
} as const

export interface NavigateResult {
  tabId: string
  url: string
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
}
