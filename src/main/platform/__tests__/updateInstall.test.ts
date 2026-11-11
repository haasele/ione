import { describe, expect, it } from 'vitest'
import {
  appImageSwapPlan,
  detectInstallKind,
  installByHandover,
  macAppBundleOf,
  macSwapScript,
  relaunchArgs,
  shellQuote,
  type HandoverInstallSteps,
  type InstallProbe,
  type InstallProbeFs
} from '../updateInstall'

/*
 * The install-kind decision and the swap plans behind an in-place update (Settings › Updates ›
 * Restart to update), every OS branch on this one: the file system and the process are seams,
 * so a Windows NSIS install, a translocated macOS bundle or an AppImage in a read-only folder
 * are each a few lines here.
 */

function memoryFs(spec: {
  files?: Record<string, string>
  dirs?: Record<string, string[]>
  writable?: string[]
}): InstallProbeFs {
  const files = spec.files ?? {}
  const dirs = spec.dirs ?? {}
  const writable = new Set(spec.writable ?? [])
  return {
    exists: (p) => p in files || p in dirs,
    readdir: (p) => dirs[p] ?? [],
    readFile: (p) => files[p] ?? '',
    writable: (p) => writable.has(p)
  }
}

function probe(over: Partial<InstallProbe>): InstallProbe {
  return {
    platform: 'linux',
    isPackaged: true,
    execPath: '/opt/Ione/ione',
    resourcesPath: '/opt/Ione/resources',
    env: {},
    macSigned: false,
    fs: memoryFs({}),
    ...over
  }
}

