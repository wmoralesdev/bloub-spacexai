// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandingStickerOutline, outlineBrandingContours, traceAlphaContours } from './stickerBrandingOutline'
import type { StickerSheetBranding } from './stickerSheetBranding'

type Point = { x: number; y: number }
function mask(rows: string[]) {
  const width = rows[0]!.length
  const alpha = Uint8Array.from(rows.join(''), (character) => character === '#' ? 255 : 0)
  return { alpha, width, height: rows.length }
}
function contours(rows: string[]) {
  const { alpha, width, height } = mask(rows)
  return traceAlphaContours(alpha, width, height)
}
function signedArea(path: Point[]): number {
  return path.reduce((sum, p, i) => {
    const next = path[(i + 1) % path.length]!
    return sum + p.x * next.y - next.x * p.y
  }, 0) / 2
}
function coordinates(path: string): Point[] {
  return [...path.matchAll(/[ML]([-\d.e+]+) ([-\d.e+]+)/g)].map((match) => ({ x: +match[1]!, y: +match[2]! }))
}
function bounds(points: Point[]) {
  const minX = Math.min(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const maxX = Math.max(...points.map((p) => p.x))
  const maxY = Math.max(...points.map((p) => p.y))
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

describe('logo alpha contour tracing', () => {
  it('retains the complete boundary, including pixels touching all canvas edges', () => {
    const paths = contours(['###', '###'])
    expect(paths).toHaveLength(1)
    expect(paths[0]).toHaveLength(4)
    expect(bounds(paths[0]!)).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 2, width: 3, height: 2 })
    expect(signedArea(paths[0]!)).toBe(6)
  })

  it('drops holes so letters and logo counters do not become internal cuts', () => {
    const paths = contours(['#####', '#...#', '#...#', '#...#', '#####'])
    expect(paths).toHaveLength(1)
    expect(paths[0]).toHaveLength(4)
    expect(signedArea(paths[0]!)).toBe(25)
  })

  it('keeps diagonal-only contacts as separate closed, simple exteriors', () => {
    const paths = contours(['#.', '.#'])
    expect(paths).toHaveLength(2)
    expect(paths.map(signedArea)).toEqual([1, 1])
    for (const path of paths) expect(new Set(path.map((p) => `${p.x},${p.y}`)).size).toBe(path.length)
  })

  it('keeps every disconnected glyph and trims empty canvas margins', () => {
    const paths = contours(['.........', '.##.#.##.', '.##.#.##.', '.........'])
    expect(paths).toHaveLength(3)
    expect(paths.map(signedArea)).toEqual([4, 2, 4])
    expect(bounds(paths.flat())).toEqual({ minX: 1, minY: 1, maxX: 8, maxY: 3, width: 7, height: 2 })
  })

  it('keeps semitransparent details and faint antialiasing independent of RGB color', () => {
    const paths = traceAlphaContours(Uint8Array.from([0, 1, 102, 127, 128, 255]), 6, 1)
    expect(paths).toHaveLength(1)
    expect(bounds(paths[0]!)).toMatchObject({ minX: 1, maxX: 6 })
  })

  it('handles every nonempty two-by-two mask without a lost or crossed pixel boundary', () => {
    for (let bits = 1; bits < 16; bits++) {
      const alpha = Uint8Array.from([0, 1, 2, 3], (bit) => bits & (1 << bit) ? 255 : 0)
      const paths = traceAlphaContours(alpha, 2, 2)
      expect(paths.reduce((sum, path) => sum + signedArea(path), 0)).toBe(alpha.filter(Boolean).length)
      for (const path of paths) expect(signedArea(path)).toBeGreaterThan(0)
    }
  })

  it('rejects empty, inconsistent or excessively complex masks before geometry work', () => {
    expect(() => traceAlphaContours(new Uint8Array(4), 2, 2)).toThrow('invalidBrandingGeometry')
    expect(() => traceAlphaContours(new Uint8Array(4), 2, 3)).toThrow('invalidBrandingGeometry')
    expect(() => traceAlphaContours(new Uint8Array(), -1, 3)).toThrow('invalidBrandingGeometry')
    const checkerboard = Uint8Array.from({ length: 512 * 512 }, (_, index) => ((index % 512) + Math.floor(index / 512)) % 2 ? 255 : 0)
    expect(() => traceAlphaContours(checkerboard, 512, 512)).toThrow('invalidBrandingGeometry')
  })
})

