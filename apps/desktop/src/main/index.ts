import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { app, dialog } from 'electron'
import { DiffBatcher } from '@ione/core'
import { initializeState } from './bootstrap'
import { ChromeWindow } from './chrome-window'
import { BrowserController } from './controller'
import { registerIpc } from './ipc'
import { WriteBehindPersistence } from './persistence/write-behind'
import { hardenApp } from './security'
import { parseTabSleepEnv, TabSleepManager } from './sleep-manager'

const isSmokeTest = process.argv.includes('--smoke-test')

let database: Database.Database | null = null
let controller: BrowserController | null = null
let chromeWindow: ChromeWindow | null = null
let sleepManager: TabSleepManager | null = null
let batcher: DiffBatcher | null = null
let smokeTimer: NodeJS.Timeout | null = null
let shuttingDown = false

app.setName('Ione')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.enableSandbox()
  app.on('second-instance', () => chromeWindow?.focus())
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', shutdown)
  app.whenReady().then(start, (error: unknown) => failStartup(error))
}

function start(): void {
  try {
    hardenApp()

    const dbPath =
      process.env['IONE_DB_PATH'] && process.env['IONE_DB_PATH'].length > 0
        ? process.env['IONE_DB_PATH']
        : join(app.getPath('userData'), 'ione.sqlite')

    const initialized = initializeState(dbPath)
    database = initialized.db
    const persistence = new WriteBehindPersistence(initialized.repository)

    batcher = new DiffBatcher((batch) => {
      chromeWindow?.sendDiffs(batch)
    })

    controller = new BrowserController(
      initialized.snapshot,
      persistence,
      (diffs, fromVersion, toVersion) => {
        batcher?.add(diffs, fromVersion, toVersion)
      },
      (snapshot) => {
        chromeWindow?.reconcile(snapshot)
      }
    )

    chromeWindow = new ChromeWindow({
      preloadPath: join(__dirname, '../preload/index.js'),
      rendererUrl: devRendererUrl(),
      rendererHtmlPath: join(__dirname, '../renderer/index.html'),
      onTabEvent: (tabId, patch) => {
        controller?.updateTab(tabId, patch)
      },
      onOpenInNewTab: (url) => {
        controller?.createTab(url)
      },
      onReady: () => onChromeReady(dbPath)
    })

    sleepManager = new TabSleepManager({
      controller,
      tabViews: chromeWindow.tabViews,
      ...parseTabSleepEnv()
    })

    chromeWindow.reconcile(controller.snapshot)
    registerIpc(controller, chromeWindow)
    chromeWindow.load()

    if (isSmokeTest) {
      smokeTimer = setTimeout(() => {
        failSmoke('IONE_SMOKE_TIMEOUT')
      }, 20_000)
    }
  } catch (error) {
    failStartup(error)
  }
}

interface ChromeProbe {
  hasBridge: boolean
  hasAddress: boolean
  tabRows: number
  title: string
  address: string
  navUrl: string | null
  essentialCount: number
  essentialTitle: string
  pinnedCount: number
  resetAddress: string
  spaceCount: number
  activeSpaceName: string
  folderCount: number
  folderTabId: string | null
  folderError: string | null
  dragIntoFolder: boolean
  sleepCycleOk: boolean
  tabListPresent: boolean
  virtualListPresent: boolean
}

function onChromeReady(dbPath: string): void {
  if (!controller || !chromeWindow) return
  chromeWindow.reconcile(controller.snapshot)
  // Views exist by the time the chrome is ready, so background sleeping can
  // begin in both smoke and normal runs.
  sleepManager?.start()

  if (!isSmokeTest) {
    chromeWindow.focus()
    return
  }

  void runSmokeProbe(dbPath)
}

