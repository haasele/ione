import {
  activeTabOf,
  shouldSleepTab,
  type BrowserSnapshot,
  type TabPatch
} from '@ione/core'

export const DEFAULT_SLEEP_AFTER_MS = 12 * 60_000
export const DEFAULT_TICK_MS = 60_000

/** The slice of BrowserController the sleep manager needs. */
export interface SleepController {
  readonly snapshot: BrowserSnapshot
  updateTab(tabId: string, patch: TabPatch): boolean
}

/** The slice of TabViewManager the sleep manager needs. */
export interface SleepTabViews {
  hasView(tabId: string): boolean
  isAudible(tabId: string): boolean
  isDevToolsOpen(tabId: string): boolean
  captureScroll(tabId: string): Promise<number | null>
}

export interface TabSleepManagerOptions {
  controller: SleepController
  tabViews: SleepTabViews
  /** Inactivity window before a tab is eligible to sleep. */
  sleepAfterMs?: number
  /** How often the policy is evaluated. */
  tickMs?: number
  now?: () => number
}

export interface TabSleepEnvironment {
  sleepAfterMs: number
  tickMs: number
}

function finiteNonNegative(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Reads IONE_TAB_SLEEP_MS / IONE_TAB_SLEEP_TICK_MS. Missing, malformed or
 * negative values fall back to the defaults.
 */
export function parseTabSleepEnv(env: NodeJS.ProcessEnv = process.env): TabSleepEnvironment {
  return {
    sleepAfterMs: finiteNonNegative(env['IONE_TAB_SLEEP_MS']) ?? DEFAULT_SLEEP_AFTER_MS,
    tickMs: finiteNonNegative(env['IONE_TAB_SLEEP_TICK_MS']) ?? DEFAULT_TICK_MS
  }
}

/**
 * Periodically puts idle background tabs to sleep. The manager is deliberately
 * free of Electron imports so the policy loop can be unit tested with fakes.
 */
export class TabSleepManager {
  private readonly controller: SleepController
  private readonly tabViews: SleepTabViews
  private readonly sleepAfterMs: number
  private readonly tickMs: number
  private readonly now: () => number
  private timer: NodeJS.Timeout | null = null
  private checking = false

  constructor(options: TabSleepManagerOptions) {
    this.controller = options.controller
    this.tabViews = options.tabViews
    this.sleepAfterMs = options.sleepAfterMs ?? DEFAULT_SLEEP_AFTER_MS
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS
    this.now = options.now ?? Date.now
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      void this.checkNow()
    }, this.tickMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async checkNow(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const snapshot = this.controller.snapshot
      const activeId = activeTabOf(snapshot)?.id ?? null

      for (const tab of Object.values(snapshot.tabs)) {
        const hasView = this.tabViews.hasView(tab.id)
        if (
          !shouldSleepTab(
            {
              tab,
              isActive: tab.id === activeId,
              hasView,
              audible: hasView && this.tabViews.isAudible(tab.id),
              devToolsOpen: hasView && this.tabViews.isDevToolsOpen(tab.id)
            },
            this.now(),
            this.sleepAfterMs
          )
        ) {
          continue
        }

        let scrollY: number | null
        try {
          scrollY = await this.tabViews.captureScroll(tab.id)
        } catch {
          scrollY = null
        }

        // State may have changed while the renderer was queried (activation,
        // pinning, audio, or a manual sleep). Re-check against fresh state.
        const latest = this.controller.snapshot
        const current = latest.tabs[tab.id]
        if (!current) continue
        const stillHasView = this.tabViews.hasView(current.id)
        const stillEligible = shouldSleepTab(
          {
            tab: current,
            isActive: current.id === (activeTabOf(latest)?.id ?? null),
            hasView: stillHasView,
            audible: stillHasView && this.tabViews.isAudible(current.id),
            devToolsOpen: stillHasView && this.tabViews.isDevToolsOpen(current.id)
          },
          this.now(),
          this.sleepAfterMs
        )
        if (!stillEligible) continue

        // Capture and the sleep transition land in a single state update so
        // the saved scroll position matches the destroyed view.
        if (scrollY === null) {
          this.controller.updateTab(current.id, { sleeping: true })
        } else {
          this.controller.updateTab(current.id, { scrollY, sleeping: true })
        }
      }
    } finally {
      this.checking = false
    }
  }
}
