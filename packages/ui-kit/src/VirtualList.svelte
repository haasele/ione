<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'

  interface Props {
    items: readonly T[]
    itemHeight: number
    ariaLabel: string
    overscan?: number
    getKey?: (item: T, index: number) => string | number
    children: Snippet<[T, number]>
  }

  let {
    items,
    itemHeight,
    ariaLabel,
    overscan = 8,
    getKey,
    children
  }: Props = $props()

  let viewport = $state<HTMLDivElement | null>(null)
  let scrollTop = $state(0)
  let viewportHeight = $state(0)

  const maxStart = $derived(Math.max(0, items.length - 1))
  const start = $derived(
    Math.min(maxStart, Math.max(0, Math.floor(scrollTop / itemHeight) - overscan))
  )
  const end = $derived(
    Math.min(
      items.length,
      Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
    )
  )
  const visible = $derived(items.slice(start, end))

  function handleScroll(event: Event): void {
    const target = event.currentTarget
    if (target instanceof HTMLDivElement) scrollTop = target.scrollTop
  }

  export function scrollToIndex(index: number): void {
    if (!viewport || index < 0 || index >= items.length) return
    const top = index * itemHeight
    const bottom = top + itemHeight
    if (top < viewport.scrollTop) viewport.scrollTop = top
    else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = bottom - viewport.clientHeight
    }
  }
</script>

<div
  class="viewport"
  bind:this={viewport}
  bind:clientHeight={viewportHeight}
  role="list"
  aria-label={ariaLabel}
  onscroll={handleScroll}
>
  <div class="spacer" style:height={`${items.length * itemHeight}px`}>
    <div class="window" style:transform={`translateY(${start * itemHeight}px)`}>
      {#each visible as item, index (getKey ? getKey(item, start + index) : start + index)}
        <div
          class="row"
          role="listitem"
          aria-posinset={start + index + 1}
          aria-setsize={items.length}
          style:height={`${itemHeight}px`}
        >
          {@render children(item, start + index)}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .viewport {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.16) transparent;
  }

  .viewport::-webkit-scrollbar {
    width: 8px;
  }

  .viewport::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
  }

  .spacer {
    position: relative;
    width: 100%;
  }

  .window {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
  }

  .row {
    display: block;
    overflow: hidden;
  }
</style>
