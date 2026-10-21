<script lang="ts">
  import { onMount } from 'svelte'
  import type { PaletteCommand } from '../lib/palette'

  interface Props {
    commands: readonly PaletteCommand[]
    onclose: () => void
  }

  let { commands, onclose }: Props = $props()

  let query = $state('')
  let selected = $state(0)
  let input = $state<HTMLInputElement | null>(null)

  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands.slice(0, 14)
    const tokens = needle.split(/\s+/)
    return commands
      .filter((command) => {
        const haystack = `${command.label} ${command.detail ?? ''} ${command.keywords ?? ''}`.toLowerCase()
        return tokens.every((token) => haystack.includes(token))
      })
      .slice(0, 20)
  })

  onMount(() => {
    queueMicrotask(() => input?.focus())
  })

  function move(delta: number): void {
    if (filtered.length === 0) return
    selected = (selected + delta + filtered.length) % filtered.length
  }

  function execute(command: PaletteCommand | undefined): void {
    if (!command) return
    onclose()
    command.run()
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onclose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      execute(filtered[selected])
    }
  }
</script>

<dialog
  open
  class="palette-backdrop"
  aria-label="Command palette"
  data-testid="command-palette"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose()
  }}
>
  <div class="palette">
    <input
      bind:this={input}
      bind:value={query}
      class="palette-input"
      type="text"
      aria-label="Command"
      placeholder="Type a command…"
      autocomplete="off"
      spellcheck="false"
      data-testid="command-input"
      onkeydown={keydown}
      oninput={() => (selected = 0)}
    />
    <div class="palette-list" role="listbox" aria-label="Commands">
      {#if filtered.length === 0}
        <p class="empty">No matching commands</p>
      {:else}
        {#each filtered as command, index (command.id)}
          <button
            class="palette-item"
            class:selected={index === selected}
            type="button"
            role="option"
            aria-selected={index === selected}
            data-testid="command-item"
            onclick={() => execute(command)}
            onmouseenter={() => (selected = index)}
          >
            <span class="command-label">{command.label}</span>
            {#if command.detail}<span class="command-detail">{command.detail}</span>{/if}
          </button>
        {/each}
      {/if}
    </div>
    <div class="palette-hint">↑↓ navigate · Enter run · Esc close</div>
  </div>
</dialog>

<style>
  .palette-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: 54px 10px 10px;
    border: 0;
    background: rgba(5, 6, 8, 0.58);
    backdrop-filter: blur(2px);
  }

  .palette {
    display: flex;
    flex-direction: column;
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-lg, 16px);
    background: var(--bg-elevated, #1a1c21);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
  }

  .palette-input {
    width: 100%;
    padding: 12px 13px;
    border: 0;
    border-bottom: 1px solid var(--border, #262a31);
    background: transparent;
    color: var(--text, #e8eaed);
    font-size: 13px;
    outline: 0;
    user-select: text;
  }

  .palette-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 340px;
    padding: 4px;
    overflow-y: auto;
  }

  .palette-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted, #9aa1ab);
    text-align: left;
    cursor: pointer;
  }

  .palette-item.selected {
    background: var(--accent-soft, rgba(138, 180, 248, 0.16));
    color: var(--text, #e8eaed);
  }

  .palette-item:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: -2px;
  }

  .command-label {
    font-size: 12px;
  }

  .command-detail {
    color: var(--text-faint, #6b7280);
    font-size: 10px;
  }

  .empty {
    margin: 0;
    padding: 14px;
    color: var(--text-faint, #6b7280);
    font-size: 11px;
    text-align: center;
  }

  .palette-hint {
    padding: 7px 11px;
    border-top: 1px solid var(--border, #262a31);
    color: var(--text-faint, #6b7280);
    font-size: 10px;
  }
</style>
