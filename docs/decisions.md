# Architecture & dependency decisions

Status: Phase 1-2 implemented. Verified against npm/GitHub on 2026-10-20.

Every runtime/build dependency is listed below with version, license, and the
reason it is present. Packages marked **planned** are not installed yet and
MUST be re-checked before the phase that adds them.

## Installed now (Phase 1-2)

| Package | Version | License | Why |
| --- | --- | --- | --- |
| `electron` | 44.9.2 | MIT | Current stable Electron major (Node 24.22.0, Chromium 152). Only prebuilt binaries; no Chromium build. |
| `electron-vite` | 6.0.0 | MIT | Build/dev tool for main, preload, renderer with the svelte-ts preset. Peer: Vite 6-8. |
| `vite` | 8.3.4 | MIT | Required by electron-vite 6 / vite-plugin-svelte 7. |
| `svelte` | 5.57.2 | MIT | Browser chrome UI, runes mode. |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | MIT | Svelte 5 + Vite 8 integration (peer `svelte ^5.46.4`, `vite ^8`). |
| `typescript` | 5.9.3 | Apache-2.0 | Strict typechecking. Deliberately not TS 7: svelte-check 4.7.7 peer range is `^5 || ^6`. |
| `svelte-check` | 4.7.7 | MIT | Typechecks `.svelte` files; `tsc` cannot. |
| `vitest` | 5.0.5 | MIT | Unit tests for framework-free core and SQLite/IPC code. |
| `better-sqlite3` | 13.0.3 | MIT | SQLite persistence. Ships N-API prebuilds (NAPI 10), so the same binary is intended to load in Electron's Node and in Node-based tests. |
| `@types/better-sqlite3` | 9.6.0 | MIT | Type definitions; better-sqlite3 does not ship its own. No newer typings exist. |
| `@electron/rebuild` | 4.2.1 | MIT | Mandated native-module fallback. Script `rebuild:native` rebuilds better-sqlite3 if the N-API prebuild ever fails to load. |
| `@types/node` | 24.19.2 | MIT | Node 24 typings matching Electron 44's runtime. |

No UI, virtualization, drag-and-drop, RSS, adblock, or extension package is
installed in Phase 1-2. The first three are Phase 3+ decisions; RSS and
extensions are Phase 5-6.

### Electron binary installation
Electron 44 no longer ships a package postinstall script. The root
`postinstall` invokes `install:electron` in `apps/desktop`, which downloads the
prebuilt binary on a fresh `bun install`. `electron` remains in
`trustedDependencies`; Bun runs the root lifecycle hook.

## Researched, not installed yet

| Package | Latest checked | License | Notes / risk |
| --- | --- | --- | --- |
| `electron-chrome-extensions` | 4.9.0 | Dual GPL-3.0 / patron license (NOT MIT) | Explicit gap from the plan. MV3/API coverage MUST be tested in Phase 5 against uBlock Origin and Bitwarden. A GPL-compatible licensing decision is required before shipping. |
| `electron-chrome-web-store` | (same repo) | Dual GPL-3.0 / patron license | Phase 5. Same licensing constraint. |
| `electron-chrome-context-menu` | (same repo) | Same repo license family | Phase 5. |
| `@ghostery/adblocker-electron` | 2.20.1 | MPL-2.0 | Fallback/complement if uBO is unreliable; Phase 5. |
| `electron-builder` | 26.15.3 | MIT | Phase 7 packaging only. |
| `@playwright/test` | 1.64.1 | Apache-2.0 | Electron smoke/E2E later. Phase 1-2 uses a dependency-free Electron smoke mode so the gate does not need browser downloads. |

## Architecture decisions

### Process/view layout
- `BaseWindow` + two kinds of `WebContentsView`: exactly one chrome view and
  one view per tab (created lazily, only the active tab is attached).
- The chrome view is the vertical sidebar (320 px) and contains the URL bar,
  tab list, and future command palette. The active tab occupies the remaining
  rectangle. This keeps all chrome in one Svelte UI/view and avoids
  click-blocking overlays that a full-window transparent chrome view would
  create.
- No `<webview>`, no `BrowserView`.

