# Architecture & dependency decisions

Status: Phases 1-7 implemented. Verified against npm/GitHub on 2026-10-20/21.

Every runtime/build dependency is listed below with version, license, and the
reason it is present. Packages marked **planned** are not installed yet and
MUST be re-checked before the phase that adds them.

## Installed now (Phases 1-7)

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
| `@ione/ui-kit` | workspace | internal | Shared `VirtualList` (fixed-row windowing, no external virtualization package) and `IconButton` for the chrome UI. |
| `electron-chrome-extensions` | 4.9.0 | GPL-3.0 **or** Patron-License-2020-11-19 | Chrome `chrome.*` API bridge. Repo tests Electron 44. Distribution requires GPLv3 compliance or a Patron license; see licensing decision below. |
| `electron-chrome-web-store` | 0.13.0 | MIT | Programmatic CWS install/uninstall, CRX3 unpacking, extension path loading. Uses a private CWS endpoint/API; treated as a compatibility risk. |
| `electron-chrome-context-menu` | 1.1.0 | MIT | Native Chrome-like context menu, including extension context items. npm build is old but its deprecated navigation calls still exist in Electron 44. |
| `@ghostery/adblocker-electron` | 2.20.1 | MPL-2.0 | Built-in network + cosmetic filtering, fallback/complement when uBO is unavailable. Preload package is MPL-2.0 transitive. |
| `fast-xml-parser` | 5.11.2 | MIT | RSS/Atom XML parsing in `@ione/rss`; dual ESM/CJS, typed, entity/depth controls. |
| `@playwright/test` | 1.64.1 | Apache-2.0 | Electron E2E via `chromium.connectOverCDP`; no Playwright browser download required. |
| `electron-builder` | 26.15.3 | MIT | Linux packaging (`dist/linux-unpacked` verified). Internal workspace packages are devDependencies because Vite bundles them. |

No third-party UI/virtualization/DnD package is installed. Virtualization is a
Svelte 5 windowed list; DnD uses native pointer events.

### Electron binary installation
Electron 44 no longer ships a package postinstall script. The root
`postinstall` invokes `install:electron` in `apps/desktop`, which downloads the
prebuilt binary on a fresh `bun install`. `electron` remains in
`trustedDependencies`; Bun runs the root lifecycle hook.

## Researched, not installed yet

None for Phases 1-7. Future virtualization/DnD libraries, extension API
shims, and packaging targets must be added here before use.

## Architecture decisions

### Process/view layout
- `BaseWindow` + two kinds of `WebContentsView`: exactly one chrome view and
  one view per tab (created lazily, only the active tab is attached).
- The chrome view is the vertical sidebar (320 px normal / 96 px compact)
  and contains the URL bar, tab tree, command palette, downloads, permissions,
  and extensions. The active tab occupies the remaining
  rectangle. This keeps all chrome in one Svelte UI/view and avoids
  click-blocking overlays that a full-window transparent chrome view would
  create.
- Chrome UI uses `session.defaultSession`; web content, extensions and the
  adblocker use `persist:browser`. Isolated space partitions use their own
  sessions and intentionally do not receive extensions in Phase 5.
- No `<webview>`, no `BrowserView`.

### Shell basics, palette and packaging (Phase 7)
- Navigation uses `navigationHistory` (back/forward) and reload/stop; find in
  page resolves `found-in-page` with a 2 s timeout. The chrome UI exposes nav
  buttons, Ctrl/Cmd+T/W/F/K, and a command palette with dynamic space/tab
  commands.
- Downloads are tracked from the `will-download` event in `persist:browser`;
  files save to the Downloads directory or `IONE_DOWNLOAD_DIR`, shown in a
  panel with progress/cancel/open/folder actions.
- Permission requests are routed per content session to a single chrome prompt
  (30 s timeout, deny on timeout/close). `setPermissionCheckHandler` exposes
  promptable permissions without pre-granting them; unsupported permissions
  stay denied.
- Compact mode resizes the chrome view via IPC (96 px, icons only) and persists
  in localStorage. A light theme overrides CSS variables; the active space
  still controls the accent.
