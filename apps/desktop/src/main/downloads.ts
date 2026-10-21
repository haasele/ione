import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, shell } from 'electron'
import type { DownloadInfo, DownloadState } from '../shared/ipc'
import { browserSession } from './browser-session'

const MAX_HISTORY = 100

interface TrackedDownload {
  info: DownloadInfo
  cancel: () => void
}

/**
 * Tracks downloads in the browser content session. Electron handles the actual
 * transfer and writes to the user's Downloads directory.
 */
export class DownloadService {
  private readonly onChanged: (downloads: DownloadInfo[]) => void
  private readonly downloads = new Map<string, TrackedDownload>()
  private attached = false
  private readonly saveDirectory: string
  private readonly listener: (
    event: Electron.Event,
    item: Electron.DownloadItem,
    contents: Electron.WebContents
  ) => void

  constructor(onChanged: (downloads: DownloadInfo[]) => void) {
    this.onChanged = onChanged
    this.saveDirectory =
      process.env['IONE_DOWNLOAD_DIR'] && process.env['IONE_DOWNLOAD_DIR'].length > 0
        ? process.env['IONE_DOWNLOAD_DIR']
        : app.getPath('downloads')
    this.listener = (_event, item) => this.track(item)
  }

  initialize(): void {
    if (this.attached) return
    this.attached = true
    try {
      mkdirSync(this.saveDirectory, { recursive: true })
    } catch (error) {
      console.warn('[downloads] could not create download directory', error)
    }
    browserSession().on('will-download', this.listener)
  }

  list(): DownloadInfo[] {
    return [...this.downloads.values()]
      .map((entry) => ({ ...entry.info }))
      .sort((left, right) => right.startedAt - left.startedAt)
  }

  cancel(id: string): void {
    this.downloads.get(id)?.cancel()
  }

  async open(id: string): Promise<void> {
    const info = this.downloads.get(id)?.info
    if (!info || info.state !== 'completed' || !info.savePath) return
    await shell.openPath(info.savePath)
  }

  showInFolder(id: string): void {
    const info = this.downloads.get(id)?.info
    if (info?.savePath) shell.showItemInFolder(info.savePath)
  }

  dispose(): void {
    if (this.attached) {
      browserSession().removeListener('will-download', this.listener)
      this.attached = false
    }
    this.downloads.clear()
  }

  private track(item: Electron.DownloadItem): void {
    const id = randomUUID()
    try {
      item.setSavePath(join(this.saveDirectory, basename(item.getFilename())))
    } catch (error) {
      console.warn('[downloads] could not assign save path', error)
    }
    const info: DownloadInfo = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      state: normalizeState(item.getState()),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      savePath: item.getSavePath(),
      startedAt: Date.now()
    }
    const tracked: TrackedDownload = { info, cancel: () => item.cancel() }
    this.downloads.set(id, tracked)
    this.trim()
    this.emit()

    item.on('updated', (_event, state) => {
      tracked.info = {
        ...tracked.info,
        state: normalizeState(state),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        savePath: item.getSavePath()
      }
      this.emit()
    })
    item.once('done', (_event, state) => {
      tracked.info = {
        ...tracked.info,
        state: normalizeState(state),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        savePath: item.getSavePath()
      }
      this.emit()
    })
  }

  private trim(): void {
    while (this.downloads.size > MAX_HISTORY) {
      const first = this.downloads.keys().next().value
      if (!first) break
      this.downloads.delete(first)
    }
  }

  private emit(): void {
    this.onChanged(this.list())
  }
}

function normalizeState(state: string): DownloadState {
  if (state === 'completed' || state === 'cancelled' || state === 'interrupted') return state
  return 'progressing'
}
