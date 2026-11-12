<p align="center">
  <img src="logo/ione-transp.svg" alt="Ione" width="112">
</p>

# Ione

[![Latest release](https://img.shields.io/github/v/release/haasele/ione?label=latest&sort=semver)](https://github.com/haasele/ione/releases/latest)
[![Release](https://github.com/haasele/ione/actions/workflows/release-desktop.yml/badge.svg)](https://github.com/haasele/ione/actions/workflows/release-desktop.yml)
[![Nightly](https://img.shields.io/github/actions/workflow/status/haasele/ione/nightly.yml?label=Nightly&branch=main)](https://github.com/haasele/ione/actions/workflows/nightly.yml)

Ione brings [Zen Browser](https://zen-browser.app)'s user experience to the Chromium engine. Zen
is a Firefox (Gecko) fork; Ione rebuilds its chrome and behaviours on Blink/V8, so pages render as
they do in Chrome while the browser UI stays Zen's. The reference is **Zen 1.22b** (September
2026).

It runs as a desktop app (Electron; Linux, Windows and macOS) and as an Android app (the system
WebView). Both share the browser core and the React chrome. On phones the chrome becomes a bottom
bar with the sidebar in a drawer; tablets and phones in a Samsung DeX session with a pointer use
the desktop layout.

Ione continues the browser originally built as **Zenium** by **BenItBuhner**; see
[Credits](#credits). It is an independent project and is not affiliated with the Zen Browser team.

## Download

Stable releases are tagged `v<version>` and built by
[release-desktop.yml](https://github.com/haasele/ione/actions/workflows/release-desktop.yml).
Every push to `main` also produces a nightly prerelease from
[nightly.yml](https://github.com/haasele/ione/actions/workflows/nightly.yml); nightlies use a
version like `v<version>-nightly.<run>`, are marked as pre-releases and never become the
repository's "latest" release. Both channels build the same package set.

| Platform         | Packages                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10 / 11  | `ione-<version>-x64-setup.exe` (NSIS), `ione-<version>-x64.msi`, `ione-<version>-x64-portable.zip`                                                                                                          |
| macOS            | `ione-<version>-x64.dmg`, `ione-<version>-arm64.dmg`; updater ZIPs `ione-<version>-x64.zip`, `ione-<version>-arm64.zip`                                                                                       |
| Linux            | `ione-<version>-x86_64.AppImage`, `ione_<version>_amd64.deb`, `ione-<version>-x86_64.rpm`, `ione-<version>-x86_64.flatpak`, `install.sh`                                                                      |
| Android 8.0+     | `ione-<version>.apk`                                                                                                                                                                                |

Windows and Linux packages are x64 only. macOS ships separate Intel (x64) and Apple Silicon
(arm64) builds.

Each release also carries `SHA256SUMS.txt`, `update-manifest.json` (with an optional
`update-manifest.json.sig`) and the `latest*.yml` feeds used by the updater. The manifest lists
the packages the in-app updater can apply, with their size and SHA-256; `SHA256SUMS.txt` covers
the published files (packages, feeds and `install.sh`):

```bash
sha256sum -c SHA256SUMS.txt
```

### Install

| Platform | First install                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | Run the NSIS `setup.exe` or the MSI. The portable ZIP can be extracted anywhere and run without installing.                                                                                                                    |
| macOS    | Open the DMG and drag **Ione** to Applications. The ZIP is the updater package, not the first-install download.                                                                                                                |
| Linux    | Run the AppImage, install the `.deb` with `apt`/`dpkg`, the `.rpm` with `dnf`/`rpm`, or the Flatpak with `flatpak install ./ione-<version>-x86_64.flatpak`. `install.sh` next to the packages performs a per-user AppImage install or installs the `.deb` and verifies `SHA256SUMS.txt` first. |
| Android  | Open the APK and allow installation from that source. Android 8.0 (API 26) or newer is required.                                                                                                                              |

Without the signing secrets below, Windows and Linux packages are unsigned and macOS builds are
only ad-hoc signed. Windows SmartScreen and macOS Gatekeeper may therefore ask for confirmation
on first launch; the checksums above let you verify the file you downloaded.

### Coming from Zen or Zenium

Ione inherits the old profile on first launch: the `Zen` and `Zenium` user-data directories become
`Ione`, and a `zen-sync` / `zenium-sync` folder becomes `ione-sync`. The Windows installer removes
the old Zenium and Zen installations but keeps their data; the `.deb` declares the old `zenium`
and `zen-chromium` packages as replaced and conflicting. macOS users delete the old `Zen.app` /
`Zenium.app` themselves. On Android, Ione installs alongside the old app; Android cannot migrate
its private data, so uninstall the old app afterwards.

The `.deb` also keeps `zenium` and `zen-chromium` as command aliases of `ione` for one release.
Ione itself used the application id `io.github.benitbuhner.ione` before `dev.haasele.ione`: the
Windows installer retires that older uninstall entry while keeping the profile, and Android treats
the new id as a separate app that cannot read the old app's private data.

## Bundled extensions

- **uBlock Origin Lite** is the built-in content blocker, installed and pinned on first launch.
  Its popup, dashboard and list controls are the blocker's own UI, restyled at runtime to match
  Ione; the old filter-list settings and bundled lists are retired when the extension is present.
  Disable or reconfigure it in Settings → Extensions or from its dashboard.
- **ieq**, the live audio equalizer, is preinstalled and pinned to the toolbar, ready to EQ the
  audio of any page.

## Automatic updates

Ione checks releases in `haasele/ione` on startup and every six hours. Settings → Updates offers
a manual check, a stable or beta channel, and a background-download switch. The stable channel
reads GitHub's latest stable release; the beta channel also considers pre-releases, including
nightly builds. Nightly builds are therefore opt-in: choose the beta channel to receive them.

Every release publishes `update-manifest.json` (version, package URLs, sizes and SHA-256 hashes)
and the `latest*.yml` feeds read by electron-updater. How an update is applied depends on the
install:

| Install                        | Behaviour                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows NSIS installer         | Downloaded in the background and installed when Ione restarts.                                                                                                        |
| AppImage                       | Downloaded in the background; the new image replaces the old one when Ione restarts.                                                                                   |
| Debian package                 | Downloaded in the background; installing runs `dpkg` through `pkexec` and asks for your password.                                                                     |
| macOS                          | Downloaded and verified, then the app bundle is swapped on restart when its folder is writable. From a disk image or an unwritable folder, Ione opens the new DMG.     |
| Android                        | Ione downloads and verifies the APK and hands it to the package installer; upgrades in place only with the same signing key and applicationId.                        |
| rpm, Flatpak                   | Not updated in place; update with your package manager or from the release page.                                                                                      |
| Portable ZIP                   | Not updated in place; download the new ZIP from the release page.                                                                                                     |

Every update download is checked against the manifest's SHA-256, and electron-updater
additionally checks its own SHA-512. When `UPDATE_MANIFEST_SIGNING_KEY` is configured, releases
also publish an ed25519 signature for the manifest. A build can only enforce that signature if it
was compiled with the matching public key; otherwise the manifest is accepted on HTTPS plus its
checksums.

## What is ported

Ione tracks Zen 1.22b. Features implemented in the shared core work on both desktop and Android;
host-only items are marked.

| Area                        | What is included                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout                      | Vertical tab sidebar (single, multiple and collapsed layouts; right side, resizable, icon-collapse); Zen-style centered titlebar with Back / Forward / Reload, a centered address pill, extension actions and the menu; horizontal tab strip on request. Window transparency and native system window controls are desktop-only.                                               |
| Compact Mode                | Hide the sidebar and/or toolbar, reveal on edge hover, persistent floating sidebar (Ctrl+Alt+S), per window.                                                                                                                                                                                                                                                                 |
| Spaces                      | Icons, per-space gradient themes, default containers, slide animation, space switcher, Space Routing ("Add Route for Domain"), "Create New Space" and opening a space in a new window.                                                                                                                                                                                       |
| Essentials and pinned tabs  | Favicon tile grid at the top of the sidebar, container-specific Essentials; pinned tabs reset to their URL, unload/switch on close, a URL editor, rename by double-click and an emoji icon picker.                                                                                                                                                                           |
| Folders and Live Folders    | Create, rename, collapse, unpack and delete folders; drag tabs in. Live Folders read GitHub pull requests (with draft filter), GitHub issues, RSS/Atom feeds or REST endpoints with a field mapping, refresh every 15 minutes to 8 hours, and remember dismissed items.                                                                                                      |
| Split View and Glance       | Grid, vertical and horizontal splits for up to four tabs with resizable gutters; drag onto a page edge, "Split link in new tab", Alt+click a tab, or Ctrl/Shift+click several tabs to open them in a split. Glance previews a link over the current page and can expand into a tab or a split.                                                                                |
| Windows and sessions        | Desktop-only window sync: any number of windows can share the same tabs, spaces, folders and splits; blank windows (Ctrl+Shift+N) and private windows (Ctrl+Shift+P) are independent and never persisted. Every synced window is restored in the space it was in.                                                                                                           |
| Boosts and Reader View      | Per-site colour tint, fonts, text size, "zap element", force dark mode and custom CSS; Reader View (Ctrl+Alt+R) uses Mozilla Readability with theme, width and type controls.                                                                                                                                                                                               |
| URL bar, themes, shortcuts  | Floating URL bar with inline autofill, history/bookmarks/open-tab suggestions, space-only mode, `@engine` keywords and remembered drafts; theme picker with colour wheels, harmony algorithms and presets; Zen's shortcut table, fully rebindable with conflict detection.                                                                                                    |
| Containers and browsing     | Isolated cookie sessions per container with per-space defaults; history, bookmarks, downloads (Firefox-style unique names or "always ask"), find in page, screenshots, save page, print, view source, zoom, mute, PiP and sidebar media controls; native context menus, remembered permission prompts and `window.open` popups.                                                |
| Extensions and Mods         | Chrome extensions (Ctrl+Shift+A on desktop) load unpacked or from the Chrome Web Store into every container, with content scripts, storage, webRequest, scripting, runtime messaging, toolbar buttons and DevTools panels (desktop). Mods add custom CSS to the browser chrome.                                                                                                |
| Cross-device sync           | Settings → Sync exchanges end-to-end encrypted record sets (scrypt + AES-256-GCM) through a folder your cloud drive or Syncthing already syncs, or a WebDAV server. Spaces, folders, pinned tabs, Essentials, optional open tabs, containers, bookmarks, settings, shortcuts and Boosts are covered; Android picks its folder with the system file picker.                                                                                     |
| Resource governor           | Desktop-only memory, CPU and GPU budgets with purge → throttle → freeze → unload ladders, a live-page cap, queued background loads, battery/idle/suspend awareness and live meters in Settings.                                                                                                                                                                               |
| AI agents (MCP server)      | A loopback MCP server that lets local agents drive the browser with Playwright-style `browser_*` tools plus `ione_*` tools, foreground/background modes, per-agent tab groups and an approval prompt.                                                                                                                                                                          |
| Onboarding                  | First-run flow for look, search engine, Essentials, the feature tour, sync and shortcuts.                                                                                                                                                                                                                                                                                    |
| Not applicable              | Mozilla account sign-in, Firefox add-ons (AMO) and Gecko-only engine features such as Firefox Translations, PDF merging and QWAC display.                                                                                                                                                                                                                                    |

## Architecture

```
src/
  shared/     Types, Zen shortcut table, URL/search/theme/boost/live-folder helpers, zen:// page
              HTML, the page click script (Glance / pinned-tab rules, Boost "zap element" picker) –
              pure, unit tested
  core/       The browser: BrowserState (persistence, per-window snapshots), TabManager (one live
              page per tab, moved between windows), ZenWindow (per-window selection, Glance, find,
              compact state, view placement), spaces/split/glance behaviours, history, bookmarks,
              downloads, permissions, menus, keyboard routing, URL-bar suggestions, Boosts, Reader
              View, Live Folders, Mods, the resource planner and load scheduler (pure). Talks to the
              host only through the interfaces in core/platform.ts – no Electron, Node or DOM
              imports (lint-enforced)
  main/       Electron host: main process entry + platform/ (BrowserWindow per ZenWindow,
              WebContentsView per tab, native menus/dialogs, sessions/containers (+ private
              session), zen:// protocol, download tracking, fs storage, extensions, the resource
              governor with its CDP tab lifecycle and startup switches)
    sync/     Cross-device sync: records + LWW merge (pure), crypto, folder transport, engine
  preload/    index.ts – typed IPC bridge for the chrome; page.ts – Electron transport for the
              page script
  renderer/   Zen's chrome in React + Tailwind (shadcn-style primitives); adapts to phone /
              tablet / desktop from the viewport and pointer type, not from the platform
  android/    Android host, JS side: runs the core inside the chrome WebView, bridges to Kotlin,
              renders context menus in the chrome (sheets on touch, popovers with a mouse), and a
              browser-only preview host for developing the mobile layout on a desktop
android/      Android host, Kotlin side (Gradle project): one WebView per tab, downloads,
              permissions, WebView profiles for containers, snapshots, hardware keyboards, DeX
```

Every page is a host-owned web view (`WebContentsView` on Electron, `WebView` on Android). The
React chrome measures where its content area is and reports view rectangles; the core positions
the views attached to that window. Chrome overlays (URL bar, panels, Glance frame, the phone
drawer, menus) hide the live views and show a dimmed snapshot of the page behind them, which is
how Zen's "dim the page" look is reproduced – the same mechanism renders the preview of a tab
shown in another window.

All browser state lives in the core and is shared by every synced window; each window receives its
own snapshot (selection, Glance, find bar, compact state) and only sends commands over
`window.zen` (Electron: IPC through the preload; Android: a direct in-process call, since core and
chrome share the WebView). State is persisted atomically to `<userData>/ione/*.json` on desktop and
`files/ione/*.json` on Android; blank and private windows are never persisted.

Because the core and the chrome are shared, a feature landed for the desktop app is the same
feature on Android; only the host adapters (`src/main/platform`, `src/android` + `android/`) know
which platform they are on. Hosts declare what they cannot do (`HostCapabilities`): Android has
one window and no resource governor.

### Resource governor

Settings → Resources sets budgets for the whole browser: memory in MB or as a share of installed
RAM, CPU as a share of all cores, and GPU-process memory. Every few seconds the governor samples
`app.getAppMetrics()`, attributes each process to the tabs that own it, and escalates
cheapest-first through Chromium's own lifecycle machinery:

- **Memory** – V8 low-memory GC and a memory-pressure purge, then unload hidden pages by score,
  purge visible pages, and reload the active page if it alone busts the budget.
- **CPU** – throttle hidden pages 4× / 8× / 16×, freeze them, then unload pages that keep burning
  CPU while frozen; pages also see proportionally fewer cores.
- **GPU** – pause muted background media, purge, then unload one hidden page per cycle.

Hidden pages are frozen after a timeout and immediately when the system is idle, locked or
suspending, and are unloaded after Zen's tab-unloading timeout. A live-page cap is enforced and
background loads queue instead of all starting at once. Budgets shrink on battery. Pages playing
audio, excluded domains and pages with DevTools open are never touched; pinned tabs and Essentials
can be protected too. The process profile becomes Chromium command-line switches at the next
launch; `ZEN_GOVERNOR_LOG=1` prints one diagnostic line per sample. The governor is desktop-only;
Android relies on the system's memory management.

### AI agents (MCP server)

Settings → AI Agents turns on a built-in [Model Context Protocol](https://modelcontextprotocol.io)
server so any local AI agent can control the browser without an extension or CDP bridge. It
listens on `http://127.0.0.1:<port>/mcp` (Streamable HTTP):

```json
{ "mcpServers": { "ione": { "url": "http://127.0.0.1:41735/mcp" } } }
```

Clients that launch a command can use the stdio shim, which relays to the running browser:

```json
{ "mcpServers": { "ione": { "command": "ione", "args": ["--mcp"] } } }
```

The tool set combines Playwright-style `browser_*` tools (navigate, snapshot, click, type, press
key, scroll, select, wait, screenshot, tabs, read page, evaluate) with `ione_*` tools for status,
sessions, groups, modes, spaces and history, plus `ione://` resources. Every page tool names its
tab with `tabId`. Foreground agents bring their tab forward and show a labelled cursor; background
agents drive their own tabs without changing what you are looking at. Each connection gets its own
session and tab groups, and agent tabs are protected from the resource governor while held. The
server is loopback-only by default, validates `Origin` and `Host` against DNS rebinding, asks for
approval unless the client presents the connection token, never exposes private windows, and
requires a toggle before `browser_evaluate` can run scripts in pages.

## Running it

Requirements: Node 22.23.4+ and Bun 1.4+ (the package manager and script runner).

```bash
bun install
bun run dev          # start the browser with hot reload
```

Other scripts:

```bash
bun run typecheck    # tsc for main/preload/shared and renderer
bun run lint         # eslint
bun run test         # vitest unit tests
bun run check        # all of the above
bun run build        # production bundle in out/
bun run build:linux  # packaged app via electron-builder (also build:win / build:mac)
bun run build:android            # debug APK
bun run build:android:release    # release APK (R8)
```

On a headless Linux box run with a display, e.g. `xvfb-run -a bun run dev`. Command-line flags:
`ione https://example.com`, `ione --blank-window`, `ione --private-window`. Chrome's launch
switches: `--kiosk` (browser windows fullscreen without the chrome; F11 and Esc leave nothing),
`--user-data-dir=<path>` (the profile directory; one instance per directory, so two profiles run
side by side), `--restore-last-session` (the last session comes back whatever "Restore previous
session" says), `--start-maximized`; `--profile-directory=<name>` is accepted and ignored, Ione
keeping one profile per user-data directory. A second `ione` on the same profile hands its URLs
and window flags to the running one; its `--kiosk`, `--start-maximized` and
`--restore-last-session` change nothing there, as in Chrome.

## Setting up sync

Zen syncs Spaces through a Mozilla account. A Chromium port has no access to Firefox Sync, so Ione
brings its own transport: Settings → Sync → choose a folder that is already synced between your
computers (Dropbox, iCloud Drive, Google Drive, OneDrive, Nextcloud, Syncthing…) and a passphrase.
Each device writes one AES-256-GCM encrypted file (`ione-sync/<device>.zensync`) into that folder;
the folder never holds anything readable without the passphrase. Joining a folder that already has
data asks whether to merge or keep only the joining device's data, just like Zen 1.22. Conflicts
resolve last-writer-wins per record, with edits stamped when they happen.

## Android

Requirements: Node 22+, JDK 17+, an Android SDK with platform 35 / build-tools 35 (set
`ANDROID_HOME` or `android/local.properties`). Minimum Android 8.0 (API 26); containers need a
WebView with multi-profile support (Chrome 111+).

```bash
bun install
bun run build:android            # web bundle + Gradle → android/app/build/outputs/apk/debug/
bun run build:android:release    # release APK (R8) → android/app/build/outputs/apk/release/
```

Or use Android Studio: open `android/`; the Gradle build runs the Vite build first (pass
`-PskipWeb` to skip it when the assets are already built).

The release APK (applicationId `dev.haasele.ione`) is staged as `ione-<version>.apk`; its
`versionName` is the `package.json` version and its `versionCode` is derived from it
(`major·1000000 + minor·10000 + patch·100 + channel`, where a pre-release such as `-beta.2` sorts
below the final release; pass `-PversionCode=…` or set `ZEN_ANDROID_VERSION_CODE` to override). A
release build is signed with the keystore given by the environment or by Gradle properties (for
example in `~/.gradle/gradle.properties`). In CI the keystore is supplied as the
`ANDROID_KEYSTORE_BASE64` secret and decoded to a temporary file:

| Environment variable            | Gradle property                |                                  |
| ------------------------------- | ------------------------------ | -------------------------------- |
| `ZEN_ANDROID_KEYSTORE_FILE`     | `zen.android.keystoreFile`     | path to the `.keystore` / `.jks` |
| `ZEN_ANDROID_KEYSTORE_PASSWORD` | `zen.android.keystorePassword` |                                  |
| `ZEN_ANDROID_KEY_ALIAS`         | `zen.android.keyAlias`         |                                  |
| `ZEN_ANDROID_KEY_PASSWORD`      | `zen.android.keyPassword`      |                                  |

Without a keystore the release APK (like every debug build) is signed with the committed CI debug
key `android/ci-debug.keystore` (alias and password `ione-ci-debug`). It is a debug key that
anyone can sign with, but it is the same key everywhere, so debug-keyed builds – CI artifacts,
local builds and GitHub releases made without the keystore secrets – upgrade each other in place,
including through the in-app updater. Moving to the project release key later means one final
uninstall for those installs.

Developing the mobile chrome without a device:

```bash
bun run dev:android              # http://localhost:41734 – the Android chrome in a desktop
                                 # browser with iframes as tabs (use DevTools device emulation)
cd android && ./gradlew installDebug -PdevServer=http://10.0.2.2:41734/   # emulator loads the dev server
```

Debug builds expose the chrome WebView (browser core + UI) and every tab in `chrome://inspect`.

### How the layout adapts

| Window                                                          | Layout                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Width < 600 dp (phones)                                         | Bottom bar: back, address pill (favicon, lock, space badge – swipe sideways to change space), new tab, tab count, menu. Sidebar (Essentials, pinned, folders, spaces, theme) opens as a drawer; swiping the pill switches spaces. URL bar anchors to the top above the keyboard. Menus are bottom sheets. |
| ≥ 600 dp with touch (tablets, phones in landscape)              | The desktop layout with touch-sized controls (permanent close buttons, wider split gutters); long-press for context menus.                                                                                                                                                                                |
| Mouse / trackpad present (Samsung DeX, tablets with a keyboard) | The desktop layout as on Linux/Windows: hover affordances, tab drag & drop, popover menus, Zen's full shortcut table on the hardware keyboard, freeform window resizing.                                                                                                                                  |

The decision is made from the viewport and pointer, so rotating a phone or docking it into DeX
switches layouts live.

### Feature parity on Android

Everything in the feature table that lives in the core works identically, including: Spaces,
Essentials, pinned tabs, folders, Split View (grid / vertical / horizontal, resizable gutters),
Glance (from the long-press link menu, or Alt/Ctrl/Shift+tap with a keyboard), the URL bar and
its suggestions, Space Routing, containers (WebView profiles), themes, shortcuts, tab unloading,
history, bookmarks,
downloads (Android's download manager – no pause/resume), find in page, screenshots (to Downloads),
save page (web archive), print, zoom, permissions remembered per site, `window.open` popups and
session restore.

Not available on Android: developer tools for pages (use `chrome://inspect`), view-source,
Picture-in-Picture, window controls, Compact Mode's hover reveal (tap the edge instead), tab drag
& drop with a finger (use the tab menu), per-tab mute is best-effort (mutes the page's media
elements).

## Default shortcuts (Linux/Windows – Cmd replaces Ctrl on macOS)

| Action                                             | Shortcut                             |
| -------------------------------------------------- | ------------------------------------ |
| New tab (opens the floating URL bar)               | Ctrl+T                               |
| New window / new blank window / new private window | Ctrl+N / Ctrl+Shift+N / Ctrl+Shift+P |
| Toggle Compact Mode                                | Ctrl+S                               |
| Toggle floating sidebar                            | Ctrl+Alt+S                           |
| Next / previous space                              | Ctrl+Alt+→ / Ctrl+Alt+←              |
| Split view grid / vertical / horizontal / unsplit  | Ctrl+Alt+G / V / H / U               |
| New empty split                                    | Ctrl+Shift+*                         |
| Next / previous split pane                         | Ctrl+Alt+Shift+→ / Ctrl+Alt+Shift+←  |
| Pin / unpin tab                                    | Ctrl+Shift+D                         |
| Copy URL / as Markdown                             | Ctrl+Shift+C / Ctrl+Shift+Alt+C      |
| Expand Glance into a tab                           | Ctrl+O                               |
| Close all unpinned tabs                            | Ctrl+Shift+K                         |
| Reader View                                        | Ctrl+Alt+R                           |
| Add-ons and Themes                                 | Ctrl+Shift+A                         |
| Back / Forward                                     | Alt+← / Alt+→ (macOS: ⌘[ / ⌘])       |
| Glance a link                                      | Alt+click                            |
| Split a tab with the active one                    | Alt+click the tab                    |
| Save page                                          | Ctrl+Alt+Shift+S                     |

Everything is editable in Settings → Keyboard Shortcuts. The Chrome preset (the default) uses
Chrome's chords instead; on macOS it also takes ⌘← / ⌘→ for Back / Forward, except in a text
field, where they stay the caret's line-start / line-end keys as in Chrome.

## Releasing

The version in `package.json` is the single source of truth: the desktop About dialog reads it,
the Android `versionName` / `versionCode` are derived from it, and a release tag must be `v` plus
that version. `release-desktop.yml` refuses a tag that does not match.

Stable release:

1. Bump the version in `package.json` and commit the change to `main`.
2. Tag the commit `v<version>` and push the tag.
3. `release-desktop.yml` validates the tag, runs the shared packaging workflow, generates
   `update-manifest.json` (plus `.sig` when `UPDATE_MANIFEST_SIGNING_KEY` is set),
   `SHA256SUMS.txt` and the `latest*.yml` feeds, and publishes the GitHub release. A version with a
   pre-release suffix is published as a pre-release.
4. `workflow_dispatch` runs the same builds without publishing, which is the way to test packaging
   changes.

Nightly release: `.github/workflows/nightly.yml` runs on every push to `main` and on
`workflow_dispatch`. It strips any existing pre-release suffix from the `package.json` version,
builds `v<version>-nightly.<run>`, and publishes it as a GitHub pre-release with the same package
set and updater metadata. Nightlies never become the repository's "latest" release and are only
offered to clients on the beta update channel.

Both workflows call the same reusable packaging workflow, so the Windows, macOS, Linux and Android
artifacts stay in sync.

Code signing is optional and switched on by adding repository secrets; without them Windows and
Linux packages are unsigned and macOS builds are ad-hoc signed:

| Secrets                                                                                             | Effect                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                                                                      | Sign the macOS app with a Developer ID Application certificate (`base64 -w0 certificate.p12`)                                              |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`                                          | Notarize the signed macOS app                                                                                                              |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                                                              | Authenticode-sign the Windows installers                                                                                                   |
| `ANDROID_KEYSTORE_BASE64`, `ZEN_ANDROID_KEYSTORE_PASSWORD`, `ZEN_ANDROID_KEY_ALIAS`, `ZEN_ANDROID_KEY_PASSWORD` | Sign the APK with a release keystore (the base64 keystore is decoded to a temporary file for the build); until then it is signed with the committed CI debug key (`android/ci-debug.keystore`), which upgrades other CI-debug-keyed builds in place but is not a release key |
| `UPDATE_MANIFEST_SIGNING_KEY`                                                                       | Sign `update-manifest.json` with the ed25519 private key (base64 or PEM)                                                                   |

## Credits

Ione continues the browser originally built as **Zenium** by **BenItBuhner**; thanks for the
original port of Zen's experience to Chromium and for the work this tree builds on.

Zen itself is made by the [Zen Browser](https://zen-browser.app) team. Ione is an independent port
and is not affiliated with the Zen Browser team or the original Zenium project.

## Notes

- In a page, Ctrl+C or Ctrl+Shift+C copies the selection and Ctrl+V or Ctrl+Shift+V pastes
  (Command replaces Ctrl on macOS); the page context menu offers the same actions.
- The selection mini menu (Copy, Search, Define, Translate, Listen) is off by default. Turn it
  on in Settings → Look and Feel → Appearance → **Show the mini menu when text is selected**.
- The Glance trigger (Alt+click) can be swallowed by desktop environments that use Alt+click to
  move windows; change the trigger in Settings → Look and Feel → Glance if that happens.
- Ctrl+Alt+←/→ are also common desktop-workspace shortcuts on Linux; rebind them if your window
  manager grabs them first.
- Zen 1.21 lets you drag the window from empty space at the top of a web page. Pages here are
  native child views, so the chrome cannot intercept those drags; use the sidebar / toolbar.
- On desktop, extensions use Electron's Chrome-extension support; Android runs them in the
  chrome's WebView host. Coverage includes content scripts, `storage`, `webRequest`, `scripting`,
  `runtime` messaging and (on desktop) DevTools panels, but not the full Chrome API; extensions
  that rely on unsupported APIs will report errors in the Add-ons manager.