async function runSmokeProbe(dbPath: string): Promise<void> {
  if (!controller || !chromeWindow) return

  const initialActiveTabId = controller.snapshot.activeTabId
  if (!chromeWindow.hasAttachedTab(initialActiveTabId)) {
    failSmoke('IONE_SMOKE_FAILED active tab view not attached')
    return
  }

  const probe = await probeChrome()
  const expectedUrl = process.env['IONE_SMOKE_URL'] ?? null
  const phase3Ok =
    expectedUrl === null ||
    (probe !== null &&
      probe.navUrl === expectedUrl &&
      probe.title === 'Smoke Page' &&
      probe.address === expectedUrl &&
      probe.essentialCount >= 1 &&
      probe.essentialTitle.includes('Smoke Essential') &&
      probe.pinnedCount >= 1 &&
      probe.resetAddress === expectedUrl &&
      probe.spaceCount >= 2 &&
      probe.activeSpaceName === 'Home' &&
      probe.folderCount >= 2 &&
      probe.folderTabId !== null &&
      probe.folderError === null &&
      probe.dragIntoFolder &&
      probe.sleepCycleOk &&
      probe.tabListPresent &&
      probe.virtualListPresent)
  if (
    !probe ||
    !probe.hasBridge ||
    !probe.hasAddress ||
    probe.tabRows < 1 ||
    !phase3Ok
  ) {
    failSmoke(`IONE_SMOKE_FAILED chrome probe ${JSON.stringify(probe)}`)
    return
  }

  const screenshotPath = process.env['IONE_SMOKE_SCREENSHOT']
  if (screenshotPath) {
    try {
      await captureChromeScreenshot(screenshotPath)
    } catch (error) {
      console.error('[smoke] screenshot failed', error)
      failSmoke('IONE_SMOKE_FAILED screenshot')
      return
    }
  }

  if (smokeTimer) {
    clearTimeout(smokeTimer)
    smokeTimer = null
  }
  console.log(
    `IONE_SMOKE_READY ${JSON.stringify({
      activeTabId: controller.snapshot.activeTabId,
      activeSpaceId: controller.snapshot.activeSpaceId,
      version: controller.snapshot.version,
      dbPath,
      probe,
      screenshotPath: screenshotPath ?? null
    })}`
  )
  setTimeout(() => app.quit(), 150)
}

