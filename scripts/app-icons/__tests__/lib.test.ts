import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  APP_ICON_DEFAULT,
  APP_ICON_PRIVATE,
  APP_ICON_VARIANTS,
  parseHex
} from '../../../src/shared/appIcon'
import { rasteriseSvg } from '../brand'
import {
  ANDROID_MANIFEST,
  ANDROID_RES,
  ANDROID_SHORTCUTS_META,
  DESKTOP_PNG_SIZE,
  DOCK_PNG_SIZE,
  ICNS_TYPES,
  ICO_SIZES,
  KOTLIN_VARIANTS,
  MANIFEST_BEGIN,
  MANIFEST_END,
  RUNTIME_ICON_DIR,
  decodePng,
  encodeIcns,
  encodeIco,
  encodePng,
  icnsTypes,
  icoSizes,
  manifestWithAliases,
  planAppIcons,
  renderAndroidForeground,
  renderIcon,
  renderPrivateIcon,
  type BrandAssets,
  type OutputFile
} from '../lib'

const root = resolve(__dirname, '../../..')
const repoManifest = readFileSync(join(root, ANDROID_MANIFEST), 'utf8')
const brand: BrandAssets = {
  mark: await rasteriseSvg(readFileSync(join(root, 'logo/ione-transp.svg')))
}
const plan = planAppIcons({ manifest: repoManifest, brand })
const byPath = new Map(plan.map((f) => [f.path, f]))

function file(path: string): OutputFile {
  const f = byPath.get(path)
  if (!f) throw new Error(`not planned: ${path}`)
  return f
}
const bytes = (path: string): Uint8Array => file(path).data as Uint8Array
const text = (path: string): string => file(path).data as string

/** RGBA of the pixel at (x, y) of a square image. */
function pixel(rgba: Uint8Array, size: number, x: number, y: number): number[] {
  const o = (y * size + x) * 4
  return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]
}

function icoImages(ico: Uint8Array): Uint8Array[] {
  const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength)
  const count = view.getUint16(4, true)
  const images: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(6 + i * 16 + 8, true)
    const offset = view.getUint32(6 + i * 16 + 12, true)
    images.push(ico.subarray(offset, offset + size))
  }
  return images
}

function icnsImages(icns: Uint8Array): Uint8Array[] {
  const view = new DataView(icns.buffer, icns.byteOffset, icns.byteLength)
  const images: Uint8Array[] = []
  let offset = 8
  while (offset < icns.length) {
    const length = view.getUint32(offset + 4)
    images.push(icns.subarray(offset + 8, offset + length))
    offset += length
  }
  return images
}

describe('renderIcon', () => {
  const size = 128
  const c = size / 2

  it('draws each treatment on its ground and cuts the squircle', () => {
    const black = renderIcon(APP_ICON_VARIANTS[0], size, brand)
    const white = renderIcon(APP_ICON_VARIANTS[1], size, brand)
    const transp = renderIcon(APP_ICON_VARIANTS[2], size, brand)
    // The source’s centre is the radar’s open core: the black/white grounds show through.
    expect(pixel(black, size, c, c)).toEqual([0, 0, 0, 255])
    expect(pixel(white, size, c, c)).toEqual([255, 255, 255, 255])
    expect(pixel(transp, size, c, c)[3]).toBe(0)
    // Mid-edge is opaque ground; the corner is cut by the squircle (the mark alone is clear).
    expect(pixel(black, size, c, 0)[3]).toBe(255)
    expect(pixel(black, size, 0, 0)[3]).toBe(0)
    expect(pixel(white, size, 0, 0)[3]).toBe(0)
    expect(pixel(transp, size, 0, 0)[3]).toBe(0)
  })

  it('is deterministic and renders any requested size', () => {
    expect(Buffer.from(renderIcon(APP_ICON_VARIANTS[0], 64, brand)).equals(Buffer.from(renderIcon(APP_ICON_VARIANTS[0], 64, brand)))).toBe(true)
    for (const size of [16, 24, 512]) {
      const rgba = renderIcon(APP_ICON_VARIANTS[1], size, brand)
      expect(rgba).toHaveLength(size * size * 4)
    }
  })

  it('leaves the macOS grid margin transparent when asked', () => {
    const mac = renderIcon(APP_ICON_VARIANTS[0], size, brand, { macInset: true })
    expect(pixel(mac, size, c, 2)[3]).toBe(0)
    expect(pixel(mac, size, c, c)).toEqual([0, 0, 0, 255])
  })
})

