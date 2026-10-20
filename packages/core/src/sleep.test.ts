import { describe, expect, it } from 'vitest'
import type { Tab } from './model'
import { shouldSleepTab } from './sleep'
import type { SleepPolicyArgs } from './sleep'

const NOW = 1_700_000_000_000
const TIMEOUT = 30_000

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 't1',
    spaceId: 's1',
    url: 'https://example.com/',
    title: 'Example',
    favicon: '',
    pinned: false,
    lastActive: NOW - TIMEOUT - 1,
    scrollY: 0,
    sleeping: false,
    order: 'a',
    ...overrides
  }
}

function args(overrides: Partial<SleepPolicyArgs> = {}): SleepPolicyArgs {
  return {
    tab: tab(),
    isActive: false,
    hasView: true,
    audible: false,
    devToolsOpen: false,
    ...overrides
  }
}

describe('shouldSleepTab', () => {
  it('sleeps an idle, inactive, visible tab past the timeout', () => {
    expect(shouldSleepTab(args(), NOW, TIMEOUT)).toBe(true)
  })

  it('keeps the tab awake exactly at the timeout boundary', () => {
    const boundary = tab({ lastActive: NOW - TIMEOUT })
    expect(shouldSleepTab(args({ tab: boundary }), NOW, TIMEOUT)).toBe(false)
  })

  it('keeps the tab awake just past the boundary by one millisecond less', () => {
    const nearly = tab({ lastActive: NOW - TIMEOUT + 1 })
    expect(shouldSleepTab(args({ tab: nearly }), NOW, TIMEOUT)).toBe(false)
  })

  it('applies a zero timeout strictly', () => {
    expect(shouldSleepTab(args({ tab: tab({ lastActive: NOW }) }), NOW, 0)).toBe(false)
    expect(shouldSleepTab(args({ tab: tab({ lastActive: NOW - 1 }) }), NOW, 0)).toBe(true)
  })

  it.each<[string, Partial<SleepPolicyArgs>]>([
    ['already sleeping', { tab: tab({ sleeping: true }) }],
    ['active', { isActive: true }],
    ['pinned', { tab: tab({ pinned: true }) }],
    ['without a view', { hasView: false }],
    ['audible', { audible: true }],
    ['with devtools open', { devToolsOpen: true }]
  ])('keeps a tab awake when %s', (_label, overrides) => {
    expect(shouldSleepTab(args(overrides), NOW, TIMEOUT)).toBe(false)
  })

  it('still evaluates expiry when every guard is clear', () => {
    const fresh = tab({ lastActive: NOW })
    expect(shouldSleepTab(args({ tab: fresh }), NOW, TIMEOUT)).toBe(false)
    expect(shouldSleepTab(args({ tab: fresh }), NOW + TIMEOUT + 1, TIMEOUT)).toBe(true)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    'rejects invalid timeout %s',
    (timeout) => {
      expect(() => shouldSleepTab(args(), NOW, timeout)).toThrow(RangeError)
    }
  )

  it('does not mutate its arguments', () => {
    const candidate = args()
    const before = structuredClone(candidate)
    shouldSleepTab(candidate, NOW, TIMEOUT)
    expect(candidate).toEqual(before)
  })
})
