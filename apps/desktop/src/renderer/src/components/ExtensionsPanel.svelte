<script lang="ts">
  import { onMount } from 'svelte'
  import type { AdblockState, ExtensionInfo } from '../../../shared/ipc'
  import { IconButton } from '@ione/ui-kit'
  import Icon from './Icon.svelte'

  interface Props {
    onclose: () => void
    onopenurl: (url: string) => void
  }

  let { onclose, onopenurl }: Props = $props()

  let extensions = $state<ExtensionInfo[]>([])
  let adblock = $state<AdblockState>({
    enabled: false,
    ready: false,
    skippedForExtension: false,
    error: null
  })
  let loading = $state(true)
  let busy = $state(false)
  let error = $state<string | null>(null)
  let installId = $state('')

  onMount(() => {
    void refresh()
  })

  async function refresh(): Promise<void> {
    loading = true
    error = null
    try {
      const [list, state] = await Promise.all([
        window.ione.listExtensions(),
        window.ione.getAdblockState()
      ])
      extensions = list
      adblock = state
    } catch (cause) {
      error = messageFor(cause)
    } finally {
      loading = false
    }
  }

  async function toggleAdblock(): Promise<void> {
    if (busy) return
    busy = true
    error = null
    try {
      adblock = await window.ione.setAdblockEnabled(!adblock.enabled)
    } catch (cause) {
      error = messageFor(cause)
    } finally {
      busy = false
    }
  }

  async function install(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    const id = installId.trim()
    if (!id) return
    busy = true
    error = null
    try {
      await window.ione.installExtension(id)
      installId = ''
      await refresh()
    } catch (cause) {
      error = messageFor(cause)
    } finally {
      busy = false
    }
  }

  async function remove(extension: ExtensionInfo): Promise<void> {
    if (busy) return
    if (!window.confirm(`Remove ${extension.name}?`)) return
    busy = true
    error = null
    try {
      await window.ione.uninstallExtension(extension.id)
      await refresh()
    } catch (cause) {
      error = messageFor(cause)
    } finally {
      busy = false
    }
  }

  function open(extension: ExtensionInfo): void {
    const url = extension.popupUrl ?? extension.optionsUrl
    if (url) onopenurl(url)
  }

  function messageFor(cause: unknown): string {
    return cause instanceof Error && cause.message ? cause.message : String(cause)
  }

  function adblockLabel(): string {
    if (!adblock.ready) return 'Starting…'
    if (adblock.error) return `Unavailable: ${adblock.error}`
    if (adblock.skippedForExtension) return 'Disabled while uBlock Origin is loaded'
    return adblock.enabled ? 'Blocking ads and trackers' : 'Off'
  }
</script>

<dialog
  open
  class="panel-backdrop"
  aria-label="Extensions and ad blocking"
  data-testid="extensions-panel"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose()
  }}