describe('renderAndroidForeground', () => {
  it('centres the transparent mark in a clear 108 dp canvas', () => {
    const rgba = renderAndroidForeground(108, brand)
    expect(pixel(rgba, 108, 54, 54)[3]).toBe(0)
    expect(pixel(rgba, 108, 2, 2)[3]).toBe(0)
    let ink = 0
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) ink++
    expect(ink).toBeGreaterThan(0)
  })
})

describe('renderPrivateIcon', () => {
  const size = 128
  const rgba = renderPrivateIcon(size)
  const fill = parseHex(APP_ICON_PRIVATE.fill)
  const c = size / 2

  it('sits on the private theme’s purple and cuts the squircle', () => {
    expect(pixel(rgba, size, c, 4)).toEqual([...fill, 255])
    expect(pixel(rgba, size, 0, 0)[3]).toBe(0)
  })

  it('honours the macOS inset', () => {
    const mac = renderPrivateIcon(size, { macInset: true })
    expect(pixel(mac, size, c, 2)[3]).toBe(0)
    expect(pixel(rgba, size, c, 2)[3]).toBe(255)
  })
})

describe('containers', () => {
  it('PNG round-trips through the decoder', () => {
    const rgba = renderIcon(APP_ICON_VARIANTS[0], 24, brand)
    const decoded = decodePng(encodePng(rgba, 24))
    expect(decoded.width).toBe(24)
    expect(decoded.height).toBe(24)
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(rgba))).toBe(true)
  })

  it('ICO lists every size and carries the PNGs verbatim', () => {
    const images = [16, 32, 256].map((size) => ({
      size,
      png: encodePng(renderIcon(APP_ICON_VARIANTS[1], size, brand), size)
    }))
    const ico = encodeIco(images)
    expect(icoSizes(ico)).toEqual([16, 32, 256])
    expect(icoImages(ico).map((i) => Buffer.from(i))).toEqual(images.map((i) => Buffer.from(i.png)))
  })

  it('ICNS lists its entry types in order', () => {
    const entries = ICNS_TYPES.slice(0, 3).map((e) => ({
      type: e.type,
      png: encodePng(renderIcon(APP_ICON_VARIANTS[2], e.size, brand), e.size)
    }))
    expect(icnsTypes(encodeIcns(entries))).toEqual(['icp4', 'icp5', 'icp6'])
  })
})

