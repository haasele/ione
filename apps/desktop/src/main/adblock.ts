import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import type { AdblockState } from '../shared/ipc'
import { browserSession } from './browser-session'
import type { ExtensionService } from './extensions'

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Built-in network + cosmetic filtering for the browser content session.
 * Lazy-initialized after first paint. Disabled while a blocking extension
 * (uBlock Origin) is loaded because Electron's webRequest listeners take
 * precedence over extension chrome.webRequest handlers.
 */
export class AdblockService {
  private readonly extensions: ExtensionService
  private blocker: ElectronBlocker | null = null
  private preference = process.env['IONE_ADBLOCK'] !== 'off'
  private ready = false
  private enabled = false
  private skippedForExtension = false
  private error: string | null = null
  private initializing: Promise<void> | null = null

  constructor(extensions: ExtensionService) {
    this.extensions = extensions
  }

  getState(): AdblockState {
    return {
      enabled: this.enabled,
      ready: this.ready,
      skippedForExtension: this.skippedForExtension,
      error: this.error
    }
  }

  async initialize(): Promise<void> {
    if (this.initializing) return this.initializing
    this.initializing = this.start()
    try {
      await this.initializing
    } finally {
      this.initializing = null
    }
  }

  async setEnabled(enabled: boolean): Promise<AdblockState> {
    this.preference = enabled
    if (!enabled) {
      this.disable()
      return this.getState()
    }

    if (this.extensions.hasBlockingExtension()) {
      this.skippedForExtension = true
      this.enabled = false
      return this.getState()
    }

    try {
      await this.ensureBlocker()
      this.apply()
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.enabled = false
    }
    this.ready = true
    return this.getState()
  }

  /**
   * Remove built-in webRequest listeners before an extension is loaded. The
   * Ghostery disable path clears all webRequest listeners, so it must run
   * before an extension registers its own listeners.
   */
  prepareForExtensionInstall(): void {
    if (this.enabled) this.disable()
  }

  dispose(): void {
    this.disable()
    this.blocker = null
    this.ready = false
  }

  /** Called after extensions load/unload. */
  handleExtensionChange(): void {
    if (this.extensions.hasBlockingExtension()) {
      if (this.enabled) this.disable()
      this.skippedForExtension = true
      return
    }

    this.skippedForExtension = false
    if (this.preference && !this.enabled) void this.setEnabled(true)
  }

  private async start(): Promise<void> {
    if (!this.preference) {
      this.ready = true
      return
    }
    if (this.extensions.hasBlockingExtension()) {
      this.ready = true
      this.skippedForExtension = true
      return
    }

    try {
      await this.ensureBlocker()
      this.apply()
      this.ready = true
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.ready = true
      this.enabled = false
      console.error('[adblock] initialization failed', error)
    }
  }

  private apply(): void {
    if (!this.blocker) return
    this.blocker.enableBlockingInSession(browserSession())
    this.enabled = true
    this.error = null
  }

  private disable(): void {
    if (!this.blocker || !this.enabled) {
      this.enabled = false
      return
    }
    this.blocker.disableBlockingInSession(browserSession())
    this.enabled = false
  }

  private async ensureBlocker(): Promise<ElectronBlocker> {
    if (this.blocker) return this.blocker

    const cachePath = join(app.getPath('userData'), 'adblock-engine.bin')
    const freshCache =
      existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < CACHE_TTL_MS

    if (existsSync(cachePath)) {
      try {
        this.blocker = ElectronBlocker.deserialize(new Uint8Array(readFileSync(cachePath)))
        if (freshCache) return this.blocker
      } catch (error) {
        console.warn('[adblock] cached engine could not be loaded', error)
      }
    }

    try {
      const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
      this.blocker = blocker
      try {
        mkdirSync(dirname(cachePath), { recursive: true })
        writeFileSync(cachePath, blocker.serialize())
      } catch (error) {
        console.warn('[adblock] could not cache engine', error)
      }
      return blocker
    } catch (error) {
      if (this.blocker) {
        console.warn('[adblock] list refresh failed; using cached engine', error)
        return this.blocker
      }
      throw error
    }
  }
}
