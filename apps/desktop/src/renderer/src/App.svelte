<script lang="ts">
  import { onMount } from 'svelte'
  import { IconButton } from '@ione/ui-kit'
  import { activeTabOf, applyDiffBatch, sortByOrder, tabsInSpace } from '@ione/core'
  import type { BrowserSnapshot, DiffBatch, Essential, FeedItem, Folder } from '@ione/core'
  import type {
    CreateEssentialInput,
    CreateFolderInput,
    CreateSpaceInput,
    DownloadInfo,
    MoveTabInput,
    PermissionRequestInfo,
    UpdateFolderInput
  } from '../../shared/ipc'
  import type { PaletteCommand } from './lib/palette'
  import AddressBar from './components/AddressBar.svelte'
  import CommandPalette from './components/CommandPalette.svelte'
  import DownloadsPanel from './components/DownloadsPanel.svelte'
  import FindBar from './components/FindBar.svelte'
  import Essentials from './components/Essentials.svelte'
  import ExtensionsPanel from './components/ExtensionsPanel.svelte'
  import PermissionPrompt from './components/PermissionPrompt.svelte'
  import Icon from './components/Icon.svelte'
  import SidebarTree from './components/SidebarTree.svelte'
  import SpaceSwitcher from './components/SpaceSwitcher.svelte'
  import TabRow from './components/TabRow.svelte'

  interface ThemeAccent {
    accent: string
    soft: string
    border: string
  }

  const DEFAULT_THEME: ThemeAccent = {
    accent: '#8ab4f8',
    soft: 'rgba(138, 180, 248, 0.16)',
    border: 'rgba(138, 180, 248, 0.35)'
  }

  const THEME_ACCENTS: Record<string, ThemeAccent> = {
    default: DEFAULT_THEME,
    ocean: {
      accent: '#6fd3ff',
      soft: 'rgba(111, 211, 255, 0.16)',
      border: 'rgba(111, 211, 255, 0.35)'
    },
    forest: {
      accent: '#7fd6a2',
      soft: 'rgba(127, 214, 162, 0.16)',
      border: 'rgba(127, 214, 162, 0.35)'
    },
    rose: {
      accent: '#f49ac1',
      soft: 'rgba(244, 154, 193, 0.16)',
      border: 'rgba(244, 154, 193, 0.35)'
    },
    amber: {
      accent: '#f2c46d',
      soft: 'rgba(242, 196, 109, 0.16)',
      border: 'rgba(242, 196, 109, 0.35)'
    }
  }

  function themeFor(name: string | undefined): ThemeAccent {
    if (!name || !Object.hasOwn(THEME_ACCENTS, name)) return DEFAULT_THEME
    return THEME_ACCENTS[name] ?? DEFAULT_THEME
  }

  let snapshot = $state<BrowserSnapshot | null>(null)
  let loading = $state(true)
  let loadError = $state<string | null>(null)
  let status = $state<string | null>(null)
  let extensionsOpen = $state(false)
  let downloadsOpen = $state(false)
  let paletteOpen = $state(false)
  let findOpen = $state(false)
  let compact = $state(false)
  let light = $state(false)
  let downloads = $state<DownloadInfo[]>([])
  let permissionRequest = $state<PermissionRequestInfo | null>(null)

  // Non-reactive coordination state for snapshot fetching.
  let syncToken = 0
  let syncInFlight = false
  let syncQueued = false
  let pendingBatches = false

  const activeSpace = $derived(snapshot ? (snapshot.spaces[snapshot.activeSpaceId] ?? null) : null)
  const activeTab = $derived(snapshot ? activeTabOf(snapshot) : null)
  const activeTheme = $derived(themeFor(activeSpace?.theme))

  const sortedSpaces = $derived(snapshot ? sortByOrder(Object.values(snapshot.spaces)) : [])
  const essentials = $derived(
    snapshot ? sortByOrder(Object.values(snapshot.essentials)) : ([] as Essential[])
  )
  const pinnedTabs = $derived(
    snapshot ? tabsInSpace(snapshot, snapshot.activeSpaceId).filter((tab) => tab.pinned) : []
  )

  const paletteCommands = $derived.by<PaletteCommand[]>(() => {
    const commands: PaletteCommand[] = [
      { id: 'new-tab', label: 'New tab', detail: 'Ctrl+T', run: () => void createTab() },
      { id: 'reload', label: 'Reload tab', run: reloadTab },
      { id: 'back', label: 'Go back', run: goBack },
      { id: 'forward', label: 'Go forward', run: goForward },
      { id: 'find', label: 'Find in page', detail: 'Ctrl+F', run: () => (findOpen = true) },
      {
        id: 'compact',
        label: compact ? 'Exit compact mode' : 'Enter compact mode',
        run: () => setCompact(!compact)
      },
      {
        id: 'theme',
        label: light ? 'Switch to dark theme' : 'Switch to light theme',
        run: toggleTheme
      },
      { id: 'extensions', label: 'Extensions and ad blocking', run: () => (extensionsOpen = true) },
      { id: 'downloads', label: 'Downloads', detail: 'Ctrl+Shift+J', run: () => (downloadsOpen = true) }
    ]

    if (snapshot) {
      for (const space of sortByOrder(Object.values(snapshot.spaces))) {
        commands.push({
          id: `space:${space.id}`,
          label: `Switch space: ${space.name}`,
          detail: space.id === snapshot.activeSpaceId ? 'active' : undefined,
          keywords: 'space',
          run: () => void activateSpace(space.id)
        })
      }
      for (const tab of tabsInSpace(snapshot, snapshot.activeSpaceId)) {
        const label = tab.title.trim() || tab.url.trim() || 'New Tab'
        commands.push({
          id: `tab:${tab.id}`,
          label: `Switch tab: ${label}`,
          detail: tab.pinned ? 'pinned' : undefined,
          keywords: 'tab',
          run: () => void activateTab(tab.id)
        })
      }
    }
    return commands
  })

  onMount(() => {
    const unsubscribe = window.ione.onDiffs(handleDiffBatch)
    const unsubscribeDownloads = window.ione.onDownloads((list) => {
      downloads = list
    })
    const unsubscribePermission = window.ione.onPermissionRequest((request) => {
      permissionRequest = request
    })
    void loadInitial()
    void window.ione
      .listDownloads()
      .then((list) => (downloads = list))
      .catch(() => undefined)

    compact = localStorage.getItem('ione.compact') === '1'
    light = localStorage.getItem('ione.theme') === 'light'
    void window.ione.setSidebarWidth(compact ? 96 : 320).catch(() => undefined)
    window.addEventListener('keydown', handleShortcut)

    return () => {
      unsubscribe()
      unsubscribeDownloads()
      unsubscribePermission()
      window.removeEventListener('keydown', handleShortcut)
      // Invalidate any fetch that resolves after teardown.
      syncToken += 1
      syncInFlight = false
      syncQueued = false
    }
  })

  function handleShortcut(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey
    if (!mod) return
    const key = event.key.toLowerCase()
    if (key === 'k' || (key === 'p' && event.shiftKey)) {
      event.preventDefault()
      paletteOpen = true
      findOpen = false
    } else if (key === 'f') {
      event.preventDefault()
      findOpen = true
      paletteOpen = false
    } else if (key === 't') {
      event.preventDefault()
      void createTab()
    } else if (key === 'w') {
      event.preventDefault()
      if (activeTab) void closeTab(activeTab.id)
    } else if (key === 'e' && event.shiftKey) {
      event.preventDefault()
      extensionsOpen = true
    } else if (key === 'j' && event.shiftKey) {
      event.preventDefault()
      downloadsOpen = true
    }
  }

  function setCompact(next: boolean): void {
    compact = next
    localStorage.setItem('ione.compact', next ? '1' : '0')
    void window.ione.setSidebarWidth(next ? 96 : 320).catch((error) => reportError(error))
  }

  function toggleTheme(): void {
    light = !light
    localStorage.setItem('ione.theme', light ? 'light' : 'dark')
  }

  function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message
    if (typeof error === 'string' && error.trim()) return error
    return 'Something went wrong.'
  }

  function reportError(error: unknown): void {
    status = errorMessage(error)
  }

  function reportBlocked(): void {
    status = 'Navigation was blocked for that address.'
  }

  function handleDiffBatch(batch: DiffBatch): void {
    if (!snapshot) {
      // Nothing to apply to yet; catch up once the initial snapshot lands.
      pendingBatches = true
      return
    }

    if (syncInFlight) {
      // A resync is authoritative; queue one more pass so no diff is lost.
      syncQueued = true
      return
    }

    if (!applyDiffBatch(snapshot, batch)) {
      void resync()
    }
  }

  async function loadInitial(): Promise<void> {
    loading = true
    loadError = null
    status = null
    syncInFlight = false
    syncQueued = false
    const token = ++syncToken

    try {
      const next = await window.ione.getSnapshot()
      if (token !== syncToken) return

      snapshot = next
      loading = false
      loadError = null

      if (pendingBatches) {
        pendingBatches = false
        void resync()
      }
    } catch (error) {
      if (token !== syncToken) return
      loading = false
      loadError = errorMessage(error)
    }
  }

  async function resync(): Promise<void> {
    if (syncInFlight) {
      syncQueued = true
      return
    }

    syncInFlight = true
    syncQueued = false
    const token = ++syncToken

    try {
      const next = await window.ione.getSnapshot()
      if (token !== syncToken) return

      snapshot = next
      loadError = null
    } catch (error) {
      if (token === syncToken) {
        status = `Sync failed: ${errorMessage(error)}`
      }
    } finally {
      if (token === syncToken) {
        syncInFlight = false
        if (syncQueued) {
          syncQueued = false
          void resync()
        }
      }
    }
  }

  function retry(): void {
    void loadInitial()
  }

  async function activateTab(tabId: string): Promise<void> {
    status = null
    try {
      await window.ione.activateTab(tabId)
    } catch (error) {
      reportError(error)
    }
  }

  async function closeTab(tabId: string): Promise<void> {
    status = null
    try {
      await window.ione.closeTab(tabId)
    } catch (error) {
      reportError(error)
    }
  }

  async function createTab(url?: string): Promise<void> {
    status = null
    try {
      await window.ione.createTab(url)
    } catch (error) {
      reportError(error)
    }
  }

  async function activateSpace(spaceId: string): Promise<void> {
    status = null
    try {
      await window.ione.activateSpace(spaceId)
    } catch (error) {
      reportError(error)
    }
  }

  function goBack(): void {
    void window.ione.navigateBack().catch(reportError)
  }

  function goForward(): void {
    void window.ione.navigateForward().catch(reportError)
  }

  function reloadTab(): void {
    void window.ione.reloadTab().catch(reportError)
  }

  async function createSpace(input: CreateSpaceInput): Promise<boolean> {
    status = null
    try {
      await window.ione.createSpace(input)
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }

  async function removeSpace(spaceId: string): Promise<boolean> {
    status = null
    try {
      await window.ione.removeSpace(spaceId)
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }

  async function addEssential(input: CreateEssentialInput): Promise<boolean> {
    status = null
    try {
      await window.ione.addEssential(input)
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }

  async function removeEssential(essentialId: string): Promise<void> {
    status = null
    try {
      await window.ione.removeEssential(essentialId)
    } catch (error) {
      reportError(error)
    }
  }

  async function pinTab(tabId: string): Promise<void> {
    status = null
    try {
      await window.ione.pinTab(tabId)
    } catch (error) {
      reportError(error)
    }
  }

  async function unpinTab(tabId: string): Promise<void> {
    status = null
    try {
      await window.ione.unpinTab(tabId)
    } catch (error) {
      reportError(error)
    }
  }

  async function resetPinnedTab(tabId: string): Promise<void> {
    status = null
    try {
      const result = await window.ione.resetPinnedTab(tabId)
      if (!result) status = 'No pinned URL to restore for that tab.'
    } catch (error) {
      reportError(error)
    }
  }

  async function createTabInFolder(folderId: string | null): Promise<void> {
    status = null
    try {
      await window.ione.createTabInFolder(folderId)
    } catch (error) {
      reportError(error)
    }
  }

  async function refreshFeed(folderId: string): Promise<void> {
    status = null
    try {
      await window.ione.refreshFeed(folderId)
    } catch (error) {
      reportError(error)
    }
  }

  async function openFeedItem(item: FeedItem): Promise<void> {
    status = null
    try {
      await window.ione.createTab(item.url)
      await window.ione.markFeedRead(item.id)
    } catch (error) {
      reportError(error)
    }
  }

  async function createFolder(input: CreateFolderInput): Promise<Folder | null> {
    status = null
    try {
      return await window.ione.createFolder(input)
    } catch (error) {
      reportError(error)
      return null
    }
  }

  async function updateFolder(folderId: string, patch: UpdateFolderInput): Promise<void> {
    status = null
    try {
      await window.ione.updateFolder(folderId, patch)
    } catch (error) {
      reportError(error)
    }
  }

  async function removeFolder(folderId: string): Promise<void> {
    status = null
    try {
      await window.ione.removeFolder(folderId)
    } catch (error) {
      reportError(error)
    }
  }

  async function moveTab(tabId: string, target: MoveTabInput): Promise<void> {
    status = null
    try {
      await window.ione.moveTab(tabId, target)
    } catch (error) {
      reportError(error)
    }
  }
</script>

<div
  class="chrome"
  class:compact
  class:light
  style:--accent={activeTheme.accent}
  style:--accent-soft={activeTheme.soft}
  style:--accent-border={activeTheme.border}
>
  <header class="chrome-header">
    <div class="header-top">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">i</span>
        <span>Ione</span>
      </div>
      <div class="header-actions">
        <span class="command-button" data-testid="command-button">
          <IconButton
            label="Command palette"
            title="Command palette (Ctrl+K)"
            size="sm"
            onclick={() => (paletteOpen = true)}
          >
            <Icon name="command" size={13} />
          </IconButton>
        </span>
        <span class="downloads-button" data-testid="downloads-button">
          <IconButton
            label="Downloads"
            title="Downloads"
            size="sm"
            onclick={() => (downloadsOpen = true)}
          >
            <Icon name="download" size={13} />
          </IconButton>
          {#if downloads.some((download) => download.state === 'progressing')}
            <span class="action-dot" aria-hidden="true"></span>
          {/if}
        </span>
        <span class="theme-button" data-testid="theme-toggle">
          <IconButton
            label={light ? 'Switch to dark theme' : 'Switch to light theme'}
            title={light ? 'Dark theme' : 'Light theme'}
            size="sm"
            onclick={toggleTheme}
          >
            <Icon name={light ? 'moon' : 'sun'} size={13} />
          </IconButton>
        </span>
        <span class="compact-button" data-testid="compact-toggle">
          <IconButton
            label={compact ? 'Exit compact mode' : 'Enter compact mode'}
            title={compact ? 'Expand sidebar' : 'Compact sidebar'}
            size="sm"
            onclick={() => setCompact(!compact)}
          >
            <Icon name="compact" size={13} />
          </IconButton>
        </span>
        <span class="extensions-button" data-testid="extensions-button">
          <IconButton
            label="Extensions and ad blocking"
            title="Extensions"
            size="sm"
            onclick={() => (extensionsOpen = true)}
          >
            <Icon name="extensions" size={13} />
          </IconButton>
        </span>
      </div>
    </div>

    {#if snapshot}
      <SpaceSwitcher
        spaces={sortedSpaces}
        activeSpaceId={snapshot.activeSpaceId}
        onactivate={(spaceId) => void activateSpace(spaceId)}
        oncreate={createSpace}
        onremove={removeSpace}
      />
    {/if}
  </header>

  {#if loading && !snapshot}
    <div class="center-state" role="status" aria-live="polite">Loading…</div>
  {:else if loadError && !snapshot}
    <div class="center-state" role="alert">
      <p class="state-title">Could not load tabs</p>
      <p class="state-detail">{loadError}</p>
      <button class="primary-button" type="button" aria-label="Retry loading tabs" onclick={retry}>
        Retry
      </button>
    </div>
  {:else if snapshot}
    <AddressBar
      activeTab={activeTab}
      onclear={() => (status = null)}
      onerror={reportError}
      onblocked={reportBlocked}
      onback={goBack}
      onforward={goForward}
      onreload={reloadTab}
    />

    {#if findOpen}
      <FindBar onclose={() => (findOpen = false)} />
    {/if}

    {#if status}
      <div class="status" role="alert">
        <span class="status-message">{status}</span>
        <IconButton label="Dismiss message" title="Dismiss" size="sm" variant="danger" onclick={() => (status = null)}>
          <Icon name="close" size={12} />
        </IconButton>
      </div>
    {/if}

    <Essentials
      {essentials}
      onopen={(url) => void createTab(url)}
      onadd={addEssential}
      onremove={(essentialId) => void removeEssential(essentialId)}
    />

    {#if pinnedTabs.length > 0}
      <section class="pinned-section" aria-label="Pinned tabs">
        <div class="section-head">
          <h2 class="section-title">Pinned</h2>
          <span class="section-count">{pinnedTabs.length}</span>
        </div>
        <div class="pinned-list">
          {#each pinnedTabs as tab (tab.id)}
            <TabRow
              {tab}
              active={tab.id === activeTab?.id}
              testid="pinned-tab"
              onactivate={(tabId) => void activateTab(tabId)}
              onclose={(tabId) => void closeTab(tabId)}
              onunpin={(tabId) => void unpinTab(tabId)}
              onreset={(tabId) => void resetPinnedTab(tabId)}
            />
          {/each}
        </div>
      </section>
    {/if}

    <SidebarTree
      {snapshot}
      activeTabId={activeTab?.id ?? null}
      onactivate={(tabId) => void activateTab(tabId)}
      onclose={(tabId) => void closeTab(tabId)}
      onpin={(tabId) => void pinTab(tabId)}
      oncreatetab={(folderId) => void createTabInFolder(folderId)}
      oncreatefolder={createFolder}
      onupdatefolder={(folderId, patch) => void updateFolder(folderId, patch)}
      onremovefolder={(folderId) => void removeFolder(folderId)}
      onmovetab={(tabId, target) => void moveTab(tabId, target)}
      onrefreshfeed={(folderId) => void refreshFeed(folderId)}
      onopenfeeditem={(item) => void openFeedItem(item)}
    />
  {/if}

  {#if extensionsOpen}
    <ExtensionsPanel
      onclose={() => (extensionsOpen = false)}
      onopenurl={(url) => {
        extensionsOpen = false
        void createTab(url)
      }}
    />
  {/if}

  {#if paletteOpen}
    <CommandPalette commands={paletteCommands} onclose={() => (paletteOpen = false)} />
  {/if}

  {#if downloadsOpen}
    <DownloadsPanel {downloads} onclose={() => (downloadsOpen = false)} />
  {/if}

  {#if permissionRequest}
    <PermissionPrompt
      request={permissionRequest}
      onclose={() => (permissionRequest = null)}
    />
  {/if}
</div>
