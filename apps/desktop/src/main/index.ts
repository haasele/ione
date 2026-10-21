import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
import { ExtensionService } from './extensions'
import { AdblockService } from './adblock'
import { FeedService } from './feed-service'
import { DownloadService } from './downloads'
import { PermissionRequestService } from './permissions'

const isSmokeTest = process.argv.includes('--smoke-test')
const appStartedAt = Date.now()
let perfBatchCount = 0
let perfDiffCount = 0

let database: Database.Database | null = null
let controller: BrowserController | null = null
let chromeWindow: ChromeWindow | null = null
let extensionService: ExtensionService | null = null
let adblockService: AdblockService | null = null
let feedService: FeedService | null = null
let downloadService: DownloadService | null = null
let permissionService: PermissionRequestService | null = null
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
      perfBatchCount += 1
      perfDiffCount += batch.diffs.length
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

    permissionService = new PermissionRequestService((request) => {
      chromeWindow?.sendPermissionRequest(request)
    })
    const permissions = permissionService

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
      requestPermission: (permission, origin, contents) =>
        permissions.request(
          permission,
          origin,
          chromeWindow?.tabViews.tabIdForContents(contents) ?? null
        ),
      onReady: () => onChromeReady(dbPath)
    })

    downloadService = new DownloadService((downloads) => {
      chromeWindow?.sendDownloads(downloads)
    })
    downloadService.initialize()

    extensionService = new ExtensionService({
      controller,
      tabViews: chromeWindow.tabViews,
      window: chromeWindow.window,
      extensionsPath: isSmokeTest
        ? join(dirname(dbPath), 'Extensions')
        : undefined,
      offline: isSmokeTest,
      onChange: () => adblockService?.handleExtensionChange()
    })
    adblockService = new AdblockService(extensionService)
    feedService = new FeedService(controller, {
      workerPath: app.isPackaged
        ? join(process.resourcesPath, 'app.asar.unpacked/out/main/feed-worker.js')
        : join(__dirname, 'feed-worker.js')
    })

    sleepManager = new TabSleepManager({
      controller,
      tabViews: chromeWindow.tabViews,
      ...parseTabSleepEnv()
    })

    chromeWindow.reconcile(controller.snapshot)
    registerIpc(
      controller,
      chromeWindow,
      extensionService,
      adblockService,
      feedService,
      downloadService,
      permissionService
    )
    chromeWindow.load()

    if (isSmokeTest) {
      smokeTimer = setTimeout(() => {
        failSmoke('IONE_SMOKE_TIMEOUT')
      }, smokeTimeoutMs())
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
  adblockReady: boolean
  adblockEnabled: boolean
  adblockSkipped: boolean
  adblockError: string | null
  extensionCount: number
  extensionNames: string
  extensionName: string
  extensionPopupTitle: string
  extensionError: string | null
  installedExtensionName: string
  installedPopupTitle: string
  installError: string | null
  extensionsPanelWorks: boolean
  extensionRows: number
  feedFolderId: string | null
  feedItemCount: number
  feedOpenTitle: string
  feedRead: boolean
  feedEtag: string
  feedError: string | null
  downloadRows: number
  downloadsPanelWorks: boolean
  permissionPromptShown: boolean
  permissionAddress: string
  permissionPageTitle: string
  permissionDenied: boolean
  paletteWorks: boolean
  themeToggleWorks: boolean
  compactToggleWorks: boolean
  findWorks: boolean
  navigationWorks: boolean
  tabListPresent: boolean
  virtualListPresent: boolean
}

function onChromeReady(dbPath: string): void {
  if (!controller || !chromeWindow) return
  chromeWindow.reconcile(controller.snapshot)
  // Views exist by the time the chrome is ready, so background sleeping can
  // begin in both smoke and normal runs.
  sleepManager?.start()

  if (!isSmokeTest) chromeWindow.focus()
  void initializeServices(dbPath)
}

