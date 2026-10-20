<script lang="ts">
  import { onMount } from 'svelte'
  import { IconButton, VirtualList } from '@ione/ui-kit'
  import { activeTabOf, applyDiffBatch, sortByOrder, tabsInSpace } from '@ione/core'
  import type { BrowserSnapshot, DiffBatch, Essential, Space, Tab } from '@ione/core'
  import type { CreateEssentialInput, CreateSpaceInput } from '../../shared/ipc'
  import AddressBar from './components/AddressBar.svelte'
  import Essentials from './components/Essentials.svelte'
  import Icon from './components/Icon.svelte'
  import SpaceSwitcher from './components/SpaceSwitcher.svelte'
  import TabRow from './components/TabRow.svelte'

  interface ThemeAccent {
    accent: string
    soft: string
    border: string
  }

  interface VirtualTabList {
    scrollToIndex(index: number): void
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

  let virtualTabs = $state<VirtualTabList | null>(null)

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
  const tabs = $derived(snapshot ? tabsInSpace(snapshot, snapshot.activeSpaceId) : [])
  const pinnedTabs = $derived(tabs.filter((tab) => tab.pinned))
  const unpinnedTabs = $derived(tabs.filter((tab) => !tab.pinned))

  $effect(() => {
    const activeId = activeTab?.id
    if (!activeId) return
    const index = unpinnedTabs.findIndex((tab) => tab.id === activeId)
    if (index >= 0) virtualTabs?.scrollToIndex(index)
  })

  onMount(() => {
    const unsubscribe = window.ione.onDiffs(handleDiffBatch)
    void loadInitial()

    return () => {
      unsubscribe()
      // Invalidate any fetch that resolves after teardown.
      syncToken += 1
      syncInFlight = false
      syncQueued = false
    }
  })

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

  function spaceName(space: Space | null): string {
    return space?.name.trim() || 'Tabs'
  }
</script>

<div
  class="chrome"
  style:--accent={activeTheme.accent}
  style:--accent-soft={activeTheme.soft}
  style:--accent-border={activeTheme.border}
>
  <header class="chrome-header">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">i</span>
      <span>Ione</span>
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
    />

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

    <section class="tabs" aria-label="Tabs">
      <div class="tabs-toolbar">
        <div class="tabs-heading">
          <h2 class="space-title" title={spaceName(activeSpace)}>{spaceName(activeSpace)}</h2>
          <span class="section-count">{tabs.length}</span>
        </div>
        <span class="new-tab" data-testid="new-tab">
          <IconButton label="New tab" title="New tab" size="sm" variant="soft" onclick={() => void createTab()}>
            <Icon name="plus" size={13} />
          </IconButton>
        </span>
      </div>

      <div class="tab-list" data-testid="tab-list">
        {#if tabs.length === 0}
          <div class="center-state empty-state">
            <p class="state-detail">No tabs in this space</p>
            <button
              class="primary-button"
              type="button"
              aria-label="New tab"
              data-testid="new-tab-empty"
              onclick={() => void createTab()}
            >
              New Tab
            </button>
          </div>
        {:else if unpinnedTabs.length === 0}
          <p class="empty-hint">Only pinned tabs</p>
        {:else}
          <VirtualList
            bind:this={virtualTabs}
            items={unpinnedTabs}
            itemHeight={38}
            ariaLabel="Open tabs"
            getKey={(tab: Tab) => tab.id}
          >
            {#snippet children(tab: Tab)}
              <TabRow
                {tab}
                active={tab.id === activeTab?.id}
                testid="tab-row"
                onactivate={(tabId) => void activateTab(tabId)}
                onclose={(tabId) => void closeTab(tabId)}
                onpin={(tabId) => void pinTab(tabId)}
              />
            {/snippet}
          </VirtualList>
        {/if}
      </div>
    </section>
  {/if}
</div>
