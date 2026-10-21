import { existsSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import {
  app,
  session as electronSession,
  type BaseWindow
} from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import {
  installChromeWebStore,
  installExtension as installFromStore,
  uninstallExtension as uninstallFromStore
} from 'electron-chrome-web-store'
import type { ExtensionInfo } from '../shared/ipc'
import { browserSession } from './browser-session'
import type { BrowserController } from './controller'
import type { TabExtensionBridge, TabViewManager } from './tab-views'

type ExtensionLicense = 'GPL-3.0' | 'Patron-License-2020-11-19'

const EXTENSION_ID_PATH = /^[A-Za-z0-9_-]+$/

export interface ExtensionServiceOptions {
  controller: BrowserController
  tabViews: TabViewManager
  window: BaseWindow
  extensionsPath?: string
  license?: ExtensionLicense
  /** Disable auto-update/network work for deterministic smoke runs. */
  offline?: boolean
  onChange?: () => void
}

/**
 * Owns Chrome extension loading and the chrome.* API bridge for the browser
 * content session. The chrome UI stays in the default session.
 */
export class ExtensionService {
  readonly session = browserSession()
  readonly extensionsPath: string
  private readonly controller: BrowserController
  private readonly tabViews: TabViewManager
  private readonly browserWindow: BaseWindow
  private readonly manager: ElectronChromeExtensions
  private readonly offline: boolean
  private readonly onChange: (() => void) | undefined
  private initialized = false
  private changed = false

  constructor(options: ExtensionServiceOptions) {
    this.controller = options.controller
    this.tabViews = options.tabViews
    this.browserWindow = options.window
    this.extensionsPath =
      options.extensionsPath ?? join(app.getPath('userData'), 'Extensions')
    this.offline = options.offline ?? false
    this.onChange = options.onChange

    const license: ExtensionLicense =
      options.license ??
      (process.env['IONE_EXTENSION_LICENSE'] === 'Patron-License-2020-11-19'
        ? 'Patron-License-2020-11-19'
        : 'GPL-3.0')

    this.manager = new ElectronChromeExtensions({
      license,
      session: this.session,
      createTab: async (details) => {
        const tab = this.controller.createTab(details.url)
        const contents = this.tabViews.getWebContents(tab.id)
        if (!contents) throw new Error('Extension tab view was not created')
        return [contents, this.browserWindow]
      },
      selectTab: (contents) => {
        const tabId = this.tabViews.tabIdForContents(contents)
        if (tabId) this.controller.activateTab(tabId)
      },
      removeTab: (contents) => {
        const tabId = this.tabViews.tabIdForContents(contents)
        if (tabId) this.controller.closeTab(tabId)
      },
      assignTabDetails: (details, contents) => {
        const tabId = this.tabViews.tabIdForContents(contents)
        if (!tabId) return
        const tab = this.controller.snapshot.tabs[tabId]
        if (!tab) return
        details.active = tab.id === this.controller.snapshot.activeTabId
        details.pinned = tab.pinned
        details.discarded = tab.sleeping
      },
      requestPermissions: async () => false
    })

    // Extension icons rendered in the chrome UI use crx:// URLs from the
    // default session.
    ElectronChromeExtensions.handleCRXProtocol(electronSession.defaultSession)
    this.tabViews.setExtensionBridge(this.bridge)

    this.session.extensions.on('extension-loaded', () => this.scheduleChange())
    this.session.extensions.on('extension-unloaded', () => this.scheduleChange())
  }

  get bridge(): TabExtensionBridge {
    return {
      addTab: (contents, window) => this.manager.addTab(contents, window),
      removeTab: (contents) => this.manager.removeTab(contents),
      selectTab: (contents) => this.manager.selectTab(contents),
      getContextMenuItems: (contents, params) =>
        this.manager.getContextMenuItems(contents, params)
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    if (process.env['IONE_EXTENSIONS'] === 'off') return

    try {
      await installChromeWebStore({
        session: this.session,
        extensionsPath: this.extensionsPath,
        autoUpdate: !this.offline,
        allowUnpackedExtensions: true,
        minimumManifestVersion: 2
      })
    } catch (error) {
      console.error('[extensions] Chrome Web Store initialization failed', error)
    }

    for (const directory of this.extraDirectories()) {
      try {
        await this.session.extensions.loadExtension(directory, {
          allowFileAccess: false
        })
      } catch (error) {
        console.error('[extensions] failed to load unpacked extension', directory, error)
      }
    }

    this.scheduleChange()
  }

  list(): ExtensionInfo[] {
    return this.session.extensions
      .getAllExtensions()
      .map((extension) => this.toInfo(extension))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async install(extensionId: string): Promise<ExtensionInfo> {
    if (!EXTENSION_ID_PATH.test(extensionId)) {
      throw new TypeError('invalid Chrome extension id')
    }
    const extension = await installFromStore(extensionId, {
      session: this.session,
      extensionsPath: this.extensionsPath
    })
    this.scheduleChange()
    return this.toInfo(extension)
  }

  async uninstall(extensionId: string): Promise<void> {
    if (!EXTENSION_ID_PATH.test(extensionId)) {
      throw new TypeError('invalid Chrome extension id')
    }
    const loaded = this.session.extensions.getExtension(extensionId)
    try {
      await uninstallFromStore(extensionId, {
        session: this.session,
        extensionsPath: this.extensionsPath
      })
    } catch (error) {
      console.warn('[extensions] web store uninstall failed, unloading only', error)
      if (loaded) this.session.extensions.removeExtension(extensionId)
    }
    this.scheduleChange()
  }

  hasBlockingExtension(): boolean {
    return this.session.extensions.getAllExtensions().some((extension) => {
      const permissions = extension.manifest?.permissions
      return Array.isArray(permissions) && permissions.includes('webRequestBlocking')
    })
  }

  private toInfo(extension: Electron.Extension): ExtensionInfo {
    const manifest = extension.manifest ?? {}
    const action = manifest.action ?? manifest.browser_action ?? {}
    const popup =
      typeof action.default_popup === 'string' ? action.default_popup : null
    const optionsPage =
      typeof manifest.options_ui?.page === 'string'
        ? manifest.options_ui.page
        : typeof manifest.options_page === 'string'
          ? manifest.options_page
          : null

    return {
      id: extension.id,
      name: extension.name,
      version: extension.version,
      manifestVersion: typeof manifest.manifest_version === 'number' ? manifest.manifest_version : 0,
      popupUrl: popup ? extensionUrl(extension.id, popup) : null,
      optionsUrl: optionsPage ? extensionUrl(extension.id, optionsPage) : null,
      hasWebRequestBlocking: Array.isArray(manifest.permissions)
        ? manifest.permissions.includes('webRequestBlocking')
        : false
    }
  }

  private extraDirectories(): string[] {
    const raw = process.env['IONE_EXTENSION_DIRS']
    if (!raw) return []
    return raw
      .split(delimiter)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => (isAbsolute(part) ? resolve(part) : resolve(process.cwd(), part)))
      .filter((part) => existsSync(part))
  }

  private scheduleChange(): void {
    if (this.changed) return
    this.changed = true
    queueMicrotask(() => {
      this.changed = false
      this.onChange?.()
    })
  }
}

function extensionUrl(extensionId: string, path: string): string {
  const clean = path.replace(/^\/+/, '')
  return `chrome-extension://${extensionId}/${clean}`
}
