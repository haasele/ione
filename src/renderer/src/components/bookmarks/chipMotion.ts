import { SlideMotion, type SlideOptions } from '@renderer/lib/motion/slide'

/**
 * Motion of the bookmarks bar's chips: the list motion (`SlideMotion`) along the bar's axis.
 * While a chip is being dragged its neighbours slide to open the gap where it would land, and
 * after any commit (that drop, a new bookmark, a removal, "Sort by name") chips whose layout
 * moved keep their on-screen place and spring home. With `enter`, a chip new to the bar grows
 * into its slot, batched by the bar's `ENTER_BATCH`; under reduced motion it fades in place.
 */
export class ChipMotion extends SlideMotion {
  constructor(options: SlideOptions = {}) {
    super('x', options)
  }
}
