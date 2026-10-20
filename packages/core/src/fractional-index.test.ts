import { describe, expect, it } from 'vitest'
import { generateKeyBetween, generateNKeysBetween } from './fractional-index'

const KEY = /^[0-9A-Za-z]+$/

function expectCanonical(key: string): void {
  expect(key).toMatch(KEY)
  expect(key.length).toBeGreaterThan(0)
  expect(key.endsWith('0')).toBe(false)
}

function expectStrictlyAscending(keys: readonly string[]): void {
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i] as string
    expectCanonical(key)
    if (i > 0) expect((keys[i - 1] as string) < key).toBe(true)
  }
}

describe('generateKeyBetween', () => {
  it('creates an initial key without bounds', () => {
    const key = generateKeyBetween(null, null)
    expectCanonical(key)
    expect(key).toBe('V')
  })

  it('creates strictly increasing keys when appending hundreds of times', () => {
    const keys: string[] = []
    let cursor = generateKeyBetween(null, null)
    keys.push(cursor)
    for (let i = 0; i < 400; i += 1) {
      cursor = generateKeyBetween(cursor, null)
      keys.push(cursor)
    }
    expectStrictlyAscending(keys)
  })

  it('creates strictly decreasing keys when prepending hundreds of times', () => {
    const keys: string[] = []
    let cursor = generateKeyBetween(null, null)
    keys.push(cursor)
    for (let i = 0; i < 400; i += 1) {
      cursor = generateKeyBetween(null, cursor)
      keys.push(cursor)
    }
    const reversed = [...keys].reverse()
    expectStrictlyAscending(reversed)
  })

  it('keeps inserting midpoints strictly between neighbours', () => {
    const lower = 'V'
    const upper = 'W'
    const inBetween: string[] = []
    let left = lower
    let right = upper
    for (let i = 0; i < 200; i += 1) {
      const key = generateKeyBetween(left, right)
      expectCanonical(key)
      expect(left < key).toBe(true)
      expect(key < right).toBe(true)
      inBetween.push(key)
      if (i % 2 === 0) right = key
      else left = key
    }
    const sorted = sortStrings(inBetween)
    expectStrictlyAscending(sorted)
  })

  it('maintains a large sorted list through random insertions', () => {
    const keys = [generateKeyBetween(null, null)]
    const random = mulberry32(42)
    for (let i = 0; i < 250; i += 1) {
      const position = Math.floor(random() * (keys.length + 1))
      const previous = position === 0 ? null : (keys[position - 1] as string)
      const following = position === keys.length ? null : (keys[position] as string)
      const key = generateKeyBetween(previous, following)
      keys.splice(position, 0, key)
      expectCanonical(key)
    }
    expectStrictlyAscending(keys)
  })

  it.each([
    ['V', 'V'],
    ['W', 'V'],
    ['a', '0V']
  ])('rejects prev %s >= next %s', (previous, following) => {
    expect(() => generateKeyBetween(previous, following)).toThrow()
  })

  it.each(['', 'V0', 'V!', 'V 1'])('rejects invalid key %j', (invalid) => {
    expect(() => generateKeyBetween(invalid, null)).toThrow()
    expect(() => generateKeyBetween(null, invalid)).toThrow()
  })
})

describe('generateNKeysBetween', () => {
  it('returns an empty array for a count of zero', () => {
    expect(generateNKeysBetween(null, null, 0)).toEqual([])
  })

  it('returns exactly one key for a count of one', () => {
    const keys = generateNKeysBetween('V', null, 1)
    expect(keys).toHaveLength(1)
    expect((keys[0] as string) > 'V').toBe(true)
  })

  it.each([1, 2, 3, 5, 17, 128])('generates %i ordered keys between unbounded ends', (count) => {
    const keys = generateNKeysBetween(null, null, count)
    expect(keys).toHaveLength(count)
    expectStrictlyAscending(keys)
  })

  it('generates keys between existing bounds', () => {
    const lower = generateKeyBetween(null, null)
    const upper = generateKeyBetween(lower, null)
    const keys = generateNKeysBetween(lower, upper, 64)
    expect(keys).toHaveLength(64)
    expectStrictlyAscending([lower, ...keys, upper])
  })

  it('generates ordered keys before a single upper bound', () => {
    const upper = generateKeyBetween(null, null)
    const keys = generateNKeysBetween(null, upper, 33)
    expectStrictlyAscending([...keys, upper])
  })

  it.each([-1, 1.5, Number.NaN])('rejects invalid count %s', (count) => {
    expect(() => generateNKeysBetween(null, null, count)).toThrow()
  })

  it('rejects invalid bounds', () => {
    expect(() => generateNKeysBetween('W', 'V', 2)).toThrow()
    expect(() => generateNKeysBetween('', null, 2)).toThrow()
    expect(() => generateNKeysBetween(null, 'V0', 2)).toThrow()
  })
})

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
