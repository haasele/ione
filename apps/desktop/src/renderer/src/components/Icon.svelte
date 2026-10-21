<script lang="ts">
  type IconName =
    | 'pin'
    | 'unpin'
    | 'close'
    | 'reset'
    | 'plus'
    | 'trash'
    | 'arrow'
    | 'extensions'
    | 'back'
    | 'forward'
    | 'reload'
    | 'find'
    | 'download'
    | 'command'
    | 'compact'
    | 'sun'
    | 'moon'

  interface Props {
    name: IconName
    size?: number
  }

  let { name, size = 14 }: Props = $props()
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  aria-hidden="true"
  focusable="false"
>
  {#if name === 'back'}
    <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  {:else if name === 'forward'}
    <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  {:else if name === 'reload'}
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V6h-3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  {:else if name === 'find'}
    <circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.5" />
    <path d="m10 10 3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  {:else if name === 'download'}
    <path d="M8 2.5v7M5.5 7 8 9.5 10.5 7M3 12.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  {:else if name === 'command'}
    <path d="M5 3a2 2 0 0 1 2 2v6a2 2 0 1 1-2-2h6a2 2 0 1 1-2 2V5a2 2 0 1 1 2 2H5a2 2 0 1 1 2-2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
  {:else if name === 'compact'}
    <path d="M3 3v10M6 6h7M6 10h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  {:else if name === 'sun'}
    <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.4" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
  {:else if name === 'moon'}
    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
  {:else if name === 'plus'}
    <path
      d="M8 3v10M3 8h10"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  {:else if name === 'close'}
    <path
      d="M4 4l8 8M12 4l-8 8"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  {:else if name === 'extensions'}
    <path
      d="M2.5 6.2h2.1a1.7 1.7 0 1 1 0 3.4H2.5v3.6h3.6v-2.1a1.7 1.7 0 1 1 3.4 0v2.1h3.6V9.6h-2.1a1.7 1.7 0 1 1 0-3.4h2.1V2.5H9.5v2.1a1.7 1.7 0 1 1-3.4 0V2.5H2.5v3.7Z"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linejoin="round"
    />
  {:else if name === 'arrow'}
    <path
      d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'reset'}
    <path
      d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V6h-3.4"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'trash'}
    <path
      d="M3 4.5h10M6 4.5V3h4v1.5M4.2 4.5l.6 8.5h6.4l.6-8.5M6.5 7v3.5M9.5 7v3.5"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'unpin'}
    <path
      d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146Z"
      fill="currentColor"
    />
    <path
      d="M2.5 13.5 13.5 2.5"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  {:else}
    <path
      d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146Z"
      fill="currentColor"
    />
  {/if}
</svg>