describe('logo physical outlines', () => {
  it('builds one cut for the full-resolution AiL fixture with a translucent separated letter', async () => {
    const width = 4096
    const height = 2048
    const alpha = new Uint8Array(width * height)
    const scale = width / 200
    const fill = (y: number, from: number, to: number, opacity = 255) => {
      alpha.fill(opacity, y * width + Math.max(0, Math.ceil(from * scale - 0.5)), y * width + Math.min(width, Math.ceil(to * scale - 0.5)))
    }
    const polygons: Array<{ points: Point[]; opacity: number }> = [
      { points: [{ x: 20, y: 80 }, { x: 50, y: 20 }, { x: 80, y: 80 }, { x: 65, y: 80 }, { x: 50, y: 48 }, { x: 35, y: 80 }], opacity: 255 },
      { points: [{ x: 128, y: 80 }, { x: 128, y: 20 }, { x: 145, y: 20 }, { x: 145, y: 64 }, { x: 180, y: 64 }, { x: 180, y: 80 }], opacity: 102 }
    ]
    for (let y = 0; y < height; y++) {
      const py = (y + 0.5) / scale
      for (const { points, opacity } of polygons) {
        const crossings: number[] = []
        for (let index = 0; index < points.length; index++) {
          const a = points[index]!
          const b = points[(index + 1) % points.length]!
          if ((a.y > py) !== (b.y > py)) crossings.push(a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y))
        }
        crossings.sort((a, b) => a - b)
        for (let i = 0; i < crossings.length; i += 2) fill(y, crossings[i]!, crossings[i + 1]!, opacity)
      }
      if (Math.abs(py - 25) < 9) {
        const half = Math.sqrt(81 - (py - 25) ** 2)
        fill(y, 102 - half, 102 + half)
      }
      if (py >= 44 && py < 80) {
        const dy = Math.max(52 - py, py - 72, 0)
        const half = Math.sqrt(64 - dy * dy)
        fill(y, 102 - half, 102 + half)
      }
    }
    const source = traceAlphaContours(alpha, width, height)
    expect(source).toHaveLength(4)
    const result = await outlineBrandingContours(source, 60.66666666666667, 2)
    expect(result.cutPath.match(/M/g)).toHaveLength(1)
    expect(bounds(coordinates(result.cutPath)).width).toBeCloseTo(60.66666666666667, 1)
  })

  it('offsets an exterior to the finished dimensions and positions the original art with it', async () => {
    const paths = [[{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 30 }]]
    const result = await outlineBrandingContours(paths, 40, 2)
    const box = bounds(coordinates(result.cutPath))
    expect(box.width).toBeCloseTo(40, 2)
    expect(box.height).toBeCloseTo(22, 2)
    expect(box.minX + box.maxX).toBeCloseTo(40, 8)
    expect(box.minY + box.maxY).toBeCloseTo(40, 8)
    expect(result.scale).toBe(1.8)
    expect(10 * result.scale + result.x).toBeCloseTo(2, 2)
    expect(20 * result.scale + result.y).toBeCloseTo(11, 2)
    expect(result.bounds.x).toBeCloseTo(box.minX, 10)
    expect(result.bounds.y).toBeCloseTo(box.minY, 10)
    expect(result.bounds.width).toBeCloseTo(box.width, 10)
    expect(result.bounds.height).toBeCloseTo(box.height, 10)
  })

  it.each([
    ['##..##..##', '##..##..##'],
    ['#...', '..#.', '...#'],
    ['#.', '.#'],
    ['#####...#', '#...#...#', '#####...#']
  ])('connects separated shapes into exactly one cut with rounded white bridges: %j', async (...rows) => {
    const source = contours(rows)
    const result = await outlineBrandingContours(source, 40, 2)
    expect(result.cutPath.match(/M/g)).toHaveLength(1)
    expect(result.cutPath.match(/Z/g)).toHaveLength(1)
    const points = coordinates(result.cutPath)
    expect(signedArea(points)).toBeGreaterThan(0)
    expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(points.length)
    const box = bounds(points)
    expect(Math.max(box.width, box.height)).toBeCloseTo(40, 1)
    expect(box.minX).toBeGreaterThanOrEqual(-0.03)
    expect(box.minY).toBeGreaterThanOrEqual(-0.03)
    expect(box.maxX).toBeLessThanOrEqual(40.03)
    expect(box.maxY).toBeLessThanOrEqual(40.03)
  })

  it('supports a single silhouette with zero border and rejects disconnected zero-border lettering', async () => {
    const single = await outlineBrandingContours(contours(['##', '##']), 40, 0)
    expect(bounds(coordinates(single.cutPath))).toMatchObject({ minX: 0, minY: 0, maxX: 40, maxY: 40 })
    await expect(outlineBrandingContours(contours(['##..##', '##..##']), 40, 0)).rejects.toThrow('invalidBrandingGeometry')
  })

  it('fills nested islands and holes without inventing additional cut contours', async () => {
    const source = contours(['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'])
    expect(source).toHaveLength(2)
    const result = await outlineBrandingContours(source, 40, 0)
    expect(result.cutPath.match(/M/g)).toHaveLength(1)
    expect(coordinates(result.cutPath)).toHaveLength(4)
  })

  it('rejects non-finite dimensions, oversized borders and excessive polygon input', async () => {
    for (const [size, border] of [[0, 0], [40, 20], [40, -1], [NaN, 2]]) {
      await expect(outlineBrandingContours(contours(['##', '##']), size!, border!)).rejects.toThrow('invalidBrandingGeometry')
    }
    await expect(outlineBrandingContours([], 40, 2)).rejects.toThrow('invalidBrandingGeometry')
    await expect(outlineBrandingContours(Array.from({ length: 257 }, () => contours(['##', '##'])[0]!), 40, 2)).rejects.toThrow('invalidBrandingGeometry')
  })
})

