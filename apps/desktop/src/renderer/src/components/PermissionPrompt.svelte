<script lang="ts">
  import type { PermissionRequestInfo } from '../../../shared/ipc'

  interface Props {
    request: PermissionRequestInfo
    onclose: () => void
  }

  let { request, onclose }: Props = $props()
  let busy = $state(false)

  const labels: Record<string, string> = {
    media: 'use your camera and microphone',
    geolocation: 'know your location',
    notifications: 'show notifications',
    'clipboard-read': 'read the clipboard',
    'clipboard-sanitized-write': 'write to the clipboard',
    fullscreen: 'enter fullscreen',
    'display-capture': 'capture your screen',
    midi: 'use MIDI devices',
    'pointerLock': 'lock the pointer',
    openExternal: 'open an external application'
  }

  const action = $derived(labels[request.permission] ?? `use ${request.permission}`)

  function originLabel(origin: string): string {
    try {
      return new URL(origin).origin
    } catch {
      return origin
    }
  }

  async function respond(allow: boolean): Promise<void> {
    if (busy) return
    busy = true
    try {
      await window.ione.respondPermission(request.id, allow)
    } finally {
      onclose()
    }
  }
</script>

<dialog
  open
  class="permission-backdrop"
  aria-label="Permission request"
  data-testid="permission-prompt"
>
  <section class="permission-panel">
    <h2>Permission request</h2>
    <p class="permission-copy">
      <strong>{originLabel(request.origin)}</strong> wants to {action}.
    </p>
    <p class="permission-note">Only allow sites you trust.</p>
    <div class="permission-actions">
      <button
        class="deny-button"
        type="button"
        data-testid="permission-deny"
        disabled={busy}
        onclick={() => void respond(false)}
      >
        Deny
      </button>
      <button
        class="allow-button"
        type="button"
        data-testid="permission-allow"
        disabled={busy}
        onclick={() => void respond(true)}
      >
        Allow
      </button>
    </div>
  </section>
</dialog>

<style>
  .permission-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: 16px;
    border: 0;
    background: rgba(5, 6, 8, 0.7);
  }

  .permission-panel {
    width: 100%;
    padding: 16px;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-lg, 16px);
    background: var(--bg-elevated, #1a1c21);
    color: var(--text, #e8eaed);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 14px;
    font-weight: 650;
  }

  .permission-copy {
    margin: 0;
    color: var(--text-muted, #9aa1ab);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .permission-copy strong {
    color: var(--text, #e8eaed);
  }

  .permission-note {
    margin: 8px 0 0;
    color: var(--text-faint, #6b7280);
    font-size: 10px;
  }

  .permission-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 14px;
  }

  .deny-button,
  .allow-button {
    padding: 6px 13px;
    border: 1px solid var(--border, #262a31);
    border-radius: 999px;
    font-size: 11.5px;
    cursor: pointer;
  }

  .deny-button {
    background: transparent;
    color: var(--text-muted, #9aa1ab);
  }

  .allow-button {
    border-color: var(--accent-border, rgba(138, 180, 248, 0.35));
    background: var(--accent-soft, rgba(138, 180, 248, 0.16));
    color: var(--text, #e8eaed);
  }

  .deny-button:hover {
    background: var(--bg-hover, #23262d);
  }

  .allow-button:hover {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }
</style>
