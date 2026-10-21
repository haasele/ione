<script lang="ts">
  import { onDestroy } from 'svelte'
  import { VirtualList } from '@ione/ui-kit'
  import { getFolderChildren, sortByOrder } from '@ione/core'
  import type { BrowserSnapshot, Folder, Tab } from '@ione/core'
  import type {
    CreateFolderInput,
    MoveTabInput,
    UpdateFolderInput
  } from '../../../shared/ipc'
  import Icon from './Icon.svelte'
  import FolderRow from './FolderRow.svelte'
  import TabRow from './TabRow.svelte'
  import { IconButton } from '@ione/ui-kit'

  interface VirtualTreeList {
    scrollToIndex(index: number): void
  }

  interface TreeFolderRow {
    kind: 'folder'
    key: string
    folder: Folder
    depth: number
  }

  interface TreeTabRow {
    kind: 'tab'
    key: string
    tab: Tab
    depth: number
  }

  type TreeRow = TreeFolderRow | TreeTabRow

  interface FolderDropTarget {
    kind: 'folder'
    spaceId: string
    folderId: string
  }

  interface TabDropTarget {
    kind: 'tab'
    spaceId: string
    folderId: string | null
    beforeTabId: string | null
    hoverTabId: string
    position: 'before' | 'after'
  }

  interface RootDropTarget {
    kind: 'root'
    spaceId: string
  }

  type DropTarget = FolderDropTarget | TabDropTarget | RootDropTarget

  interface PendingDrag {
    tab: Tab
    startX: number
    startY: number
    started: boolean
    cancelled: boolean
  }

  interface Props {
    snapshot: BrowserSnapshot
    activeTabId: string | null
    onactivate: (tabId: string) => void
    onclose: (tabId: string) => void
    onpin: (tabId: string) => void
    oncreatetab: (folderId: string | null) => void
    oncreatefolder: (input: CreateFolderInput) => Promise<Folder | null>
    onupdatefolder: (folderId: string, patch: UpdateFolderInput) => void | Promise<void>
    onremovefolder: (folderId: string) => void
    onmovetab: (tabId: string, target: MoveTabInput) => void
  }

  let {
    snapshot,
    activeTabId,
    onactivate,
    onclose,
    onpin,
    oncreatetab,
    oncreatefolder,
    onupdatefolder,
    onremovefolder,
    onmovetab
  }: Props = $props()

  function folderIdOf(tab: Tab): string | null {
    return tab.folderId === undefined || tab.folderId === '' ? null : tab.folderId
  }

  function buildRows(
    folders: Record<string, Folder>,
    tabs: readonly Tab[],
    spaceId: string
  ): TreeRow[] {
    const rows: TreeRow[] = []
    const visited = new Set<string>()

    function tabsFor(folderId: string | null): Tab[] {
      return sortByOrder(tabs.filter((tab) => folderIdOf(tab) === folderId))
    }

    function walk(folder: Folder, depth: number): void {
      if (visited.has(folder.id)) return
      visited.add(folder.id)
      rows.push({ kind: 'folder', key: `folder:${folder.id}`, folder, depth })
      if (folder.collapsed) return
      for (const child of getFolderChildren(folders, spaceId, folder.id)) {
        walk(child, depth + 1)
      }
      for (const tab of tabsFor(folder.id)) {
        rows.push({ kind: 'tab', key: `tab:${tab.id}`, tab, depth: depth + 1 })
      }
    }

    for (const folder of getFolderChildren(folders, spaceId, null)) {
      walk(folder, 0)
    }
    for (const tab of tabsFor(null)) {
      rows.push({ kind: 'tab', key: `tab:${tab.id}`, tab, depth: 0 })
    }
    return rows
  }

  const activeSpace = $derived(snapshot.spaces[snapshot.activeSpaceId] ?? null)
  const spaceName = $derived(activeSpace?.name.trim() || 'Tabs')

  const allTabs = $derived(
    sortByOrder(
      Object.values(snapshot.tabs).filter((tab) => tab.spaceId === snapshot.activeSpaceId)
    )
  )
  const visibleTabs = $derived(allTabs.filter((tab) => !tab.pinned))
  const spaceFolders = $derived(
    Object.values(snapshot.folders).filter(
      (folder) => folder.spaceId === snapshot.activeSpaceId
    )
  )
  const rows = $derived(buildRows(snapshot.folders, visibleTabs, snapshot.activeSpaceId))

  const folderTabCounts = $derived.by(() => {
    const counts = new Map<string, number>()
    for (const tab of allTabs) {
      const folderId = folderIdOf(tab)
      if (folderId !== null) counts.set(folderId, (counts.get(folderId) ?? 0) + 1)
    }
    return counts
  })

  let treeList = $state<VirtualTreeList | null>(null)

  $effect(() => {
    if (!activeTabId) return
    const index = rows.findIndex((row) => row.kind === 'tab' && row.tab.id === activeTabId)
    if (index >= 0) treeList?.scrollToIndex(index)
  })

  let folderFormOpen = $state(false)
  let folderFormParentId = $state<string | null>(null)
  let folderFormSpaceId = $state<string | null>(null)
  let folderFormName = $state('')
  let folderSubmitting = $state(false)
  let folderInput = $state<HTMLInputElement | null>(null)

  let dragTabId = $state<string | null>(null)
  let dropTarget = $state<DropTarget | null>(null)
  let pendingDrag: PendingDrag | null = null
  let suppressTimer: number | null = null

  function openFolderForm(parentId: string | null): void {
    folderFormOpen = true
    folderFormParentId = parentId
    folderFormSpaceId = snapshot.activeSpaceId
    folderFormName = ''
    queueMicrotask(() => folderInput?.focus())
  }

  function closeFolderForm(): void {
    if (folderSubmitting) return
    folderFormOpen = false
    folderFormParentId = null
    folderFormSpaceId = null
    folderFormName = ''
  }

  $effect(() => {
    if (folderFormOpen && folderFormSpaceId !== snapshot.activeSpaceId) {
      folderFormOpen = false
      folderFormParentId = null
      folderFormSpaceId = null
      folderFormName = ''
    }
  })

  function toggleRootFolderForm(): void {
    if (folderFormOpen && folderFormParentId === null) closeFolderForm()
    else openFolderForm(null)
  }

  async function submitFolder(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (folderSubmitting) return

    const name = folderFormName.trim()
    if (!name) {
      folderInput?.focus()
      return
    }

    folderSubmitting = true
    try {
      const parentId = folderFormParentId
      if (parentId !== null) await onupdatefolder(parentId, { collapsed: false })

      const input: CreateFolderInput = { spaceId: snapshot.activeSpaceId, name }
      if (parentId !== null) input.parentId = parentId
      const folder = await oncreatefolder(input)
      if (folder) {
        folderSubmitting = false
        closeFolderForm()
      }
    } finally {
      folderSubmitting = false
    }
  }

  function handleToggleFolder(folderId: string): void {
    const folder = snapshot.folders[folderId]
    if (!folder) return
    void onupdatefolder(folderId, { collapsed: !folder.collapsed })
  }

  function handleRenameFolder(folderId: string, name: string): void {
    void onupdatefolder(folderId, { name })
  }

  function dropForTab(tabId: string): 'before' | 'after' | null {
    const target = dropTarget
    if (target?.kind === 'tab' && target.hoverTabId === tabId) return target.position
    return null
  }

  function nextVisibleSibling(
    tabId: string,
    spaceId: string,
    folderId: string | null,
    excludeId: string
  ): string | null {
    const siblings = sortByOrder(
      Object.values(snapshot.tabs).filter(
        (tab) =>
          tab.spaceId === spaceId &&
          !tab.pinned &&
          folderIdOf(tab) === folderId &&
          tab.id !== excludeId
      )
    )
    const index = siblings.findIndex((tab) => tab.id === tabId)
    if (index < 0) return null
    return siblings[index + 1]?.id ?? null
  }

  function resolveDropTarget(x: number, y: number, movingTabId: string): DropTarget | null {
    const element = document.elementFromPoint(x, y)
    if (!(element instanceof Element)) return null

    const tabElement = element.closest<HTMLElement>('[data-tab-id]')
    if (tabElement) {
      const tabId = tabElement.dataset.tabId
      const spaceId = tabElement.dataset.spaceId
      if (!tabId || !spaceId || tabId === movingTabId) return null

      const folderId = tabElement.dataset.folderId || null
      const rect = tabElement.getBoundingClientRect()
      const before = y < rect.top + rect.height / 2
      const beforeTabId = before
        ? tabId
        : nextVisibleSibling(tabId, spaceId, folderId, movingTabId)
      if (beforeTabId === movingTabId) return null

      return {
        kind: 'tab',
        spaceId,
        folderId,
        beforeTabId,
        hoverTabId: tabId,
        position: before ? 'before' : 'after'
      }
    }

    const folderElement = element.closest<HTMLElement>('[data-testid="folder-row"]')
    if (folderElement) {
      const folderId = folderElement.dataset.folderId
      const spaceId = folderElement.dataset.spaceId
      if (!folderId || !spaceId) return null
      return { kind: 'folder', spaceId, folderId }
    }

    const spaceElement = element.closest<HTMLElement>('[data-drop-space-id]')
    if (spaceElement) {
      const spaceId = spaceElement.dataset.dropSpaceId
      if (spaceId) return { kind: 'root', spaceId }
    }

    const rootElement = element.closest<HTMLElement>('[data-drop-root]')
    if (rootElement) {
      const spaceId = rootElement.dataset.spaceId
      if (spaceId) return { kind: 'root', spaceId }
    }

    return null
  }

  function targetInput(target: DropTarget): MoveTabInput {
    if (target.kind === 'folder') {
      return { spaceId: target.spaceId, folderId: target.folderId, beforeTabId: null }
    }
    if (target.kind === 'tab') {
      return {
        spaceId: target.spaceId,
        folderId: target.folderId,
        beforeTabId: target.beforeTabId
      }
    }
    return { spaceId: target.spaceId, folderId: null, beforeTabId: null }
  }

  function startDragMode(drag: PendingDrag): void {
    drag.started = true
    dragTabId = drag.tab.id
    document.documentElement.style.cursor = 'grabbing'
    document.body.style.cursor = 'grabbing'
  }

  function cleanupDrag(): void {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerUp)
    window.removeEventListener('keydown', handleKeyDown)
    pendingDrag = null
    dragTabId = null
    dropTarget = null
    document.documentElement.style.cursor = ''
    document.body.style.cursor = ''
  }

  function suppressNextClick(): void {
    const stop = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      document.removeEventListener('click', stop, true)
    }
    document.addEventListener('click', stop, true)
    if (suppressTimer !== null) window.clearTimeout(suppressTimer)
    suppressTimer = window.setTimeout(() => {
      document.removeEventListener('click', stop, true)
      suppressTimer = null
    }, 0)
  }

  function handleTabPointerDown(event: PointerEvent, tab: Tab): void {
    if (event.button !== 0 || tab.pinned || pendingDrag) return
    const target = event.target
    if (target instanceof Element && target.closest('.row-actions')) return

    pendingDrag = {
      tab,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      cancelled: false
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('keydown', handleKeyDown)
  }

  function autoScroll(y: number): void {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="tab-list"] [role="list"]'
    )
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    if (y < rect.top + 32) viewport.scrollTop -= 18
    else if (y > rect.bottom - 32) viewport.scrollTop += 18
  }

  function handlePointerMove(event: PointerEvent): void {
    const drag = pendingDrag
    if (!drag) return

    if (!drag.started) {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (dx * dx + dy * dy <= 25) return
      startDragMode(drag)
    }

    event.preventDefault()
    autoScroll(event.clientY)
    dropTarget = resolveDropTarget(event.clientX, event.clientY, drag.tab.id)
  }

  function handlePointerUp(event: PointerEvent): void {
    const drag = pendingDrag
    if (!drag) return

    const wasDragging = drag.started
    const cancelled = drag.cancelled || event.type === 'pointercancel'
    const tabId = drag.tab.id
    const target =
      wasDragging && !cancelled
        ? resolveDropTarget(event.clientX, event.clientY, tabId)
        : null

    cleanupDrag()
    if (wasDragging) suppressNextClick()
    if (target) onmovetab(tabId, targetInput(target))
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !pendingDrag) return
    const wasDragging = pendingDrag.started
    pendingDrag.cancelled = true
    cleanupDrag()
    if (wasDragging) suppressNextClick()
  }

  onDestroy(() => {
    cleanupDrag()
    if (suppressTimer !== null) window.clearTimeout(suppressTimer)
  })
