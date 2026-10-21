import {
  session,
  WebContentsView,
  type BaseWindow,
  type ContextMenuParams,
  type MenuItem,
  type WebContents,
  type WebPreferences
} from 'electron'
import buildChromeContextMenu from 'electron-chrome-context-menu'
import { isSafeNavigationUrl, type BrowserSnapshot, type Tab, type TabPatch } from '@ione/core'
import {
  BROWSER_SESSION_PARTITION,
  browserSession,
  hardenSession
} from './browser-session'

export interface TabViewManagerOptions {
  window: BaseWindow
  sidebarWidth: number
  onTabEvent: (tabId: string, patch: TabPatch) => void
  onOpenInNewTab: (url: string) => void
}

export interface TabExtensionBridge {
  addTab(tab: WebContents, window: BaseWindow): void
  removeTab(tab: WebContents): void
  selectTab(tab: WebContents): void
  getContextMenuItems(tab: WebContents, params: ContextMenuParams): MenuItem[]
}

interface ManagedTabView {
  view: WebContentsView
  /** Target currently being loaded; prevents a duplicate load on tab creation. */
  loadingUrl: string | null
  /** Scroll offset to restore after the first successful load, then cleared. */
  restoreScrollY: number
  /** True when this view lives in the extension-enabled browser session. */
  extensionManaged: boolean
}

