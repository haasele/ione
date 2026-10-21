<script lang="ts">
  import { IconButton } from '@ione/ui-kit'
  import type { DownloadInfo } from '../../../shared/ipc'
  import Icon from './Icon.svelte'

  interface Props {
    downloads: readonly DownloadInfo[]
    onclose: () => void
  }

  let { downloads, onclose }: Props = $props()

  function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0 B'
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    if (value < 1024 ** 3) return `${(value / 1024 / 1024).toFixed(1)} MB`
    return `${(value / 1024 ** 3).toFixed(2)} GB`
  }

  function progress(download: DownloadInfo): number {
    if (download.state === 'completed') return 100
    if (download.totalBytes <= 0) return 0
    return Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100))
  }

  function open(download: DownloadInfo): void {
    void window.ione.openDownload(download.id)
  }

  function show(download: DownloadInfo): void {
    void window.ione.showDownloadInFolder(download.id)
  }

  function cancel(download: DownloadInfo): void {
    void window.ione.cancelDownload(download.id)
  }
</script>

<dialog
  open
  class="downloads-backdrop"
  aria-label="Downloads"
  data-testid="downloads-panel"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose()
  }}
>
  <section class="downloads-panel">
    <header class="downloads-header">
      <h2>Downloads</h2>
      <IconButton label="Close downloads" title="Close" size="sm" onclick={onclose}>
        <Icon name="close" size={12} />
      </IconButton>
    </header>

    {#if downloads.length === 0}
      <p class="empty">No downloads yet.</p>
    {:else}
      <div class="download-list">
        {#each downloads as download (download.id)}
          <div class="download-row" data-testid="download-row">
            <div class="download-copy">
              <span class="download-name" title={download.filename}>{download.filename}</span>
              <span class="download-detail">
                {download.state === 'progressing'
                  ? `${formatBytes(download.receivedBytes)}${download.totalBytes > 0 ? ` / ${formatBytes(download.totalBytes)}` : ''}`
                  : download.state}
              </span>
              {#if download.state === 'progressing'}
                <span class="progress-track" aria-hidden="true">
                  <span class="progress-fill" style:width={`${progress(download)}%`}></span>
                </span>
              {/if}
            </div>
            <div class="download-actions">
              {#if download.state === 'progressing'}
                <button class="small-button" type="button" data-testid="download-cancel" onclick={() => cancel(download)}>
                  Cancel
                </button>
              {:else if download.state === 'completed'}
                <button class="small-button" type="button" data-testid="download-open" onclick={() => open(download)}>
                  Open
                </button>
                <button class="small-button" type="button" data-testid="download-show" onclick={() => show(download)}>
                  Folder
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</dialog>

<style>
  .downloads-backdrop {
    position: fixed;
    inset: 0;
    z-index: 25;
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
  }

  .downloads-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    max-height: calc(100vh - 32px);
    padding: 14px;
    overflow-y: auto;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-lg, 16px);
    background: var(--bg-elevated, #1a1c21);
    color: var(--text, #e8eaed);
  }

  .downloads-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 650;
  }

  .empty {
    margin: 0;
    padding: 14px;
    color: var(--text-faint, #6b7280);
    font-size: 11px;
    text-align: center;
  }

  .download-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .download-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 9px;
    border: 1px solid var(--border, #262a31);
    border-radius: var(--radius-md, 10px);
    background: var(--bg, #121316);
  }

  .download-copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .download-name {
    overflow: hidden;
    font-size: 12px;
    font-weight: 550;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .download-detail {
    color: var(--text-faint, #6b7280);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .progress-track {
    display: block;
    width: 100%;
    height: 3px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--bg-hover, #23262d);
  }

  .progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent, #8ab4f8);
    transition: width 120ms linear;
  }

  .download-actions {
    display: flex;
    flex: 0 0 auto;
    gap: 3px;
  }

  .small-button {
    padding: 5px 8px;
    border: 1px solid var(--border, #262a31);
    border-radius: 7px;
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
    font-size: 11px;
    cursor: pointer;
  }

  .small-button:hover {
    background: var(--bg-active, #2c313a);
  }
</style>
