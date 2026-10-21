import { session } from 'electron'

/**
 * Content tabs (and therefore extensions and the adblocker) live in this
 * persistent partition. The chrome UI stays on the default session so
 * extension preload scripts and webRequest handlers never touch trusted shell
 * code.
 */
export const BROWSER_SESSION_PARTITION = 'persist:browser'

export function browserSession(): Electron.Session {
  return session.fromPartition(BROWSER_SESSION_PARTITION)
}

export function hardenSession(target: Electron.Session): void {
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  target.setPermissionCheckHandler(() => false)
}
