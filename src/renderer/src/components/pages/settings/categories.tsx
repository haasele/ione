import type { JSX } from 'react'
import { ChevronRight, RotateCw } from 'lucide-react'
import type { InternalPageSection } from '@shared/internalPages'
import { run } from '@renderer/lib/api'
import { categoryDescription, categoryItems } from './categoryCopy'
import { SECTION_GLYPH, SECTION_GLYPHS } from './glyphs'

/** The big category tile: the Lucide glyph in its squircle, the title, one description and its groups. */
export function CategoryCard({
  section,
  onOpen
}: {
  section: InternalPageSection
  onOpen(sectionId: string): void
}): JSX.Element {
  const Glyph = SECTION_GLYPHS[section.id] ?? SECTION_GLYPH
  const items = categoryItems(section)
  return (
    <button
      type="button"
      className="zen-settings-category-card"
      data-section={section.id}
      onClick={() => onOpen(section.id)}
    >
      <span className="zen-settings-category-squircle" aria-hidden="true">
        <Glyph />
      </span>
      <span className="zen-settings-category-copy">
        <span className="zen-settings-category-title">{section.label}</span>
        <span className="zen-settings-category-description">{categoryDescription(section)}</span>
        {items.length > 0 && (
          <span className="zen-settings-category-items">{items.slice(0, 3).join(' · ')}</span>
        )}
      </span>
      <ChevronRight className="zen-settings-category-chevron" aria-hidden="true" />
    </button>
  )
}

/**
 * The launch note at the foot of Settings: a few choices – the native window frame, the
 * see-through frame, the Chromium switches – are read when Ione starts. Say so and give the
 * restart, rather than leaving a change that appears to do nothing. The resources snapshot's
 * `restartRequired` makes the note loud while startup switches are actually waiting.
 */
export function RestartNotice({
  pending = false,
  available = true,
  compact = false
}: {
  pending?: boolean
  available?: boolean
  compact?: boolean
}): JSX.Element | null {
  if (!available) return null
  return (
    <aside
      className="zen-settings-restart"
      data-pending={pending || undefined}
      data-compact={compact || undefined}
    >
      <span className="zen-settings-restart-icon" aria-hidden="true">
        <RotateCw />
      </span>
      <span className="zen-settings-restart-copy">
        <span className="zen-settings-restart-title">
          {pending ? 'Startup changes are waiting' : 'Some changes need a restart'}
        </span>
        <span className="zen-settings-restart-description">
          {pending
            ? 'Your process switches take effect the next time Ione starts.'
            : 'Window frame, transparency and startup switches apply after Ione restarts. New windows may pick up some changes sooner.'}
        </span>
      </span>
      <button
        type="button"
        className="zen-settings-restart-button"
        onClick={() => run('resources.relaunch', undefined)}
      >
        Restart Ione
      </button>
    </aside>
  )
}
