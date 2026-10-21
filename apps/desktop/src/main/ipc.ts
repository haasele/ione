import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { BrowserSnapshot, Essential, Folder, FolderKind, Space, Tab } from '@ione/core'
import {
  IPC,
  type CreateEssentialInput,
  type CreateFolderInput,
  type CreateSpaceInput,
  type MoveFolderInput,
  type MoveTabInput,
  type NavigateResult,
  type UpdateFolderInput,
  type UpdateSpaceInput
} from '../shared/ipc'
import type { BrowserController } from './controller'
import type { ChromeWindow } from './chrome-window'

export function registerIpc(controller: BrowserController, chromeWindow: ChromeWindow): void {
  const assertTrusted = (event: IpcMainInvokeEvent): void => {
    if (!chromeWindow.isChromeSender(event.sender)) {
      throw new Error('IPC rejected: sender is not the chrome view')
    }
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error('IPC rejected: sender is not the main frame')
    }
  }

  ipcMain.handle(IPC.getSnapshot, (event): BrowserSnapshot => {
    assertTrusted(event)
    return controller.snapshot
  })

  ipcMain.handle(IPC.navigate, (event, rawInput: unknown): NavigateResult | null => {
    assertTrusted(event)
    const input = assertString(rawInput, 'input')
    const plan = controller.prepareNavigation(input)
    if (!plan) return null
    chromeWindow.navigateTab(plan.tabId, plan.url)
    return plan
  })

  ipcMain.handle(IPC.createTab, (event, rawInput: unknown): Tab => {
    assertTrusted(event)
    const input = rawInput === undefined ? undefined : assertString(rawInput, 'input')
    return controller.createTab(input)
  })

  ipcMain.handle(IPC.closeTab, (event, rawTabId: unknown): void => {
    assertTrusted(event)
    controller.closeTab(assertId(rawTabId, 'tabId'))
  })

  ipcMain.handle(IPC.activateTab, (event, rawTabId: unknown): void => {
    assertTrusted(event)
    controller.activateTab(assertId(rawTabId, 'tabId'))
  })

  ipcMain.handle(IPC.activateSpace, (event, rawSpaceId: unknown): void => {
    assertTrusted(event)
    controller.activateSpace(assertId(rawSpaceId, 'spaceId'))
  })

  ipcMain.handle(IPC.createSpace, (event, rawInput: unknown): Space => {
    assertTrusted(event)
    return controller.createSpace(assertCreateSpaceInput(rawInput))
  })

  ipcMain.handle(IPC.updateSpace, (event, rawSpaceId: unknown, rawPatch: unknown): void => {
    assertTrusted(event)
    const spaceId = assertId(rawSpaceId, 'spaceId')
    controller.updateSpace(spaceId, assertUpdateSpaceInput(rawPatch))
  })

  ipcMain.handle(IPC.removeSpace, (event, rawSpaceId: unknown): void => {
    assertTrusted(event)
    controller.removeSpace(assertId(rawSpaceId, 'spaceId'))
  })

  ipcMain.handle(IPC.addEssential, (event, rawInput: unknown): Essential => {
    assertTrusted(event)
    return controller.addEssential(assertCreateEssentialInput(rawInput))
  })

  ipcMain.handle(IPC.removeEssential, (event, rawEssentialId: unknown): void => {
    assertTrusted(event)
    controller.removeEssential(assertId(rawEssentialId, 'essentialId'))
  })

  ipcMain.handle(IPC.pinTab, (event, rawTabId: unknown): void => {
    assertTrusted(event)
    controller.pinTab(assertId(rawTabId, 'tabId'))
  })

  ipcMain.handle(IPC.unpinTab, (event, rawTabId: unknown): void => {
    assertTrusted(event)
    controller.unpinTab(assertId(rawTabId, 'tabId'))
  })

  ipcMain.handle(IPC.resetPinnedTab, (event, rawTabId: unknown): NavigateResult | null => {
    assertTrusted(event)
    const plan = controller.resetPinnedTab(assertId(rawTabId, 'tabId'))
    if (!plan) return null
    chromeWindow.navigateTab(plan.tabId, plan.url)
    return plan
  })

  ipcMain.handle(
    IPC.createTabInFolder,
    (event, rawFolderId: unknown, rawInput: unknown): Tab => {
      assertTrusted(event)
      const folderId = rawFolderId === null ? null : assertId(rawFolderId, 'folderId')
      const input =
        rawInput === undefined ? undefined : assertString(rawInput, 'input', 8192)
      return controller.createTabInFolder(folderId, input)
    }
  )

  ipcMain.handle(IPC.createFolder, (event, rawInput: unknown): Folder => {
    assertTrusted(event)
    return controller.createFolder(assertCreateFolderInput(rawInput))
  })

  ipcMain.handle(
    IPC.updateFolder,
    (event, rawFolderId: unknown, rawPatch: unknown): void => {
      assertTrusted(event)
      const folderId = assertId(rawFolderId, 'folderId')
      controller.updateFolder(folderId, assertUpdateFolderInput(rawPatch))
    }
  )

  ipcMain.handle(IPC.removeFolder, (event, rawFolderId: unknown): void => {
    assertTrusted(event)
    controller.removeFolder(assertId(rawFolderId, 'folderId'))
  })

  ipcMain.handle(
    IPC.moveFolder,
    (event, rawFolderId: unknown, rawTarget: unknown): void => {
      assertTrusted(event)
      const folderId = assertId(rawFolderId, 'folderId')
      controller.moveFolder(folderId, assertMoveFolderInput(rawTarget))
    }
  )

  ipcMain.handle(IPC.moveTab, (event, rawTabId: unknown, rawTarget: unknown): void => {
    assertTrusted(event)
    const tabId = assertId(rawTabId, 'tabId')
    controller.moveTab(tabId, assertMoveTabInput(rawTarget))
  })
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SPACE_FIELD_PATTERN = /^[A-Za-z0-9_-]+$/
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const SPACE_PATCH_FIELDS: Record<string, true> = { name: true, icon: true, theme: true }
const FOLDER_PATCH_FIELDS: Record<string, true> = { name: true, collapsed: true }
const FOLDER_KINDS: Record<string, FolderKind> = { normal: 'normal', rss: 'rss' }
const MOVE_FOLDER_FIELDS: Record<string, true> = { parentId: true, beforeFolderId: true }
const MOVE_TAB_FIELDS: Record<string, true> = {
  spaceId: true,
  folderId: true,
  beforeTabId: true
}
const MAX_FOLDER_NAME_LENGTH = 64

function assertRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${field} must be a plain object`)
  }
  for (const key of Object.keys(value)) {
    if (RESERVED_OBJECT_KEYS.has(key)) {
      throw new TypeError(`${field} contains a reserved key`)
    }
  }
  return value as Record<string, unknown>
}

function readOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function assertSpaceName(value: unknown): string {
  const name = assertString(value, 'name', 64).trim()
  if (name.length === 0) throw new TypeError('name must not be empty')
  return name
}

function assertSpaceIcon(value: unknown): string {
  const icon = assertString(value, 'icon', 16).trim()
  if (icon.length === 0) throw new TypeError('icon must not be empty')
  return icon
}

function assertSpaceTheme(value: unknown): string {
  const theme = assertString(value, 'theme', 32).trim()
  if (!SPACE_FIELD_PATTERN.test(theme)) {
    throw new TypeError('theme must match /^[A-Za-z0-9_-]+$/')
  }
  return theme
}

function assertPartitionId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const partitionId = assertString(value, 'partitionId', 64)
  if (partitionId === '') return undefined
  if (!SPACE_FIELD_PATTERN.test(partitionId)) {
    throw new TypeError('partitionId must match /^[A-Za-z0-9_-]+$/')
  }
  return partitionId
}

function assertCreateSpaceInput(value: unknown): CreateSpaceInput {
  const record = assertRecord(value, 'input')
  const input: CreateSpaceInput = {
    name: assertSpaceName(readOwn(record, 'name')),
    icon: assertSpaceIcon(readOwn(record, 'icon')),
    theme: assertSpaceTheme(readOwn(record, 'theme'))
  }
  const partitionId = assertPartitionId(readOwn(record, 'partitionId'))
  if (partitionId !== undefined) input.partitionId = partitionId
  return input
}

function assertUpdateSpaceInput(value: unknown): UpdateSpaceInput {
  const record = assertRecord(value, 'patch')
  for (const key of Object.keys(record)) {
    if (SPACE_PATCH_FIELDS[key] !== true) {
      throw new TypeError(`patch contains an unsupported field: ${key}`)
    }
  }

  const patch: UpdateSpaceInput = {}
  if (readOwn(record, 'name') !== undefined) patch.name = assertSpaceName(readOwn(record, 'name'))
  if (readOwn(record, 'icon') !== undefined) patch.icon = assertSpaceIcon(readOwn(record, 'icon'))
  if (readOwn(record, 'theme') !== undefined)
    patch.theme = assertSpaceTheme(readOwn(record, 'theme'))

  if (Object.keys(patch).length === 0) {
    throw new TypeError('patch must contain at least one valid field')
  }
  return patch
}

function assertCreateEssentialInput(value: unknown): CreateEssentialInput {
  const record = assertRecord(value, 'input')
  const url = assertString(readOwn(record, 'url'), 'url', 8192)
  const rawTitle = readOwn(record, 'title')
  if (rawTitle === undefined) return { url }
  return { url, title: assertString(rawTitle, 'title', 256) }
}

function assertId(value: unknown, field: string): string {
  const id = assertString(value, field, 128)
  if (!ID_PATTERN.test(id) || RESERVED_OBJECT_KEYS.has(id)) {
    throw new TypeError(`${field} is not a valid id`)
  }
  return id
}

function assertString(value: unknown, field: string, maxLength = 8192): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  if (value.length > maxLength) throw new RangeError(`${field} is too long`)
  return value
}

function assertNullableId(value: unknown, field: string): string | null {
  if (value === null) return null
  return assertId(value, field)
}

function assertFolderName(value: unknown): string {
  const name = assertString(value, 'name', MAX_FOLDER_NAME_LENGTH).trim()
  if (name.length === 0) throw new TypeError('name must not be empty')
  return name
}

function assertFolderKind(value: unknown): FolderKind | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError("kind must be 'normal' or 'rss'")
  const kind = FOLDER_KINDS[value]
  if (kind === undefined) throw new TypeError("kind must be 'normal' or 'rss'")
  return kind
}

function assertCreateFolderInput(value: unknown): CreateFolderInput {
  const record = assertRecord(value, 'input')
  const input: CreateFolderInput = {
    spaceId: assertId(readOwn(record, 'spaceId'), 'spaceId'),
    name: assertFolderName(readOwn(record, 'name'))
  }
  const rawParentId = readOwn(record, 'parentId')
  if (rawParentId !== undefined) {
    input.parentId = assertNullableId(rawParentId, 'parentId')
  }
  const kind = assertFolderKind(readOwn(record, 'kind'))
  if (kind !== undefined) input.kind = kind
  return input
}

function assertUpdateFolderInput(value: unknown): UpdateFolderInput {
  const record = assertRecord(value, 'patch')
  for (const key of Object.keys(record)) {
    if (FOLDER_PATCH_FIELDS[key] !== true) {
      throw new TypeError(`patch contains an unsupported field: ${key}`)
    }
  }

  const patch: UpdateFolderInput = {}
  if (readOwn(record, 'name') !== undefined) {
    patch.name = assertFolderName(readOwn(record, 'name'))
  }
  if (readOwn(record, 'collapsed') !== undefined) {
    const collapsed = readOwn(record, 'collapsed')
    if (typeof collapsed !== 'boolean') {
      throw new TypeError('collapsed must be a boolean')
    }
    patch.collapsed = collapsed
  }

  if (Object.keys(patch).length === 0) {
    throw new TypeError('patch must contain at least one valid field')
  }
  return patch
}

function assertMoveFolderInput(value: unknown): MoveFolderInput {
  const record = assertRecord(value, 'target')
  for (const key of Object.keys(record)) {
    if (MOVE_FOLDER_FIELDS[key] !== true) {
      throw new TypeError(`target contains an unsupported field: ${key}`)
    }
  }

  const rawParentId = readOwn(record, 'parentId')
  if (rawParentId === undefined) throw new TypeError('parentId is required')
  const target: MoveFolderInput = {
    parentId: assertNullableId(rawParentId, 'parentId')
  }
  const rawBeforeFolderId = readOwn(record, 'beforeFolderId')
  if (rawBeforeFolderId !== undefined) {
    target.beforeFolderId = assertNullableId(rawBeforeFolderId, 'beforeFolderId')
  }
  return target
}

function assertMoveTabInput(value: unknown): MoveTabInput {
  const record = assertRecord(value, 'target')
  for (const key of Object.keys(record)) {
    if (MOVE_TAB_FIELDS[key] !== true) {
      throw new TypeError(`target contains an unsupported field: ${key}`)
    }
  }

  const rawFolderId = readOwn(record, 'folderId')
  if (rawFolderId === undefined) throw new TypeError('folderId is required')
  const target: MoveTabInput = {
    spaceId: assertId(readOwn(record, 'spaceId'), 'spaceId'),
    folderId: assertNullableId(rawFolderId, 'folderId')
  }
  const rawBeforeTabId = readOwn(record, 'beforeTabId')
  if (rawBeforeTabId !== undefined) {
    target.beforeTabId = assertNullableId(rawBeforeTabId, 'beforeTabId')
  }
  return target
}