describe('detectInstallKind', () => {
  it('is dev for anything not packaged, on every OS', () => {
    for (const platform of ['win32', 'darwin', 'linux'])
      expect(detectInstallKind(probe({ platform, isPackaged: false }))).toBe('dev')
  })

  describe('Windows', () => {
    const exe = 'C:\\Users\\u\\AppData\\Local\\Programs\\Ione\\Ione.exe'
    const resources = 'C:\\Users\\u\\AppData\\Local\\Programs\\Ione\\resources'
    it('is nsis with the installer’s uninstaller and update config next to it', () => {
      const fs = memoryFs({
        files: { [`${resources}\\app-update.yml`]: 'provider: generic' },
        dirs: {
          'C:\\Users\\u\\AppData\\Local\\Programs\\Ione': ['Ione.exe', 'Uninstall Ione.exe']
        }
      })
      expect(
        detectInstallKind(probe({ platform: 'win32', execPath: exe, resourcesPath: resources, fs }))
      ).toBe('nsis')
    })
    it('is portable from the portable launcher, unpacked without an uninstaller or config', () => {
      const fs = memoryFs({
        files: { [`${resources}\\app-update.yml`]: 'provider: generic' },
        dirs: {
          'C:\\Users\\u\\AppData\\Local\\Programs\\Ione': ['Ione.exe', 'Uninstall Ione.exe']
        }
      })
      expect(
        detectInstallKind(
          probe({
            platform: 'win32',
            execPath: exe,
            resourcesPath: resources,
            env: { PORTABLE_EXECUTABLE_DIR: 'D:\\apps' },
            fs
          })
        )
      ).toBe('portable')
      const noUninstaller = memoryFs({
        files: { [`${resources}\\app-update.yml`]: 'provider: generic' },
        dirs: { 'C:\\Users\\u\\AppData\\Local\\Programs\\Ione': ['Ione.exe'] }
      })
      expect(
        detectInstallKind(
          probe({ platform: 'win32', execPath: exe, resourcesPath: resources, fs: noUninstaller })
        )
      ).toBe('unpacked')
      const noConfig = memoryFs({
        dirs: {
          'C:\\Users\\u\\AppData\\Local\\Programs\\Ione': ['Ione.exe', 'Uninstall Ione.exe']
        }
      })
      expect(
        detectInstallKind(
          probe({ platform: 'win32', execPath: exe, resourcesPath: resources, fs: noConfig })
        )
      ).toBe('unpacked')
    })
  })

  describe('macOS', () => {
    const exe = '/Applications/Ione.app/Contents/MacOS/Ione'
    const resources = '/Applications/Ione.app/Contents/Resources'
    it('is mac-adhoc for a bundle the user can rename within its folder', () => {
      const fs = memoryFs({ writable: ['/Applications/Ione.app', '/Applications'] })
      expect(
        detectInstallKind(
          probe({ platform: 'darwin', execPath: exe, resourcesPath: resources, fs })
        )
      ).toBe('mac-adhoc')
    })
    it('is mac-unsigned when translocated, on a read-only volume or in a folder it cannot write', () => {
      const writableBoth = memoryFs({ writable: ['/Applications/Ione.app', '/Applications'] })
      expect(
        detectInstallKind(
          probe({
            platform: 'darwin',
            execPath:
              '/private/var/folders/x/AppTranslocation/ABCD/d/Ione.app/Contents/MacOS/Ione',
            resourcesPath:
              '/private/var/folders/x/AppTranslocation/ABCD/d/Ione.app/Contents/Resources',
            fs: writableBoth
          })
        )
      ).toBe('mac-unsigned')
      const dmg = memoryFs({})
      expect(
        detectInstallKind(
          probe({
            platform: 'darwin',
            execPath: '/Volumes/Ione 0.5.70-arm64/Ione.app/Contents/MacOS/Ione',
            resourcesPath: '/Volumes/Ione 0.5.70-arm64/Ione.app/Contents/Resources',
            fs: dmg
          })
        )
      ).toBe('mac-unsigned')
      const bundleOnly = memoryFs({ writable: ['/Applications/Ione.app'] })
      expect(
        detectInstallKind(
          probe({ platform: 'darwin', execPath: exe, resourcesPath: resources, fs: bundleOnly })
        )
      ).toBe('mac-unsigned')
    })
    it('is mac-signed only for a Developer ID build with the update config', () => {
      const fs = memoryFs({
        files: { [`${resources}/app-update.yml`]: 'provider: generic' },
        writable: ['/Applications/Ione.app', '/Applications']
      })
      expect(
        detectInstallKind(
          probe({
            platform: 'darwin',
            execPath: exe,
            resourcesPath: resources,
            macSigned: true,
            fs
          })
        )
      ).toBe('mac-signed')
      // Signed, but no config shipped: the swap is still ours.
      expect(
        detectInstallKind(
          probe({
            platform: 'darwin',
            execPath: exe,
            resourcesPath: resources,
            macSigned: true,
            fs: memoryFs({ writable: ['/Applications/Ione.app', '/Applications'] })
          })
        )
      ).toBe('mac-adhoc')
    })
  })

  describe('Linux', () => {
    it('is appimage for a writable AppImage in a writable folder, unpacked otherwise', () => {
      const image = '/home/u/Applications/ione-0.5.70-x86_64.AppImage'
      const env = { APPIMAGE: image }
      expect(
        detectInstallKind(
          probe({ env, fs: memoryFs({ writable: [image, '/home/u/Applications'] }) })
        )
      ).toBe('appimage')
      expect(detectInstallKind(probe({ env, fs: memoryFs({ writable: [image] }) }))).toBe(
        'unpacked'
      )
      expect(
        detectInstallKind(probe({ env, fs: memoryFs({ writable: ['/home/u/Applications'] }) }))
      ).toBe('unpacked')
      expect(
        detectInstallKind(
          probe({
            env: { APPIMAGE: 'relative.AppImage' },
            fs: memoryFs({ writable: ['relative.AppImage', '.'] })
          })
        )
      ).toBe('unpacked')
    })
    it('is deb from the package-type marker with the update config, unpacked without', () => {
      const withBoth = memoryFs({
        files: {
          '/opt/Ione/resources/package-type': 'deb\n',
          '/opt/Ione/resources/app-update.yml': 'provider: generic'
        }
      })
      expect(detectInstallKind(probe({ fs: withBoth }))).toBe('deb')
      const rpm = memoryFs({
        files: {
          '/opt/Ione/resources/package-type': 'rpm',
          '/opt/Ione/resources/app-update.yml': 'provider: generic'
        }
      })
      expect(detectInstallKind(probe({ fs: rpm }))).toBe('unpacked')
      const noConfig = memoryFs({ files: { '/opt/Ione/resources/package-type': 'deb' } })
      expect(detectInstallKind(probe({ fs: noConfig }))).toBe('unpacked')
      expect(detectInstallKind(probe({}))).toBe('unpacked')
    })
  })
})

describe('installByHandover (NSIS, Squirrel.Mac)', () => {
  function steps(options: { present?: boolean; start?: () => Promise<void> } = {}): {
    calls: string[]
    logged: string[]
    steps: HandoverInstallSteps
  } {
    const calls: string[] = []
    const logged: string[] = []
    return {
      calls,
      logged,
      steps: {
        installerPresent: () => {
          calls.push('present?')
          return options.present ?? true
        },
        resetOneShot: () => {
          calls.push('reset')
        },
        quit: async () => {
          calls.push('quit')
        },
        runInstaller: async () => {
          calls.push('start')
          await (options.start ?? (async () => undefined))()
        },
        endProcess: async () => {
          calls.push('end')
        },
        log: (message: string) => {
          logged.push(message)
        }
      }
    }
  }

  it('checks the installer and clears the one-shot flag before the quit, then starts it and ends', async () => {
    const s = steps()
    await installByHandover(s.steps)
    expect(s.calls).toEqual(['present?', 'reset', 'quit', 'start', 'end'])
    expect(s.logged).toEqual([])
  })

  it('refuses before the quit when the installer is gone – nothing shut down, the error reaches the user', async () => {
    const s = steps({ present: false })
    await expect(installByHandover(s.steps)).rejects.toThrow('the downloaded installer is gone')
    expect(s.calls).toEqual(['present?'])
  })

  it('ends the process all the same when the installer fails to start after the quit', async () => {
    const s = steps({
      start: async () => {
        throw new Error('spawn EACCES')
      }
    })
    await installByHandover(s.steps)
    expect(s.calls).toEqual(['present?', 'reset', 'quit', 'start', 'end'])
    expect(s.logged).toEqual(['the installer did not start after the quit: spawn EACCES'])
  })
})

