<script lang="ts">
  import { onMount } from 'svelte'
  import { IconButton } from '@ione/ui-kit'
  import Icon from './Icon.svelte'

  interface Props {
    onclose: () => void
  }

  let { onclose }: Props = $props()

  let query = $state('')
  let matches = $state(0)
  let activeMatch = $state(0)
  let error = $state<string | null>(null)
  let input = $state<HTMLInputElement | null>(null)

  onMount(() => {
    queueMicrotask(() => input?.focus())
  })

  async function search(forward = true): Promise<void> {
    const value = query.trim()
    if (!value) {
      await window.ione.stopFindInPage()
      matches = 0
      activeMatch = 0
      return
    }
    try {
      const result = await window.ione.findInPage(value, forward)
      matches = result?.matches ?? 0
      activeMatch = result?.activeMatch ?? 0
      error = null
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function close(): Promise<void> {
    await window.ione.stopFindInPage().catch(() => undefined)
    onclose()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      void close()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void search(!event.shiftKey)
    }
  }
</script>

<div class="find-bar" data-testid="find-bar" role="search">
  <Icon name="find" size={13} />
  <input
    bind:this={input}
    bind:value={query}
    class="find-input"
    type="text"
    aria-label="Find in page"
    placeholder="Find in page"
    autocomplete="off"
    spellcheck="false"
    data-testid="find-input"
    onkeydown={handleKeydown}
  />
  <span class="find-count" data-testid="find-count">
    {#if query.trim().length > 0}{matches === 0 ? '0/0' : `${activeMatch}/${matches}`}{/if}
  </span>
  <span data-testid="find-prev">
    <IconButton label="Previous match" title="Previous" size="sm" onclick={() => void search(false)}>
      <Icon name="back" size={12} />
    </IconButton>
  </span>
  <span data-testid="find-next">
    <IconButton label="Next match" title="Next" size="sm" onclick={() => void search(true)}>
      <Icon name="forward" size={12} />
    </IconButton>
  </span>
  <span data-testid="find-close">
    <IconButton label="Close find bar" title="Close" size="sm" onclick={() => void close()}>
      <Icon name="close" size={12} />
    </IconButton>
  </span>
</div>

{#if error}
  <p class="find-error" role="alert">{error}</p>
{/if}

<style>
  .find-bar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 4px 9px;
    border: 1px solid var(--border, #262a31);
    border-radius: 999px;
    background: var(--bg-elevated, #1a1c21);
    color: var(--text-muted, #9aa1ab);
  }

  .find-input {
    flex: 1;
    min-width: 0;
    padding: 3px 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text, #e8eaed);
    font-size: 12px;
    user-select: text;
  }

  .find-count {
    flex: 0 0 auto;
    min-width: 30px;
    color: var(--text-faint, #6b7280);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .find-error {
    flex: 0 0 auto;
    margin: 0;
    padding: 0 4px;
    color: var(--danger, #f28b82);
    font-size: 11px;
  }
</style>
