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

const isSmokeTest = process.argv.includes('--smoke-test')

let database: Database.Database | null = null
let controller: BrowserController | null = null
let chromeWindow: ChromeWindow | null = null
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
}

function onChromeReady(dbPath: string): void {
  if (!controller || !chromeWindow) return
  chromeWindow.reconcile(controller.snapshot)

  if (!isSmokeTest) {
    chromeWindow.focus()
    return
  }

  void runSmokeProbe(dbPath)
}

async function runSmokeProbe(dbPath: string): Promise<void> {
  if (!controller || !chromeWindow) return

  const activeTabId = controller.snapshot.activeTabId
  if (!chromeWindow.hasAttachedTab(activeTabId)) {
    failSmoke('IONE_SMOKE_FAILED active tab view not attached')
    return
  }

  const probe = await probeChrome()
  const expectedUrl = process.env['IONE_SMOKE_URL'] ?? null
  const navigationOk =
    expectedUrl === null ||
    (probe !== null &&
      probe.navUrl === expectedUrl &&
      probe.title === 'Smoke Page' &&
      probe.address === expectedUrl)
  if (
    !probe ||
    !probe.hasBridge ||
    !probe.hasAddress ||
    probe.tabRows < 1 ||
    !navigationOk
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
      activeTabId,
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
        const readyStarted = Date.now()
        while (Date.now() - readyStarted < 5000) {
          const address = document.querySelector('.address-input')
          const rows = document.querySelectorAll('.tab-row').length
          if (address && rows > 0) break
          await sleep(50)
        }

        let navUrl = null
        if (targetUrl) {
          try {
            const result = await window.ione.navigate(targetUrl)
            navUrl = result ? result.url : null
          } catch (error) {
            navUrl = 'ERROR: ' + String(error)
          }
          const navStarted = Date.now()
          while (Date.now() - navStarted < 5000) {
            const title = document.querySelector('.tab-title')?.textContent?.trim()
            if (title === 'Smoke Page') break
            await sleep(50)
          }
        }

        return {
          hasBridge: typeof window.ione === 'object' && window.ione !== null,
          hasAddress: document.querySelector('.address-input') !== null,
          tabRows: document.querySelectorAll('.tab-row').length,
          title: document.querySelector('.tab-title')?.textContent?.trim() ?? '',
          address: document.querySelector('.address-input')?.value ?? '',
          navUrl
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
      navUrl: typeof record['navUrl'] === 'string' ? record['navUrl'] : null
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
