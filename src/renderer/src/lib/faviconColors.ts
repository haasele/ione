import { useEffect, useState } from 'react'

/**
 * The two colours an Essentials poster takes from its page's favicon (Zen's coloured tiles).
 *
 * The icon is drawn into a small canvas and its opaque pixels vote in coarse RGB buckets; the
 * most common saturated bucket and the most distinct runner-up become the gradient. Transparent,
 * near-white and near-black pixels do not vote, so a logo's mark beats its background. A favicon
 * the canvas cannot read (a cross-origin live icon, an SVG the engine will not draw) is simply
 * no gradient; the tile then keeps the window fill. Results are cached per icon address.
 */

export interface FaviconGradient {
  /** CSS `linear-gradient(...)` for the tile. */
  gradient: string
  /** The two source colours, for tests and future tuning. */
  from: string
  to: string
}

const CACHE = new Map<string, Promise<FaviconGradient | null>>()
/** The sample canvas' side: enough pixels to find a logo's colours, cheap enough to run per tile. */
const SAMPLE = 24

/** Extract the gradient for `src`, or null when the icon has no usable colour. Cached. */
export function faviconGradient(src: string | null | undefined): Promise<FaviconGradient | null> {
  if (!src) return Promise.resolve(null)
  const cached = CACHE.get(src)
  if (cached) return cached
  const pending = readGradient(src).catch(() => null)
  CACHE.set(src, pending)
  return pending
}

function readGradient(src: string): Promise<FaviconGradient | null> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // Cached favicons are served with an open CORS header (`main/platform/protocol.ts`); a live
    // site icon may still refuse, and then the canvas is tainted — the read below rejects.
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => {
      try {
        resolve(paletteOf(image))
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = () => reject(new Error('favicon did not load'))
    image.src = src
  })
}

function paletteOf(image: HTMLImageElement): FaviconGradient | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE
  canvas.height = SAMPLE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.clearRect(0, 0, SAMPLE, SAMPLE)
  context.drawImage(image, 0, 0, SAMPLE, SAMPLE)
  const data = context.getImageData(0, 0, SAMPLE, SAMPLE).data
  const buckets = new Map<string, { r: number; g: number; b: number; n: number; sat: number }>()
  let greyR = 0
  let greyG = 0
  let greyB = 0
  let greyN = 0
  for (let at = 0; at < data.length; at += 4) {
    const a = data[at + 3]
    if (a < 160) continue
    const r = data[at]
    const g = data[at + 1]
    const b = data[at + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const light = (max + min) / 510
    const sat = max === 0 ? 0 : (max - min) / max
    if (light < 0.08 || light > 0.92) continue
    if (sat < 0.16) {
      greyR += r
      greyG += g
      greyB += b
      greyN++
      continue
    }
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, sat: 0 }
    bucket.r += r
    bucket.g += g
    bucket.b += b
    bucket.n++
    bucket.sat = Math.max(bucket.sat, sat)
    buckets.set(key, bucket)
  }
  if (buckets.size === 0) {
    if (greyN === 0) return null
    const grey = { r: Math.round(greyR / greyN), g: Math.round(greyG / greyN), b: Math.round(greyB / greyN) }
    return {
      from: hex(grey),
      to: hex(shade(grey, 0.72)),
      gradient: `linear-gradient(135deg, ${rgba(grey, 0.9)} 0%, ${rgba(shade(grey, 0.72), 0.82)} 100%)`
    }
  }
  const ranked = [...buckets.values()]
    .map((bucket) => ({
      r: Math.round(bucket.r / bucket.n),
      g: Math.round(bucket.g / bucket.n),
      b: Math.round(bucket.b / bucket.n),
      weight: bucket.n * (0.35 + bucket.sat)
    }))
    .sort((a, b) => b.weight - a.weight)
  const first = ranked[0]
  // A one-colour mark (YouTube's red, a plain glyph) still gets a poster gradient: the second
  // stop rotates the hue a little instead of repeating the same red at a darker value.
  const second = ranked.find((c) => distance(first, c) > 70) ?? rotate(first, 28)
  const from = hex(first)
  const to = hex(second)
  return {
    from,
    to,
    gradient: `linear-gradient(135deg, ${rgba(first, 0.94)} 0%, ${rgba(second, 0.82)} 72%, ${rgba(shade(second, 1.12), 0.9)} 100%)`
  }
}

function distance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number }
): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

function rotate(
  c: { r: number; g: number; b: number },
  degrees: number
): { r: number; g: number; b: number } {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let sat = 0
  if (d !== 0) {
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  h = (h + degrees + 360) % 360
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat
  const p = 2 * l - q
  const channel = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return {
    r: Math.round(channel(h / 360 + 1 / 3) * 255),
    g: Math.round(channel(h / 360) * 255),
    b: Math.round(channel(h / 360 - 1 / 3) * 255)
  }
}

function shade(c: { r: number; g: number; b: number }, k: number): { r: number; g: number; b: number } {
  return {
    r: Math.max(0, Math.min(255, Math.round(c.r * k))),
    g: Math.max(0, Math.min(255, Math.round(c.g * k))),
    b: Math.max(0, Math.min(255, Math.round(c.b * k)))
  }
}

function hex(c: { r: number; g: number; b: number }): string {
  return `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function rgba(c: { r: number; g: number; b: number }, alpha: number): string {
  return `rgb(${c.r} ${c.g} ${c.b} / ${alpha})`
}

/** The gradient for a live icon address, re-read when the address changes. */
export function useFaviconGradient(src: string | null | undefined): FaviconGradient | null {
  const [read, setRead] = useState<{ src: string; gradient: FaviconGradient | null } | null>(null)
  useEffect(() => {
    if (!src) return undefined
    let live = true
    void faviconGradient(src).then((gradient) => {
      if (live) setRead({ src, gradient })
    })
    return () => {
      live = false
    }
  }, [src])
  // A result from the previous address is not this address's gradient; null until this one lands.
  if (!read || read.src !== src) return null
  return read.gradient
}
