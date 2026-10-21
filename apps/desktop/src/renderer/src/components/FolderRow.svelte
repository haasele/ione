<script lang="ts">
  import { IconButton } from '@ione/ui-kit'
  import type { FeedState, Folder } from '@ione/core'
  import Icon from './Icon.svelte'

  interface Props {
    folder: Folder
    depth: number
    tabCount: number
    dropInside?: boolean
    feedState?: FeedState
    onrefresh?: (folderId: string) => void
    ontoggle: (folderId: string) => void
    onnewtab: (folderId: string) => void
    onnewfolder: (folderId: string) => void
    onrename: (folderId: string, name: string) => void
    onremove: (folderId: string) => void
  }

  let {
    folder,
    depth,
    tabCount,
    dropInside = false,
    feedState,
    onrefresh,
    ontoggle,
    onnewtab,
    onnewfolder,
    onrename,
    onremove
  }: Props = $props()

  const label = $derived(folder.name.trim() || 'Folder')
  const rss = $derived(folder.kind === 'rss')

  function handleRename(): void {
    const next = window.prompt('Rename folder', folder.name)
    if (next === null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === folder.name) return
    onrename(folder.id, trimmed)
  }

  function handleRemove(): void {
    if (!window.confirm(`Remove “${label}”? Its tabs will move up one level.`)) return
    onremove(folder.id)
  }
</script>

<div
  class="folder-row"
  class:drop-inside={dropInside}
  data-testid="folder-row"
  data-folder-id={folder.id}
  data-space-id={folder.spaceId}
  style:padding-left={`${depth * 14}px`}
>
  <button
    class="folder-toggle"
    data-testid="folder-toggle"
    type="button"
    aria-label={`${folder.collapsed ? 'Expand' : 'Collapse'} ${label}`}
    aria-expanded={!folder.collapsed}
    title={folder.collapsed ? 'Expand folder' : 'Collapse folder'}
    onclick={() => ontoggle(folder.id)}
  >
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {#if folder.collapsed}
        <path
          d="M6 3.5 10.5 8 6 12.5"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      {:else}
        <path
          d="M3.5 6 8 10.5 12.5 6"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      {/if}
    </svg>
  </button>

  <span class="folder-icon" aria-hidden="true">
    {#if rss}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="3.2" cy="12.8" r="1.2" fill="currentColor" />
        <path
          d="M2.5 8.2a5.3 5.3 0 0 1 5.3 5.3M2.5 4.2a9.3 9.3 0 0 1 9.3 9.3"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
      </svg>
    {:else}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M1.75 4.5A1.75 1.75 0 0 1 3.5 2.75h2.2c.4 0 .78.16 1.06.44l.9.9h4.84a1.75 1.75 0 0 1 1.75 1.75v5.66a1.75 1.75 0 0 1-1.75 1.75H3.5a1.75 1.75 0 0 1-1.75-1.75V4.5Z"
          fill="currentColor"
          opacity="0.7"
        />
      </svg>
    {/if}
  </span>

  <button
    class="folder-name"
    data-testid="folder-name"
    type="button"
    title={label}
    aria-label={`Toggle ${label}`}
    onclick={() => ontoggle(folder.id)}
  >
    {label}
  </button>

  <span class="folder-count">{tabCount}</span>
  {#if feedState?.lastError}
    <span class="feed-error" title={feedState.lastError} aria-label="Feed error">!</span>
  {/if}

  <span class="row-actions">
    {#if rss && onrefresh}
      <span data-testid="folder-refresh">
        <IconButton
          label={`Refresh ${label}`}
          title={feedState?.lastCheckedAt ? 'Refresh feed' : 'Load feed'}
          size="sm"
          onclick={() => onrefresh?.(folder.id)}
        >
          <Icon name="reset" size={12} />
        </IconButton>
      </span>
    {/if}
    <IconButton
      label={`New tab in ${label}`}
      title="New tab in folder"
      size="sm"
      onclick={() => onnewtab(folder.id)}
    >
      <Icon name="plus" size={12} />
    </IconButton>
    <IconButton
      label={`New subfolder in ${label}`}
      title="New subfolder"
      size="sm"
      onclick={() => onnewfolder(folder.id)}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M1.75 4.5A1.75 1.75 0 0 1 3.5 2.75h2.2c.4 0 .78.16 1.06.44l.9.9h4.84a1.75 1.75 0 0 1 1.75 1.75v5.66a1.75 1.75 0 0 1-1.75 1.75H3.5a1.75 1.75 0 0 1-1.75-1.75V4.5Z"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <path d="M8 7.5v4M6 9.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </IconButton>
    <IconButton label={`Rename ${label}`} title="Rename folder" size="sm" onclick={handleRename}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 13l.55-2.55L10.7 3.3a1.4 1.4 0 0 1 2 0l.05.05a1.4 1.4 0 0 1 0 2L5.6 12.5 3 13Z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
        <path d="m9.7 4.3 2 2" stroke="currentColor" stroke-width="1.3" />
      </svg>
    </IconButton>
    <IconButton
      label={`Remove ${label}`}
      title="Remove folder"
      size="sm"
      variant="danger"
      onclick={handleRemove}
    >
      <Icon name="trash" size={12} />
    </IconButton>
  </span>
</div>

<style>
  .folder-row {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding-right: 3px;
    border-radius: var(--radius-md, 10px);
    color: var(--text-muted, #9aa1ab);
  }

  .folder-row:hover,
  .folder-row:focus-within {
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
  }

  .folder-row.drop-inside {
    background: var(--accent-soft, rgba(138, 180, 248, 0.16));
    box-shadow: inset 0 0 0 1px var(--accent-border, rgba(138, 180, 248, 0.35));
    color: var(--text, #e8eaed);
  }

  .folder-toggle {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .folder-toggle:hover {
    background: var(--bg-active, #2c313a);
    color: var(--text, #e8eaed);
  }

  .folder-toggle:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: 1px;
  }

  .folder-icon {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    margin-right: 2px;
  }

  .folder-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 4px 2px;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 12.5px;
    font-weight: 600;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .folder-name:focus-visible {
    border-radius: 5px;
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: -2px;
  }

  .folder-count {
    flex: 0 0 auto;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--bg-elevated, #1a1c21);
    color: var(--text-faint, #6b7280);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    text-align: center;
  }

  .feed-error {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--danger-soft, rgba(242, 139, 130, 0.12));
    color: var(--danger, #f28b82);
    font-size: 10px;
    font-weight: 700;
  }

  .row-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 1px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .folder-row:hover .row-actions,
  .folder-row:focus-within .row-actions {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .row-actions {
      transition-duration: 0.01ms !important;
    }
  }
</style>
