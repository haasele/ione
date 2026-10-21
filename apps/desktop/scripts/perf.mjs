import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(dirname(appRoot))
const results = []

if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error('[perf] No DISPLAY/WAYLAND_DISPLAY. Run under xvfb-run on headless Linux.')
  process.exit(2)
}

async function runCase(tabs, sleeping) {
  const workDir = mkdtempSync(join(tmpdir(), 'ione-perf-'))
  const dbPath = join(workDir, 'perf.sqlite')
  const child = spawn(
    electronBinary,
    [appRoot, '--no-sandbox', '--disable-dev-shm-usage'],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        IONE_DB_PATH: dbPath,
        IONE_DOWNLOAD_DIR: join(workDir, 'Downloads'),
        IONE_ADBLOCK: 'off',
        IONE_EXTENSIONS: 'off',
        IONE_FEEDS: 'off',
        IONE_PERF_MODE: '1',
        IONE_PERF_TABS: String(tabs),
        IONE_PERF_SLEEP: sleeping ? '1' : '0',
        IONE_TAB_SLEEP_MS: sleeping ? '0' : String(60 * 60_000),
        IONE_TAB_SLEEP_TICK_MS: sleeping ? '100' : String(60 * 60_000)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let stdout = ''
  let stderr = ''
  let result = null
  const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000)
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    const match = stdout.match(/IONE_PERF_RESULT (\{.*\})/)
    if (match && !result) result = JSON.parse(match[1])
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const code = await new Promise((resolve) => child.on('exit', resolve))
  clearTimeout(timeout)
  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    // best effort
  }
  if (!result || code !== 0) {
    throw new Error(
      `perf case tabs=${tabs} sleeping=${sleeping} failed (exit ${code})\n${stdout}\n${stderr}`
    )
  }
  results.push({ requestedTabs: tabs, sleeping, ...result })
  console.log(
    `[perf] tabs=${result.tabs} sleeping=${result.sleepingTabs} workingSet=${result.workingSetMb}MB startup=${result.startupToChromeReadyMs}ms`
  )
}

for (const tabs of [1, 20, 50]) {
  await runCase(tabs, false)
  await runCase(tabs, true)
}

const generated = new Date().toISOString()
const lines = [
  '# Performance measurements',
  '',
  `Generated: ${generated}`,
  '',
  'Environment: Linux x64 container, Xvfb 1440x900, Electron 44.9.2 (Chromium 152),',
  'extensions/adblock/feed worker disabled to isolate shell overhead. Startup is measured',
  'from main-module load to chrome `did-finish-load` (first chrome paint). Working set is',
  'summed from `app.getAppMetrics()` across Electron processes after 500 ms idle.',
  '',
  '| Tabs | Sleeping | Working set | Main RSS | Renderer procs | Startup | Diff batches |',
  '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...results.map(
    (result) =>
      `| ${result.tabs} | ${result.sleepingTabs} | ${result.workingSetMb} MB | ${result.mainRssMb} MB | ${result.rendererProcesses} | ${result.startupToChromeReadyMs} ms | ${result.diffBatches} |`
  ),
  '',
  'Notes:',
  '- Tabs are `about:blank`; inactive awake tabs keep one renderer/WebContentsView each.',
  '- Sleeping tabs have their WebContents destroyed; only the active tab should remain.',
  '- Diff batches coalesce reducer changes on the ~16 ms frame timer.',
  '- CPU/IPC message rate was not profiled beyond batch/diff counts; add a tracing pass in a future iteration if regressions appear.',
  '- Target from the plan: startup < 1.5 s, 50 sleeping tabs well under 3 GB.'
]
const outputPath = join(repoRoot, 'docs', 'perf.md')
writeFileSync(outputPath, lines.join('\n') + '\n')
console.log(`[perf] wrote ${outputPath}`)