### Security
- All renderer views: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`.
- Chrome renderer gets only the typed `window.ione` contextBridge API.
- `setWindowOpenHandler` denies native windows on both chrome and content
  views. Content-initiated foreground safe URLs may open as a tab, capped at
  five per tab view per 10 seconds; background popups are dropped.
- Content navigation is limited to `http:`, `https:`, and `about:blank`. The
  chrome view may not navigate away from its own entry point.
- IPC entity ids are syntax-checked, and domain lookups use own-property
  checks (`Object.hasOwn`) so `__proto__`/`constructor` ids cannot resolve
  through the prototype chain or poison persisted state.
- Page-controlled fields are bounded before they enter state/IPC/SQLite:
  title <= 1 KiB, URL <= 8 KiB, favicon <= 100 KB.
- Permission requests are denied by default in Phase 1-2; explicit prompt UI
  belongs to a later phase.
- CSP is injected by the Vite renderer build: production has no eval, no
  remote scripts, images limited to self/data/https, and `connect-src 'self'`.
  Development adds only the loopback Vite origin plus ws/wss for HMR.
- `ELECTRON_RENDERER_URL` is honored only in unpackaged builds and only for
  loopback http URLs. Packaged builds ignore it.

### State and IPC
- The main process owns the single source of truth: an in-memory
  `BrowserSnapshot` (normalized maps) backed by SQLite.
- Commands arrive over validated `ipcMain.handle` channels. Reducers in
  `@ione/core` are pure and return `{ state, diffs }`.
- The chrome renderer receives one snapshot at startup. Afterwards only
  `StateDiff` messages are sent. Diffs are queued and flushed on a ~16 ms
  (one frame) timer, never per individual change.
- Every batch carries `baseVersion`/`version`. If the renderer sees a version
  gap it requests a fresh snapshot instead of applying a corrupt diff.
- Diff ordering is insertion order. Version is monotonic per reducer call.

### Persistence
- SQLite via better-sqlite3, WAL mode, `synchronous=NORMAL`, foreign keys on.
- Schema versioning uses `PRAGMA user_version` plus an ordered migration
  array. Migrations run in transactions and are idempotent.
- Persistence is write-behind: reducer diffs are queued, then applied in one
  SQLite transaction after 150 ms; the queue is flushed synchronously on quit.
  A failed flush is logged, retained, and retried instead of crashing main.
- Session selection (`activeSpaceId`, `activeTabId`) is stored in
  `app_state` and restored at startup.
- Initial bootstrap: one space (`Home`) and one blank tab if the DB has no
  spaces. No network page is loaded during smoke tests.

### Ordering
- Tabs, folders, spaces, and essentials use fractional index strings
  (`order`). Inserts take a key strictly between neighbors, so reordering
  touches one row and does not renumber siblings.
- The implementation is a compact base-62 midpoint algorithm derived from
  the CC0 `fractional-indexing` reference algorithm. It rejects invalid or
  equal neighbors and never emits trailing zero digits.

### URL handling
- Address input is normalized in core: explicit `http`/`https` URLs and
  `about:blank` are accepted, bare hosts/domains get `https://`
  (localhost/IP get `http://`), everything else becomes a DuckDuckGo search.
- `javascript:`, `data:`, `file:`, non-blank `about:` URLs, and unknown
  schemes are never navigated directly; they fall through to search. This is
  defense in depth even though main also validates the final URL.

### Electron flags
- Sandbox remains enabled in production; `--no-sandbox` is only in the smoke
  harness for constrained CI/headless environments and is never set in app
  code.
- The smoke harness also passes `--disable-dev-shm-usage` for container CI.
- No `--disable-web-security`, no remote module, no experimental flag.
- `backgroundThrottling` stays at Electron defaults; tab sleeping is a later
  explicit lifecycle feature rather than a hidden throttling hack.

## Phase 1-2 scope ledger

Implemented: monorepo scaffold, hardened window, chrome `WebContentsView`,
one lazily created tab `WebContentsView`, URL bar, core model/reducers/folder
tree/fractional ordering/URL normalization/session normalization, SQLite
migrations/repository/write-behind, versioned diff IPC and Svelte diff
application, unit tests and Electron smoke mode.

Not in this phase (still required by the overall plan): full sidebar UI with
virtual list/spaces/essentials (Phase 3), DnD/pinned reset/session restore
UI/tab sleeping (Phase 4), extensions/Web Store/adblock (Phase 5), RSS
(Phase 6), theme polish/perf/packaging (Phase 7).

## Verification gates

- `bun run typecheck` must pass (TS strict for core/main/preload + svelte-check).
- `bun run test:core` and `bun run test` must pass.
- `bun run build` must succeed.
- `bun run smoke` must print `IONE_SMOKE_READY` and exit 0 (needs a display or
  Xvfb on Linux).

### Last verified (2026-10-20)

- `bun run typecheck`: 0 errors, 0 warnings (svelte-check: 100 files).
- `bun run test:core`: 6 files, 182 tests passed.
- `bun run test`: 9 files, 197 tests passed.
- `bun run build`: main/preload/renderer bundles produced; built CSP is
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:; object-src 'none'; base-uri 'none';
  form-action 'none'; frame-src 'none'; connect-src 'self'`.
- `DISPLAY=:99 bun run smoke`: `IONE_SMOKE_READY` with
  `hasBridge=true`, `hasAddress=true`, `tabRows=1`, after an IPC navigation to
  a loopback page the tab title/address updated to `Smoke Page` and the SQLite
  row `tabs.url`/`tabs.title` plus `app_state.activeTabId` were verified after
  process exit. The smoke screenshot is `/tmp/ione-smoke-chrome.png`.
- `electron-vite dev --noSandbox --remoteDebuggingPort 9333` under Xvfb:
  chrome target loaded from `http://localhost:5173/`, typed bridge present,
  address bar and tab row rendered, Vite HMR client connected without CSP
  errors.
- The smoke harness uses `--no-sandbox` because this Linux container has
  neither a SUID Chromium sandbox nor unprivileged user namespaces. The
  application itself never passes `--no-sandbox`; smoke-only evidence is not a
  claim that OS-level sandboxing was exercised here.

## Open risks / handoff

- Electron extension packages are GPL-3.0/patron-licensed, not MIT. Phase 5
  needs an explicit licensing decision before integration.
- Playwright is not installed yet; Phase 1-2 uses the dependency-free smoke
  harness. Browser E2E coverage starts when Playwright is added.
- Tab sleeping, DnD/folder UI, RSS, adblock, downloads/permission prompt UI,
  and packaging are intentionally later phases.
- This container cannot exercise the Chromium OS sandbox; verify the packaged
  app's sandbox installation on a normal Linux desktop during Phase 7.

