import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { generateKeyBetween, normalizeSnapshot, type BrowserSnapshot } from '@ione/core'
import { openDatabase } from './persistence/database'
import { StateRepository } from './persistence/state-repository'

export interface InitializedState {
  db: Database.Database
  repository: StateRepository
  snapshot: BrowserSnapshot
}

export function initializeState(dbPath: string): InitializedState {
  const db = openDatabase(dbPath)
  const repository = new StateRepository(db)
  const loaded = repository.loadSnapshot()
  const snapshot = loaded ? normalizeSnapshot(loaded) : createBootstrapSnapshot()

  // Persist bootstrap state and any repairs from normalizeSnapshot before the
  // chrome renderer can observe a versioned snapshot.
  repository.saveSnapshot(snapshot)
  return { db, repository, snapshot }
}

export function createBootstrapSnapshot(): BrowserSnapshot {
  const spaceId = randomUUID()
  const tabId = randomUUID()
  const now = Date.now()

  return {
    version: 0,
    spaces: {
      [spaceId]: {
        id: spaceId,
        name: 'Home',
        icon: 'home',
        theme: 'default',
        order: generateKeyBetween(null, null)
      }
    },
    essentials: {},
    folders: {},
    tabs: {
      [tabId]: {
        id: tabId,
        spaceId,
        url: 'about:blank',
        title: 'New Tab',
        favicon: '',
        pinned: false,
        lastActive: now,
        scrollY: 0,
        sleeping: false,
        order: generateKeyBetween(null, null)
      }
    },
    activeSpaceId: spaceId,
    activeTabId: tabId
  }
}
