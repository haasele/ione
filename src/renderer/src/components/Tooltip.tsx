import type { JSX } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KEYBOARD_FOCUS_ATTR } from '@renderer/lib/panes'
import { subscribePopovers } from '@renderer/lib/popoverStore'
import { ChromePortal, toRect, viewportSize } from '@renderer/lib/portals'
import {
  placeTooltip,
  TOOLTIP_ATTR,
  TOOLTIP_ID,
  tooltip,
  tooltipPaneOf,
  tooltipRoomStore,
  tooltipSize,
  tooltipStore,
  tooltipTargetOf,
  tooltipText,
  type TooltipPlacement
} from '@renderer/lib/tooltip'
import { contentAreaStore } from '@renderer/lib/ui'

/**
 * The chrome tooltip's host (lib/tooltip.ts; design-language-v2-draft §9.31, a11y-26): one
 * for the window, mounted by the desktop shell, listening on the document for the pointer and
 * the keyboard reaching any control that carries `data-tooltip`. It draws the one tooltip in
 * the chrome layer – 13/400 on `--v2-panel` with the hairline, the control radius (4), no
 * arrow, 8 px from the control and never over it, slid and flipped to stay inside the control's
 * pane and the window (`placeTooltip`) – marks the control `aria-describedby` it while it is
 * up, and takes it down on the pointer leaving, focus leaving, a press, Escape (let through to
 * whatever it is for the control: one press), the window losing focus, a scroll or resize, the
 * control leaving the DOM or losing its text, and other chrome opening.
 *
 * The tab views draw above the chrome's DOM: a tooltip placed over the page cannot be drawn
 * there. Rather than hiding the page – which pauses a playing video and tells the site its tab
 * went away – such a tooltip falls back to the control's native `title` while the pointer rests
 * on it. Tooltips that fit in their pane (every one in the sidebar) and those that fit beside
 * the page (a split pane's top header, on the caption band) keep the chrome's own panel.
 *
 * A window resize takes the tooltip down (`resize: 'hide'`, the shells' way: the controls move
 * under a still pointer, and the one the pointer lands on starts its own dwell). The popup
 * surface's document has the other way (`'place'`): there a resize is the core giving the
 * document the room it asked for the tooltip's own moment (`MiniMenuRoom`, the folded pill),
 * which moves no control from under the pointer – so the tooltip on its way keeps its dwell
 * and one up is placed again in the grown document, rather than taken down by the room made
 * for it. And while that room is on its way (`tooltipRoomStore.awaited`: asked of the core,
 * its landing not yet seen – `awaitTooltipRoom`, §11's handshake) a tooltip waits hidden, as
 * one waits for the page's cover: painted before the room lands it would be cut by the
 * surface's old bounds. The shells never ask a room; nothing waits there.
 */
