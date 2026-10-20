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

const pageServer = createServer((_request, response) => {
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
      IONE_SMOKE_URL: smokeUrl
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

const timeout = setTimeout(() => {
  if (settled) return
  console.error('[smoke] timed out after 30s')
  finish(1, '')
}, 30_000)

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
    const tab = db.prepare('SELECT url, title FROM tabs LIMIT 1').get()
    const activeTabRow = db
      .prepare("SELECT value FROM app_state WHERE key = 'activeTabId'")
      .get()
    db.close()
    if (!tab || tab.url !== smokeUrl || tab.title !== 'Smoke Page') {
      stderr += `\n[smoke] persisted tab mismatch: ${JSON.stringify(tab)}`
      finish(1, '')
      return
    }
    if (!activeTabRow || typeof activeTabRow.value !== 'string' || activeTabRow.value === '') {
      stderr += '\n[smoke] active tab session was not persisted'
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
    `[smoke] app started, rendered chrome, navigated via IPC, persisted state, screenshot: ${screenshotPath}`
  )
})