- Performance mode (`IONE_PERF_MODE=1` + `IONE_PERF_TABS`) measures startup to
  chrome first paint and summed `app.getAppMetrics()` working set. Results are
  in `docs/perf.md`; current 50-tab sleeping working set is ~629 MB, startup
  ~200-250 ms on Xvfb.
- Playwright E2E connects over CDP to the built Electron app (the BaseWindow +
  WebContentsView layout has no BrowserWindow for `_electron.firstWindow`).
- electron-builder packages `out/`, runtime node_modules, and asar-unpacks the
  feed worker, better-sqlite3, and extension/adblock preload packages. The
  packaged `dist/linux-unpacked/ione` binary passed the full smoke flow,
  including an unpacked extension popup. Packaging is currently a Linux `dir`
  target; AppImage/signing/notarization are future work.

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

### Extensions and ad blocking (Phase 5)
- `ExtensionService` owns the `ElectronChromeExtensions` bridge in
  `persist:browser`, including `chrome.tabs`, webRequest, context menus,
  popups/actions, and extension-created tabs routed back through the core
  controller/reducer.
- `installChromeWebStore` loads persisted CWS extensions at startup (deferred
  until after the chrome's first load). `IONE_EXTENSION_DIRS` loads unpacked
  directories for development/testing. The Extensions panel can install by
  CWS id, uninstall, and open an extension's popup/options page in a tab.
- Web pages may not navigate to privileged chrome-extension:// pages; only
  extension pages themselves may navigate within the extension scheme.
  Extension pages are opened by the shell/user via tabs.
- Extension action toolbar (`<browser-action-list>`) is not rendered yet;
  popups are reachable from the Extensions panel. chrome.windows.create is
  unsupported (multi-window is out of scope), and permission prompts are
  denied.
- The built-in Ghostery blocker initializes after first paint, caches its
  serialized engine under userData, and is enabled by default
  (`IONE_ADBLOCK=off` disables it). It is skipped when an extension declares
  `webRequestBlocking` (uBO). Before installing an extension, built-in
  webRequest listeners are removed so they cannot clobber the extension's
  listeners.
- Known API gaps documented from the Phase 5 smoke: uBO 1.75.0 (MV2) loads;
  Bitwarden 2026.10.0 (MV3) installs from CWS and background service worker
  registration fails with ManifestError status 2, and its popup page returns
  ERR_FAILED. Permissions `contextMenus`, `sidePanel`, `webNavigation`,
  `notifications`, and `privacy` are unknown to Electron 44. `chrome.identity`,
  `storage.session`, MV3 `webRequest` dispatch, and DNR static rule loading
  remain gaps. uBO is no longer available on the CWS; side-load the GitHub
  1.75.0 ZIP.
- Licensing decision: the extension bridge is constructed with
  `license: 'GPL-3.0'` by default (override with
  `IONE_EXTENSION_LICENSE=Patron-License-2020-11-19` only with a valid Patron
  subscription). Any distributed Ione build that links this package must be
  GPLv3-compatible or covered by the Patron license. The current repository is
  private development code; this decision must be revisited before a public
  binary release.
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

### Chrome UI (Phase 3-4)
- One Svelte chrome view with: space switcher (create/remove/isolated login
  partition), address bar, global essentials, pinned tabs, and a virtualized
  regular-tab list.
- `@ione/ui-kit` owns the fixed-row `VirtualList` and `IconButton`. Only rows
  in/around the viewport exist in the DOM; tab keys are entity ids and the list
  binds to the parent height.
- Space theme maps to the `--accent` custom properties without re-rendering
  the tab data.
- New typed commands: create/update/remove/activate space, add/remove
  essential, pin/unpin/reset tab. All are validated in main and flow through
  the core reducer and diff pipeline.
- Essentials are global metadata rows; opening one creates a normal tab (and
  therefore a `WebContentsView` only on demand).
- Pinned tabs remain tabs with `pinned:true`/`pinnedUrl`; reset re-navigates to
  the stored pinned URL. Pinned tabs render in a separate fixed section.
- Nested folders render as a flattened virtualized tree (folders first, then
  tabs). Collapsed folders hide descendants. Folder CRUD, new-tab-in-folder,
  rename/delete, and parent moves go through typed IPC + core actions.
- Tab DnD uses native pointer events (no library): 5px threshold, folder/tab/
  space/root drop targets, midpoint insertion, a 2px drop indicator, Escape
  cancel, click suppression, and edge auto-scroll. Pinned tabs are not
  draggable; dropping into a collapsed folder expands it.

### Tab lifecycle and restore (Phase 4)
- On startup, `prepareLazyRestore` marks every tab sleeping except the valid
  active tab; only that tab gets a `WebContentsView`. Background tabs get
  views on activation and are destroyed by tab sleeping.
- Sleep policy: default 12 minutes (`IONE_TAB_SLEEP_MS`), checked once a minute
  (`IONE_TAB_SLEEP_TICK_MS`). Skip active, pinned, sleeping, viewless, audible,
  DevTools-open, and recently active tabs. Scroll is captured before the view
  is destroyed; `scrollY` survives restore and is applied after
  `did-finish-load`.
- Scroll positions are also captured when the active view is detached. The
  detach path re-attaches safely if the user switches back while the scroll
  query is in flight.
- Cleanup: the sleep interval is unref'd and stopped before persistence flush.

### RSS / live folders (Phase 6)
- `@ione/rss` is a framework-free parser/normalizer for RSS 2.0, RSS 1.0
  (RDF), Atom, and JSON Feed. It resolves relative item links, strips HTML to
  plain summaries, caps strings/items, and parses with `processEntities:false`.
- Fetching/parsing runs in an Electron `utilityProcess` (`out/main/feed-worker.js`,
  CJS) with a 20 s timeout, 5 MiB decoded cap, manual redirects (max 5, no
  HTTPS→HTTP downgrade), conditional `If-None-Match`/`If-Modified-Since`, and
  `Retry-After`. It never opens SQLite.
- Main `FeedService` owns scheduling, backoff (equal jitter, max 6 h), cache
  writes, and read/star preservation. Poll interval defaults to 15 min; due
  checks run every 30 s with at most 3 concurrent fetches.
- Migration 2 adds `feed_state` (validators, fetch URL, next poll, failures,
  title/site) and `feed_items` (stable sha256 ids, folder FK, title/author/
  summary/published/fetched/read/starred). Diffs are `feed.state`,
  `feed.state.remove`, `feed.items.replace`, `feed.item.upsert`, and
  `feed.item.remove`. Folder/space removal and feed URL changes clear cached
  feed data in the reducer.
- RSS folders render as virtual rows with unread dots, relative dates, refresh,
  and feed errors; opening an item creates one normal tab and marks the item
  read. A folder-create form accepts an optional feed URL and creates an RSS
  folder. Feed items are not tabs/WebContentsViews.
- Limits/gaps: no OPML import/export, media enclosures, full-text extraction,
  cross-device read sync, or worker auto-restart after a crash. Item bodies are
  stored as plain text, not raw HTML.

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
- `backgroundThrottling` stays at Electron defaults; tab sleeping is the
  explicit lifecycle feature described above rather than a hidden throttling
  hack.

## Scope ledger

### Phase 1-2 (implemented)
Monorepo scaffold, hardened window, chrome `WebContentsView`, lazily created
tab `WebContentsView`, URL bar, core model/reducers/folder tree/fractional
ordering/URL normalization/session normalization, SQLite migrations/repository/
write-behind, versioned diff IPC and Svelte diff application, unit tests and
Electron smoke mode.

### Phase 3 (implemented)
Space switcher with create/remove and optional isolated session partition,
global essentials (add/open/remove), pinned tabs with pin/unpin/reset, a
virtualized regular-tab sidebar via `@ione/ui-kit`, themed accents, typed IPC
for all of the above, and smoke coverage that exercises the interactions and
verifies the persisted rows.

### Phase 4 (implemented)
Core sleep policy/lazy restore/sibling order helpers; nested virtualized
folder tree; folder CRUD and moves; native pointer DnD for tabs across
folders/spaces; pinned reset (from Phase 3); tab sleeping with audible/
DevTools/pinned/recent guards; scroll capture+restore; lazy startup with only
the active tab's WebContents. Smoke covers folder creation, collapse, tab
create in folder, move out/back, pointer DnD into a folder, sleep/wake, and
persisted folder/sleep state.

### Phase 5 (implemented, with documented extension gaps)
Extension bridge and CWS installer, extension panel (list/install/remove/open
popup/options), lazy built-in adblock with cache and extension-conflict guard,
context-menu integration, uBO and Bitwarden smoke checks. Bitwarden's MV3
service worker/popup remain broken; uBO MV2 loads and forces the built-in
blocker to yield.

### Phase 6 (implemented)
RSS/Atom/JSON parser package, utility-process fetcher with conditional GET,
redirect/size/entity limits, SQLite feed cache migration, scheduler/backoff,
feed-item diffs, nested RSS folder UI with unread/read state, refresh, feed
errors, and virtual feed rows. Smoke covers create RSS folder, fetch, 304
refresh, open item as a tab, mark read, and persisted SQLite state.

### Phase 7 (implemented)
Command palette, keyboard shortcuts, back/forward/reload/stop, find in page,
downloads tracking/panel, permission prompt UI, compact sidebar and light
theme, performance harness (`docs/perf.md`), Playwright Electron E2E, and an
electron-builder Linux unpacked package.

## Verification gates

- `bun run typecheck` must pass (TS strict for core/main/preload + svelte-check).
- `bun run test:core` and `bun run test` must pass.
- `bun run build` must succeed.
- `bun run smoke` must print `IONE_SMOKE_READY` and exit 0 (needs a display or
  Xvfb on Linux).
- `bun run test:e2e` (Playwright/CDP) must pass.
- `bun run package` must produce a launchable `dist/linux-unpacked/ione`.
- `bun run perf` must regenerate `docs/perf.md`; the 50-tab sleeping case must
  stay well under 3 GB.

### Last verified (2026-10-21, after Phase 7)

- `bun run typecheck`: 0 errors, 0 warnings (svelte-check: 120 files).
- `bun run test:core`: 7 files, 225 tests passed.
- `bun run test`: 13 files, 256 tests passed.
- `bun run test:e2e`: 1 Playwright CDP test passed (chrome render, navigation, command palette, compact toggle).
- `bun run build`: main/preload/renderer bundles produced; built CSP is
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:; object-src 'none'; base-uri 'none';
  form-action 'none'; frame-src 'none'; connect-src 'self'`.
- `DISPLAY=:99 bun run smoke`: `IONE_SMOKE_READY` with typed bridge, address
  bar, essentials, pin/reset, space creation, folder creation + nested move,
  tab creation inside a folder, collapse/expand, move out, **synthetic pointer
  drag back into the folder**, sleep/wake of an inactive tab, folder rows,
  persisted SQLite state (5 tabs, 2 spaces, 3 folders, 1 sleeping tab, active
  tab in a folder), RSS folder + 2 feed items with a 304 refresh/read item,
  download file, permission deny prompt, command palette, theme/compact toggles,
  find matches, and back/forward navigation. Screenshot:
  `/tmp/ione-smoke-chrome.png`.
- Packaged `dist/linux-unpacked/ione` passed the same smoke flow and the
  unpacked-extension fixture flow.
- `electron-vite dev --noSandbox --remoteDebuggingPort 9333` under Xvfb:
  chrome target loaded from `http://localhost:5173/`, typed bridge present,
  address bar and tab row rendered, Vite HMR client connected without CSP
  errors.
### Phase 5 extension/adblock evidence (2026-10-21)

- Fixture extension via `IONE_EXTENSION_DIRS` loaded (`Ione Smoke Extension`
  1.0.0); popup rendered as `Ione Fixture Popup`; Extensions panel showed one
  row; adblock IPC reported ready.
- uBlock Origin 1.75.0 loaded from the GitHub MV2 ZIP; Extensions list reported
  `uBlock Origin@1.75.0`; with `IONE_ADBLOCK=on`, built-in adblock reported
  `skipped=true` because uBO declares `webRequestBlocking`.
- Bitwarden 2026.10.0 installed through the Chrome Web Store installer
  (`nngceckbapebfimnlniiiahkandclblb`); list reported the name/version. Loading
  its `popup/index.html` failed (ERR_FAILED) and the main log reported
  `Service worker registration failed. Status code: 2` plus unknown
  `contextMenus`, `sidePanel`, `webNavigation`, `notifications`, `privacy`
  permissions. This is a documented compatibility gap, not claimed working.
- Built-in adblock enabled with an environment without blocking extensions;
  the cached 6.8 MB engine reported matches for `doubleclick.net` and
  `google-analytics.com` and no match for `example.com/app.js`.

### Phase 6 RSS evidence (2026-10-21)

- Smoke feed served with ETag `"ione-smoke-v1"`; an RSS folder was created,
  two items parsed, a second fetch returned 304, the unread item opened as a
  normal tab titled `Feed Article`, and read state changed. SQLite contained
  the RSS folder, feed state with the ETag, two feed items, and a read item.
  Screenshot: `/tmp/ione-smoke-chrome.png`.
- `bun run test` covers parser RSS2/Atom/RSS1/JSON/entity handling, reducer
  feed actions/cleanup, and SQLite feed round-trip/diff persistence.

### Phase 7 shell/package evidence (2026-10-21)

- `bun run smoke` verified downloads (saved to `IONE_DOWNLOAD_DIR`), permission
  prompt (Notification request, deny), command palette, light/dark toggle,
  compact toggle, find-in-page count, and back/forward buttons alongside all
  earlier phase checks.
- `bun run test:e2e` passed one Playwright CDP test against the built app.
- `bun run package` produced `apps/desktop/dist/linux-unpacked/ione` (318 MB);
  the packaged binary passed the full smoke flow and a fixture-extension flow.
- `bun run perf` produced `docs/perf.md`: startup 207-252 ms; 50 awake tabs
  4.6 GB; 50 tabs with 49 sleeping 629 MB working set.

- The smoke harness uses `--no-sandbox` because this Linux container has
  neither a SUID Chromium sandbox nor unprivileged user namespaces. The
  application itself never passes `--no-sandbox`; smoke-only evidence is not a
  claim that OS-level sandboxing was exercised here.

## Open risks / handoff

- Electron-chrome-extensions is GPL-3.0/Patron-licensed. A distributed Ione
  binary must be GPLv3-compatible or covered by a Patron subscription.
- Bitwarden MV3 service worker/popup is broken in Electron 44; uBO MV2 is not
  available from the CWS (side-load the GitHub ZIP) and uBO disables the
  built-in blocker while loaded.
- Extension action toolbar is not rendered; popups are opened from the
  Extensions panel. Isolated space partitions have no extension APIs.
- RSS worker crashes are logged but not auto-restarted; OPML/media/full-text
  extraction and cross-device read sync are out of scope.
- Playwright is installed; the E2E test uses CDP because there is no
  BrowserWindow. Extend it as UI flows grow.
- Packaging is a Linux unpacked directory only; no AppImage/installer/signing
  and the container cannot validate the Chromium OS sandbox. Verify those on a
  normal desktop.
- CPU/IPC message-rate profiling is limited to diff batch counts; a detailed
  tracing pass remains future work.
- Permission prompts are one-at-a-time and deny on timeout; there is no
  persisted per-origin permission policy yet.
- Download tracking is attached to `persist:browser`; downloads initiated in an
  isolated space partition are not shown in the panel.
- Scroll restore is best-effort (captured on detach/sleep, 500 ms query
  timeout); it is not captured on abrupt process kill.
- This container cannot exercise the Chromium OS sandbox; verify the packaged
  app's sandbox installation on a normal Linux desktop before release.