/** Upper bound for reading scrollY from a renderer that may be unresponsive. */
const SCROLL_CAPTURE_TIMEOUT_MS = 500

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
  private attachedManaged: ManagedTabView | null = null
  private disposed = false
  private popupTimes: number[] = []
  private extensionBridge: TabExtensionBridge | null = null

  constructor(options: TabViewManagerOptions) {
    this.window = options.window
    this.sidebarWidth = options.sidebarWidth
    this.onTabEvent = options.onTabEvent
    this.onOpenInNewTab = options.onOpenInNewTab
  }

  reconcile(snapshot: BrowserSnapshot): void {
    if (this.disposed) return

    const activeTab =
      snapshot.activeTabId !== null ? snapshot.tabs[snapshot.activeTabId] : undefined
    const active = activeTab && activeTab.spaceId === snapshot.activeSpaceId ? activeTab : undefined

    // A view is retired when its tab is gone or explicitly sleeping. This is
    // independent of the active tab: sleeping background tabs release their
    // WebContents too.
    for (const [id, managed] of [...this.views]) {
      const tab = snapshot.tabs[id]
      if (!tab || tab.sleeping) this.retireView(id, managed)
    }

    // Awake inactive tabs keep their view but are detached from the window.
    for (const [id, managed] of [...this.views]) {
      if (id !== active?.id && this.attachedId === id) this.detachView(id, managed)
    }

    if (!active || active.sleeping) return

    let managed = this.views.get(active.id)
    if (!managed) {
      const partitionId = snapshot.spaces[active.spaceId]?.partitionId
      managed = this.createView(active, partitionId)
      this.views.set(active.id, managed)
    }

    if (this.attachedManaged !== managed) {
      this.window.contentView.addChildView(managed.view)
      this.attachedId = active.id
      this.attachedManaged = managed
      if (managed.extensionManaged) {
        this.extensionBridge?.selectTab(managed.view.webContents)
      }
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

  setExtensionBridge(bridge: TabExtensionBridge | null): void {
    this.extensionBridge = bridge
    if (!bridge) return
    for (const managed of this.views.values()) {
      if (managed.extensionManaged) bridge.addTab(managed.view.webContents, this.window)
    }
    if (this.attachedManaged?.extensionManaged) {
      bridge.selectTab(this.attachedManaged.view.webContents)
    }
  }

  getWebContents(tabId: string): WebContents | null {
    return this.views.get(tabId)?.view.webContents ?? null
  }

  tabIdForContents(contents: WebContents): string | null {
    for (const [tabId, managed] of this.views) {
      if (managed.view.webContents === contents) return tabId
    }
    return null
  }

  hasView(tabId: string): boolean {
    return this.views.has(tabId)
  }

  isAudible(tabId: string): boolean {
    const managed = this.views.get(tabId)
    if (!managed) return false
    const contents = managed.view.webContents
    if (contents.isDestroyed()) return false
    return contents.isCurrentlyAudible()
  }

  isDevToolsOpen(tabId: string): boolean {
    const managed = this.views.get(tabId)
    if (!managed) return false
    const contents = managed.view.webContents
    if (contents.isDestroyed()) return false
    return contents.isDevToolsOpened()
  }

  /** Reads the current window.scrollY; null when no live view exists or the read fails. */
  async captureScroll(tabId: string): Promise<number | null> {
    const managed = this.views.get(tabId)
    if (!managed) return null
    return this.captureScrollOf(managed)
  }

  focusActive(): void {
    if (this.disposed || this.attachedId === null) return
    this.views.get(this.attachedId)?.view.webContents.focus()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [id, managed] of [...this.views]) {
      this.views.delete(id)
      if (managed.extensionManaged && !managed.view.webContents.isDestroyed()) {
        this.extensionBridge?.removeTab(managed.view.webContents)
      }
      this.removeAttachedView(managed)
      this.closeManagedView(managed)
    }
    this.attachedId = null
    this.attachedManaged = null
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
    let extensionManaged = false
    if (partitionId && /^[A-Za-z0-9_-]{1,64}$/.test(partitionId)) {
      const partition = `persist:${partitionId}`
      webPreferences.partition = partition
      // Apply the same deny-by-default permission policy to isolated spaces.
      hardenSession(session.fromPartition(partition))
    } else {
      webPreferences.partition = BROWSER_SESSION_PARTITION
      extensionManaged = true
      hardenSession(browserSession())
    }

    const initialUrl = isSafeNavigationUrl(tab.url) ? tab.url : 'about:blank'
    const view = new WebContentsView({ webPreferences })
    view.setBackgroundColor('#ffffff')
    view.setBorderRadius(10)

    const contents = view.webContents
    if (extensionManaged) this.extensionBridge?.addTab(contents, this.window)
    contents.on('context-menu', (_event, params) => {
      const extensionItems = extensionManaged
        ? (this.extensionBridge?.getContextMenuItems(contents, params) ?? [])
        : []
      const menu = buildChromeContextMenu({
        params,
        webContents: contents,
        extensionMenuItems: extensionItems,
        openLink: (url) => {
          if (isSafeNavigationUrl(url)) this.onOpenInNewTab(url)
        }
      })
      menu.popup({ window: this.window })
    })
    const restoreScrollY =
      Number.isFinite(tab.scrollY) && tab.scrollY > 0 ? Math.floor(tab.scrollY) : 0
    const managed: ManagedTabView = {
      view,
      loadingUrl: initialUrl,
      restoreScrollY,
      extensionManaged
    }

    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (
        !this.disposed &&
        disposition !== 'background-tab' &&
        isContentNavigationAllowed(url, contents) &&
        this.allowPopup()
      ) {
        this.onOpenInNewTab(url)
      }
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-navigate', (event, url) => {
      if (!isContentNavigationAllowed(url, contents)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isContentNavigationAllowed(url, contents)) event.preventDefault()
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
    contents.on('did-finish-load', () => {
      const scrollY = managed.restoreScrollY
      if (scrollY <= 0) return
      managed.restoreScrollY = 0
      if (this.disposed || contents.isDestroyed()) return
      void contents
        .executeJavaScript(`window.scrollTo(0, ${scrollY})`)
        .catch((error: unknown) => {
          console.warn('[tab] scroll restore failed', error)
        })
    })

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

  private retireView(tabId: string, managed: ManagedTabView): void {
    this.views.delete(tabId)
    if (managed.extensionManaged && !managed.view.webContents.isDestroyed()) {
      this.extensionBridge?.removeTab(managed.view.webContents)
    }
    if (this.disposed || this.attachedManaged !== managed) {
      this.closeManagedView(managed)
      return
    }

    // Capture the scroll position while the renderer is still alive, then
    // detach and release the WebContents. Emitting through onTabEvent keeps the
    // snapshot authoritative for the next lazy restore.
    void this.captureScrollOf(managed)
      .then((scrollY) => {
        if (scrollY !== null) this.emitTabEvent(tabId, { scrollY })
      })
      .finally(() => {
        this.removeAttachedView(managed)
        this.closeManagedView(managed)
      })
  }

  private detachView(tabId: string, managed: ManagedTabView): void {
    if (this.attachedManaged !== managed) return
    // Mark the view logically detached now so a reconcile triggered by the
    // scroll capture does not queue a duplicate capture.
    this.attachedId = null
    this.attachedManaged = null
    void this.captureScrollOf(managed)
      .then((scrollY) => {
        if (scrollY !== null && this.attachedManaged !== managed) {
          this.emitTabEvent(tabId, { scrollY })
        }
      })
      .finally(() => {
        // A quick switch back may have reattached this view while the scroll
        // query was in flight; never remove a live attached view.
        if (this.attachedManaged !== managed) this.removeAttachedView(managed)
      })
  }

  private removeAttachedView(managed: ManagedTabView): void {
    if (this.attachedManaged === managed) {
      this.attachedId = null
      this.attachedManaged = null
    }
    try {
      this.window.contentView.removeChildView(managed.view)
    } catch {
      // The window may already be gone during shutdown.
    }
  }

  private closeManagedView(managed: ManagedTabView): void {
    if (!managed.view.webContents.isDestroyed()) managed.view.webContents.close()
  }

  private captureScrollOf(managed: ManagedTabView): Promise<number | null> {
    const contents = managed.view.webContents
    if (contents.isDestroyed()) return Promise.resolve(null)

    return new Promise((resolve) => {
      let settled = false
      const finish = (value: number | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => finish(null), SCROLL_CAPTURE_TIMEOUT_MS)
      timer.unref()

      try {
        contents.executeJavaScript('window.scrollY').then(
          (value: unknown) => {
            finish(
              typeof value === 'number' && Number.isFinite(value)
                ? Math.max(0, Math.floor(value))
                : null
            )
          },
          () => finish(null)
        )
      } catch {
        finish(null)
      }
    })
  }

  private emitTabEvent(tabId: string, patch: TabPatch): void {
    if (!this.disposed) this.onTabEvent(tabId, patch)
  }
}



/**
 * Normal pages may not navigate to privileged chrome-extension:// pages.
 * Extension pages themselves may navigate within the extension scheme.
 */
function isContentNavigationAllowed(url: string, contents: WebContents): boolean {
  if (!isSafeNavigationUrl(url)) return false
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return false
  }
  if (target.protocol !== 'chrome-extension:') return true
  try {
    return new URL(contents.getURL()).protocol === 'chrome-extension:'
  } catch {
    return false
  }
}
