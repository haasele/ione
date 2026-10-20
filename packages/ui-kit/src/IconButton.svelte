<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    title?: string
    variant?: 'ghost' | 'soft' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
    onclick?: (event: MouseEvent) => void
    children: Snippet
  }

  let {
    label,
    title,
    variant = 'ghost',
    size = 'md',
    disabled = false,
    onclick,
    children
  }: Props = $props()
</script>

<button
  class="icon-button {variant} {size}"
  type="button"
  aria-label={label}
  title={title ?? label}
  {disabled}
  {onclick}
>
  {@render children()}
</button>

<style>
  .icon-button {
    display: inline-grid;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted, #9aa1ab);
    cursor: pointer;
    transition:
      background-color 100ms ease,
      color 100ms ease,
      transform 100ms ease;
  }

  .icon-button:hover {
    background: var(--bg-hover, #23262d);
    color: var(--text, #e8eaed);
  }

  .icon-button:active {
    transform: scale(0.92);
  }

  .icon-button:focus-visible {
    outline: 2px solid var(--accent, #8ab4f8);
    outline-offset: 1px;
  }

  .icon-button:disabled {
    opacity: 0.4;
    cursor: default;
    transform: none;
  }

  .sm {
    width: 22px;
    height: 22px;
    border-radius: 6px;
  }

  .md {
    width: 28px;
    height: 28px;
  }

  .soft {
    border-color: var(--border, #262a31);
    background: var(--bg-elevated, #1a1c21);
  }

  .danger:hover {
    background: var(--danger-soft, rgba(242, 139, 130, 0.12));
    color: var(--danger, #f28b82);
  }

  .icon-button :global(svg) {
    display: block;
    width: 14px;
    height: 14px;
  }

  .icon-button.sm :global(svg) {
    width: 12px;
    height: 12px;
  }
</style>
