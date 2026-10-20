import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffBatch, StateDiff } from './diff'
import { DiffBatcher, timerScheduler } from './diff-batcher'
import type { FlushScheduler } from './diff-batcher'

function diffFor(id: string): StateDiff {
  return {
    type: 'tab.remove',
    id
  }
}

function manualScheduler() {
  let pending: (() => void) | null = null
  let cancels = 0
  const schedule: FlushScheduler = (flush) => {
    pending = flush
    return () => {
      cancels += 1
      pending = null
    }
  }
  return {
    schedule,
    runPending: () => {
      const flush = pending
      pending = null
      flush?.()
    },
    get hasPending() {
      return pending !== null
    },
    get cancels() {
      return cancels
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DiffBatcher', () => {
  it('coalesces diffs added before a flush into one batch', () => {
    const scheduler = manualScheduler()
    const batches: DiffBatch[] = []
    const batcher = new DiffBatcher((batch) => batches.push(batch), scheduler.schedule)

    batcher.add([diffFor('t1')], 1, 2)
    batcher.add([diffFor('t2'), diffFor('t3')], 2, 3)

    expect(batcher.pendingCount).toBe(3)
    expect(batches).toEqual([])
    expect(scheduler.hasPending).toBe(true)

    scheduler.runPending()

    expect(batches).toEqual([
      {
        baseVersion: 1,
        version: 3,
        diffs: [diffFor('t1'), diffFor('t2'), diffFor('t3')]
      }
    ])
    expect(batcher.pendingCount).toBe(0)
  })

  it('publishes exactly once per flush', () => {
    const scheduler = manualScheduler()
    const batches: DiffBatch[] = []
    const batcher = new DiffBatcher((batch) => batches.push(batch), scheduler.schedule)

    batcher.add([diffFor('t1')], 1, 2)
    batcher.flush()

    expect(batches).toHaveLength(1)
    expect(batcher.pendingCount).toBe(0)

    batcher.flush()
    expect(batches).toHaveLength(1)
  })

  it('clears the scheduled timer on flush', () => {
    const scheduler = manualScheduler()
    const batcher = new DiffBatcher(() => {}, scheduler.schedule)

    batcher.add([diffFor('t1')], 1, 2)
    expect(scheduler.cancels).toBe(0)
    batcher.flush()
    expect(scheduler.cancels).toBe(1)
    expect(scheduler.hasPending).toBe(false)
  })

  it('ignores empty diff lists', () => {
    const scheduler = manualScheduler()
    const batches: DiffBatch[] = []
    const batcher = new DiffBatcher((batch) => batches.push(batch), scheduler.schedule)

    batcher.add([], 4, 5)

    expect(batcher.pendingCount).toBe(0)
    expect(scheduler.hasPending).toBe(false)
    batcher.flush()
    expect(batches).toEqual([])
  })

  it('throws when a subsequent add has a version gap', () => {
    const scheduler = manualScheduler()
    const batcher = new DiffBatcher(() => {}, scheduler.schedule)

    batcher.add([diffFor('t1')], 1, 2)
    expect(() => batcher.add([diffFor('t2')], 3, 4)).toThrow(/version/i)
    expect(batcher.pendingCount).toBe(1)

    scheduler.runPending()
    expect(batcher.pendingCount).toBe(0)
  })

  it('accepts a new batch after a flush with a fresh base version', () => {
    const scheduler = manualScheduler()
    const batches: DiffBatch[] = []
    const batcher = new DiffBatcher((batch) => batches.push(batch), scheduler.schedule)

    batcher.add([diffFor('t1')], 1, 2)
    batcher.flush()
    batcher.add([diffFor('t2')], 2, 3)
    batcher.flush()

    expect(batches.map((batch) => [batch.baseVersion, batch.version])).toEqual([
      [1, 2],
      [2, 3]
    ])
  })

  it('cancels pending work on dispose without publishing', () => {
    const scheduler = manualScheduler()
    const batches: DiffBatch[] = []
    const batcher = new DiffBatcher((batch) => batches.push(batch), scheduler.schedule)

    batcher.add([diffFor('t1')], 1, 2)
    expect(scheduler.hasPending).toBe(true)

    batcher.dispose()

    expect(scheduler.hasPending).toBe(false)
    expect(scheduler.cancels).toBe(1)
    expect(batcher.pendingCount).toBe(0)

    scheduler.runPending()
    expect(batches).toEqual([])
  })
})

describe('timerScheduler', () => {
  it('flushes after the delay', () => {
    vi.useFakeTimers()
    const batches: DiffBatch[] = []
    const batcher = new DiffBatcher((batch) => batches.push(batch), timerScheduler(16))
    const diff: StateDiff = { type: 'tab.remove', id: 't1' }

    batcher.add([diff], 1, 2)
    batcher.add([{ type: 'tab.remove', id: 't2' }], 2, 3)
    expect(batches).toEqual([])

    vi.advanceTimersByTime(15)
    expect(batches).toEqual([])

    vi.advanceTimersByTime(1)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual({
      baseVersion: 1,
      version: 3,
      diffs: [diff, { type: 'tab.remove', id: 't2' }]
    })
  })

  it('does not flush after dispose', () => {
    vi.useFakeTimers()
    const batches: DiffBatch[] = []
    const batcher = new DiffBatcher((batch) => batches.push(batch), timerScheduler(10))

    batcher.add([diffFor('t1')], 1, 2)
    batcher.dispose()
    vi.advanceTimersByTime(50)

    expect(batches).toEqual([])
  })

  it('defaults the delay when omitted', () => {
    vi.useFakeTimers()
    const batches: DiffBatch[] = []
    const batcher = new DiffBatcher((batch) => batches.push(batch), timerScheduler())

    batcher.add([diffFor('t1')], 1, 2)
    vi.advanceTimersByTime(16)

    expect(batches).toHaveLength(1)
  })
})