let identity = 0
function branding(): StickerSheetBranding {
  return {
    name: 'wordmark.svg', aspectRatio: 50,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 2" width="100" height="2"><title>test-${identity++}</title><defs><linearGradient id="color"><stop offset="0" stop-color="#ff6600"/></linearGradient><mask id="shape"><rect width="100" height="2" fill="#ffffff"/></mask></defs><path id="original" d="M25 .25H75V1.25H25Z" fill="url('#color')" mask="url(#shape)"/></svg>`
  }
}

function browserRaster() {
  let empty = false
  const decode = vi.fn(async () => {})
  const draw = vi.fn()
  const context = {
    clearRect: vi.fn(), drawImage: draw,
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4)
      if (!empty) {
        for (let y = 11; y < 50; y++) {
          for (let x = 1024; x < 3072; x++) data[(y * width + x) * 4 + 3] = 255
        }
      }
      return { data }
    })
  }
  vi.stubGlobal('Image', class { decoding = ''; src = ''; decode = decode })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:logo-test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { decode, draw, setEmpty: (value: boolean) => { empty = value } }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('vector logo rendering and raster cache', () => {
  it('keeps printable artwork as vector paths with isolated paint/mask IDs', async () => {
    const browser = browserRaster()
    const logo = branding()
    const original = logo.svg
    const result = await brandingStickerOutline(logo, 40, 2)
    const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${result.artwork}</svg>`, 'image/svg+xml')
    expect(document.querySelector('parsererror, image, canvas')).toBeNull()
    expect(document.querySelector('path')?.getAttribute('d')).toBe('M25 .25H75V1.25H25Z')
    for (const element of document.querySelectorAll('[id]')) expect(element.getAttribute('id')).toMatch(/^branding-/)
    const fill = document.querySelector('path')!.getAttribute('fill')!
    const mask = document.querySelector('path')!.getAttribute('mask')!
    expect(fill).toBe(`url(#${document.querySelector('linearGradient')!.getAttribute('id')})`)
    expect(mask).toBe(`url(#${document.querySelector('mask')!.getAttribute('id')})`)
    expect(document.querySelector('svg svg')?.getAttribute('viewBox')).toBe('0 0 100 2')
    expect(logo.svg).toBe(original)
    expect(browser.draw.mock.calls[0]?.slice(1)).toEqual([0, 0, 4096, 81.92])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:logo-test')
  })

  it('reuses silhouette sampling across physical size and border changes', async () => {
    const browser = browserRaster()
    const logo = branding()
    const first = await brandingStickerOutline(logo, 40, 2)
    const second = await brandingStickerOutline(logo, 80, 4)
    expect(browser.decode).toHaveBeenCalledTimes(1)
    expect(bounds(coordinates(first.cutPath)).width).toBeCloseTo(40, 2)
    expect(bounds(coordinates(second.cutPath)).width).toBeCloseTo(80, 2)
    const actual = bounds(coordinates(first.cutPath))
    expect(first.bounds.width).toBeCloseTo(actual.width, 10)
    expect(first.bounds.height).toBeCloseTo(actual.height, 10)
    expect(first.bounds.y).toBeCloseTo(actual.minY, 10)
    // Visible alpha, not the padded source viewBox, determines its finished height.
    expect(first.bounds.height).toBeCloseTo(36 * 39 / 2048 + 4, 2)
  })

  it('evicts a failed rasterization so the same source can be retried', async () => {
    const browser = browserRaster()
    const logo = branding()
    browser.setEmpty(true)
    await expect(brandingStickerOutline(logo, 40, 2)).rejects.toThrow('invalidBrandingGeometry')
    browser.setEmpty(false)
    await expect(brandingStickerOutline(logo, 40, 2)).resolves.toHaveProperty('cutPath')
    expect(browser.decode).toHaveBeenCalledTimes(2)
  })

  it('bounds the cache to three SVG sources', async () => {
    const browser = browserRaster()
    const logos = Array.from({ length: 4 }, branding)
    for (const logo of logos) await brandingStickerOutline(logo, 40, 2)
    await brandingStickerOutline(logos[0]!, 40, 2)
    expect(browser.decode).toHaveBeenCalledTimes(5)
  })
})
