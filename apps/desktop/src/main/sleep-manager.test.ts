import { describe, expect, it } from 'vitest'
import type { BrowserSnapshot, Tab, TabPatch } from '@ione/core'
import {
  DEFAULT_SLEEP_AFTER_MS,
  DEFAULT_TICK_MS,
  parseTabSleepEnv,
  TabSleepManager,
  type SleepController,
  type SleepTabViews
} from './sleep-manager'

const NOW = 1_700_000_000_000
const SPACE_ID = 's1'

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    spaceId: SPACE_ID,
    url: 'https://example.com/',
    title: id,
    favicon: '',
    pinned: false,
    lastActive: NOW - DEFAULT_SLEEP_AFTER_MS - 1,
    scrollY: 0,
    sleeping: false,
    order: id,
    ...overrides
  }
}

function snapshot(tabs: Tab[], activeTabId: string | null): BrowserSnapshot {
  return {
    version: 7,
    spaces: {
      [SPACE_ID]: {
        id: SPACE_ID,
        name: 'Home',
        icon: 'home',
        theme: 'default',
        order: 'a'
      }
    },
    essentials: {},
    folders: {},
    tabs: Object.fromEntries(tabs.map((entry) => [entry.id, entry])),
    activeSpaceId: SPACE_ID,
    activeTabId
  }
}

interface Update {
  tabId: string
  patch: TabPatch
}

class FakeController implements SleepController {
  state: BrowserSnapshot
  readonly updates: Update[] = []

  constructor(state: BrowserSnapshot) {
    this.state = state
  }

  get snapshot(): BrowserSnapshot {
    return this.state
  }

  updateTab(tabId: string, patch: TabPatch): boolean {
    const current = this.state.tabs[tabId]
    if (!current) return false
    this.updates.push({ tabId, patch })
    const next = { ...current, ...patch } as unknown as Tab
    if (patch.pinnedUrl === null) delete next.pinnedUrl
    this.state = {
      ...this.state,
      tabs: { ...this.state.tabs, [tabId]: next }
    }
    return true
  }
}

class FakeTabViews implements SleepTabViews {
  readonly audible = new Set<string>()
  readonly devTools = new Set<string>()
  readonly withoutView = new Set<string>()
  scrollByTab = new Map<string, number | null>()
  captured: string[] = []

  hasView(tabId: string): boolean {
    return !this.withoutView.has(tabId)
  }

  isAudible(tabId: string): boolean {
    return this.audible.has(tabId)
  }

  isDevToolsOpen(tabId: string): boolean {
    return this.devTools.has(tabId)
  }

  async captureScroll(tabId: string): Promise<number | null> {
    this.captured.push(tabId)
    const value = this.scrollByTab.get(tabId)
    return value === undefined ? 0 : value
  }
}

function manager(
  state: BrowserSnapshot,
  views: FakeTabViews,
  options: { sleepAfterMs?: number; tickMs?: number } = {}
): { controller: FakeController; manager: TabSleepManager } {
  const controller = new FakeController(state)
  return {
    controller,
    manager: new TabSleepManager({
      controller,
      tabViews: views,
      sleepAfterMs: options.sleepAfterMs ?? DEFAULT_SLEEP_AFTER_MS,
      tickMs: options.tickMs ?? DEFAULT_TICK_MS,
      now: () => NOW
    })
  }
}

describe('TabSleepManager', () => {
  it('sleeps an idle, detached tab after capturing its scroll', async () => {
    const views = new FakeTabViews()
    views.scrollByTab.set('old', 120)
    const { controller, manager: sleepManager } = manager(
      snapshot([tab('active'), tab('old')], 'active'),
      views
    )

    await sleepManager.checkNow()

    expect(controller.updates).toEqual([{ tabId: 'old', patch: { scrollY: 120, sleeping: true } }])
    expect(controller.state.tabs['old']?.sleeping).toBe(true)
    expect(views.captured).toEqual(['old'])
  })

  it('skips active, pinned, audible, DevTools, viewless and recent tabs', async () => {
    const views = new FakeTabViews()
    views.audible.add('audible')
    views.devTools.add('devtools')
    views.withoutView.add('viewless')
    const tabs = [
      tab('active'),
      tab('pinned', { pinned: true }),
      tab('audible'),
      tab('devtools'),
      tab('viewless'),
      tab('recent', { lastActive: NOW - 1000 }),
      tab('already-asleep', { sleeping: true })
    ]
    const { controller, manager: sleepManager } = manager(snapshot(tabs, 'active'), views)

    await sleepManager.checkNow()

    expect(controller.updates).toEqual([])
    expect(views.captured).toEqual([])
  })

  it('sets only sleeping when scroll capture returns null', async () => {
    const views = new FakeTabViews()
    views.scrollByTab.set('old', null)
    const { controller, manager: sleepManager } = manager(
      snapshot([tab('active'), tab('old')], 'active'),
      views
    )

    await sleepManager.checkNow()

    expect(controller.updates).toEqual([{ tabId: 'old', patch: { sleeping: true } }])
  })

  it('does not re-enter while a check is in flight', async () => {
    const views = new FakeTabViews()
    const { controller, manager: sleepManager } = manager(
      snapshot([tab('active'), tab('old')], 'active'),
      views
    )

    await Promise.all([sleepManager.checkNow(), sleepManager.checkNow()])

    expect(controller.updates).toHaveLength(1)
  })

  it('starts and stops idempotently', () => {
    const { manager: sleepManager } = manager(snapshot([tab('t')], 't'), new FakeTabViews())
    expect(() => {
      sleepManager.start()
      sleepManager.start()
      sleepManager.stop()
      sleepManager.stop()
    }).not.toThrow()
  })
})

describe('parseTabSleepEnv', () => {
  it('uses defaults for missing values', () => {
    expect(parseTabSleepEnv({})).toEqual({
      sleepAfterMs: 720_000,
      tickMs: 60_000
    })
  })

  it('accepts finite non-negative values, including zero', () => {
    expect(
      parseTabSleepEnv({
        IONE_TAB_SLEEP_MS: '1500',
        IONE_TAB_SLEEP_TICK_MS: '0'
      })
    ).toEqual({ sleepAfterMs: 1500, tickMs: 0 })
  })

  it('falls back for malformed, negative or infinite values', () => {
    expect(
      parseTabSleepEnv({
        IONE_TAB_SLEEP_MS: '-5',
        IONE_TAB_SLEEP_TICK_MS: 'not-a-number'
      })
    ).toEqual({ sleepAfterMs: 720_000, tickMs: 60_000 })
    expect(
      parseTabSleepEnv({
        IONE_TAB_SLEEP_MS: 'Infinity',
        IONE_TAB_SLEEP_TICK_MS: ''
      })
    ).toEqual({ sleepAfterMs: 720_000, tickMs: 60_000 })
  })
})
