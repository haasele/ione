<script lang="ts">
  import { IconButton } from '@ione/ui-kit'
  import type { Tab } from '@ione/core'
  import Favicon from './Favicon.svelte'
  import Icon from './Icon.svelte'

  interface Props {
    tab: Tab
    active: boolean
    testid?: string
    depth?: number
    dnd?: boolean
    dragging?: boolean
    dropPosition?: 'before' | 'after' | null
    onpointerdown?: (event: PointerEvent) => void
    onactivate: (tabId: string) => void
    onclose: (tabId: string) => void
    onpin?: (tabId: string) => void
    onunpin?: (tabId: string) => void
    onreset?: (tabId: string) => void
  }

  let {
    tab,
    active,
    testid = 'tab-row',
    depth = 0,
    dnd = false,
    dragging = false,
    dropPosition = null,
    onpointerdown,
    onactivate,
    onclose,
    onpin,
    onunpin,
    onreset
  }: Props = $props()

  const label = $derived(tab.title.trim() || tab.url.trim() || 'New Tab')
</script>

<div
  class="tab-row"
  class:active
  class:pinned={tab.pinned}
  class:dragging
  class:drop-before={dropPosition === 'before'}
  class:drop-after={dropPosition === 'after'}
  data-testid={testid}
  role="group"
  aria-label={`${label} tab`}
  data-tab-id={dnd ? tab.id : undefined}
  data-space-id={dnd ? tab.spaceId : undefined}
  data-folder-id={dnd ? (tab.folderId ?? '') : undefined}
  style:padding-left={`${depth * 14}px`}
  onpointerdown={dnd ? onpointerdown : undefined}
>
  <button
    class="tab-main"
    type="button"
    aria-label={`Activate ${label}${tab.pinned ? ' (pinned)' : ''}`}
    aria-current={active ? 'true' : undefined}
    title={label}
    onclick={() => onactivate(tab.id)}
  >
    <Favicon src={tab.favicon} fallback={label} />
    <span class="tab-title">{label}</span>
    {#if tab.pinned}
      <span class="pinned-mark" aria-hidden="true">
        <Icon name="pin" size={11} />
      </span>
    {/if}
  </button>

  <span class="row-actions">
    {#if tab.pinned}
      {#if onunpin}
        <IconButton
          label={`Unpin ${label}`}
          title="Unpin tab"
          size="sm"
          onclick={() => onunpin?.(tab.id)}
        >
          <Icon name="unpin" size={12} />
        </IconButton>
      {/if}
      {#if onreset}
        <IconButton
          label={`Reset ${label} to pinned URL`}
          title="Reset to pinned URL"
          size="sm"
          onclick={() => onreset?.(tab.id)}
        >
          <Icon name="reset" size={12} />
        </IconButton>
      {/if}
    {:else if onpin}
      <IconButton label={`Pin ${label}`} title="Pin tab" size="sm" onclick={() => onpin?.(tab.id)}>
        <Icon name="pin" size={12} />
      </IconButton>
    {/if}

    <IconButton
      label={`Close ${label}`}
      title="Close tab"
      size="sm"
      variant="danger"
      onclick={() => onclose(tab.id)}
    >
      <Icon name="close" size={12} />
    </IconButton>
  </span>
</div>

<style>
  .tab-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    border-radius: var(--radius-md, 10px);
  }

  .tab-row.dragging {
    opacity: 0.55;
  }

  .tab-row.drop-before::before,
  .tab-row.drop-after::after {
    position: absolute;
    right: 6px;
    left: 6px;
    z-index: 2;
    height: 2px;
    border-radius: 999px;
    background: var(--accent, #8ab4f8);
    content: '';
    pointer-events: none;
  }

  .tab-row.drop-before::before {
    top: 0;
  }

  .tab-row.drop-after::after {
    bottom: 0;
  }

  .tab-main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 34px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md, 10px);
    background: transparent;
    color: var(--text-muted, #9aa1ab);
    text-align: left;
    cursor: pointer;
  }

  .tab-row:hover .tab-main {
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
  }

  .tab-row.active .tab-main {
    background: var(--accent-soft, rgba(138, 180, 248, 0.16));
    box-shadow: inset 2px 0 0 var(--accent, #8ab4f8);
    color: var(--text, #e8eaed);
  }

  .tab-row.pinned .tab-main {
    color: var(--text, #e8eaed);
  }

  .tab-main:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: -2px;
  }

  .tab-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pinned-mark {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    color: var(--accent, #8ab4f8);
    opacity: 0.9;
  }

  .row-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 1px;
    padding-right: 3px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .tab-row:hover .row-actions,
  .tab-row:focus-within .row-actions,
  .tab-row.active .row-actions {
    opacity: 1;
  }
</style>