async function initializeServices(dbPath: string): Promise<void> {
  try {
    await extensionService?.initialize()
  } catch (error) {
    console.error('[startup] extension initialization failed', error)
  }
  try {
    await adblockService?.initialize()
  } catch (error) {
    console.error('[startup] adblock initialization failed', error)
  }
  try {
    await feedService?.initialize()
  } catch (error) {
    console.error('[startup] feed initialization failed', error)
  }
  const loadedExtensions = extensionService?.list() ?? []
  if (loadedExtensions.length > 0) {
    console.log(
      '[extensions] loaded',
      loadedExtensions.map((extension) => `${extension.name}@${extension.version}`)
    )
  }
  if (process.env['IONE_PERF_MODE'] === '1') {
    await runPerfMode()
    return
  }
  if (isSmokeTest) await runSmokeProbe(dbPath)
}

async function runPerfMode(): Promise<void> {
  if (!controller || !chromeWindow) return
  const chromeReadyAt = Date.now()
  const targetTabs = Math.max(1, Math.min(100, Number(process.env['IONE_PERF_TABS'] ?? 1)))
  const wantsSleeping = process.env['IONE_PERF_SLEEP'] === '1'
  const currentTabs = Object.keys(controller.snapshot.tabs).length

  for (let index = currentTabs; index < targetTabs; index += 1) {
    controller.createTab('about:blank')
  }

  if (wantsSleeping) {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const snapshot = controller.snapshot
      const sleeping = Object.values(snapshot.tabs).filter((tab) => tab.sleeping).length
      if (sleeping >= Object.keys(snapshot.tabs).length - 1) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500))

  const snapshot = controller.snapshot
  const metrics = app.getAppMetrics()
  const workingSetKb = metrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0)
  console.log(
    `IONE_PERF_RESULT ${JSON.stringify({
      tabs: Object.keys(snapshot.tabs).length,
      sleepingTabs: Object.values(snapshot.tabs).filter((tab) => tab.sleeping).length,
      startupToChromeReadyMs: chromeReadyAt - appStartedAt,
      scenarioMs: Date.now() - chromeReadyAt,
      workingSetMb: Math.round(workingSetKb / 1024),
      mainRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      rendererProcesses: metrics.filter((metric) => metric.type === 'Tab').length,
      processes: metrics.map((metric) => ({
        type: metric.type,
        workingSetMb: Math.round(metric.memory.workingSetSize / 1024)
      })),
      diffBatches: perfBatchCount,
      diffs: perfDiffCount,
      version: snapshot.version
    })}`
  )
  setTimeout(() => app.quit(), 200)
}

