import { describe, expect, it } from 'vitest'
import {
  APP_ICON_DEFAULT,
  APP_ICON_FILL_LIGHTNESS,
  APP_ICON_PRIVATE,
  APP_ICON_VARIANTS,
  accentFill,
  appIconVariant,
  oklchToRgb,
  parseHex,
  rgbToOklch,
  sanitizeAppIcon
} from '../appIcon'
import { PRIVATE_THEME } from '../theme'

describe('app icon treatments', () => {
  it('ships the brand’s three treatments, the default first', () => {
    expect(APP_ICON_VARIANTS.map((v) => v.id)).toEqual(['black', 'white', 'transp'])
    expect(APP_ICON_VARIANTS[0].id).toBe(APP_ICON_DEFAULT)
    expect(APP_ICON_VARIANTS.map((v) => v.name)).toEqual(['Black', 'White', 'Transparent'])
    expect(APP_ICON_VARIANTS.map((v) => v.ground)).toEqual(['#000000', '#ffffff', null])
  })

  it('takes a known id and falls back for an old palette or junk', () => {
    expect(sanitizeAppIcon('white')).toBe('white')
    expect(sanitizeAppIcon('transp')).toBe('transp')
    for (const old of ['indigo', 'purple', 'ocean', 'forest', 'sunset', 'rose', 'slate', 'graphite'])
      expect(sanitizeAppIcon(old)).toBe(APP_ICON_DEFAULT)
    expect(sanitizeAppIcon('magenta')).toBe(APP_ICON_DEFAULT)
    expect(sanitizeAppIcon(undefined)).toBe(APP_ICON_DEFAULT)
    expect(sanitizeAppIcon(3)).toBe(APP_ICON_DEFAULT)
    expect(appIconVariant('white').name).toBe('White')
    expect(appIconVariant(null).id).toBe(APP_ICON_DEFAULT)
  })

  it('keeps the private icon on the private theme’s purple through the accent-fill rule', () => {
    const primary = PRIVATE_THEME.colors.find((c) => c.isPrimary) ?? PRIVATE_THEME.colors[0]
    expect(parseHex(APP_ICON_PRIVATE.accent)).toEqual(primary.c)
    expect(APP_ICON_PRIVATE.fill).toBe(accentFill(APP_ICON_PRIVATE.accent))
  })

  it('clamps out-of-band accents and passes in-band ones through', () => {
    expect(accentFill('#6264dc')).toBe('#6264dc')
    const [min, max] = APP_ICON_FILL_LIGHTNESS
    expect(rgbToOklch(parseHex(accentFill('#ffffff')))[0]).toBeCloseTo(max, 2)
    expect(rgbToOklch(parseHex(accentFill('#000000')))[0]).toBeCloseTo(min, 2)
    expect(() => accentFill('blue')).toThrow()
  })

  it('round-trips colours through OKLCH', () => {
    for (const hex of ['#6264dc', '#ff7a59', '#3b3c44', '#4caf50']) {
      const rgb = parseHex(hex)
      const back = oklchToRgb(rgbToOklch(rgb))
      back.forEach((v, i) => expect(Math.abs(v - rgb[i])).toBeLessThan(1))
    }
  })
})
