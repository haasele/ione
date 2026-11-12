// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Tab } from '@shared/types'
import { DEFAULT_CONTAINER_ID } from '@shared/types'

/*
 * The Essentials poster is the ACTIVE tile's alone: the favicon colours while the tile is the
 * tab in front, and the same tile falls back to the neutral window fill as soon as another tab
 * is active. This is the regression that made every tile look coloured at once.
 */

vi.mock('@renderer/lib/api', () => ({
  cmd: vi.fn(async () => null),
  run: vi.fn(),
  onEvent: vi.fn(() => () => undefined)
}))
vi.mock('@renderer/lib/favicons', () => ({ useFaviconSrc: () => 'zen://favicon/test' }))
vi.mock('@renderer/lib/faviconColors', () => ({
  useFaviconGradient: () => ({
    gradient: 'linear-gradient(135deg, #f00 0%, #a00 100%)',
    from: '#ff0000',
    to: '#aa0000'
  })
}))

const { Essentials } = await import('../Essentials')

function tab(id: string): Tab {
  return {
    id,
    spaceId: 'space',
    containerId: DEFAULT_CONTAINER_ID,
    url: 'https://example.com/',
    title: id,
    favicon: 'https://example.com/favicon.ico',
    pinned: false,
    essential: true,
    pinnedUrl: null,
    customTitle: null,
    customIcon: null,
    windowId: null,
    folderId: null,
    loading: false,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    audible: false,
    muted: false,
    discarded: false,
    frozen: false,
    cpuThrottle: 1,
    zoom: 1,
    splitGroupId: null,
    createdAt: 0,
    lastActiveAt: 0,
    errorCode: null
  }
}

const html = (activeTabId: string | null): string =>
  renderToStaticMarkup(<Essentials essentials={[tab('mail')]} activeTabId={activeTabId} compact={false} />)

describe('Essentials poster tint', () => {
  it('paints the active tile from its favicon', () => {
    const markup = html('mail')
    expect(markup).toContain('data-tinted="true"')
    expect(markup).toContain('--zen-essential-gradient')
  })

  it('leaves an inactive tile on the neutral fill', () => {
    const markup = html('other')
    expect(markup).not.toContain('data-tinted')
    expect(markup).not.toContain('--zen-essential-gradient')
  })
})
