import type { JSX } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import type { UIState } from '@shared/types'
import { run } from '@renderer/lib/api'
import { TOOLBAR_STROKE } from './v2/controls'

/**
 * Linux window buttons. macOS uses native traffic lights; Windows draws its own over the chrome
 * (Window Controls Overlay); mobile hosts have none. Three §9.3 toolbar icon buttons in the
 * window family (design language v2 §9.29): the 28 box, a 16 glyph at `TOOLBAR_STROKE`, the
 * window's hover fill on each – Close included, as the GTK title bars they stand in for draw it;
 * a danger fill would be a page colour on the window, and status colours are ink alone (§9.29).
 * 4 apart like the toolbar row's buttons (§5). Each is named for the tree and carries the same
 * word as its chrome tooltip (`data-tooltip`, lib/tooltip.ts; a11y-26) in place of a native
 * `title`. The maximize/restore glyph is the phone bar's two-glyph slot (`.zen-glyph-swap`,
 * `BarGlyphs`): the two fade through each other in place, the button's name changing with them.
 */
export function WindowControls({
  state,
  compact = false
}: {
  state: UIState
  compact?: boolean
}): JSX.Element | null {
  if (state.platform === 'darwin' || state.window.fullscreen) return null
  // A window made with the desktop's own frame draws no custom buttons: the OS (or the
  // compositor, when it provides no server-side decorations) owns them.
  if (state.window.nativeFrame) return null
  if (!state.capabilities.windowControls || state.capabilities.windowControlsOverlay) return null
  if (compact) {
    return (
      <div className="zen-no-drag flex items-center">
        <button
          type="button"
          className="zen-toolbar-button"
          aria-label="Close"
          data-tooltip="Close"
          onClick={() => run('window.close', undefined)}
        >
          <X className="h-4 w-4" strokeWidth={TOOLBAR_STROKE} />
        </button>
      </div>
    )
  }
  return (
    <div className="zen-no-drag flex items-center gap-1">
      <button
        type="button"
        className="zen-toolbar-button"
        aria-label="Minimize"
        data-tooltip="Minimize"
        onClick={() => run('window.minimize', undefined)}
      >
        <Minus className="h-4 w-4" strokeWidth={TOOLBAR_STROKE} />
      </button>
      <button
        type="button"
        className="zen-toolbar-button"
        aria-label={state.window.maximized ? 'Restore' : 'Maximize'}
        data-tooltip={state.window.maximized ? 'Restore' : 'Maximize'}
        onClick={() => run('window.toggleMaximize', undefined)}
      >
        <span className="zen-glyph-swap relative flex h-4 w-4 items-center justify-center">
          <Copy
            className="h-4 w-4 -scale-x-100 absolute"
            data-shown={state.window.maximized}
            strokeWidth={TOOLBAR_STROKE}
            aria-hidden
          />
          <Square
            className="h-4 w-4 absolute"
            data-shown={!state.window.maximized}
            strokeWidth={TOOLBAR_STROKE}
            aria-hidden
          />
        </span>
      </button>
      <button
        type="button"
        className="zen-toolbar-button"
        aria-label="Close"
        data-tooltip="Close"
        onClick={() => run('window.close', undefined)}
      >
        <X className="h-4 w-4" strokeWidth={TOOLBAR_STROKE} />
      </button>
    </div>
  )
}