</script>

<section class="tabs" aria-label="Tabs">
  <div class="tabs-toolbar">
    <div class="tabs-heading">
      <h2 class="space-title" title={spaceName}>{spaceName}</h2>
      <span class="section-count">{allTabs.length}</span>
    </div>
    <div class="toolbar-actions">
      <span class="new-tab" data-testid="new-tab">
        <IconButton
          label="New tab"
          title="New tab"
          size="sm"
          variant="soft"
          onclick={() => oncreatetab(null)}
        >
          <Icon name="plus" size={13} />
        </IconButton>
      </span>
      <span class="new-folder" data-testid="new-folder">
        <IconButton
          label={folderFormOpen && folderFormParentId === null ? 'Cancel new folder' : 'New folder'}
          title="New folder"
          size="sm"
          variant="soft"
          onclick={toggleRootFolderForm}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M1.75 4.5A1.75 1.75 0 0 1 3.5 2.75h2.2c.4 0 .78.16 1.06.44l.9.9h4.84a1.75 1.75 0 0 1 1.75 1.75v5.66a1.75 1.75 0 0 1-1.75 1.75H3.5a1.75 1.75 0 0 1-1.75-1.75V4.5Z"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <path d="M8 7.5v4M6 9.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </IconButton>
      </span>
    </div>
  </div>

  <div
    class="tab-list"
    class:root-drop={dropTarget?.kind === 'root'}
    data-testid="tab-list"
    data-drop-root="true"
    data-space-id={snapshot.activeSpaceId}
  >
    {#if folderFormOpen}
      <form class="folder-form" data-testid="folder-create-form" onsubmit={submitFolder}>
        <input
          class="folder-input"
          bind:this={folderInput}
          bind:value={folderFormName}
          type="text"
          placeholder={folderFormParentId === null ? 'Folder name' : 'Subfolder name'}
          aria-label="Folder name"
          maxlength="64"
          autocomplete="off"
          required
        />
        <button class="primary-button folder-submit" type="submit" disabled={folderSubmitting}>
          Create
        </button>
        <button class="folder-cancel" type="button" onclick={closeFolderForm}>Cancel</button>
      </form>
    {/if}

    {#if allTabs.length === 0 && spaceFolders.length === 0 && !folderFormOpen}
      <div class="center-state empty-state">
        <p class="state-detail">No tabs in this space</p>
        <button
          class="primary-button"
          type="button"
          aria-label="New tab"
          data-testid="new-tab-empty"
          onclick={() => oncreatetab(null)}
        >
          New Tab
        </button>
      </div>
    {:else}
      {#if allTabs.length > 0 && visibleTabs.length === 0 && spaceFolders.length === 0}
        <p class="empty-hint">Only pinned tabs</p>
      {/if}
      {#if rows.length > 0}
        <div class="tab-tree">
          <VirtualList
            bind:this={treeList}
            items={rows}
            itemHeight={38}
            ariaLabel="Tabs and folders"
            getKey={(row: TreeRow) => row.key}
          >
            {#snippet children(row: TreeRow)}
              {#if row.kind === 'folder'}
                <FolderRow
                  folder={row.folder}
                  depth={row.depth}
                  tabCount={folderTabCounts.get(row.folder.id) ?? 0}
                  dropInside={dropTarget?.kind === 'folder' && dropTarget.folderId === row.folder.id}
                  ontoggle={handleToggleFolder}
                  onnewtab={(folderId) => oncreatetab(folderId)}
                  onnewfolder={(folderId) => openFolderForm(folderId)}
                  onrename={handleRenameFolder}
                  onremove={(folderId) => onremovefolder(folderId)}
                />
              {:else}
                <TabRow
                  tab={row.tab}
                  depth={row.depth}
                  active={row.tab.id === activeTabId}
                  testid="tab-row"
                  dnd
                  dragging={dragTabId === row.tab.id}
                  dropPosition={dropForTab(row.tab.id)}
                  onpointerdown={(event) => handleTabPointerDown(event, row.tab)}
                  onactivate={onactivate}
                  onclose={onclose}
                  onpin={onpin}
                />
              {/if}
            {/snippet}
          </VirtualList>
        </div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .toolbar-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 2px;
  }

  .new-folder {
    display: inline-flex;
    flex: 0 0 auto;
  }

  .tab-tree {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  .folder-form {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    padding: 4px 2px 6px;
  }

  .folder-input {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-sm, 8px);
    background: var(--bg-elevated, #1a1c21);
    color: var(--text, #e8eaed);
    font-size: 12px;
    user-select: text;
  }

  .folder-input:focus {
    border-color: var(--accent-border, rgba(138, 180, 248, 0.35));
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: -1px;
  }

  .folder-submit {
    flex: 0 0 auto;
    margin-top: 0;
    padding: 4px 10px;
    font-size: 11.5px;
  }

  .folder-submit:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .folder-cancel {
    flex: 0 0 auto;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted, #9aa1ab);
    font-size: 11.5px;
    cursor: pointer;
  }

  .folder-cancel:hover {
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
  }

  .folder-cancel:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: 1px;
  }
</style>
