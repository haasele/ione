import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { FeedItem, FeedState, Folder } from '@ione/core'
import type { BrowserController } from './controller'
import type { FeedFetchRequest, FeedFetchResult } from '../shared/rss'

const DEFAULT_POLL_MS = 15 * 60_000
const TICK_MS = 30_000
const FETCH_TIMEOUT_MS = 30_000
const MAX_CONCURRENT = 3

export interface FeedServiceOptions {
  pollIntervalMs?: number
  workerPath?: string
  random?: () => number
}

interface PendingRequest {
  resolve: (result: FeedFetchResult) => void
  timer: NodeJS.Timeout
}

export function feedBackoffMs(
  failures: number,
  retryAfterMs: number | null,
  random: () => number = Math.random
): number {
  const raw = Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(Math.max(failures, 1), 8))
  const jittered = raw / 2 + random() * (raw / 2)
  return Math.max(jittered, retryAfterMs ?? 0)
}

export function feedItemId(folderId: string, guid: string | null, url: string): string {
  return createHash('sha256')
    .update(folderId)
    .update('\0')
    .update(guid || url)
    .digest('hex')
}

export class FeedService {
  private readonly controller: BrowserController
  private readonly pollIntervalMs: number
  private readonly workerPath: string
  private readonly random: () => number
  private worker: UtilityProcess | null = null
  private timer: NodeJS.Timeout | null = null
  private started = false
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly inFlight = new Set<string>()
  private ticking = false

  constructor(controller: BrowserController, options: FeedServiceOptions = {}) {
    this.controller = controller
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS
    this.workerPath = options.workerPath ?? join(__dirname, 'feed-worker.js')
    this.random = options.random ?? Math.random
  }

  async initialize(): Promise<void> {
    if (this.started) return
    this.started = true
    this.startWorker()
    this.ensureStates()
    this.timer = setInterval(() => {
      void this.tick()
    }, TICK_MS)
    this.timer.unref()
    await this.tick()
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    for (const pending of this.pending.values()) clearTimeout(pending.timer)
    this.pending.clear()
    this.inFlight.clear()
    this.worker?.kill()
    this.worker = null
    this.started = false
  }

  async refreshNow(folderId: string): Promise<void> {
    if (!this.started) await this.initialize()
    const folder = this.folderForFetch(folderId)
    if (!folder) return
    this.ensureState(folder)
    await this.fetchFolder(folder)
  }

  private async tick(): Promise<void> {
    if (this.ticking || !this.worker) return
    this.ticking = true
    try {
      const now = Date.now()
      const snapshot = this.controller.snapshot
      this.ensureStates()
      const due = Object.values(snapshot.folders)
        .filter((folder) => folder.kind === 'rss' && Boolean(folder.feedUrl))
        .filter((folder) => {
          const state = this.controller.snapshot.feedStates?.[folder.id]
          return !state || state.nextPollAt <= now
        })
        .slice(0, MAX_CONCURRENT)
      await Promise.all(
        due.map((folder) =>
          this.fetchFolder(folder).catch((error: unknown) => {
            console.warn('[feed] poll failed', folder.id, error)
          })
        )
      )
    } finally {
      this.ticking = false
    }
  }

  private async fetchFolder(folder: Folder): Promise<void> {
    if (!folder.feedUrl || this.inFlight.has(folder.id) || !this.worker) return
    this.inFlight.add(folder.id)
    const state = this.controller.snapshot.feedStates?.[folder.id]
    const request: FeedFetchRequest = {
      requestId: this.nextRequestId++,
      folderId: folder.id,
      url: folder.feedUrl,
      etag: state?.etag ?? null,
      lastModified: state?.lastModified ?? null
    }

    try {
      const result = await this.request(request)
      this.applyResult(folder.id, result)
    } catch (error) {
      this.applyFailure(folder.id, error instanceof Error ? error.message : String(error))
    } finally {
      this.inFlight.delete(folder.id)
    }
  }

