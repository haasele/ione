import type { BrowserSnapshot, StateDiff } from '@ione/core'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './database'
import { StateRepository } from './state-repository'
import { WriteBehindPersistence } from './write-behind'

const databases: Database.Database[] = []

function createRepository(): StateRepository {
  const db = openDatabase(':memory:')
  databases.push(db)
  const repository = new StateRepository(db)
  repository.saveSnapshot(baseSnapshot())
  return repository
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
})

function baseSnapshot(): BrowserSnapshot {
  return {
    version: 1,
    spaces: {
      a: { id: 'a', name: 'Alpha', icon: 'a', theme: 'dark', order: 'a0' }
    },
    essentials: {},
    folders: {},
    tabs: {
      t1: {
        id: 't1',
        spaceId: 'a',
        url: 'https://one.example',
        title: 'One',
        favicon: 'i',
        pinned: false,
        lastActive: 1,
        scrollY: 0,
        sleeping: false,
        order: 't0'
      }
    },
    activeSpaceId: 'a',
    activeTabId: 't1'
  }
}

function withSpace(base: BrowserSnapshot, id: string): BrowserSnapshot {
  return {
    ...base,
    version: base.version + 1,
    spaces: {
      ...base.spaces,
      [id]: { id, name: id.toUpperCase(), icon: id, theme: 'dark', order: `${id}0` }
    }
  }
}

describe('WriteBehindPersistence', () => {
  it('does not write before the delay and writes once at 150ms', () => {
    const repository = createRepository()
    const spy = vi.spyOn(repository, 'applyDiffs')
    const writer = new WriteBehindPersistence(repository)

    const diff: StateDiff = {
      type: 'space.upsert',
      space: { id: 'b', name: 'b', icon: 'b', theme: 'dark', order: 'b0' }
    }
    writer.enqueue([diff], withSpace(baseSnapshot(), 'b'))

    expect(writer.pending).toBe(true)
    expect(repository.loadSnapshot()?.spaces.b).toBeUndefined()

    vi.advanceTimersByTime(149)
    expect(spy).not.toHaveBeenCalled()
    expect(repository.loadSnapshot()?.spaces.b).toBeUndefined()

    vi.advanceTimersByTime(1)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(writer.pending).toBe(false)
    expect(repository.loadSnapshot()?.spaces.b).toMatchObject({ id: 'b' })

    vi.advanceTimersByTime(5_000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('queues diffs in order and persists the latest snapshot', () => {
    const repository = createRepository()
    const spy = vi.spyOn(repository, 'applyDiffs')
    const writer = new WriteBehindPersistence(repository)

    const diffB: StateDiff = {
      type: 'space.upsert',
      space: { id: 'b', name: 'b', icon: 'b', theme: 'dark', order: 'b0' }
    }
    const diffC: StateDiff = {
      type: 'space.upsert',
      space: { id: 'c', name: 'c', icon: 'c', theme: 'dark', order: 'c0' }
    }
    const firstSnapshot = withSpace(baseSnapshot(), 'b')
    const latestSnapshot: BrowserSnapshot = {
      ...withSpace(firstSnapshot, 'c'),
      activeSpaceId: 'b',
      activeTabId: null
    }

    writer.enqueue([diffB], firstSnapshot)
    writer.enqueue([diffC], latestSnapshot)
    vi.advanceTimersByTime(150)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith([diffB, diffC], latestSnapshot)

    const loaded = repository.loadSnapshot()
    expect(loaded?.spaces.b).toBeDefined()
    expect(loaded?.spaces.c).toBeDefined()
    expect(loaded?.activeSpaceId).toBe('b')
    expect(loaded?.activeTabId).toBeNull()
  })

  it('ignores empty diff batches', () => {
    const repository = createRepository()
    const spy = vi.spyOn(repository, 'applyDiffs')
    const writer = new WriteBehindPersistence(repository)

    writer.enqueue([], withSpace(baseSnapshot(), 'b'))

    expect(writer.pending).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(spy).not.toHaveBeenCalled()
    expect(repository.loadSnapshot()?.spaces.b).toBeUndefined()
  })

  it('flushes immediately on dispose and rejects later enqueues', () => {
    const repository = createRepository()
    const writer = new WriteBehindPersistence(repository)

    const diff: StateDiff = {
      type: 'space.upsert',
      space: { id: 'b', name: 'b', icon: 'b', theme: 'dark', order: 'b0' }
    }
    const snapshot = withSpace(baseSnapshot(), 'b')
    writer.enqueue([diff], snapshot)
    writer.dispose()

    expect(writer.pending).toBe(false)
    expect(repository.loadSnapshot()?.spaces.b).toBeDefined()

    expect(() => writer.enqueue([diff], snapshot)).toThrow(/disposed/)
    expect(() => writer.dispose()).not.toThrow()
  })

  it('retries after a repository failure instead of dropping the queue', () => {
    const repository = createRepository()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const spy = vi
      .spyOn(repository, 'applyDiffs')
      .mockImplementationOnce(() => {
        throw new Error('disk full')
      })
    const writer = new WriteBehindPersistence(repository)
    const diff: StateDiff = {
      type: 'space.upsert',
      space: { id: 'b', name: 'b', icon: 'b', theme: 'dark', order: 'b0' }
    }

    writer.enqueue([diff], withSpace(baseSnapshot(), 'b'))
    vi.advanceTimersByTime(150)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(writer.pending).toBe(true)
    expect(repository.loadSnapshot()?.spaces.b).toBeUndefined()

    vi.advanceTimersByTime(150)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(writer.pending).toBe(false)
    expect(repository.loadSnapshot()?.spaces.b).toMatchObject({ id: 'b' })
  })

  it('flushes manually and clears the scheduled timer', () => {
    const repository = createRepository()
    const spy = vi.spyOn(repository, 'applyDiffs')
    const writer = new WriteBehindPersistence(repository)

    const diff: StateDiff = {
      type: 'space.upsert',
      space: { id: 'b', name: 'b', icon: 'b', theme: 'dark', order: 'b0' }
    }
    writer.enqueue([diff], withSpace(baseSnapshot(), 'b'))
    writer.flush()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(repository.loadSnapshot()?.spaces.b).toBeDefined()
    expect(writer.pending).toBe(false)

    vi.advanceTimersByTime(150)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
