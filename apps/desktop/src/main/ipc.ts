import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { BrowserSnapshot, Essential, Space, Tab } from '@ione/core'
import {
  IPC,
  type CreateEssentialInput,
  type CreateSpaceInput,
  type NavigateResult,
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
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SPACE_FIELD_PATTERN = /^[A-Za-z0-9_-]+$/
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const SPACE_PATCH_FIELDS: Record<string, true> = { name: true, icon: true, theme: true }

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