  private request(request: FeedFetchRequest): Promise<FeedFetchResult> {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('Feed worker is not running'))
    return new Promise<FeedFetchResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new Error('Feed fetch timed out'))
      }, FETCH_TIMEOUT_MS)
      this.pending.set(request.requestId, { resolve, timer })
      worker.postMessage(request)
    })
  }

  private startWorker(): void {
    const worker = utilityProcess.fork(this.workerPath, [], {
      serviceName: 'Ione Feed Fetcher',
      stdio: 'pipe',
      partition: 'ione-feeds'
    })
    this.worker = worker
    worker.on('message', (message: unknown) => {
      if (typeof message !== 'object' || message === null) return
      const result = message as FeedFetchResult
      const pending = this.pending.get(result.requestId)
      if (!pending) return
      this.pending.delete(result.requestId)
      clearTimeout(pending.timer)
      pending.resolve(result)
    })
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.worker = null
      console.error('[feed] worker exited', code)
      for (const pending of this.pending.values()) clearTimeout(pending.timer)
      this.pending.clear()
    })
    worker.stdout?.on('data', (chunk: Buffer) => {
      console.log('[feed-worker]', chunk.toString().trim())
    })
    worker.stderr?.on('data', (chunk: Buffer) => {
      console.error('[feed-worker]', chunk.toString().trim())
    })
  }

  private ensureStates(): void {
    for (const folder of Object.values(this.controller.snapshot.folders)) {
      if (folder.kind === 'rss' && folder.feedUrl) this.ensureState(folder)
    }
  }

  private ensureState(folder: Folder): void {
    if (!folder.feedUrl) return
    const current = this.controller.snapshot.feedStates?.[folder.id]
    if (current && current.fetchUrl === folder.feedUrl) return
    const now = Date.now()
    this.controller.setFeedState({
      folderId: folder.id,
      fetchUrl: folder.feedUrl,
      lastCheckedAt: 0,
      lastSuccessAt: 0,
      nextPollAt: now,
      consecutiveFailures: 0
    })
  }

  private applyResult(folderId: string, result: FeedFetchResult): void {
    const folder = this.folderForFetch(folderId)
    if (!folder) return
    const now = Date.now()
    const previous = this.controller.snapshot.feedStates?.[folderId]

    if (result.error || result.status === 0) {
      this.applyFailure(folderId, result.error ?? 'Feed fetch failed', result.retryAfterMs)
      return
    }

    if (result.notModified) {
      this.controller.setFeedState({
        folderId,
        fetchUrl: result.fetchUrl,
        lastCheckedAt: now,
        lastSuccessAt: now,
        nextPollAt: now + this.nextSuccessDelay(),
        consecutiveFailures: 0,
        ...(result.etag ? { etag: result.etag } : previous?.etag ? { etag: previous.etag } : {}),
        ...(result.lastModified
          ? { lastModified: result.lastModified }
          : previous?.lastModified
            ? { lastModified: previous.lastModified }
            : {}),
        ...(previous?.title ? { title: previous.title } : {}),
        ...(previous?.siteUrl ? { siteUrl: previous.siteUrl } : {})
      })
      return
    }

    if (result.status < 200 || result.status >= 300) {
      this.applyFailure(folderId, `HTTP ${result.status}`, result.retryAfterMs)
      return
    }

    const existing = this.controller.snapshot.feedItems ?? {}
    const previousItems = new Map(
      Object.values(existing)
        .filter((item) => item.folderId === folderId)
        .map((item) => [item.id, item])
    )
    const items: FeedItem[] = result.items.map((item) => {
      const id = feedItemId(folderId, item.guid ?? null, item.url)
      const old = previousItems.get(id)
      return {
        id,
        folderId,
        ...(item.guid ? { guid: item.guid } : {}),
        url: item.url,
        title: item.title,
        author: item.author,
        summary: item.summary,
        publishedAt: item.publishedAt,
        fetchedAt: now,
        read: old?.read ?? false,
        starred: old?.starred ?? false
      }
    })

    const state: FeedState = {
      folderId,
      fetchUrl: result.fetchUrl,
      lastCheckedAt: now,
      lastSuccessAt: now,
      nextPollAt: now + this.nextSuccessDelay(),
      consecutiveFailures: 0
    }
    if (result.etag) state.etag = result.etag
    if (result.lastModified) state.lastModified = result.lastModified
    if (result.title) state.title = result.title
    if (result.siteUrl) state.siteUrl = result.siteUrl

    this.controller.setFeedItems(folderId, items)
    this.controller.setFeedState(state)
  }

  private applyFailure(
    folderId: string,
    message: string,
    retryAfterMs: number | null = null
  ): void {
    const folder = this.folderForFetch(folderId)
    if (!folder?.feedUrl) return
    const previous = this.controller.snapshot.feedStates?.[folderId]
    const failures = (previous?.consecutiveFailures ?? 0) + 1
    const now = Date.now()
    this.controller.setFeedState({
      folderId,
      fetchUrl: previous?.fetchUrl ?? folder.feedUrl,
      lastCheckedAt: now,
      lastSuccessAt: previous?.lastSuccessAt ?? 0,
      nextPollAt: now + feedBackoffMs(failures, retryAfterMs, this.random),
      consecutiveFailures: failures,
      lastError: message.slice(0, 500),
      ...(previous?.etag ? { etag: previous.etag } : {}),
      ...(previous?.lastModified ? { lastModified: previous.lastModified } : {}),
      ...(previous?.title ? { title: previous.title } : {}),
      ...(previous?.siteUrl ? { siteUrl: previous.siteUrl } : {})
    })
  }

  private nextSuccessDelay(): number {
    return Math.round(this.pollIntervalMs * (0.9 + this.random() * 0.2))
  }

  private folderForFetch(folderId: string): Folder | null {
    const folder = this.controller.snapshot.folders[folderId]
    if (!folder || folder.kind !== 'rss' || !folder.feedUrl) return null
    return folder
  }
}
