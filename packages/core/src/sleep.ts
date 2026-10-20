/**
 * Pure tab-sleep policy shared by the main process and the renderer.
 * No framework or Electron imports are allowed here.
 */

import type { Tab } from './model'

export interface SleepPolicyArgs {
  tab: Tab
  /** The tab is the active tab of the active space. */
  isActive: boolean
  /** A live WebContents (view) exists for the tab. */
  hasView: boolean
  /** The tab is currently playing audio. */
  audible: boolean
  /** DevTools are attached to the tab. */
  devToolsOpen: boolean
}

/**
 * Decides whether an inactive tab may be put to sleep.
 *
 * Every guard returns false: sleeping tabs are left alone, and active, pinned,
 * viewless (already effectively asleep), audible and debugged tabs are kept
 * alive. A tab sleeps only once it has been inactive for strictly longer than
 * `timeoutMs`; exactly at the boundary it stays awake.
 */
export function shouldSleepTab(
  args: SleepPolicyArgs,
  now: number,
  timeoutMs: number
): boolean {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(`timeoutMs must be a finite non-negative number: ${timeoutMs}`)
  }

  const { tab, isActive, hasView, audible, devToolsOpen } = args
  if (tab.sleeping) return false
  if (isActive) return false
  if (tab.pinned) return false
  if (!hasView) return false
  if (audible) return false
  if (devToolsOpen) return false
  return now - tab.lastActive > timeoutMs
}
