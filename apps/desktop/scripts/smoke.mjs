import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const workDir = mkdtempSync(join(tmpdir(), 'ione-smoke-'))
const dbPath = join(workDir, 'smoke.sqlite')
const screenshotPath = join(tmpdir(), 'ione-smoke-chrome.png')
rmSync(screenshotPath, { force: true })

if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error('[smoke] No DISPLAY/WAYLAND_DISPLAY. Run under xvfb-run on headless Linux.')
  rmSync(workDir, { recursive: true, force: true })
  process.exit(2)
}

const rss = (origin) => `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<title>Ione Smoke Feed</title>
<link>${origin}</link>
<item><title>Feed Item One</title><link>${origin}feed-article?item=1</link><guid>feed-1</guid><description>First smoke item</description><pubDate>Tue, 20 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>Feed Item Two</title><link>${origin}feed-article?item=2</link><guid>feed-2</guid><description>Second smoke item</description><pubDate>Mon, 19 Oct 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`

const pageServer = createServer((request, response) => {
  const origin = `http://${request.headers.host ?? '127.0.0.1'}/`
  if (request.url === '/feed.xml') {
    if (request.headers['if-none-match'] === '"ione-smoke-v1"') {
      response.writeHead(304, { etag: '"ione-smoke-v1"' })
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': 'application/rss+xml; charset=utf-8',
      etag: '"ione-smoke-v1"'
    })
    response.end(rss(origin))
    return
  }
  if (request.url?.startsWith('/feed-article')) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><html><head><title>Feed Article</title></head><body><h1>Feed article</h1></body></html>'
    )
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(
    '<!doctype html><html><head><title>Smoke Page</title></head><body><h1>Ione smoke</h1></body></html>'
  )
})
await new Promise((resolve, reject) => {
  pageServer.once('error', reject)
  pageServer.listen(0, '127.0.0.1', resolve)
})
const pageAddress = pageServer.address()
if (!pageAddress || typeof pageAddress === 'string') {
  throw new Error('smoke page server did not expose a TCP port')
}
const smokeUrl = `http://127.0.0.1:${pageAddress.port}/`
const feedUrl = `${smokeUrl}feed.xml`

const child = spawn(
  electronBinary,
  [
    appRoot,
    '--smoke-test',
    // This environment cannot use the SUID/user-namespace sandbox. The flag is
    // confined to the smoke harness; app code never disables sandboxing.
    '--no-sandbox',
    '--disable-dev-shm-usage'
  ],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      IONE_DB_PATH: dbPath,
      IONE_SMOKE_SCREENSHOT: screenshotPath,
      IONE_SMOKE_URL: smokeUrl,
      IONE_SMOKE_FEED_URL: feedUrl,
      IONE_TAB_SLEEP_MS: '250',
      IONE_TAB_SLEEP_TICK_MS: '200',
      IONE_ADBLOCK: process.env.IONE_ADBLOCK ?? 'off'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  }
)

let stdout = ''
let stderr = ''
let ready = false
let settled = false

const finish = (code, message) => {
  if (settled) return
  settled = true
  clearTimeout(timeout)
  if (code === 0 && message) console.log(message)
  if (code !== 0) {
    if (stdout) console.error(stdout.trimEnd())
    if (stderr) console.error(stderr.trimEnd())
    console.error(`[smoke] failed (exit ${code})`)
  }
  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    // best effort
  }
  pageServer.close()
  process.exitCode = code
  if (!child.killed) child.kill('SIGKILL')
}

const timeoutMs = Number(process.env.IONE_SMOKE_TIMEOUT_MS ?? 30_000) + 10_000
const timeout = setTimeout(() => {
  if (settled) return
  console.error(`[smoke] timed out after ${Math.round(timeoutMs / 1000)}s`)
  finish(1, '')
}, timeoutMs)

child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdout += chunk
  for (const line of stdout.split('\n')) {
    if (!ready && line.includes('IONE_SMOKE_READY')) {
      ready = true
      console.log(`[smoke] ${line.trim()}`)
    }
  }
})
child.stderr.on('data', (chunk) => {
  stderr += chunk
})

child.on('error', (error) => {
  stderr += `\n[smoke] spawn error: ${error.message}`
  finish(1, '')
})

