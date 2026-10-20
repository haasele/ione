<script lang="ts">
  import { IconButton } from '@ione/ui-kit'
  import type { Space } from '@ione/core'
  import type { CreateSpaceInput } from '../../../shared/ipc'
  import Icon from './Icon.svelte'

  interface Props {
    spaces: readonly Space[]
    activeSpaceId: string
    onactivate: (spaceId: string) => void
    oncreate: (input: CreateSpaceInput) => Promise<boolean>
    onremove: (spaceId: string) => Promise<boolean>
  }

  let { spaces, activeSpaceId, onactivate, oncreate, onremove }: Props = $props()

  const THEMES = ['default', 'ocean', 'forest', 'rose', 'amber'] as const

  let formOpen = $state(false)
  let name = $state('')
  let icon = $state('')
  let theme = $state<string>('default')
  let isolated = $state(false)
  let submitting = $state(false)

  let nameInput = $state<HTMLInputElement | null>(null)

  function spaceGlyph(space: Space): string {
    const value = space.icon.trim()
    if (value && Array.from(value).length <= 2) return value
    const label = space.name.trim()
    return label ? label.charAt(0).toUpperCase() : '•'
  }

  function makePartitionId(rawName: string): string {
    const slug =
      rawName
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24) || 'space'

    const bytes = new Uint8Array(4)
    crypto.getRandomValues(bytes)
    const suffix = Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 6)

    return `${slug}-${suffix}`.slice(0, 64)
  }

  function openForm(): void {
    formOpen = true
    name = ''
    icon = ''
    theme = 'default'
    isolated = false
    queueMicrotask(() => nameInput?.focus())
  }

  function closeForm(): void {
    formOpen = false
    name = ''
    icon = ''
    theme = 'default'
    isolated = false
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (submitting) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      nameInput?.focus()
      return
    }

    submitting = true
    try {
      const input: CreateSpaceInput = {
        name: trimmedName,
        icon: icon.trim() || '◆',
        theme
      }
      if (isolated) input.partitionId = makePartitionId(trimmedName)

      if (await oncreate(input)) closeForm()
    } finally {
      submitting = false
    }
  }

  async function handleRemove(space: Space): Promise<void> {
    if (spaces.length <= 1) return
    if (!window.confirm(`Remove “${space.name}”? Its tabs will be closed.`)) return
    await onremove(space.id)
  }
</script>

<nav class="space-switcher" aria-label="Spaces" data-testid="space-switcher">
  <div class="space-chips">
    {#each spaces as space (space.id)}
      <div class="space-item" class:active={space.id === activeSpaceId}>
        <button
          class="space-chip"
          type="button"
          data-testid="space-chip"
          aria-label={`Switch to ${space.name}`}
          aria-current={space.id === activeSpaceId ? 'true' : undefined}
          title={space.name}
          onclick={() => onactivate(space.id)}
        >
          <span class="space-icon" aria-hidden="true">{spaceGlyph(space)}</span>
          <span class="space-name">{space.name}</span>
        </button>
        {#if space.id === activeSpaceId && spaces.length > 1}
          <span class="space-remove">
            <IconButton
              label={`Remove ${space.name}`}
              title={`Remove ${space.name}`}
              size="sm"
              variant="danger"
              onclick={() => void handleRemove(space)}
            >
              <Icon name="close" size={12} />
            </IconButton>
          </span>
        {/if}
      </div>
    {/each}

    <span class="add-space" data-testid="add-space">
      <IconButton
        label={formOpen ? 'Cancel new space' : 'New space'}
        title="New space"
        size="sm"
        variant="soft"
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
    <form class="space-form" data-testid="space-create-form" onsubmit={handleSubmit}>
      <label class="field">
        <span class="field-label">Name</span>
        <input
          class="text-input"
          bind:this={nameInput}
          bind:value={name}
          type="text"
          placeholder="Work"
          aria-label="Space name"
          maxlength="48"
          autocomplete="off"
          required
        />
      </label>

      <label class="field">
        <span class="field-label">Icon</span>
        <input
          class="text-input"
          bind:value={icon}
          type="text"
          placeholder="🌐"
          aria-label="Space icon"
          maxlength="2"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <label class="field full">
        <span class="field-label">Theme</span>
        <select class="text-input select-input" bind:value={theme} aria-label="Space theme">
          {#each THEMES as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </label>

      <label class="checkbox full">
        <input type="checkbox" bind:checked={isolated} />
        <span>Separate logins</span>
      </label>

      <div class="form-actions full">
        <button class="cancel-button" type="button" onclick={closeForm}>Cancel</button>
        <button class="create-button" type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create space'}
        </button>
      </div>
    </form>
  {/if}
</nav>

<style>
  .space-switcher {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .space-chips {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }

  .space-chips::-webkit-scrollbar {
    display: none;
  }

  .space-item {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    padding: 1px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm, 8px);
    transition: background-color 120ms ease;
  }

  .space-item.active {
    border-color: var(--accent-border, rgba(138, 180, 248, 0.35));
    background: var(--accent-soft, rgba(138, 180, 248, 0.16));
  }

  .space-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 132px;
    padding: 5px 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted, #9aa1ab);
    white-space: nowrap;
    cursor: pointer;
  }

  .space-chip:hover {
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
  }

  .space-item.active .space-chip {
    color: var(--text, #e8eaed);
  }

  .space-chip:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: -2px;
  }

  .space-icon {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.07);
    font-size: 10px;
    line-height: 1;
  }

  .space-name {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
  }

  .space-remove {
    display: flex;
    align-items: center;
    margin-left: 1px;
  }

  .add-space {
    display: inline-flex;
    flex: 0 0 auto;
  }

  .space-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 58px;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-md, 10px);
    background: var(--bg-elevated, #1a1c21);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .field.full,
  .full {
    grid-column: 1 / -1;
  }

  .field-label {
    color: var(--text-faint, #6b7280);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .text-input {
    width: 100%;
    min-width: 0;
    padding: 5px 7px;
    border: 1px solid var(--border, #262a31);
    border-radius: 6px;
    background: var(--bg, #121316);
    color: var(--text, #e8eaed);
  }

  .text-input::placeholder {
    color: var(--text-faint, #6b7280);
  }

  .select-input {
    cursor: pointer;
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted, #9aa1ab);
    font-size: 12px;
    cursor: pointer;
  }

  .checkbox input {
    margin: 0;
    accent-color: var(--accent, #8ab4f8);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .cancel-button,
  .create-button {
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

  .create-button {
    border: 1px solid var(--accent-border, rgba(138, 180, 248, 0.35));
    background: var(--accent-soft, rgba(138, 180, 248, 0.16));
    color: var(--text, #e8eaed);
  }

  .create-button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .create-button:active:not(:disabled) {
    transform: scale(0.97);
  }
</style>
