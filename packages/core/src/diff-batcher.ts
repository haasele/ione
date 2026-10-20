/**
 * Coalesces reducer diffs into versioned batches. A batch is published once
 * per scheduled flush; version continuity is enforced so the renderer never
 * applies a gap.
 */

import type { DiffBatch, StateDiff } from './diff'

/** Schedules a flush and returns a cancel function. */
export type FlushScheduler = (flush: () => void) => () => void

export function timerScheduler(delayMs = 16): FlushScheduler {
  return (flush) => {
    const handle = setTimeout(flush, delayMs)
    return () => clearTimeout(handle)
  }
}

export class DiffBatcher {
  private readonly publish: (batch: DiffBatch) => void
  private readonly schedule: FlushScheduler
  private diffs: StateDiff[] = []
  private baseVersion: number | null = null
  private latestVersion: number | null = null
  private cancelScheduled: (() => void) | null = null

  constructor(publish: (batch: DiffBatch) => void, schedule: FlushScheduler = timerScheduler()) {
    this.publish = publish
    this.schedule = schedule
  }

  get pendingCount(): number {
    return this.diffs.length
  }

  add(diffs: readonly StateDiff[], fromVersion: number, toVersion: number): void {
    if (diffs.length === 0) return

    if (this.latestVersion === null) {
      this.baseVersion = fromVersion
    } else if (this.latestVersion !== fromVersion) {
      throw new Error(
        `Diff batch version gap: expected fromVersion ${this.latestVersion}, received ${fromVersion}`
      )
    }

    this.diffs.push(...diffs)
    this.latestVersion = toVersion

    if (this.cancelScheduled === null) {
      this.cancelScheduled = this.schedule(this.flush)
    }
  }

  flush = (): void => {
    if (this.cancelScheduled !== null) {
      this.cancelScheduled()
      this.cancelScheduled = null
    }
    if (this.diffs.length === 0) return

    const batch: DiffBatch = {
      baseVersion: this.baseVersion ?? 0,
      version: this.latestVersion ?? this.baseVersion ?? 0,
      diffs: this.diffs
    }
    this.diffs = []
    this.baseVersion = null
    this.latestVersion = null
    this.publish(batch)
  }

  dispose(): void {
    if (this.cancelScheduled !== null) {
      this.cancelScheduled()
      this.cancelScheduled = null
    }
    this.diffs = []
    this.baseVersion = null
    this.latestVersion = null
  }
}
