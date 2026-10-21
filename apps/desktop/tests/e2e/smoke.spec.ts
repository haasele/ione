import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'

const require = createRequire(__filename)
const electronBinary = require('electron') as string
const appRoot = dirname(dirname(__dirname))
const cdpPort = 9338

let server: Server
let electron: ChildProcess
let browser: Browser
let page: Page
let baseUrl: string
let workDir: string

async function waitForChromeTarget(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json`)
      if (response.ok) {
        const targets = (await response.json()) as Array<{ title?: string }>
        if (targets.some((target) => target.title === 'Ione')) return
      }
    } catch {
      // app still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Ione chrome target did not appear')
}

test.beforeAll(async () => {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    test.skip(true, 'Electron E2E needs a display or Xvfb')
  }

  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><html><head><title>E2E Page</title></head><body><h1>E2E Ione</h1></body></html>'
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind')
  baseUrl = `http://127.0.0.1:${address.port}/`

  workDir = mkdtempSync(join(tmpdir(), 'ione-e2e-'))
  electron = spawn(
    electronBinary,
    [
      appRoot,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${cdpPort}`
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        IONE_DB_PATH: join(workDir, 'e2e.sqlite'),
        IONE_DOWNLOAD_DIR: join(workDir, 'Downloads'),
        IONE_ADBLOCK: 'off',
        IONE_EXTENSIONS: 'off',
        IONE_FEEDS: 'off'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  electron.stdout?.on('data', (chunk) => process.stdout.write(`[e2e] ${chunk}`))
  electron.stderr?.on('data', (chunk) => process.stderr.write(`[e2e] ${chunk}`))

  await waitForChromeTarget()
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        if ((await candidate.title()) === 'Ione') page = candidate
      }
    }
    if (page) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!page) throw new Error('chrome page not found over CDP')
})

test.afterAll(async () => {
  await browser?.close().catch(() => undefined)
  electron?.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 300))
  if (electron && !electron.killed) electron.kill('SIGKILL')
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

test('chrome renders, navigates, and opens the command palette', async ({}, testInfo) => {
  await expect(page.getByTestId('address-input')).toBeVisible()
  await expect(page.getByTestId('tab-row').first()).toBeVisible()

  await page.getByTestId('address-input').fill(baseUrl)
  await page.getByTestId('address-input').press('Enter')
  await expect(page.getByTestId('address-input')).toHaveValue(baseUrl)
  await expect(page.locator('[data-testid="tab-row"].active .tab-title')).toHaveText(
    'E2E Page',
    { timeout: 10_000 }
  )

  await page.keyboard.press('Control+K')
  await expect(page.getByTestId('command-palette')).toBeVisible()
  await page.getByTestId('command-input').fill('theme')
  await expect(page.getByTestId('command-item').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('command-palette')).toBeHidden()

  await page.getByTestId('compact-toggle').locator('button').click()
  await expect(page.locator('.chrome.compact')).toBeVisible()
  await page.getByTestId('compact-toggle').locator('button').click()
  await expect(page.locator('.chrome.compact')).toHaveCount(0)

  const screenshot = await page.screenshot()
  await testInfo.attach('ione-e2e', { body: screenshot, contentType: 'image/png' })
})
