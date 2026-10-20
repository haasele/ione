import { session, WebContentsView, type BaseWindow, type WebPreferences } from 'electron'
import { isSafeNavigationUrl, type BrowserSnapshot, type Tab, type TabPatch } from '@ione/core'

export interface TabViewManagerOptions {
  window: BaseWindow
  sidebarWidth: number
  onTabEvent: (tabId: string, patch: TabPatch) => void
  onOpenInNewTab: (url: string) => void
}

interface ManagedTabView {
  view: WebContentsView
  /** Target currently being loaded; prevents a duplicate load on tab creation. */
  loadingUrl: string | null
}

const TAB_WEB_PREFERENCES: WebPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  webviewTag: false,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  spellcheck: true
}

export class TabViewManager {
  private readonly window: BaseWindow
  private readonly sidebarWidth: number
  private readonly onTabEvent: TabViewManagerOptions['onTabEvent']
  private readonly onOpenInNewTab: TabViewManagerOptions['onOpenInNewTab']
  private readonly views = new Map<string, ManagedTabView>()
  private attachedId: string | null = null
  private disposed = false
  private popupTimes: number[] = []

  constructor(options: TabViewManagerOptions) {
    this.window = options.window
    this.sidebarWidth = options.sidebarWidth
    this.onTabEvent = options.onTabEvent
    this.onOpenInNewTab = options.onOpenInNewTab
  }

  reconcile(snapshot: BrowserSnapshot): void {
    if (this.disposed) return

    for (const [id, managed] of this.views) {
      if (!snapshot.tabs[id]) this.destroyView(id, managed)
    }

    const activeTab =
      snapshot.activeTabId !== null ? snapshot.tabs[snapshot.activeTabId] : undefined
    const active = activeTab && activeTab.spaceId === snapshot.activeSpaceId ? activeTab : undefined

    for (const [id, managed] of this.views) {
      if (id !== active?.id && this.attachedId === id) {
        this.window.contentView.removeChildView(managed.view)
        this.attachedId = null
      }
    }

    if (!active) return

    let managed = this.views.get(active.id)
    if (managed && active.sleeping) {
      this.destroyView(active.id, managed)
      managed = undefined
    }

    if (!managed) {
      const partitionId = snapshot.spaces[active.spaceId]?.partitionId
      managed = this.createView(active, partitionId)
      this.views.set(active.id, managed)
    }

    if (this.attachedId !== active.id) {
      this.window.contentView.addChildView(managed.view)
      this.attachedId = active.id
    }
    managed.view.setBounds(this.contentBounds())
  }

  navigate(tabId: string, url: string): void {
    if (!isSafeNavigationUrl(url)) return
    const managed = this.views.get(tabId)
    if (!managed) return
    if (managed.loadingUrl === url) return

    managed.loadingUrl = url
    void managed.view.webContents.loadURL(url).catch((error: unknown) => {
      managed.loadingUrl = null
      console.error('[tab] failed to load', url, error)
    })
  }

  layout(): void {
    if (this.disposed) return
    for (const managed of this.views.values()) {
      // Inactive views are detached; keeping their bounds current is harmless
      // and avoids a layout flash when they are attached again.
      managed.view.setBounds(this.contentBounds())
    }
  }

  hasAttachedView(tabId: string): boolean {
    return this.attachedId === tabId
  }

  focusActive(): void {
    if (this.disposed || this.attachedId === null) return
    this.views.get(this.attachedId)?.view.webContents.focus()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [id, managed] of [...this.views]) this.destroyView(id, managed)
  }

  private contentBounds(): Electron.Rectangle {
    const { width, height } = this.window.getContentBounds()
    return {
      x: this.sidebarWidth,
      y: 0,
      width: Math.max(0, width - this.sidebarWidth),
      height
    }
  }

  private createView(tab: Tab, partitionId: string | undefined): ManagedTabView {
    const webPreferences: WebPreferences = { ...TAB_WEB_PREFERENCES }
    if (partitionId && /^[A-Za-z0-9_-]{1,64}$/.test(partitionId)) {
      const partition = `persist:${partitionId}`
      webPreferences.partition = partition
      // Apply the same deny-by-default permission policy to isolated spaces.
      hardenSession(session.fromPartition(partition))
    } else {
      hardenSession(session.defaultSession)
    }

    const initialUrl = isSafeNavigationUrl(tab.url) ? tab.url : 'about:blank'
    const view = new WebContentsView({ webPreferences })
    view.setBackgroundColor('#ffffff')
    view.setBorderRadius(10)

    const contents = view.webContents
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (
        !this.disposed &&
        disposition !== 'background-tab' &&
        isSafeNavigationUrl(url) &&
        this.allowPopup()
      ) {
        this.onOpenInNewTab(url)
      }
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-navigate', (event, url) => {
      if (!isSafeNavigationUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isSafeNavigationUrl(url)) event.preventDefault()
    })
    contents.on('will-prevent-unload', (event) => event.preventDefault())

    contents.on('page-title-updated', (_event, title) => {
      this.emitTabEvent(tab.id, { title })
    })
    contents.on('page-favicon-updated', (_event, favicons) => {
      const favicon = favicons.find((candidate) => candidate.length <= 100_000)
      if (favicon) this.emitTabEvent(tab.id, { favicon })
    })
    contents.on('did-navigate', (_event, url) => {
      const managed = this.views.get(tab.id)
      if (managed) managed.loadingUrl = null
      if (isSafeNavigationUrl(url)) this.emitTabEvent(tab.id, { url })
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame && isSafeNavigationUrl(url)) this.emitTabEvent(tab.id, { url })
    })
    contents.on('did-fail-load', (_event, errorCode, _description, validatedUrl, isMainFrame) => {
      const managed = this.views.get(tab.id)
      if (managed && managed.loadingUrl === validatedUrl) managed.loadingUrl = null
      if (!isMainFrame || errorCode === -3 || this.disposed) return
      console.warn(`[tab] load failed (${errorCode}) ${validatedUrl}`)
    })
    contents.on('render-process-gone', (_event, details) => {
      if (!this.disposed) console.error(`[tab] renderer gone: ${details.reason}`)
    })

    const managed: ManagedTabView = { view, loadingUrl: initialUrl }
    void contents.loadURL(initialUrl).catch((error: unknown) => {
      managed.loadingUrl = null
      console.error('[tab] initial load failed', initialUrl, error)
    })
    return managed
  }

  private allowPopup(): boolean {
    const now = Date.now()
    this.popupTimes = this.popupTimes.filter((time) => now - time < 10_000)
    if (this.popupTimes.length >= 5) return false
    this.popupTimes.push(now)
    return true
  }

  private destroyView(tabId: string, managed: ManagedTabView): void {
    if (this.attachedId === tabId) {
      this.window.contentView.removeChildView(managed.view)
      this.attachedId = null
    }
    this.views.delete(tabId)
    if (!managed.view.webContents.isDestroyed()) managed.view.webContents.close()
  }

  private emitTabEvent(tabId: string, patch: TabPatch): void {
    if (!this.disposed) this.onTabEvent(tabId, patch)
  }
}

function hardenSession(target: Electron.Session): void {
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  target.setPermissionCheckHandler(() => false)
}
