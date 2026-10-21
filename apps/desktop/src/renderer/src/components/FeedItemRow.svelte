<script lang="ts">
  import type { FeedItem } from '@ione/core'

  interface Props {
    item: FeedItem
    depth: number
    onopen: (item: FeedItem) => void
  }

  let { item, depth, onopen }: Props = $props()

  const label = $derived(item.title.trim() || item.url)

  function relativeDate(timestamp: number | null): string {
    if (timestamp === null) return ''
    const delta = Date.now() - timestamp
    if (delta < 60_000) return 'now'
    if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`
    if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d`
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric'
      }).format(timestamp)
    } catch {
      return ''
    }
  }

  const stamp = $derived(relativeDate(item.publishedAt))
</script>

<div
  class="feed-row"
  class:unread={!item.read}
  data-testid="feed-item"
  data-feed-item-id={item.id}
  style:padding-left={`${depth * 14}px`}
>
  <button
    class="feed-main"
    type="button"
    title={`${label}${item.author ? ` — ${item.author}` : ''}`}
    aria-label={`Open feed item ${label}`}
    onclick={() => onopen(item)}
  >
    <span class="unread-dot" aria-hidden="true"></span>
    <span class="feed-copy">
      <span class="feed-title">{label}</span>
      <span class="feed-meta">
        {#if item.author}{item.author}{/if}
        {#if item.author && stamp}<span aria-hidden="true"> · </span>{/if}
        {#if stamp}<span class="feed-date">{stamp}</span>{/if}
      </span>
    </span>
  </button>
</div>

<style>
  .feed-row {
    display: flex;
    align-items: center;
    height: 38px;
    border-radius: var(--radius-md, 10px);
  }

  .feed-main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 7px;
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

  .feed-row:hover .feed-main,
  .feed-row:focus-within .feed-main {
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
  }

  .feed-main:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: -2px;
  }

  .unread-dot {
    flex: 0 0 auto;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: transparent;
  }

  .feed-row.unread .unread-dot {
    background: var(--accent, #8ab4f8);
    box-shadow: 0 0 6px var(--accent-soft, rgba(138, 180, 248, 0.16));
  }

  .feed-copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }

  .feed-title {
    overflow: hidden;
    font-size: 12px;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-row.unread .feed-title {
    color: var(--text, #e8eaed);
    font-weight: 550;
  }

  .feed-meta {
    overflow: hidden;
    color: var(--text-faint, #6b7280);
    font-size: 10px;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feed-date {
    font-variant-numeric: tabular-nums;
  }
</style>
