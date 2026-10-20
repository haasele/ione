<script lang="ts">
  interface Props {
    src: string
    fallback: string
    size?: number
  }

  let { src, fallback, size = 16 }: Props = $props()

  let failedSource = $state<string | null>(null)

  /** Only https/data image URLs are rendered; anything else becomes a letter. */
  function safeFavicon(raw: string): string | null {
    const value = raw.trim()
    if (!value) return null
    if (/^data:image\//i.test(value)) return value

    try {
      const parsed = new URL(value)
      if (parsed.protocol === 'https:') return value
    } catch {
      return null
    }

    return null
  }

  const source = $derived(safeFavicon(src))
  const letter = $derived((fallback.trim().match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase())
</script>

{#if source !== null && failedSource !== source}
  <img
    class="favicon"
    src={source}
    alt=""
    aria-hidden="true"
    style:width={`${size}px`}
    style:height={`${size}px`}
    onerror={() => {
      failedSource = source
    }}
  />
{:else}
  <span
    class="favicon favicon-fallback"
    aria-hidden="true"
    style:width={`${size}px`}
    style:height={`${size}px`}
    style:font-size={`${Math.max(8, Math.round(size * 0.56))}px`}
  >
    {letter}
  </span>
{/if}

<style>
  .favicon {
    flex: 0 0 auto;
    border-radius: 4px;
  }

  img.favicon {
    object-fit: contain;
  }

  .favicon-fallback {
    display: grid;
    place-items: center;
    background: var(--bg-active, #2c313a);
    color: var(--text-muted, #9aa1ab);
    font-weight: 700;
    line-height: 1;
  }
</style>