>
  <div class="panel">
    <header class="panel-header">
      <div>
        <h2>Extensions</h2>
        <p class="subtitle">Chrome Web Store and unpacked extensions</p>
      </div>
      <IconButton label="Close extensions" title="Close" size="sm" onclick={onclose}>
        <Icon name="close" size={12} />
      </IconButton>
    </header>

    <section class="adblock-row">
      <div class="adblock-copy">
        <span class="row-title">Built-in ad blocker</span>
        <span class="row-detail" data-testid="adblock-status">{adblockLabel()}</span>
      </div>
      <button
        class="toggle"
        class:on={adblock.enabled}
        type="button"
        role="switch"
        aria-checked={adblock.enabled}
        aria-label="Toggle built-in ad blocker"
        data-testid="adblock-toggle"
        disabled={busy || !adblock.ready || adblock.skippedForExtension}
        onclick={() => void toggleAdblock()}
      >
        <span class="toggle-knob"></span>
      </button>
    </section>

    {#if error}
      <div class="panel-error" role="alert">{error}</div>
    {/if}

    <div class="extension-list" data-testid="extension-list">
      {#if loading}
        <p class="empty">Loading extensions…</p>
      {:else if extensions.length === 0}
        <p class="empty">No extensions installed.</p>
      {:else}
        {#each extensions as extension (extension.id)}
          <div class="extension-row" data-testid="extension-row">
            <div class="extension-copy">
              <span class="row-title">{extension.name}</span>
              <span class="row-detail">
                v{extension.version} · MV{extension.manifestVersion}{extension.hasWebRequestBlocking
                  ? ' · blocking'
                  : ''}
              </span>
            </div>
            <div class="extension-actions">
              {#if extension.popupUrl || extension.optionsUrl}
                <button
                  class="small-button"
                  type="button"
                  data-testid="extension-open"
                  onclick={() => open(extension)}
                >
                  Open
                </button>
              {/if}
              <button
                class="small-button danger"
                type="button"
                aria-label={`Remove ${extension.name}`}
                data-testid="extension-remove"
                disabled={busy}
                onclick={() => void remove(extension)}
              >
                Remove
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <form class="install-form" data-testid="extension-install-form" onsubmit={install}>
      <label class="field-label" for="extension-id">Install from Chrome Web Store</label>
      <div class="install-row">
        <input
          id="extension-id"
          class="install-input"
          bind:value={installId}
          type="text"
          placeholder="Extension ID (32 characters)"
          autocomplete="off"
          spellcheck="false"
          data-testid="extension-install-input"
        />
        <button class="install-button" type="submit" disabled={busy || installId.trim().length === 0}>
          {busy ? 'Working…' : 'Install'}
        </button>
      </div>
    </form>

    <p class="note">
      MV2 and MV3 extensions load from the browser session. Some chrome.* APIs and
      Chrome Web Store review flows are not fully supported by Electron.
    </p>
  </div>
</dialog>

<style>
  .panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: 16px;
    border: 0;
    background: rgba(5, 6, 8, 0.62);
    backdrop-filter: blur(3px);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-height: calc(100vh - 32px);
    padding: 14px;
    overflow-y: auto;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-lg, 16px);
    background: var(--bg-elevated, #1a1c21);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
    color: var(--text, #e8eaed);
  }

  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 650;
    letter-spacing: 0.02em;
  }

  .subtitle,
  .row-detail,
  .empty,
  .note {
    margin: 0;
    color: var(--text-faint, #6b7280);
    font-size: 11px;
    line-height: 1.4;
  }

  .adblock-row,
  .extension-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 10px;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-md, 10px);
    background: var(--bg, #121316);
  }

  .adblock-copy,
  .extension-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row-title {
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toggle {
    position: relative;
    flex: 0 0 auto;
    width: 34px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--border, #262a31);
    border-radius: 999px;
    background: var(--bg-active, #2c313a);
    cursor: pointer;
    transition: background-color 120ms ease;
  }

  .toggle.on {
    background: var(--accent, #8ab4f8);
    border-color: var(--accent, #8ab4f8);
  }

  .toggle:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 120ms ease;
  }

  .toggle.on .toggle-knob {
    transform: translateX(14px);
  }

  .toggle:focus-visible,
  .install-input:focus-visible,
  .small-button:focus-visible,
  .install-button:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: 1px;
  }

  .extension-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .extension-actions {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
  }

  .small-button,
  .install-button {
    padding: 5px 9px;
    border: 1px solid var(--border, #262a31);
    border-radius: 7px;
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
    font-size: 11px;
    cursor: pointer;
  }

  .small-button:hover,
  .install-button:hover {
    background: var(--bg-active, #2c313a);
  }

  .small-button.danger:hover {
    border-color: var(--danger-border, rgba(242, 139, 130, 0.28));
    background: var(--danger-soft, rgba(242, 139, 130, 0.12));
    color: var(--danger, #f28b82);
  }

  .install-form {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field-label {
    color: var(--text-muted, #9aa1ab);
    font-size: 11px;
    font-weight: 600;
  }

  .install-row {
    display: flex;
    gap: 5px;
  }

  .install-input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border, #262a31);
    border-radius: 7px;
    background: var(--bg, #121316);
    color: var(--text, #e8eaed);
    font-size: 11px;
    user-select: text;
  }

  .install-button {
    flex: 0 0 auto;
    background: var(--accent-soft, rgba(138, 180, 248, 0.16));
    border-color: var(--accent-border, rgba(138, 180, 248, 0.35));
  }

  .install-button:disabled,
  .small-button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .panel-error {
    padding: 7px 9px;
    border: 1px solid var(--danger-border, rgba(242, 139, 130, 0.28));
    border-radius: var(--radius-sm, 8px);
    background: var(--danger-soft, rgba(242, 139, 130, 0.12));
    color: #f6c9c5;
    font-size: 11px;
    user-select: text;
  }

  .note {
    border-top: 1px solid var(--border, #262a31);
    padding-top: 8px;
  }
</style>
