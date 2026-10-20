import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { BrowserSnapshot, Tab } from '@ione/core'
import { IPC, type NavigateResult } from '../shared/ipc'
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
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

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