describe('planAppIcons', () => {
  it('produces the runtime set of every variant, all sizes present', () => {
    for (const v of APP_ICON_VARIANTS) {
      const dir = `${RUNTIME_ICON_DIR}/${v.id}`
      const icon = decodePng(bytes(`${dir}/icon.png`))
      expect([icon.width, icon.height]).toEqual([DESKTOP_PNG_SIZE, DESKTOP_PNG_SIZE])
      const dock = decodePng(bytes(`${dir}/dock.png`))
      expect([dock.width, dock.height]).toEqual([DOCK_PNG_SIZE, DOCK_PNG_SIZE])
      expect(pixel(dock.rgba, DOCK_PNG_SIZE, DOCK_PNG_SIZE / 2, 10)[3]).toBe(0)
      expect(icoSizes(bytes(`${dir}/icon.ico`))).toEqual([...ICO_SIZES])
      for (const [i, png] of icoImages(bytes(`${dir}/icon.ico`)).entries()) {
        expect(decodePng(png).width).toBe(ICO_SIZES[i])
      }
    }
  })

  it('produces the private windows’ icon: the PNG and the ICO, no Dock image', () => {
    const dir = `${RUNTIME_ICON_DIR}/${APP_ICON_PRIVATE.folder}`
    const icon = decodePng(bytes(`${dir}/icon.png`))
    expect([icon.width, icon.height]).toEqual([DESKTOP_PNG_SIZE, DESKTOP_PNG_SIZE])
    expect(pixel(icon.rgba, DESKTOP_PNG_SIZE, DESKTOP_PNG_SIZE / 2, 4)).toEqual([
      ...parseHex(APP_ICON_PRIVATE.fill),
      255
    ])
    expect(icoSizes(bytes(`${dir}/icon.ico`))).toEqual([...ICO_SIZES])
    expect(byPath.has(`${dir}/dock.png`)).toBe(false)
  })

  it('writes electron-builder the default variant in every format', () => {
    expect(icoSizes(bytes('build/icon.ico'))).toEqual([...ICO_SIZES])
    expect(icnsTypes(bytes('build/icon.icns'))).toEqual(ICNS_TYPES.map((e) => e.type))
    for (const [i, png] of icnsImages(bytes('build/icon.icns')).entries()) {
      expect(decodePng(png).width).toBe(ICNS_TYPES[i].size)
    }
    expect(Buffer.from(bytes('build/icon.png'))).toEqual(
      Buffer.from(bytes(`${RUNTIME_ICON_DIR}/${APP_ICON_DEFAULT}/icon.png`))
    )
  })

  it('gives Android one adaptive icon per variant and bitmap foregrounds per density', () => {
    const colors = text(`${ANDROID_RES}/values/ic_launcher_colors.xml`)
    for (const v of APP_ICON_VARIANTS) {
      const xml = text(`${ANDROID_RES}/mipmap-anydpi-v26/ic_launcher_${v.id}.xml`)
      expect(xml).toContain(`<background android:drawable="@color/ic_launcher_bg_${v.id}" />`)
      expect(xml).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground" />')
      expect(xml).toContain('<monochrome android:drawable="@mipmap/ic_launcher_foreground" />')
      expect(colors).toContain(
        `<color name="ic_launcher_bg_${v.id}">${(v.ground ?? '#00000000').toUpperCase()}</color>`
      )
    }
    expect(text(`${ANDROID_RES}/mipmap-anydpi-v26/ic_launcher.xml`)).toBe(
      text(`${ANDROID_RES}/mipmap-anydpi-v26/ic_launcher_${APP_ICON_DEFAULT}.xml`)
    )
    for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      const foreground = decodePng(bytes(`${ANDROID_RES}/mipmap-${density}/ic_launcher_foreground.png`))
      expect(foreground.width).toBe(foreground.height)
      expect(foreground.width).toBeGreaterThan(0)
    }
    expect(byPath.has(`${ANDROID_RES}/drawable/ic_launcher_foreground.xml`)).toBe(false)
  })

  it('regenerates the manifest aliases: one per variant, only the default enabled', () => {
    const manifest = text(ANDROID_MANIFEST)
    const begin = manifest.indexOf(MANIFEST_BEGIN)
    const end = manifest.indexOf(MANIFEST_END)
    expect(begin).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(begin)
    const block = manifest.slice(begin, end)
    expect(block.match(/<activity-alias/g)).toHaveLength(APP_ICON_VARIANTS.length)
    expect(block.match(/android:enabled="true"/g)).toHaveLength(1)
    for (const v of APP_ICON_VARIANTS) {
      expect(block).toContain(`android:icon="@mipmap/ic_launcher_${v.id}"`)
    }
    expect(block.split(ANDROID_SHORTCUTS_META)).toHaveLength(APP_ICON_VARIANTS.length + 1)
    expect(manifestWithAliases(manifest, APP_ICON_VARIANTS)).toBe(manifest)
    expect(() => manifestWithAliases('<manifest/>', APP_ICON_VARIANTS)).toThrow(/markers/)
  })

  it('emits the Kotlin alias table', () => {
    const kotlin = text(KOTLIN_VARIANTS)
    expect(kotlin).toContain(`const val DEFAULT = "${APP_ICON_DEFAULT}"`)
    for (const v of APP_ICON_VARIANTS) {
      const cls = `dev.haasele.ione.icon.${v.id[0].toUpperCase()}${v.id.slice(1)}`
      expect(kotlin).toContain(`"${v.id}" to "${cls}"`)
    }
  })

  it('matches the files committed to the repository (run `bun run icons` after editing the brand)', () => {
    const samePixels = (a: Uint8Array, b: Uint8Array): boolean => {
      const da = decodePng(a)
      const db = decodePng(b)
      return (
        da.width === db.width &&
        da.height === db.height &&
        Buffer.from(da.rgba).equals(Buffer.from(db.rgba))
      )
    }
    const allSame = (a: Uint8Array[], b: Uint8Array[]): boolean =>
      a.length === b.length && a.every((image, i) => samePixels(image, b[i]))
    for (const planned of plan) {
      const target = join(root, planned.path)
      expect(existsSync(target), `${planned.path} is missing`).toBe(true)
      const committed = readFileSync(target)
      if (typeof planned.data === 'string') {
        expect(committed.toString('utf8'), planned.path).toBe(planned.data)
      } else if (planned.path.endsWith('.png')) {
        expect(samePixels(committed, planned.data), planned.path).toBe(true)
      } else if (planned.path.endsWith('.ico')) {
        expect(icoSizes(committed), planned.path).toEqual(icoSizes(planned.data))
        expect(allSame(icoImages(committed), icoImages(planned.data)), planned.path).toBe(true)
      } else if (planned.path.endsWith('.icns')) {
        expect(icnsTypes(committed), planned.path).toEqual(icnsTypes(planned.data))
        expect(allSame(icnsImages(committed), icnsImages(planned.data)), planned.path).toBe(true)
      } else {
        expect(committed.equals(Buffer.from(planned.data)), planned.path).toBe(true)
      }
    }
  })
})