async function runSmokeProbe(dbPath: string): Promise<void> {
  if (!controller || !chromeWindow) return

  const initialActiveTabId = controller.snapshot.activeTabId
  if (!chromeWindow.hasAttachedTab(initialActiveTabId)) {
    failSmoke('IONE_SMOKE_FAILED active tab view not attached')
    return
  }

  const downloadUrl = process.env['IONE_SMOKE_DOWNLOAD_URL'] ?? null
  if (downloadUrl && downloadService && initialActiveTabId) {
    const contents = chromeWindow.tabViews.getWebContents(initialActiveTabId)
    contents?.downloadURL(downloadUrl)
    const started = Date.now()
    while (
      !downloadService.list().some((download) => download.state === 'completed') &&
      Date.now() - started < 5000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  const probe = await probeChrome()
  const expectedUrl = process.env['IONE_SMOKE_URL'] ?? null
  const expectExtension = process.env['IONE_SMOKE_EXTENSIONS'] === '1'
  const installExtensionId = process.env['IONE_SMOKE_INSTALL_EXTENSION_ID'] ?? null
  const extensionOk =
    (!expectExtension ||
      (probe !== null &&
        probe.extensionCount >= 1 &&
        probe.extensionName === 'Ione Smoke Extension' &&
        probe.extensionPopupTitle === 'Ione Fixture Popup' &&
        probe.extensionError === null)) &&
    (installExtensionId === null ||
      (probe !== null &&
        probe.installError === null &&
        probe.installedExtensionName.length > 0 &&
        probe.extensionCount >= 1 &&
        probe.extensionsPanelWorks &&
        probe.extensionRows >= 1))
  const adblockOk = probe?.adblockReady === true && probe?.extensionsPanelWorks === true
  const feedUrl = process.env['IONE_SMOKE_FEED_URL'] ?? null
  const permissionUrl = process.env['IONE_SMOKE_PERMISSION_URL'] ?? null
  const downloadsOk =
    downloadUrl === null ||
    (probe !== null && probe.downloadRows >= 1 && probe.downloadsPanelWorks)
  const permissionsOk =
    permissionUrl === null ||
    (probe !== null && probe.permissionPromptShown && probe.permissionDenied)
  const phase7Ok =
    probe !== null &&
    probe.paletteWorks &&
    probe.themeToggleWorks &&
    probe.compactToggleWorks &&
    probe.findWorks &&
    probe.navigationWorks &&
    downloadsOk &&
    permissionsOk
  const feedOk =
    feedUrl === null ||
    (probe !== null &&
      probe.feedFolderId !== null &&
      probe.feedItemCount >= 2 &&
      probe.feedOpenTitle === 'Feed Article' &&
      probe.feedRead &&
      probe.feedEtag.length > 0 &&
      probe.feedError === null)
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
      extensionOk &&
      adblockOk &&
      feedOk &&
      phase7Ok &&
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
  const expectExtension = process.env['IONE_SMOKE_EXTENSIONS'] === '1'
  const installExtensionId = process.env['IONE_SMOKE_INSTALL_EXTENSION_ID'] ?? null
  const feedUrl = process.env['IONE_SMOKE_FEED_URL'] ?? null
  const permissionUrl = process.env['IONE_SMOKE_PERMISSION_URL'] ?? null
  try {
    const raw: unknown = await chromeWindow.chromeView.webContents.executeJavaScript(`
      (async () => {
        const targetUrl = ${JSON.stringify(targetUrl)}
        const expectExtension = ${JSON.stringify(expectExtension)}
        const installExtensionId = ${JSON.stringify(installExtensionId)}
        const feedUrl = ${JSON.stringify(feedUrl)}
        const permissionUrl = ${JSON.stringify(permissionUrl)}
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

        let feedFolderId = null
        let feedItemCount = 0
        let feedOpenTitle = ''
        let feedRead = false
        let feedEtag = ''
        let feedError = null
        if (feedUrl && targetUrl) {
          try {
            const feedFolder = await window.ione.createFolder({
              spaceId: homeSpaceId,
              name: 'Smoke Feed',
              kind: 'rss',
              feedUrl
            })
            feedFolderId = feedFolder.id
            await waitFor(
              () =>
                document.querySelector(
                  '[data-testid="folder-row"][data-folder-id="' + feedFolder.id + '"]'
                ) !== null
            )
            await window.ione.refreshFeed(feedFolder.id)
            const feedSnap = await waitForSnapshot(
              (value) =>
                Object.values(value.feedItems ?? {}).filter(
                  (item) => item.folderId === feedFolder.id
                ).length >= 2,
              10000
            )
            if (!feedSnap) {
              feedError = 'feed items were not loaded'
            } else {
              const folderItems = Object.values(feedSnap.feedItems ?? {}).filter(
                (item) => item.folderId === feedFolder.id
              )
              feedItemCount = folderItems.length
              feedEtag = feedSnap.feedStates?.[feedFolder.id]?.etag ?? ''
              await window.ione.refreshFeed(feedFolder.id)

              const rowReady = await waitFor(
                () => document.querySelector('[data-testid="feed-item"]') !== null
              )
              if (!rowReady) {
                feedError = 'feed rows were not rendered'
              } else {
                const feedRow = document.querySelector('[data-testid="feed-item"]')
                const feedItemId =
                  feedRow instanceof HTMLElement ? feedRow.dataset.feedItemId : undefined
                if (!(feedRow instanceof HTMLElement) || !feedItemId) {
                  feedError = 'feed row has no id'
                } else {
                  const beforeOpen = await window.ione.getSnapshot()
                  const feedButton = feedRow.querySelector('button')
                  if (feedButton instanceof HTMLElement) feedButton.click()
                  await waitFor(() => activeTitle() === 'Feed Article', 10000)
                  feedOpenTitle = activeTitle()
                  const readSnap = await waitForSnapshot(
                    (value) => value.feedItems?.[feedItemId]?.read === true,
                    5000
                  )
                  feedRead = readSnap !== null
                  if (feedOpenTitle !== 'Feed Article') feedError = 'feed article did not open'
                  const afterRead = await window.ione.getSnapshot()
                  if (afterRead.activeTabId) await window.ione.closeTab(afterRead.activeTabId)
                  if (beforeOpen.activeTabId) {
                    await window.ione.activateTab(beforeOpen.activeTabId)
                  }
                  await waitFor(() => activeTitle() === 'Smoke Page', 7000)
                }
              }
            }
          } catch (error) {
            feedError = String(error)
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

        let extensionError = null
        let extensionCount = 0
        let extensionNames = ''
        let extensionName = ''
        let extensionPopupTitle = ''
        let installedExtensionName = ''
        let installedPopupTitle = ''
        let installError = null
        if (installExtensionId) {
          try {
            const beforeInstall = await window.ione.getSnapshot()
            const installed = await window.ione.installExtension(installExtensionId)
            installedExtensionName = installed && installed.name ? installed.name : 'missing-name'
            if (installed.popupUrl) {
              const extensionTab = await window.ione.createTab(installed.popupUrl)
              await waitFor(() => activeTitle().length > 0 && activeTitle() !== 'New Tab', 10000)
              installedPopupTitle = activeTitle()
              await window.ione.closeTab(extensionTab.id)
              if (beforeInstall.activeTabId) {
                await window.ione.activateTab(beforeInstall.activeTabId)
              }
              await waitFor(() => activeTitle() === 'Smoke Page', 7000)
            }
          } catch (error) {
            installError = String(error)
          }
        }
        let extensions = await window.ione.listExtensions()
        extensionCount = extensions.length
        extensionNames = extensions
          .map((extension) => extension.name + '@' + extension.version)
          .join(', ')
        const fixture = extensions.find(
          (extension) => extension.name === 'Ione Smoke Extension'
        )
        if (fixture) extensionName = fixture.name
        if (expectExtension) {
          if (!fixture) {
            extensionError = 'fixture extension not loaded'
          } else if (!fixture.popupUrl) {
            extensionError = 'fixture extension has no popup'
          } else {
            try {
              const beforeExtension = await window.ione.getSnapshot()
              const extensionTab = await window.ione.createTab(fixture.popupUrl)
              await waitFor(() => activeTitle() === 'Ione Fixture Popup', 7000)
              extensionPopupTitle = activeTitle()
              if (extensionPopupTitle !== 'Ione Fixture Popup') {
                extensionError = 'extension popup did not load'
              }
              await window.ione.closeTab(extensionTab.id)
              if (beforeExtension.activeTabId) {
                await window.ione.activateTab(beforeExtension.activeTabId)
              }
              await waitFor(() => activeTitle() === 'Smoke Page', 7000)
            } catch (error) {
              extensionError = String(error)
            }
          }
        }
        const adblock = await window.ione.getAdblockState()

        let extensionsPanelWorks = false
        let extensionRows = 0
        const extensionsButton = document.querySelector(
          '[data-testid="extensions-button"] button'
        )
        if (extensionsButton instanceof HTMLElement) {
          extensionsButton.click()
          extensionsPanelWorks = await waitFor(
            () => document.querySelector('[data-testid="extensions-panel"]') !== null
          )
          if (extensionsPanelWorks) {
            if (extensionCount > 0) {
              await waitFor(
                () => document.querySelectorAll('[data-testid="extension-row"]').length > 0
              )
            }
            extensionRows = document.querySelectorAll('[data-testid="extension-row"]').length
            const closeButton = document.querySelector('[aria-label="Close extensions"]')
            if (closeButton instanceof HTMLElement) closeButton.click()
            await waitFor(
              () => document.querySelector('[data-testid="extensions-panel"]') === null
            )
          }
        }

        let downloadRows = 0
        let downloadsPanelWorks = false
        const downloadsButton = document.querySelector('[data-testid="downloads-button"] button')
        if (downloadsButton instanceof HTMLElement) {
          downloadsButton.click()
          downloadsPanelWorks = await waitFor(
            () => document.querySelector('[data-testid="downloads-panel"]') !== null
          )
          if (downloadsPanelWorks) {
            await waitFor(
              () => document.querySelectorAll('[data-testid="download-row"]').length > 0,
              5000
            )
            downloadRows = document.querySelectorAll('[data-testid="download-row"]').length
            const closeDownloads = document.querySelector('[aria-label="Close downloads"]')
            if (closeDownloads instanceof HTMLElement) closeDownloads.click()
            await waitFor(
              () => document.querySelector('[data-testid="downloads-panel"]') === null
            )
          }
        }

        let permissionPromptShown = false
        let permissionDenied = false
        let permissionAddress = ''
        let permissionPageTitle = ''
        if (permissionUrl && targetUrl) {
          try {
            await window.ione.navigate(permissionUrl)
            await waitFor(() => activeTitle() === 'Permission Page', 7000)
            permissionPageTitle = activeTitle()
            permissionAddress = addressValue()
            permissionPromptShown = await waitFor(
              () => document.querySelector('[data-testid="permission-prompt"]') !== null,
              10000
            )
            if (permissionPromptShown) {
              const deny = document.querySelector('[data-testid="permission-deny"]')
              if (deny instanceof HTMLElement) deny.click()
              await waitFor(
                () => document.querySelector('[data-testid="permission-prompt"]') === null,
                5000
              )
              permissionDenied =
                document.querySelector('[data-testid="permission-prompt"]') === null
            }
            await window.ione.navigate(targetUrl)
            await waitFor(() => activeTitle() === 'Smoke Page', 7000)
          } catch (error) {
            permissionDenied = false
          }
        }

        let paletteWorks = false
        const commandButton = document.querySelector('[data-testid="command-button"] button')
        if (commandButton instanceof HTMLElement) {
          commandButton.click()
          paletteWorks = await waitFor(
            () => document.querySelector('[data-testid="command-palette"]') !== null
          )
          if (paletteWorks) {
            const commandInput = document.querySelector('[data-testid="command-input"]')
            if (commandInput instanceof HTMLInputElement) {
              commandInput.value = 'reload'
              commandInput.dispatchEvent(new Event('input', { bubbles: true }))
              await waitFor(
                () => document.querySelectorAll('[data-testid="command-item"]').length > 0
              )
              commandInput.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
              )
            }
            await waitFor(
              () => document.querySelector('[data-testid="command-palette"]') === null
            )
            paletteWorks =
              document.querySelector('[data-testid="command-palette"]') === null
          }
        }

        let themeToggleWorks = false
        const themeButton = document.querySelector('[data-testid="theme-toggle"] button')
        if (themeButton instanceof HTMLElement) {
          themeButton.click()
          await waitFor(() => document.querySelector('.chrome.light') !== null)
          const wentLight = document.querySelector('.chrome.light') !== null
          themeButton.click()
          await waitFor(() => document.querySelector('.chrome.light') === null)
          themeToggleWorks = wentLight && document.querySelector('.chrome.light') === null
        }

        let compactToggleWorks = false
        const compactButton = document.querySelector('[data-testid="compact-toggle"] button')
        if (compactButton instanceof HTMLElement) {
          compactButton.click()
          await waitFor(() => document.querySelector('.chrome.compact') !== null)
          const wentCompact = document.querySelector('.chrome.compact') !== null
          compactButton.click()
          await waitFor(() => document.querySelector('.chrome.compact') === null)
          compactToggleWorks = wentCompact && document.querySelector('.chrome.compact') === null
        }

        let findWorks = false
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })
        )
        const findReady = await waitFor(
          () => document.querySelector('[data-testid="find-bar"]') !== null
        )
        if (findReady) {
          const findInput = document.querySelector('[data-testid="find-input"]')
          if (findInput instanceof HTMLInputElement) {
            findInput.value = 'Ione'
            findInput.dispatchEvent(new Event('input', { bubbles: true }))
            findInput.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
            )
            findWorks = await waitFor(() => {
              const value =
                document.querySelector('[data-testid="find-count"]')?.textContent?.trim() ?? ''
              return value.length > 0 && value !== '0/0'
            })
          }
          const closeFind = document.querySelector('[aria-label="Close find bar"]')
          if (closeFind instanceof HTMLElement) closeFind.click()
          await waitFor(() => document.querySelector('[data-testid="find-bar"]') === null)
        }

        let navigationWorks = false
        if (targetUrl) {
          await window.ione.navigate(targetUrl + 'feed-article?nav=1')
          await waitFor(() => activeTitle() === 'Feed Article', 7000)
          const backButton = document.querySelector('[data-testid="back-button"] button')
          if (backButton instanceof HTMLElement) backButton.click()
          await waitFor(() => activeTitle() === 'Smoke Page', 7000)
          const backWorked = activeTitle() === 'Smoke Page'
          const forwardButton = document.querySelector('[data-testid="forward-button"] button')
          if (forwardButton instanceof HTMLElement) forwardButton.click()
          await waitFor(() => activeTitle() === 'Feed Article', 7000)
          const forwardWorked = activeTitle() === 'Feed Article'
          navigationWorks = backWorked && forwardWorked
          await window.ione.navigate(targetUrl)
          await waitFor(() => activeTitle() === 'Smoke Page', 7000)
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
          adblockReady: adblock.ready,
          adblockEnabled: adblock.enabled,
          adblockSkipped: adblock.skippedForExtension,
          adblockError: adblock.error,
          extensionCount,
          extensionNames,
          extensionName,
          extensionPopupTitle,
          extensionError,
          installedExtensionName,
          installedPopupTitle,
          installError,
          extensionsPanelWorks,
          extensionRows,
          feedFolderId,
          feedItemCount,
          feedOpenTitle,
          feedRead,
          feedEtag,
          feedError,
          downloadRows,
          downloadsPanelWorks,
          permissionPromptShown,
          permissionDenied,
          permissionAddress,
          permissionPageTitle,
          paletteWorks,
          themeToggleWorks,
          compactToggleWorks,
          findWorks,
          navigationWorks,
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
      adblockReady: record['adblockReady'] === true,
      adblockEnabled: record['adblockEnabled'] === true,
      adblockSkipped: record['adblockSkipped'] === true,
      adblockError:
        typeof record['adblockError'] === 'string' ? record['adblockError'] : null,
      extensionCount: typeof record['extensionCount'] === 'number' ? record['extensionCount'] : 0,
      extensionNames: typeof record['extensionNames'] === 'string' ? record['extensionNames'] : '',
      extensionName: typeof record['extensionName'] === 'string' ? record['extensionName'] : '',
      extensionPopupTitle:
        typeof record['extensionPopupTitle'] === 'string' ? record['extensionPopupTitle'] : '',
      extensionError:
        typeof record['extensionError'] === 'string' ? record['extensionError'] : null,
      installedExtensionName:
        typeof record['installedExtensionName'] === 'string'
          ? record['installedExtensionName']
          : '',
      installedPopupTitle:
        typeof record['installedPopupTitle'] === 'string'
          ? record['installedPopupTitle']
          : '',
      installError: typeof record['installError'] === 'string' ? record['installError'] : null,
      extensionsPanelWorks: record['extensionsPanelWorks'] === true,
      extensionRows: typeof record['extensionRows'] === 'number' ? record['extensionRows'] : 0,
      feedFolderId: typeof record['feedFolderId'] === 'string' ? record['feedFolderId'] : null,
      feedItemCount: typeof record['feedItemCount'] === 'number' ? record['feedItemCount'] : 0,
      feedOpenTitle: typeof record['feedOpenTitle'] === 'string' ? record['feedOpenTitle'] : '',
      feedRead: record['feedRead'] === true,
      feedEtag: typeof record['feedEtag'] === 'string' ? record['feedEtag'] : '',
      feedError: typeof record['feedError'] === 'string' ? record['feedError'] : null,
      downloadRows: typeof record['downloadRows'] === 'number' ? record['downloadRows'] : 0,
      downloadsPanelWorks: record['downloadsPanelWorks'] === true,
      permissionPromptShown: record['permissionPromptShown'] === true,
      permissionDenied: record['permissionDenied'] === true,
      permissionAddress:
        typeof record['permissionAddress'] === 'string' ? record['permissionAddress'] : '',
      permissionPageTitle:
        typeof record['permissionPageTitle'] === 'string' ? record['permissionPageTitle'] : '',
      paletteWorks: record['paletteWorks'] === true,
      themeToggleWorks: record['themeToggleWorks'] === true,
      compactToggleWorks: record['compactToggleWorks'] === true,
      findWorks: record['findWorks'] === true,
      navigationWorks: record['navigationWorks'] === true,
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

function smokeTimeoutMs(): number {
  const raw = Number(process.env['IONE_SMOKE_TIMEOUT_MS'])
  return Number.isFinite(raw) && raw >= 1000 ? raw : 20_000
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
  if (isSmokeTest) {
    failSmoke(`IONE_SMOKE_STARTUP_FAILED ${message}`)
    return
  }
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

  adblockService?.dispose()
  adblockService = null
  feedService?.stop()
  feedService = null
  downloadService?.dispose()
  downloadService = null
  permissionService?.dispose()
  permissionService = null
  extensionService = null

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
