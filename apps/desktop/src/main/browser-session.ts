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

export type PermissionHandler = (
  permission: string,
  origin: string,
  contents: Electron.WebContents
) => boolean | Promise<boolean>

export function hardenSession(
  target: Electron.Session,
  requestPermission?: PermissionHandler
): void {
  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = details.requestingUrl || contents.getURL()
    if (!requestPermission) {
      callback(false)
      return
    }
    void Promise.resolve(requestPermission(permission, origin, contents)).then(
      (allow) => callback(allow),
      () => callback(false)
    )
  })
  const promptable = new Set([
    'media',
    'geolocation',
    'notifications',
    'clipboard-read',
    'display-capture',
    'fullscreen',
    'midi',
    'pointerLock',
    'openExternal'
  ])
  target.setPermissionCheckHandler((_contents, permission) =>
    Boolean(requestPermission) && promptable.has(permission)
  )
}
