/**
 * The brand mark as pixels: the SVG in `logo/` rasterised at one high resolution, then sampled
 * down for every icon size. `@napi-rs/canvas` draws the vector at 1024 so the macOS `.icns`
 * entry is native rather than an upscale of the 256 px preview.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { RasterImage } from './lib.ts'

/** The rasterisation side of the source SVGs; larger than the largest icon (the `.icns` 1024). */
export const BRAND_MARK_SIZE = 1024

/** Render an SVG document to straight-alpha RGBA at `size` × `size`. */
export async function rasteriseSvg(svg: Uint8Array, size = BRAND_MARK_SIZE): Promise<RasterImage> {
  const image = await loadImage(Buffer.from(svg))
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(image, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  return { width: size, height: size, rgba: Uint8Array.from(data) }
}
