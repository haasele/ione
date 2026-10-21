import { randomUUID } from 'node:crypto'
import type { PermissionRequestInfo } from '../shared/ipc'

interface PendingPermission {
  info: PermissionRequestInfo
  resolve: (allow: boolean) => void
  timer: NodeJS.Timeout
}

const TIMEOUT_MS = 30_000

/**
 * Bridges session permission requests to a chrome-view prompt. Denies by
 * default when no prompt can be shown or the user does not answer.
 */
export class PermissionRequestService {
  private readonly send: (request: PermissionRequestInfo) => void
  private readonly pending = new Map<string, PendingPermission>()

  constructor(send: (request: PermissionRequestInfo) => void) {
    this.send = send
  }

  request(permission: string, origin: string, tabId: string | null): Promise<boolean> {
    if (this.pending.size > 0) return Promise.resolve(false)
    const id = randomUUID()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.finish(id, false), TIMEOUT_MS)
      timer.unref()
      const info: PermissionRequestInfo = { id, permission, origin, tabId }
      this.pending.set(id, { info, resolve, timer })
      try {
        this.send(info)
      } catch {
        this.finish(id, false)
      }
    })
  }

  respond(id: string, allow: boolean): void {
    this.finish(id, allow)
  }

  dispose(): void {
    for (const id of [...this.pending.keys()]) this.finish(id, false)
  }

  private finish(id: string, allow: boolean): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    pending.resolve(allow)
  }
}