export function Tooltip({ resize = 'hide' }: TooltipProps): JSX.Element | null {
  const { target, by } = tooltipStore.use()
  const roomAwaited = tooltipRoomStore.use((s) => s.awaited)
  // The text is the control's attribute, read at render; `words` re-renders when it changes.
  const [, setWords] = useState(0)
  const text = target ? tooltipText(target) : ''
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null)
  // Counts the window's resizes while the host places through them (`resize: 'place'`): the
  // placement runs again for each, in the document's new size.
  const [resized, setResized] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  // The document's events, once, for every control now or later in the DOM. A touch or pen
  // pointer shows nothing (§9.31): the row's context menu header carries the full title there.
  useEffect(() => {
    const mouse = (e: PointerEvent): boolean => e.pointerType === 'mouse' || e.pointerType === ''
    const onOver = (e: PointerEvent): void => {
      if (!mouse(e)) return
      const next = tooltipTargetOf(e.target)
      const prev = tooltipTargetOf(e.relatedTarget)
      if (next === prev) return
      if (prev) tooltip.pointerLeave(prev)
      if (next) tooltip.pointerEnter(next)
    }
    const onOut = (e: PointerEvent): void => {
      if (!mouse(e)) return
      const prev = tooltipTargetOf(e.target)
      if (prev && prev !== tooltipTargetOf(e.relatedTarget)) tooltip.pointerLeave(prev)
    }
    // The control is the nearest element carrying the text, the keyboard's test is on the
    // element that took the focus: a control may be a box around its focusable part (the URL
    // pill – the group carries the address, its button inside takes the Tab stop).
    const onFocusIn = (e: FocusEvent): void => {
      const next = tooltipTargetOf(e.target)
      if (next && e.target instanceof HTMLElement && keyboardFocus(e.target)) tooltip.focus(next)
    }
    const onFocusOut = (e: FocusEvent): void => {
      const prev = tooltipTargetOf(e.target)
      if (prev) tooltip.blur(prev)
    }
    const onDown = (): void => {
      tooltip.dismiss()
    }
    // Escape takes the tooltip down and goes on its way, never consumed: the key is whatever
    // it is for the control under it – Stop on a loading tab's Stop button, Close on the find
    // bar's – in the one press (the popups' stack, `useEscape`, and the chrome's own Escape in
    // `useGlobalKeys` hear it as if no tooltip had been up). Only a pointer's tooltip is
    // silenced by it (`dismiss`), as by a press.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      tooltip.dismiss()
    }
    const hide = (): void => tooltip.hide()
    // The popup surface's document places through a resize (the room made for the tooltip);
    // the shells take the tooltip down.
    const onResize = resize === 'place' ? (): void => setResized((n) => n + 1) : hide
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', hide, { capture: true, passive: true })
    window.addEventListener('blur', hide)
    window.addEventListener('resize', onResize)
    const unsubscribe = subscribePopovers((change) => {
      if (change === 'open' || change === 'all') tooltip.hide()
    })
    return () => {
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', hide, { capture: true })
      window.removeEventListener('blur', hide)
      window.removeEventListener('resize', onResize)
      unsubscribe()
      tooltip.hide()
    }
  }, [resize])

  // While the tooltip is up: its text follows the control's attribute (Reload becoming Stop
  // under the pointer), the control leaving the DOM takes it down (the chrome's tree is watched
  // only for as long as a tooltip shows), and the control is `aria-describedby` it – put back
  // as it was after.
  useLayoutEffect(() => {
    if (!target) return
    const words = new MutationObserver(() => {
      if (tooltipText(target)) setWords((n) => n + 1)
      else tooltip.hide()
    })
    words.observe(target, { attributes: true, attributeFilter: [TOOLTIP_ATTR] })
    const gone = new MutationObserver(() => {
      if (!target.isConnected) tooltip.hide()
    })
    gone.observe(document.body, { childList: true, subtree: true })
    const before = target.getAttribute('aria-describedby')
    target.setAttribute('aria-describedby', before ? `${before} ${TOOLTIP_ID}` : TOOLTIP_ID)
    return () => {
      words.disconnect()
      gone.disconnect()
      const now = target.getAttribute('aria-describedby')
      if (now === null) return
      const rest = now
        .split(/\s+/)
        .filter((id) => id && id !== TOOLTIP_ID)
        .join(' ')
      if (rest) target.setAttribute('aria-describedby', rest)
      else target.removeAttribute('aria-describedby')
    }
  }, [target])

  // The tooltip's own size decides where it fits; measured once it has rendered its text, to
  // the fraction (`tooltipSize`: a rounded width clamps the box a fraction over the margin),
  // with the width the last text was given taken off first so the reading is this text's own
  // `max-content`. The placer takes the width up to the whole pixel (`box.width`) and the box
  // is given it here, outside React's style prop – the same whole width for two texts in a
  // row would otherwise leave the cleared style uncorrected – so the right hairline stands on
  // a column as the left one does. `resized` runs it again for a window the host places
  // through a resize of (`resize: 'place'`): the same tooltip, the document's new size – and
  // so does the room's landing (`roomAwaited` going), which is that size's arrival by another
  // word: placed in the document as it stands the moment it may show.
  useLayoutEffect(() => {
    const el = ref.current
    if (!target || !el || !text) {
      setPlacement(null)
      return
    }
    el.style.width = ''
    const pane = tooltipPaneOf(target)
    const placed = placeTooltip(
      toRect(target.getBoundingClientRect()),
      tooltipSize(el),
      viewportSize(),
      pane ? toRect(pane.getBoundingClientRect()) : null,
      contentAreaStore.get().area
    )
    el.style.width = `${placed.box.width}px`
    setPlacement(placed)
  }, [target, text, resized, roomAwaited])

  // A tooltip that would lie over a page view cannot be drawn in the chrome (the native view
  // composites above it). Use the control's native `title` for that case instead of hiding the
  // page: hiding pauses video and sends the site a visibility change it did not ask for.
  const native = placement?.coversPage === true
  useEffect(() => {
    if (!target || !native || !text) return undefined
    const before = target.getAttribute('title')
    target.setAttribute('title', text)
    return () => {
      if (before === null) target.removeAttribute('title')
      else target.setAttribute('title', before)
    }
  }, [target, native, text])

  if (!target || !text) return null
  // Placed, over a covered page or beside it, and with its room landed where it asked one.
  const shown = placement !== null && !placement.coversPage && !roomAwaited
  return (
    <ChromePortal>
      <div
        ref={ref}
        id={TOOLTIP_ID}
        role="tooltip"
        className="zen-tooltip zen-animate-pop"
        // A plain panel (§9.31): a page surface in either layout, as the popovers beside it in
        // the chrome layer declare on their own roots (§9.29's two families).
        data-surface="page"
        data-side={placement?.box.side}
        data-by={by ?? undefined}
        style={{
          left: placement?.box.left ?? 0,
          top: placement?.box.top ?? 0,
          visibility: shown ? 'visible' : 'hidden'
        }}
      >
        {text}
      </div>
    </ChromePortal>
  )
}

export interface TooltipProps {
  /**
   * What a window resize does to the tooltip: `'hide'` (the shells; the default) takes it down,
   * `'place'` (the popup surface's document) places it again in the document's new size and
   * lets one on its way keep its dwell.
   */
  resize?: 'hide' | 'place'
}

/**
 * Whether the focus that landed on `focused` came from the keyboard – `:focus-visible` (a
 * pointer's press focuses a button without it, and its tooltip is the pointer's to show after
 * the wait), or a pane shortcut's landing (`KEYBOARD_FOCUS_ATTR`, lib/panes.ts: the chord is
 * consumed before the document sees a key, so the heuristic alone would read the focus as the
 * mouse's after any click). A DOM without the pseudo-class (a test's) counts every focus as the
 * keyboard's.
 */
function keyboardFocus(focused: HTMLElement): boolean {
  if (focused.hasAttribute(KEYBOARD_FOCUS_ATTR)) return true
  try {
    return focused.matches(':focus-visible')
  } catch {
    return true
  }
}
