<script lang="ts">
  import type { Tab } from '@ione/core'
  import Icon from './Icon.svelte'

  interface Props {
    activeTab: Tab | null
    onclear: () => void
    onerror: (error: unknown) => void
    onblocked: () => void
  }

  let { activeTab, onclear, onerror, onblocked }: Props = $props()

  let draft = $state('')
  let focused = $state(false)
  let committedUrl = $state<string | null>(null)
  let addressInput = $state<HTMLInputElement | null>(null)

  $effect(() => {
    const tabUrl = activeTab ? activeTab.url : ''
    if (committedUrl !== null && tabUrl === committedUrl) {
      committedUrl = null
      return
    }
    if (!focused) {
      draft = committedUrl ?? tabUrl
    }
  })

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault()
    void navigateDraft()
  }

  async function navigateDraft(): Promise<void> {
    const input = draft.trim()
    if (!input) return

    onclear()
    try {
      const result = await window.ione.navigate(input)
      if (!result) {
        onblocked()
      } else {
        committedUrl = result.url
        draft = result.url
      }
    } catch (error) {
      onerror(error)
    } finally {
      addressInput?.blur()
    }
  }
</script>

<form class="url-form" onsubmit={handleSubmit}>
  <input
    class="address-input"
    data-testid="address-input"
    bind:this={addressInput}
    bind:value={draft}
    type="text"
    aria-label="Address"
    placeholder="Search or enter address"
    autocomplete="off"
    spellcheck="false"
    onfocus={() => {
      focused = true
    }}
    onblur={() => {
      focused = false
    }}
  />
  <button class="go-button" type="submit" aria-label="Navigate" title="Navigate">
    <Icon name="arrow" size={14} />
  </button>
</form>

<style>
  .url-form {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 12px;
    border: 1px solid var(--border, #262a31);
    border-radius: 999px;
    background: var(--bg-elevated, #1a1c21);
    box-shadow: var(--shadow, none);
  }

  .url-form:focus-within {
    border-color: var(--accent-border, rgba(138, 180, 248, 0.35));
    box-shadow: 0 0 0 3px var(--accent-soft, rgba(138, 180, 248, 0.16));
  }

  .address-input {
    flex: 1;
    min-width: 0;
    padding: 6px 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text, #e8eaed);
    caret-color: var(--accent, #8ab4f8);
    user-select: text;
  }

  .address-input::placeholder {
    color: var(--text-faint, #6b7280);
  }

  .go-button {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 50%;
    background: var(--bg-hover, #23262d);
    color: var(--text-muted, #9aa1ab);
    cursor: pointer;
    transition:
      background-color 120ms ease,
      transform 120ms ease;
  }

  .go-button:hover {
    background: var(--bg-active, #2c313a);
    color: var(--text, #e8eaed);
  }

  .go-button:active {
    transform: scale(0.94);
  }

  .go-button:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: 1px;
  }
</style>
