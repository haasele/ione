import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyBetween, type BrowserSnapshot } from '@ione/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createBootstrapSnapshot, initializeState } from './bootstrap'
import { openDatabase } from './persistence/database'
import { StateRepository } from './persistence/state-repository'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

function restoredSnapshot(): BrowserSnapshot {
  const base = createBootstrapSnapshot()
  const space = Object.values(base.spaces)[0]
  const first = base.activeTabId
  if (!space || !first) throw new Error('bootstrap fixture is incomplete')

  const secondId = 'restored-second-tab'
  const firstTab = base.tabs[first]
  if (!firstTab) throw new Error('bootstrap active tab missing')

  return {
    ...base,
    version: 4,
    tabs: {
      [first]: { ...firstTab, scrollY: 0 },
      [secondId]: {
        id: secondId,
        spaceId: space.id,
        url: 'https://restored.example/',
        title: 'Restored',
        favicon: '',
        pinned: false,
        lastActive: firstTab.lastActive - 1,
        scrollY: 240,
        sleeping: false,
        order: generateKeyBetween(firstTab.order, null)
      }
    }
  }
}

describe('initializeState lazy restore', () => {
  it('restores persisted tabs with only the active tab awake', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ione-bootstrap-'))
    tempDirs.push(dir)
    const path = join(dir, 'state.sqlite')
    const seeded = restoredSnapshot()
    const activeId = seeded.activeTabId
    if (!activeId) throw new Error('active tab missing')

    const seedDb = openDatabase(path)
    new StateRepository(seedDb).saveSnapshot(seeded)
    seedDb.close()

    const initialized = initializeState(path)
    try {
      expect(initialized.snapshot.version).toBe(0)
      expect(initialized.snapshot.activeTabId).toBe(activeId)
      expect(initialized.snapshot.tabs[activeId]?.sleeping).toBe(false)
      expect(initialized.snapshot.tabs['restored-second-tab']?.sleeping).toBe(true)
      expect(initialized.snapshot.tabs['restored-second-tab']?.scrollY).toBe(240)
      expect(initialized.repository.loadSnapshot()?.tabs['restored-second-tab']?.sleeping).toBe(
        true
      )
    } finally {
      initialized.db.close()
    }
  })
})