async function probeChrome(): Promise<ChromeProbe | null> {
  if (!chromeWindow) return null
  const targetUrl = process.env['IONE_SMOKE_URL'] ?? null
  try {
    const raw: unknown = await chromeWindow.chromeView.webContents.executeJavaScript(`
      (async () => {
        const targetUrl = ${JSON.stringify(targetUrl)}
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const waitFor = async (predicate, timeout = 5000) => {
          const started = Date.now()
          while (Date.now() - started < timeout) {
            if (predicate()) return true
            await sleep(50)
          }
          return false
        }
        const waitForSnapshot = async (predicate, timeout = 7000) => {
          const started = Date.now()
          while (Date.now() - started < timeout) {
            const value = await window.ione.getSnapshot()
            if (predicate(value)) return value
            await sleep(50)
          }
          return null
        }
        const addressValue = () =>
          document.querySelector('[data-testid="address-input"]')?.value ?? ''
        const spaceTitle = () =>
          document.querySelector('.space-title')?.textContent?.trim() ?? ''
        const activeTitle = () =>
          (
            document.querySelector(
              '[data-testid="tab-row"].active .tab-title, [data-testid="pinned-tab"].active .tab-title'
            )?.textContent ?? ''
          ).trim()

        const initial = await window.ione.getSnapshot()
        const homeSpaceId = initial.activeSpaceId
        const homeSpaceName = initial.spaces[homeSpaceId]?.name ?? ''
        await waitFor(
          () =>
            document.querySelector('[data-testid="address-input"]') !== null &&
            document.querySelectorAll('[data-testid="tab-row"], [data-testid="pinned-tab"]').length > 0
        )

        let essentialError = null
        if (targetUrl) {
          try {
            await window.ione.addEssential({ url: targetUrl, title: 'Smoke Essential' })
          } catch (error) {
            essentialError = String(error)
          }
        }
        await waitFor(() => document.querySelectorAll('[data-testid="essential-tile"]').length > 0)

        let navUrl = null
        if (targetUrl) {
          try {
            const result = await window.ione.navigate(targetUrl)
            navUrl = result ? result.url : null
          } catch (error) {
            navUrl = 'ERROR: ' + String(error)
          }
        }
        await waitFor(
          () => activeTitle() === 'Smoke Page' && addressValue() === targetUrl,
          7000
        )

        let pinError = null
        const beforePin = await window.ione.getSnapshot()
        const pinnedTabId = beforePin.activeTabId
        if (pinnedTabId) {
          try {
            await window.ione.pinTab(pinnedTabId)
          } catch (error) {
            pinError = String(error)
          }
        }
        await waitFor(() => document.querySelectorAll('[data-testid="pinned-tab"]').length > 0)

        let resetError = null
        let resetAddress = ''
        if (targetUrl && pinnedTabId) {
          try {
            await window.ione.navigate('about:blank')
            await waitFor(() => addressValue() === 'about:blank')
            await window.ione.resetPinnedTab(pinnedTabId)
            await waitFor(() => addressValue() === targetUrl, 7000)
            resetAddress = addressValue()
          } catch (error) {
            resetError = String(error)
          }
        }

        let folderError = null
        let folderId = null
        let folderTabId = null
        let subfolderId = null
        let dragIntoFolder = false
        if (targetUrl) {
          try {
            const folder = await window.ione.createFolder({
              spaceId: homeSpaceId,
              name: 'Smoke Folder'
            })
            folderId = folder.id
            await waitFor(
              () =>
                document.querySelector(
                  '[data-testid="folder-row"][data-folder-id="' + folderId + '"]'
                ) !== null
            )
            const folderTab = await window.ione.createTabInFolder(folderId, targetUrl)
            folderTabId = folderTab.id
            await waitFor(() => activeTitle() === 'Smoke Page', 7000)

            let snap = await window.ione.getSnapshot()
            if (snap.tabs[folderTabId]?.folderId !== folderId) {
              folderError = 'tab was not created in folder'
            }

            await window.ione.updateFolder(folderId, { collapsed: true })
            await waitFor(
              () => document.querySelector('[data-tab-id="' + folderTabId + '"]') === null
            )
            await window.ione.updateFolder(folderId, { collapsed: false })
            await waitFor(
              () => document.querySelector('[data-tab-id="' + folderTabId + '"]') !== null
            )

            await window.ione.moveTab(folderTabId, {
              spaceId: homeSpaceId,
              folderId: null,
              beforeTabId: null
            })
            snap = await window.ione.getSnapshot()
            if (snap.tabs[folderTabId]?.folderId !== undefined) {
              folderError = 'tab was not moved out of folder'
            }
            await waitFor(
              () => document.querySelector('[data-tab-id="' + folderTabId + '"]') !== null
            )

            const source = document.querySelector('[data-tab-id="' + folderTabId + '"]')
            const target = document.querySelector(
              '[data-testid="folder-row"][data-folder-id="' + folderId + '"]'
            )
            if (source instanceof HTMLElement && target instanceof HTMLElement) {
              const sourceRect = source.getBoundingClientRect()
              const targetRect = target.getBoundingClientRect()
              const fromX = sourceRect.left + 24
              const fromY = sourceRect.top + sourceRect.height / 2
              const toX = targetRect.left + 24
              const toY = targetRect.top + targetRect.height / 2
              source.dispatchEvent(
                new PointerEvent('pointerdown', {
                  bubbles: true,
                  button: 0,
                  pointerId: 7,
                  clientX: fromX,
                  clientY: fromY
                })
              )
              window.dispatchEvent(
                new PointerEvent('pointermove', {
                  bubbles: true,
                  pointerId: 7,
                  buttons: 1,
                  clientX: toX,
                  clientY: toY
                })
              )
              window.dispatchEvent(
                new PointerEvent('pointerup', {
                  bubbles: true,
                  pointerId: 7,
                  clientX: toX,
                  clientY: toY
                })
              )
              const dragged = await waitForSnapshot(
                (value) => value.tabs[folderTabId]?.folderId === folderId,
                5000
              )
              dragIntoFolder = dragged !== null
            }

            const subfolder = await window.ione.createFolder({
              spaceId: homeSpaceId,
              parentId: folderId,
              name: 'Nested'
            })
            subfolderId = subfolder.id
            await window.ione.moveFolder(subfolderId, { parentId: null })
            const afterMove = await window.ione.getSnapshot()
            if (afterMove.folders[subfolderId]?.parentId !== undefined) {
              folderError = 'folder was not moved to root'
            }
            await waitFor(
              () =>
                document.querySelectorAll('[data-testid="folder-row"]').length >= 2
            )
          } catch (error) {
            folderError = String(error)
          }
        }

        let createSpaceError = null
        let smokeSpaceId = null
        try {
          const space = await window.ione.createSpace({
            name: 'Smoke Space',
            icon: 'S',
            theme: 'ocean'
          })
          smokeSpaceId = space.id
        } catch (error) {
          createSpaceError = String(error)
        }
        await waitFor(
          () =>
            document.querySelectorAll('[data-testid="space-chip"]').length >= 2 &&
            spaceTitle() === 'Smoke Space'
        )
        if (targetUrl) {
          await window.ione.createTab(targetUrl)
          await waitFor(
            () =>
              document.querySelectorAll('[data-testid="tab-row"]').length >= 1 &&
              spaceTitle() === 'Smoke Space'
          )
          await waitFor(() => activeTitle() === 'Smoke Page', 7000)
        }

        await window.ione.activateSpace(homeSpaceId)
        await waitFor(() => spaceTitle() === homeSpaceName)
        if (targetUrl) {
          await window.ione.createTab(targetUrl)
          await waitFor(() => activeTitle() === 'Smoke Page', 7000)
        }
        await waitFor(() => document.querySelector('[role="list"]') !== null)

        let sleepCycleOk = false
        if (targetUrl && folderTabId) {
          const activeNow = await window.ione.getSnapshot()
          if (activeNow.activeTabId !== folderTabId) {
            await window.ione.activateTab(folderTabId)
            await waitFor(() => activeTitle() === 'Smoke Page', 7000)
          }
          await window.ione.createTab(targetUrl)
          await waitFor(() => activeTitle() === 'Smoke Page', 7000)
          const slept = await waitForSnapshot(
            (value) => value.tabs[folderTabId]?.sleeping === true,
            7000
          )
          if (slept) {
            await window.ione.activateTab(folderTabId)
            const woke = await waitForSnapshot(
              (value) =>
                value.tabs[folderTabId]?.sleeping === false &&
                value.activeTabId === folderTabId,
              7000
            )
            await waitFor(() => activeTitle() === 'Smoke Page', 7000)
            sleepCycleOk = woke !== null
          }
        }

        const final = await window.ione.getSnapshot()
        const essentialTitle =
          document.querySelector('[data-testid="essential-tile"] .essential-title')?.textContent?.trim() ?? ''
        return {
          hasBridge: typeof window.ione === 'object' && window.ione !== null,
          hasAddress: document.querySelector('[data-testid="address-input"]') !== null,
          tabRows: document.querySelectorAll('[data-testid="tab-row"]').length,
          title: activeTitle(),
          address: addressValue(),
          navUrl,
          essentialCount: document.querySelectorAll('[data-testid="essential-tile"]').length,
          essentialTitle,
          essentialError,
          pinnedCount: document.querySelectorAll('[data-testid="pinned-tab"]').length,
          pinError,
          resetAddress,
          resetError,
          spaceCount: document.querySelectorAll('[data-testid="space-chip"]').length,
          activeSpaceName: final.spaces[final.activeSpaceId]?.name ?? '',
          activeSpaceId: final.activeSpaceId,
          homeSpaceId,
          smokeSpaceId,
          createSpaceError,
          folderCount: document.querySelectorAll('[data-testid="folder-row"]').length,
          folderId,
          folderTabId,
          subfolderId,
          folderError,
          dragIntoFolder,
          sleepCycleOk,
          tabListPresent: document.querySelector('[data-testid="tab-list"]') !== null,
          virtualListPresent: document.querySelector('[data-testid="tab-list"] [role="list"]') !== null
        }
      })()
    `)
    if (typeof raw !== 'object' || raw === null) return null
    const record = raw as Record<string, unknown>
    return {
      hasBridge: record['hasBridge'] === true,
      hasAddress: record['hasAddress'] === true,
      tabRows: typeof record['tabRows'] === 'number' ? record['tabRows'] : 0,
      title: typeof record['title'] === 'string' ? record['title'] : '',
      address: typeof record['address'] === 'string' ? record['address'] : '',
      navUrl: typeof record['navUrl'] === 'string' ? record['navUrl'] : null,
      essentialCount:
        typeof record['essentialCount'] === 'number' ? record['essentialCount'] : 0,
      essentialTitle:
        typeof record['essentialTitle'] === 'string' ? record['essentialTitle'] : '',
      pinnedCount: typeof record['pinnedCount'] === 'number' ? record['pinnedCount'] : 0,
      resetAddress: typeof record['resetAddress'] === 'string' ? record['resetAddress'] : '',
      spaceCount: typeof record['spaceCount'] === 'number' ? record['spaceCount'] : 0,
      activeSpaceName:
        typeof record['activeSpaceName'] === 'string' ? record['activeSpaceName'] : '',
      folderCount: typeof record['folderCount'] === 'number' ? record['folderCount'] : 0,
      folderTabId: typeof record['folderTabId'] === 'string' ? record['folderTabId'] : null,
      folderError: typeof record['folderError'] === 'string' ? record['folderError'] : null,
      dragIntoFolder: record['dragIntoFolder'] === true,
      sleepCycleOk: record['sleepCycleOk'] === true,
      tabListPresent: record['tabListPresent'] === true,
      virtualListPresent: record['virtualListPresent'] === true
    }
  } catch (error) {
    console.error('[smoke] chrome probe failed', error)
    return null
  }
}

