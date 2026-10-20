import type { BrowserSnapshot, StateDiff } from '@ione/core'
import type { StateRepository } from './state-repository'

/**
 * Coalesces reducer diffs into one delayed repository write. The timer is the
 * global `setTimeout` so tests can drive it with fake timers.
 */
export class WriteBehindPersistence {
  private readonly repository: StateRepository
  private readonly delayMs: number

  private diffs: StateDiff[] = []
  private latestSnapshot: BrowserSnapshot | null = null
  private timer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(repository: StateRepository, delayMs = 150) {
    this.repository = repository
    this.delayMs = delayMs
  }

  get pending(): boolean {
    return this.diffs.length > 0
  }

  enqueue(diffs: StateDiff[], snapshot: BrowserSnapshot): void {
    if (this.disposed) {
      throw new Error('WriteBehindPersistence has been disposed')
    }
    if (diffs.length === 0) return

    this.diffs.push(...diffs)
    this.latestSnapshot = snapshot

    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, this.delayMs)
    }
  }

  /** Synchronously applies everything queued. Safe to call with no work. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const snapshot = this.latestSnapshot
    if (this.diffs.length === 0 || snapshot === null) return

    try {
      this.repository.applyDiffs(this.diffs, snapshot)
      this.diffs = []
      this.latestSnapshot = null
    } catch (error) {
      console.error('[persistence] diff apply failed; will retry', error)
      if (!this.disposed) {
        this.timer = setTimeout(() => {
          this.timer = null
          this.flush()
        }, this.delayMs)
      }
    }
  }

  /** Flushes pending work and rejects all later enqueues. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.flush()
  }
}
