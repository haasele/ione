import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BaseWindow, WebContentsView, type WebContents, type WebPreferences } from 'electron'
import type { BrowserSnapshot, DiffBatch, TabPatch } from '@ione/core'
import { IPC } from '../shared/ipc'
import { TabViewManager } from './tab-views'

const SIDEBAR_WIDTH = 320

const CHROME_WEB_PREFERENCES: WebPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  webviewTag: false,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  spellcheck: false
}

export interface ChromeWindowOptions {
  preloadPath?: string
  rendererUrl?: string
  rendererHtmlPath?: string
  onTabEvent: (tabId: string, patch: TabPatch) => void
  onOpenInNewTab: (url: string) => void
  onReady?: () => void
}

export class ChromeWindow {
  readonly window: BaseWindow
  readonly chromeView: WebContentsView
  readonly tabViews: TabViewManager
  private readonly rendererUrl: string | undefined
  private readonly rendererHtmlPath: string | undefined
  private readonly onReady: (() => void) | undefined
  private readyNotified = false
  private disposed = false

  constructor(options: ChromeWindowOptions) {
    this.rendererUrl = options.rendererUrl
    this.rendererHtmlPath = options.rendererHtmlPath
    this.onReady = options.onReady

    this.window = new BaseWindow({
      width: 1280,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      show: false,
      backgroundColor: '#0b0b0f',
      autoHideMenuBar: true,
      title: 'Ione'
    })
    this.window.contentView.setBackgroundColor('#0b0b0f')

    this.chromeView = new WebContentsView({
      webPreferences: {
        ...CHROME_WEB_PREFERENCES,
        preload: options.preloadPath ?? join(__dirname, '../preload/index.js')
      }
    })
    this.chromeView.setBackgroundColor('#0b0b0f')
    this.window.contentView.addChildView(this.chromeView)

    this.tabViews = new TabViewManager({
      window: this.window,
      sidebarWidth: SIDEBAR_WIDTH,
      onTabEvent: options.onTabEvent,
      onOpenInNewTab: options.onOpenInNewTab
    })

    this.hardenChrome()
    this.layout()

    this.window.on('resize', () => this.layout())
    this.window.on('closed', () => this.dispose())
    this.chromeView.webContents.on('did-finish-load', () => {
      this.layout()
      if (!this.window.isDestroyed()) this.window.show()
      if (!this.readyNotified) {
        this.readyNotified = true
        this.onReady?.()
      }
    })
    this.chromeView.webContents.on('did-fail-load', (_event, code, description, url) => {
      console.error(`[chrome] failed to load ${url} (${code} ${description})`)
    })
  }

  load(): void {
    const contents = this.chromeView.webContents
    const load = this.rendererUrl
      ? contents.loadURL(this.rendererUrl)
      : contents.loadFile(this.rendererHtmlPath ?? join(__dirname, '../renderer/index.html'))
    void load.catch((error: unknown) => {
      console.error('[chrome] load rejected', error)
    })
  }

  reconcile(snapshot: BrowserSnapshot): void {
    this.tabViews.reconcile(snapshot)
  }

  navigateTab(tabId: string, url: string): void {
    this.tabViews.navigate(tabId, url)
  }

  sendDiffs(batch: DiffBatch): void {
    if (this.disposed) return
    const contents = this.chromeView.webContents
    if (contents.isDestroyed()) return
    contents.send(IPC.diffs, batch)
  }

  isChromeSender(contents: WebContents): boolean {
    return contents === this.chromeView.webContents
  }

  focus(): void {
    if (this.window.isDestroyed()) return
    if (this.window.isMinimized()) this.window.restore()
    this.window.focus()
  }

  hasAttachedTab(tabId: string | null): boolean {
    return tabId !== null && this.tabViews.hasAttachedView(tabId)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.tabViews.dispose()
    if (!this.chromeView.webContents.isDestroyed()) this.chromeView.webContents.close()
    if (!this.window.isDestroyed()) this.window.destroy()
  }

  private layout(): void {
    if (this.disposed || this.window.isDestroyed()) return
    const { width, height } = this.window.getContentBounds()
    this.chromeView.setBounds({
      x: 0,
      y: 0,
      width: Math.min(SIDEBAR_WIDTH, width),
      height
    })
    this.tabViews.layout()
  }

  private hardenChrome(): void {
    const contents = this.chromeView.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-navigate', (event, url) => {
      if (!this.isChromeUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!this.isChromeUrl(url)) event.preventDefault()
    })
  }

  private isChromeUrl(url: string): boolean {
    try {
      const target = new URL(url)
      if (this.rendererUrl) {
        const base = new URL(this.rendererUrl)
        return target.origin === base.origin
      }
      if (this.rendererHtmlPath) {
        return target.href === pathToFileURL(this.rendererHtmlPath).href
      }
      return false
    } catch {
      return false
    }
  }
}