describe('macAppBundleOf', () => {
  it('finds the .app an executable runs from', () => {
    expect(macAppBundleOf('/Applications/Ione.app/Contents/MacOS/Ione')).toBe(
      '/Applications/Ione.app'
    )
    expect(
      macAppBundleOf(
        '/Applications/Ione.app/Contents/Frameworks/Ione Helper.app/Contents/MacOS/Ione Helper'
      )
    ).toBe('/Applications/Ione.app/Contents/Frameworks/Ione Helper.app')
    expect(macAppBundleOf('/opt/Ione/ione')).toBeNull()
  })
})

describe('appImageSwapPlan', () => {
  it('keeps a renamed AppImage’s name and path', () => {
    expect(
      appImageSwapPlan(
        '/home/u/Apps/Ione.AppImage',
        '/home/u/.cache/pending/ione-0.5.81-x86_64.AppImage'
      )
    ).toEqual({
      destination: '/home/u/Apps/Ione.AppImage',
      staging: '/home/u/Apps/Ione.AppImage.ione-update',
      removeOld: false
    })
  })
  it('puts a versioned download next to a versioned file and removes the old one', () => {
    expect(
      appImageSwapPlan(
        '/home/u/Apps/ione-0.5.70-x86_64.AppImage',
        '/home/u/.cache/pending/ione-0.5.81-x86_64.AppImage'
      )
    ).toEqual({
      destination: '/home/u/Apps/ione-0.5.81-x86_64.AppImage',
      staging: '/home/u/Apps/ione-0.5.81-x86_64.AppImage.ione-update',
      removeOld: true
    })
  })
  it('overwrites in place when the names already match', () => {
    const plan = appImageSwapPlan(
      '/home/u/Apps/ione-0.5.81-x86_64.AppImage',
      '/tmp/ione-0.5.81-x86_64.AppImage'
    )
    expect(plan.destination).toBe('/home/u/Apps/ione-0.5.81-x86_64.AppImage')
    expect(plan.removeOld).toBe(false)
  })
})

describe('relaunchArgs', () => {
  it('passes the app’s own switches on and drops a harness’s debugging ones', () => {
    expect(
      relaunchArgs([
        '/opt/Ione/ione',
        '--inspect=0',
        '--remote-debugging-port=0',
        '--remote-debugging-pipe',
        '--inspect-brk',
        '--no-sandbox',
        '--user-data-dir=/tmp/p',
        'https://example.com'
      ])
    ).toEqual(['--no-sandbox', '--user-data-dir=/tmp/p', 'https://example.com'])
    expect(relaunchArgs(['/opt/Ione/ione'])).toEqual([])
  })
})

describe('macSwapScript', () => {
  const script = macSwapScript({
    pid: 4242,
    appPath: "/Applications/Zen's Ione.app",
    stagedAppPath: '/Users/u/Library/Caches/ione-updater/swap/staged/Ione.app',
    logPath: '/Users/u/Library/Caches/ione-updater/swap/swap.log',
    relaunchArgs: ['--no-sandbox', 'https://example.com/?a=1&b=2'],
    waitSeconds: 10
  })
  it('waits for the process, swaps with a rollback, clears quarantine and opens the new app', () => {
    const lines = script.split('\n')
    expect(lines[0]).toBe('#!/bin/sh')
    expect(script).toContain('PID=4242')
    expect(script).toContain(`APP='/Applications/Zen'\\''s Ione.app'`)
    expect(script).toContain('while kill -0 "$PID"')
    expect(script).toContain('-ge 50')
    expect(script.indexOf('mv "$APP" "$OLD"')).toBeLessThan(script.indexOf('mv "$NEW" "$APP"'))
    expect(script).toContain('restoring"; mv "$OLD" "$APP"; exit 1')
    expect(script).toContain('xattr -dr com.apple.quarantine "$APP"')
    expect(lines.at(-2)).toBe(
      `open -n '/Applications/Zen'\\''s Ione.app' --args '--no-sandbox' 'https://example.com/?a=1&b=2'`
    )
  })
  it('opens without --args when there are none', () => {
    const bare = macSwapScript({
      pid: 1,
      appPath: '/Applications/Ione.app',
      stagedAppPath: '/tmp/s/Ione.app',
      logPath: '/tmp/s/swap.log',
      relaunchArgs: []
    })
    expect(bare.split('\n').at(-2)).toBe(`open -n '/Applications/Ione.app'`)
    expect(bare).toContain('-ge 450')
  })
})

describe('shellQuote', () => {
  it('makes one word of anything', () => {
    expect(shellQuote('plain')).toBe(`'plain'`)
    expect(shellQuote(`it's "x" $HOME`)).toBe(`'it'\\''s "x" $HOME'`)
  })
})