async function captureChromeScreenshot(path: string): Promise<void> {
  if (!chromeWindow) throw new Error('chrome view is gone')
  const target = chromeWindow.chromeView.webContents.debugger
  const attachedHere = !target.isAttached()
  if (attachedHere) target.attach('1.3')
  try {
    await target.sendCommand('Page.enable')
    const result = (await target.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    })) as { data?: unknown }
    if (typeof result.data !== 'string') throw new Error('CDP returned no screenshot data')
    writeFileSync(path, Buffer.from(result.data, 'base64'))
  } finally {
    if (attachedHere && target.isAttached()) target.detach()
  }
}

function failSmoke(message: string): void {
  console.error(message)
  app.exit(1)
  // A hung compositor/graphics process must not keep the smoke harness alive.
  setTimeout(() => process.exit(1), 500)
}

function failStartup(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error('[startup] failed', error)
  dialog.showErrorBox('Ione failed to start', message)
  app.exit(1)
}

function devRendererUrl(): string | undefined {
  if (app.isPackaged) return undefined
  const raw = process.env['ELECTRON_RENDERER_URL']
  if (!raw) return undefined
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:') return undefined
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== '[::1]') {
      console.error('[startup] ignoring non-loopback ELECTRON_RENDERER_URL', raw)
      return undefined
    }
    return parsed.href
  } catch {
    console.error('[startup] ignoring invalid ELECTRON_RENDERER_URL', raw)
    return undefined
  }
}

function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true

  if (smokeTimer) {
    clearTimeout(smokeTimer)
    smokeTimer = null
  }

  sleepManager?.stop()
  sleepManager = null

  try {
    controller?.dispose()
  } catch (error) {
    console.error('[shutdown] persistence flush failed', error)
  }
  controller = null

  batcher?.dispose()
  batcher = null

  chromeWindow?.dispose()
  chromeWindow = null

  try {
    database?.close()
  } catch (error) {
    console.error('[shutdown] database close failed', error)
  }
  database = null
}