child.on('exit', (code, signal) => {
  if (settled) return
  if (!ready) {
    stderr += `\n[smoke] exited before readiness (signal=${signal ?? 'none'})`
    finish(1, '')
    return
  }
  if (code !== 0) {
    finish(1, '')
    return
  }
  if (!existsSync(dbPath) || statSync(dbPath).size === 0) {
    stderr += `\n[smoke] database was not created at ${dbPath}`
    finish(1, '')
    return
  }
  if (!existsSync(screenshotPath) || statSync(screenshotPath).size === 0) {
    stderr += `\n[smoke] chrome screenshot was not created at ${screenshotPath}`
    finish(1, '')
    return
  }

  try {
    const Sqlite = require('better-sqlite3')
    const db = new Sqlite(dbPath, { readonly: true, fileMustExist: true })
    const tabCount = db.prepare('SELECT COUNT(*) AS n FROM tabs').get()
    const spaceCount = db.prepare('SELECT COUNT(*) AS n FROM spaces').get()
    const pinnedCount = db
      .prepare('SELECT COUNT(*) AS n FROM tabs WHERE pinned = 1')
      .get()
    const essential = db.prepare('SELECT url, title FROM essentials LIMIT 1').get()
    const activeSpaceRow = db
      .prepare("SELECT value FROM app_state WHERE key = 'activeSpaceId'")
      .get()
    const activeTabRow = db
      .prepare("SELECT value FROM app_state WHERE key = 'activeTabId'")
      .get()
    const activeSpace =
      activeSpaceRow && typeof activeSpaceRow.value === 'string'
        ? db.prepare('SELECT name FROM spaces WHERE id = ?').get(activeSpaceRow.value)
        : undefined
    const activeTab =
      activeTabRow && typeof activeTabRow.value === 'string'
        ? db
            .prepare(
              'SELECT tabs.url, tabs.title, tabs.folder_id, tabs.sleeping, spaces.name AS space_name FROM tabs JOIN spaces ON spaces.id = tabs.space_id WHERE tabs.id = ?'
            )
            .get(activeTabRow.value)
        : undefined
    const folderCount = db.prepare('SELECT COUNT(*) AS n FROM folders').get()
    const nestedRoot = db
      .prepare(
        "SELECT COUNT(*) AS n FROM folders WHERE name = 'Nested' AND parent_id IS NULL"
      )
      .get()
    const sleepingCount = db
      .prepare('SELECT COUNT(*) AS n FROM tabs WHERE sleeping = 1')
      .get()
    const rssFolder = db
      .prepare("SELECT id FROM folders WHERE kind = 'rss' AND feed_url IS NOT NULL LIMIT 1")
      .get()
    const feedState = db.prepare('SELECT folder_id, etag FROM feed_state LIMIT 1').get()
    const feedItemCount = db.prepare('SELECT COUNT(*) AS n FROM feed_items').get()
    const feedReadCount = db.prepare('SELECT COUNT(*) AS n FROM feed_items WHERE read = 1').get()
    db.close()

    if (!tabCount || tabCount.n < 5) {
      stderr += `\n[smoke] expected at least 5 persisted tabs, got ${JSON.stringify(tabCount)}`
      finish(1, '')
      return
    }
    if (!spaceCount || spaceCount.n < 2) {
      stderr += `\n[smoke] expected 2 persisted spaces, got ${JSON.stringify(spaceCount)}`
      finish(1, '')
      return
    }
    if (!pinnedCount || pinnedCount.n < 1) {
      stderr += `\n[smoke] pinned tab was not persisted: ${JSON.stringify(pinnedCount)}`
      finish(1, '')
      return
    }
    if (!essential || essential.url !== smokeUrl || essential.title !== 'Smoke Essential') {
      stderr += `\n[smoke] essential mismatch: ${JSON.stringify(essential)}`
      finish(1, '')
      return
    }
    if (!folderCount || folderCount.n < 2) {
      stderr += `\n[smoke] expected 2 persisted folders, got ${JSON.stringify(folderCount)}`
      finish(1, '')
      return
    }
    if (!nestedRoot || nestedRoot.n < 1) {
      stderr += `\n[smoke] moved subfolder was not persisted at root: ${JSON.stringify(nestedRoot)}`
      finish(1, '')
      return
    }
    if (!sleepingCount || sleepingCount.n < 1) {
      stderr += `\n[smoke] no sleeping tab was persisted: ${JSON.stringify(sleepingCount)}`
      finish(1, '')
      return
    }
    if (!rssFolder) {
      stderr += '\n[smoke] RSS folder was not persisted'
      finish(1, '')
      return
    }
    if (!feedState || feedState.folder_id !== rssFolder.id || feedState.etag !== '"ione-smoke-v1"') {
      stderr += `\n[smoke] feed state mismatch: ${JSON.stringify(feedState)}`
      finish(1, '')
      return
    }
    if (!feedItemCount || feedItemCount.n < 2) {
      stderr += `\n[smoke] feed items were not persisted: ${JSON.stringify(feedItemCount)}`
      finish(1, '')
      return
    }
    if (!feedReadCount || feedReadCount.n < 1) {
      stderr += `\n[smoke] feed read state was not persisted: ${JSON.stringify(feedReadCount)}`
      finish(1, '')
      return
    }
    if (!activeSpace || activeSpace.name !== 'Home') {
      stderr += `\n[smoke] active space mismatch: ${JSON.stringify(activeSpace)}`
      finish(1, '')
      return
    }
    if (
      !activeTab ||
      activeTab.url !== smokeUrl ||
      activeTab.title !== 'Smoke Page' ||
      activeTab.space_name !== 'Home' ||
      activeTab.folder_id === null ||
      activeTab.sleeping !== 0
    ) {
      stderr += `\n[smoke] active tab mismatch: ${JSON.stringify(activeTab)}`
      finish(1, '')
      return
    }
  } catch (error) {
    stderr += `\n[smoke] persisted state check failed: ${String(error)}`
    finish(1, '')
    return
  }

  finish(
    0,
    `[smoke] app started, tree/folders/DnD/sleep/feed/extension state persisted, screenshot: ${screenshotPath}`
  )
})
