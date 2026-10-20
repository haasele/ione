<script lang="ts">
  import { IconButton } from '@ione/ui-kit'
  import type { Essential } from '@ione/core'
  import type { CreateEssentialInput } from '../../../shared/ipc'
  import Favicon from './Favicon.svelte'
  import Icon from './Icon.svelte'

  interface Props {
    essentials: readonly Essential[]
    onopen: (url: string) => void
    onadd: (input: CreateEssentialInput) => Promise<boolean>
    onremove: (essentialId: string) => void
  }

  let { essentials, onopen, onadd, onremove }: Props = $props()

  let formOpen = $state(false)
  let url = $state('')
  let title = $state('')
  let submitting = $state(false)

  let urlInput = $state<HTMLInputElement | null>(null)

  function labelFor(essential: Essential): string {
    const titleText = essential.title.trim()
    if (titleText) return titleText
    const urlText = essential.url.trim()
    return urlText || 'Essential'
  }

  function openForm(): void {
    formOpen = true
    url = ''
    title = ''
    queueMicrotask(() => urlInput?.focus())
  }

  function closeForm(): void {
    formOpen = false
    url = ''
    title = ''
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (submitting) return

    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      urlInput?.focus()
      return
    }

    submitting = true
    try {
      const input: CreateEssentialInput = { url: trimmedUrl }
      const trimmedTitle = title.trim()
      if (trimmedTitle) input.title = trimmedTitle

      if (await onadd(input)) closeForm()
    } finally {
      submitting = false
    }
  }
</script>

<section class="essentials" aria-label="Essentials" data-testid="essentials">
  <div class="section-head">
    <h2 class="section-title">Essentials</h2>
    <span class="add-essential" data-testid="add-essential">
      <IconButton
        label={formOpen ? 'Cancel new essential' : 'Add essential'}
        title="Add essential"
        size="sm"
        onclick={() => {
          if (formOpen) closeForm()
          else openForm()
        }}
      >
        <Icon name="plus" size={12} />
      </IconButton>
    </span>
  </div>

  {#if formOpen}
    <form class="essential-form" data-testid="essential-create-form" onsubmit={handleSubmit}>
      <input
        class="text-input"
        bind:this={urlInput}
        bind:value={url}
        type="text"
        aria-label="Essential URL"
        placeholder="https://example.com"
        autocomplete="off"
        spellcheck="false"
        required
      />
      <input
        class="text-input"
        bind:value={title}
        type="text"
        aria-label="Essential title"
        placeholder="Title (optional)"
        autocomplete="off"
      />
      <div class="form-actions">
        <button class="cancel-button" type="button" onclick={closeForm}>Cancel</button>
        <button class="add-button" type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  {:else if essentials.length === 0}
    <p class="empty-hint">No essentials yet</p>
  {:else}
    <div class="essential-scroll">
      <div class="essential-grid">
        {#each essentials as essential (essential.id)}
          {@const label = labelFor(essential)}
          <div class="essential-tile" data-testid="essential-tile">
            <button
              class="tile-button"
              type="button"
              title={label}
              aria-label={`Open ${label}`}
              onclick={() => onopen(essential.url)}
            >
              <Favicon src={essential.favicon} fallback={label} size={20} />
              <span class="essential-title">{label}</span>
            </button>
            <span class="tile-remove">
              <IconButton
                label={`Remove ${label}`}
                title={`Remove ${label}`}
                size="sm"
                variant="danger"
                onclick={() => onremove(essential.id)}
              >
                <Icon name="close" size={12} />
              </IconButton>
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .essentials {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 6px;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 2px;
  }

  .section-title {
    margin: 0;
    color: var(--text-faint, #6b7280);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .add-essential {
    display: inline-flex;
    flex: 0 0 auto;
  }

  .essential-scroll {
    max-height: 164px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-color: var(--bg-active, #2c313a) transparent;
    scrollbar-width: thin;
  }

  .essential-scroll::-webkit-scrollbar {
    width: 8px;
  }

  .essential-scroll::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: var(--bg-active, #2c313a);
    background-clip: padding-box;
  }

  .essential-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
    gap: 6px;
    padding: 2px;
  }

  .essential-tile {
    position: relative;
    min-width: 0;
  }

  .tile-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 10px 6px;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-md, 10px);
    background: var(--bg-elevated, #1a1c21);
    color: var(--text-muted, #9aa1ab);
    cursor: pointer;
    transition:
      background-color 120ms ease,
      transform 120ms ease;
  }

  .tile-button:hover {
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
  }

  .tile-button:active {
    transform: scale(0.97);
  }

  .tile-button:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: 1px;
  }

  .essential-title {
    display: -webkit-box;
    width: 100%;
    overflow: hidden;
    font-size: 11px;
    line-height: 1.25;
    text-align: center;
    overflow-wrap: anywhere;
    user-select: text;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .tile-remove {
    position: absolute;
    top: 3px;
    right: 3px;
    display: flex;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .essential-tile:hover .tile-remove,
  .essential-tile:focus-within .tile-remove {
    opacity: 1;
  }

  .empty-hint {
    margin: 0;
    padding: 2px 4px;
    color: var(--text-faint, #6b7280);
    font-size: 11px;
  }

  .essential-form {
    display: grid;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-md, 10px);
    background: var(--bg-elevated, #1a1c21);
  }

  .text-input {
    width: 100%;
    min-width: 0;
    padding: 5px 7px;
    border: 1px solid var(--border, #262a31);
    border-radius: 6px;
    background: var(--bg, #121316);
    color: var(--text, #e8eaed);
    user-select: text;
  }

  .text-input::placeholder {
    color: var(--text-faint, #6b7280);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .cancel-button,
  .add-button {
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      transform 120ms ease,
      opacity 120ms ease;
  }

  .cancel-button {
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted, #9aa1ab);
  }

  .cancel-button:hover {
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
  }

  .add-button {
    border: 1px solid var(--accent-border, rgba(138, 180, 248, 0.35));
    background: var(--accent-soft, rgba(138, 180, 248, 0.16));
    color: var(--text, #e8eaed);
  }

  .add-button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .add-button:active:not(:disabled) {
    transform: scale(0.97);
  }
</style>
