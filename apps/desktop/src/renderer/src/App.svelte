<script lang="ts">
  import { onMount } from 'svelte'
  import { activeTabOf, applyDiffBatch, sortByOrder, tabsInSpace } from '@ione/core'
  import type { BrowserSnapshot, DiffBatch, Space, Tab } from '@ione/core'

  const FALLBACK_TITLE = 'New Tab'

  let snapshot = $state<BrowserSnapshot | null>(null)
  let loading = $state(true)
  let loadError = $state<string | null>(null)
  let status = $state<string | null>(null)

  let urlDraft = $state('')
  let urlFocused = $state(false)
  let committedUrl = $state<string | null>(null)
  let addressInput = $state<HTMLInputElement | null>(null)

  let failedFavicons = $state<Record<string, string>>({})

  // Non-reactive coordination state for snapshot fetching.
  let syncToken = 0
  let syncInFlight = false
  let syncQueued = false
  let pendingBatches = false

  const activeSpaceId = $derived(snapshot ? snapshot.activeSpaceId : null)
  const activeSpace = $derived(snapshot ? (snapshot.spaces[snapshot.activeSpaceId] ?? null) : null)
  const activeTab = $derived(snapshot ? activeTabOf(snapshot) : null)
  const sortedSpaces = $derived(snapshot ? sortByOrder(Object.values(snapshot.spaces)) : [])
  const tabs = $derived(snapshot ? tabsInSpace(snapshot, snapshot.activeSpaceId) : [])

  $effect(() => {
    const tabUrl = activeTab ? activeTab.url : ''
    if (committedUrl !== null && tabUrl === committedUrl) {
      committedUrl = null
      return
    }
    if (!urlFocused) {
      urlDraft = committedUrl ?? tabUrl
    }
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

  function labelFor(tab: Tab): string {
    const title = tab.title.trim()
    if (title) return title
    const url = tab.url.trim()
    if (url) return url
    return FALLBACK_TITLE
  }

  function fallbackLetter(tab: Tab): string {
    const match = labelFor(tab).match(/[a-z0-9]/i)
    return (match?.[0] ?? '?').toUpperCase()
  }

  function safeFavicon(raw: string): string | null {
    const value = raw.trim()
    if (!value) return null
    if (/^data:image\//i.test(value)) return value

    try {
      const parsed = new URL(value)
      if (parsed.protocol === 'https:') return value
    } catch {
      return null
    }

    return null
  }

  function faviconFor(tab: Tab): string | null {
    const source = safeFavicon(tab.favicon)
    if (!source) return null
    return failedFavicons[tab.id] === source ? null : source
  }

  function handleFaviconError(tab: Tab): void {
    const source = safeFavicon(tab.favicon)
    if (source) failedFavicons[tab.id] = source
  }

  function spaceGlyph(space: Space): string {
    const icon = space.icon.trim()
    if (icon && Array.from(icon).length <= 2) return icon
    const name = space.name.trim()
    return name ? name.charAt(0).toUpperCase() : '•'
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault()
    void navigateDraft()
  }

  async function navigateDraft(): Promise<void> {
    const input = urlDraft.trim()
    if (!input) return

    status = null
    try {
      const result = await window.ione.navigate(input)
      if (!result) {
        status = 'Navigation was blocked for that address.'
      } else {
        committedUrl = result.url
        urlDraft = result.url
      }
    } catch (error) {
      status = errorMessage(error)
    } finally {
      addressInput?.blur()
    }
  }

  async function activateTab(tabId: string): Promise<void> {
    status = null
    try {
      await window.ione.activateTab(tabId)
    } catch (error) {
      status = errorMessage(error)
    }
  }

  async function closeTab(tabId: string): Promise<void> {
    status = null
    try {
      await window.ione.closeTab(tabId)
    } catch (error) {
      status = errorMessage(error)
    }
  }

  async function createTab(): Promise<void> {
    status = null
    try {
      await window.ione.createTab()
    } catch (error) {
      status = errorMessage(error)
    }
  }

  async function activateSpace(spaceId: string): Promise<void> {
    status = null
    try {
      await window.ione.activateSpace(spaceId)
    } catch (error) {
      status = errorMessage(error)
    }
  }

  function handleAddressFocus(): void {
    urlFocused = true
  }

  function handleAddressBlur(): void {
    urlFocused = false
  }
</script>

<div class="chrome">
  <header class="chrome-header">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">i</span>
      <span>Ione</span>
    </div>

    {#if snapshot}
      <nav class="spaces" aria-label="Spaces">
        {#each sortedSpaces as space (space.id)}
          <button
            class="space-chip"
            class:active={space.id === activeSpaceId}
            type="button"
            aria-label={`Switch to ${space.name}`}
            aria-current={space.id === activeSpaceId ? 'true' : undefined}
            title={space.name}
            onclick={() => void activateSpace(space.id)}
          >
            <span class="space-icon" aria-hidden="true">{spaceGlyph(space)}</span>
            <span class="space-name">{space.name}</span>
          </button>
        {/each}
      </nav>
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
    <form class="url-form" onsubmit={handleSubmit}>
      <input
        class="address-input"
        bind:this={addressInput}
        bind:value={urlDraft}
        type="text"
        aria-label="Address"
        placeholder="Search or enter address"
        autocomplete="off"
        spellcheck="false"
        onfocus={handleAddressFocus}
        onblur={handleAddressBlur}
      />
      <button class="go-button" type="submit" aria-label="Navigate">
        <span aria-hidden="true">↵</span>
      </button>
    </form>

    {#if status}
      <div class="status" role="alert">
        <span class="status-message">{status}</span>
        <button
          class="status-dismiss"
          type="button"
          aria-label="Dismiss message"
          onclick={() => {
            status = null
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    {/if}

    <section class="tabs" aria-label="Tabs">
      <div class="tabs-toolbar">
        <h2 class="space-title">{activeSpace?.name ?? 'Tabs'}</h2>
        <button class="new-tab" type="button" aria-label="New tab" onclick={() => void createTab()}>
          <span aria-hidden="true">+</span>
        </button>
      </div>

      {#if tabs.length === 0}
        <div class="center-state empty-state">
          <p class="state-detail">No tabs in this space</p>
          <button
            class="primary-button"
            type="button"
            aria-label="New tab"
            onclick={() => void createTab()}
          >
            New Tab
          </button>
        </div>
      {:else}
        <ol class="tab-list">
          {#each tabs as tab (tab.id)}
            {@const favicon = faviconFor(tab)}
            {@const label = labelFor(tab)}
            <li class="tab-row" class:active={tab.id === activeTab?.id}>
              <button
                class="tab-main"
                type="button"
                aria-label={`Activate ${label}${tab.pinned ? ' (pinned)' : ''}`}
                aria-current={tab.id === activeTab?.id ? 'true' : undefined}
                title={label}
                onclick={() => void activateTab(tab.id)}
              >
                {#if favicon}
                  <img
                    class="favicon"
                    src={favicon}
                    alt=""
                    aria-hidden="true"
                    onerror={() => handleFaviconError(tab)}
                  />
                {:else}
                  <span class="favicon favicon-fallback" aria-hidden="true">
                    {fallbackLetter(tab)}
                  </span>
                {/if}
                <span class="tab-title">{label}</span>
                {#if tab.pinned}
                  <span class="pin" title="Pinned" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
                      <path
                        d="M9.4 1.3a1 1 0 0 1 1.4 0l3.9 3.9a1 1 0 0 1-.3 1.6l-2.1.8-2.6 2.6-.5 3.5a.7.7 0 0 1-1.2.4L4.4 10.5l-3 3a.7.7 0 0 1-1-1l3-3L-.4 5.9a.7.7 0 0 1 .4-1.2l3.5-.5L6.1 1.6Z"
                        transform="translate(1.5 1.5) scale(0.85)"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                {/if}
              </button>
              <button
                class="tab-close"
                type="button"
                aria-label={`Close ${label}`}
                title={`Close ${label}`}
                onclick={(event) => {
                  event.stopPropagation()
                  void closeTab(tab.id)
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}
</div>
