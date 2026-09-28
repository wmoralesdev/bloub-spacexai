import { describe, expect, it } from 'vitest'
import { BotEngine } from '@/bot/engine'
import { POSE_FIGE } from '@/bot/figes'
import { SHAPES } from '@/bot/skins'
import {
  createStickerOutline,
  createStickerSheetLayout,
  DEFAULT_STICKER_SHEET_SETTINGS,
  parseStickerSheetSettings,
  resolveStickerBrandingPlacement,
  stickerSheetPreset,
  validateStickerSheetSettings,
  type StickerSheetSettings
} from './stickerSheet'

const defaults = () => ({ ...DEFAULT_STICKER_SHEET_SETTINGS })
const manual = () => ({ ...defaults(), autoFit: false })
type Point = { x: number; y: number }

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

/** Independent dense samples of the source cubic, used to measure physical errors. */
function samplePath(path: string, matrix = 'matrix(1 0 0 1 0 0)'): Point[] {
  const numbers = matrix.slice(7, -1).split(' ').map(Number)
  const [scale, , , , tx, ty] = numbers
  let start = coordinates(path)[0]!
  const points: Point[] = []
  for (const match of path.matchAll(/C([^CZ]+)/g)) {
    const [x1, y1, x2, y2, x3, y3] = match[1]!.trim().split(/\s+/).map(Number)
    for (let index = 0; index < 48; index++) {
      const t = index / 48
      const u = 1 - t
      const x = u * u * u * start.x + 3 * u * u * t * x1! + 3 * u * t * t * x2! + t * t * t * x3!
      const y = u * u * u * start.y + 3 * u * u * t * y1! + 3 * u * t * t * y2! + t * t * t * y3!
      points.push({ x: x * scale! + tx!, y: y * scale! + ty! })
    }
    start = { x: x3!, y: y3! }
  }
  return points
}

function boundaryDistance(point: Point, polygon: Point[]): number {
  let distance = Infinity
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % polygon.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const divisor = dx * dx + dy * dy
    const t = divisor ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / divisor)) : 0
    distance = Math.min(distance, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy))
  }
  return distance
}

function hasCrossing(polygon: Point[]): boolean {
  const side = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue
      const c = polygon[j]!
      const d = polygon[(j + 1) % polygon.length]!
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true
    }
  }
  return false
}

describe('sticker sheet layout and saved settings', () => {
  it('keeps independent branding placement without changing the bot grid or sharing mutable settings', () => {
    const base = createStickerSheetLayout(defaults(), 11)
    const placement = { sizeMm: 95, centerXMm: 210, centerYMm: 175 }
    const custom = createStickerSheetLayout({ ...defaults(), brandingPlacement: placement }, 11)
    expect(custom.placements).toEqual(base.placements)
    expect(custom.settings.stickerSizeMm).toBe(base.settings.stickerSizeMm)
    expect(resolveStickerBrandingPlacement(custom)).toEqual(placement)
    const resolved = resolveStickerBrandingPlacement(custom)!
    placement.sizeMm = 200
    resolved.centerXMm = 0
    expect(custom.settings.brandingPlacement).toEqual({ sizeMm: 95, centerXMm: 210, centerYMm: 175 })
  })

  it('resolves automatic branding to the last grid cell and handles an empty sheet', () => {
    const layout = createStickerSheetLayout(defaults(), 11)
    const cell = layout.placements.at(-1)!
    const sizeMm = layout.settings.stickerSizeMm
    expect(resolveStickerBrandingPlacement(layout)).toEqual({ sizeMm, centerXMm: cell.x + sizeMm / 2, centerYMm: cell.y + sizeMm / 2 })
    expect(resolveStickerBrandingPlacement(createStickerSheetLayout(defaults(), 0))).toBeNull()
  })

  it.each([
    { sizeMm: 0, centerXMm: 100, centerYMm: 100 },
    { sizeMm: 4, centerXMm: 100, centerYMm: 100 },
    { sizeMm: NaN, centerXMm: 100, centerYMm: 100 },
    { sizeMm: 50, centerXMm: Infinity, centerYMm: 100 },
    { sizeMm: 50, centerXMm: 100, centerYMm: NaN }
  ])('rejects invalid independent branding geometry %j', (brandingPlacement) => {
    expect(validateStickerSheetSettings({ ...defaults(), brandingPlacement })).toBe('invalidBrandingPlacement')
  })

  it('round-trips only recognized branding coordinates and preserves valid base settings on malformed placement', () => {
    const base = { ...manual(), backgroundColor: '#112233', marginMm: 8 }
    const placement = { sizeMm: 70, centerXMm: 150, centerYMm: 180 }
    expect(parseStickerSheetSettings(JSON.stringify({ ...base, brandingPlacement: { ...placement, unknown: true } })))
      .toEqual({ ...base, brandingPlacement: placement })
    for (const brandingPlacement of [null, [], {}, 50, { ...placement, sizeMm: 4 }, { ...placement, centerXMm: '150' }, { ...placement, centerYMm: null }]) {
      expect(parseStickerSheetSettings(JSON.stringify({ ...base, brandingPlacement }))).toEqual(base)
    }
    expect(parseStickerSheetSettings(JSON.stringify(base))).toEqual(base)
  })

  it('places 24 finished 40 mm stickers on landscape A4, in source order', () => {
    const layout = createStickerSheetLayout(manual(), 24)
    expect(layout).toMatchObject({ columns: 6, rows: 4, capacity: 24, fits: true })
    expect(layout.placements[0]).toEqual({ index: 0, x: 18.5, y: 19 })
    expect(layout.placements[5]).toEqual({ index: 5, x: 238.5, y: 19 })
    expect(layout.placements[6]).toEqual({ index: 6, x: 18.5, y: 63 })
    expect(layout.placements[23]).toEqual({ index: 23, x: 238.5, y: 151 })
    for (const cell of layout.placements) {
      expect(cell.x + 40).toBeLessThanOrEqual(287)
      expect(cell.y + 40).toBeLessThanOrEqual(200)
    }
  })

  it('marks empty or overfull sheets unexportable without shrinking cells', () => {
    expect(createStickerSheetLayout(defaults(), 0)).toMatchObject({ fits: false, placements: [] })
    const overflow = createStickerSheetLayout(manual(), 25)
    expect(overflow.fits).toBe(false)
    expect(overflow.placements).toHaveLength(24)
    expect(overflow.settings.stickerSizeMm).toBe(40)
  })

  it('supports portrait A4 and both Letter orientations', () => {
    expect(createStickerSheetLayout({ ...manual(), widthMm: 210, heightMm: 297 }, 24)).toMatchObject({ columns: 4, rows: 6, capacity: 24 })
    expect(createStickerSheetLayout({ ...manual(), widthMm: 279.4, heightMm: 215.9 }, 20)).toMatchObject({ columns: 5, rows: 4, capacity: 20 })
    expect(createStickerSheetLayout({ ...manual(), widthMm: 215.9, heightMm: 279.4 }, 20)).toMatchObject({ columns: 4, rows: 5, capacity: 20 })
  })

  it('retains exact capacity with decimal sizes and permits no outer margin', () => {
    const settings = { ...manual(), widthMm: 20.3, heightMm: 20.3, stickerSizeMm: 10.1, borderMm: 0, gapMm: 0.1, marginMm: 0 }
    expect(createStickerSheetLayout(settings, 4)).toMatchObject({ columns: 2, rows: 2, fits: true })
  })

  it.each<[Partial<StickerSheetSettings>, string]>([
    [{ widthMm: NaN }, 'invalidDimensions'],
    [{ heightMm: Infinity }, 'invalidDimensions'],
    [{ widthMm: 0 }, 'invalidDimensions'],
    [{ stickerSizeMm: -1 }, 'invalidSize'],
    [{ stickerSizeMm: NaN }, 'invalidSize'],
    [{ borderMm: -1 }, 'invalidBorder'],
    [{ borderMm: 20, autoFit: false }, 'invalidBorder'],
    [{ borderMm: Infinity }, 'invalidBorder'],
    [{ gapMm: 0 }, 'invalidSpacing'],
    [{ gapMm: NaN }, 'invalidSpacing'],
    [{ marginMm: -1 }, 'invalidMargin'],
    [{ marginMm: 105 }, 'invalidMargin'],
    [{ marginMm: Infinity }, 'invalidMargin'],
    [{ stickerSizeMm: 500, autoFit: false }, 'noCapacity'],
    [{ backgroundColor: '#fff' }, 'invalidColor'],
    [{ backgroundColor: '#abcdef00' }, 'invalidColor'],
    [{ backgroundColor: 'red' }, 'invalidColor'],
    [{ backgroundColor: '#gggggg' }, 'invalidColor'],
    [{ preset: 'A4' as StickerSheetSettings['preset'] }, 'invalidPreset']
  ])('rejects invalid physical settings %j with %s', (patch, error) => {
    const settings = { ...defaults(), ...patch }
    expect(validateStickerSheetSettings(settings)).toBe(error)
    expect(() => createStickerSheetLayout(settings, 1)).toThrow(error)
  })

  it.each([
    [215.9, 279.4, 'letter'],
    [215.9, 139.7, 'half-letter'],
    [139.7, 107.95, 'quarter-letter']
  ] as const)('round-trips %s × %s %s settings and discards unknown stored fields', (widthMm, heightMm, preset) => {
    const settings = { ...defaults(), widthMm, heightMm, borderMm: 0, backgroundColor: '#dCeF01', preset }
    expect(parseStickerSheetSettings(JSON.stringify({ ...settings, selected: ['f1'] }))).toEqual(settings)
  })

  it.each([
    [297, 210, 'a4'],
    [210, 297, 'a4'],
    [279.4, 215.9, 'letter'],
    [215.9, 279.4, 'letter'],
    [215.9, 139.7, 'half-letter'],
    [139.7, 215.9, 'half-letter'],
    [139.7, 107.95, 'quarter-letter'],
    [107.95, 139.7, 'quarter-letter'],
    [240, 180, 'custom']
  ] as const)('migrates old numeric-only settings for %s × %s to %s', (widthMm, heightMm, preset) => {
    const legacy = { widthMm, heightMm, stickerSizeMm: 32, borderMm: 1, gapMm: 3, marginMm: 8 }
    expect(parseStickerSheetSettings(JSON.stringify(legacy))).toEqual({ ...legacy, backgroundColor: '#ffffff', preset, autoFit: true })
  })

  it('recognises paper dimensions within the persisted rounding tolerance', () => {
    expect(stickerSheetPreset(210 + 0.5e-6, 297 - 0.5e-6)).toBe('a4')
    expect(stickerSheetPreset(279.4 - 0.5e-6, 215.9 + 0.5e-6)).toBe('letter')
    expect(stickerSheetPreset(139.7 + 0.5e-6, 215.9 - 0.5e-6)).toBe('half-letter')
    expect(stickerSheetPreset(139.7 - 0.5e-6, 107.95 + 0.5e-6)).toBe('quarter-letter')
    expect(stickerSheetPreset(210 + 2e-6, 297)).toBe('custom')
    expect(stickerSheetPreset(NaN, Infinity)).toBe('custom')
  })

  it.each([
    { backgroundColor: null },
    { backgroundColor: '#fff' },
    { backgroundColor: 123456 },
    { preset: null },
    { preset: 'legal' },
    { autoFit: 'true' },
    { autoFit: 1 }
  ])('discards malformed new stored fields: %j', (patch) => {
    expect(parseStickerSheetSettings(JSON.stringify({ ...defaults(), ...patch }))).toEqual(defaults())
  })

  it.each([null, '', '{', 'null', '[]', '5', '{}', '{"widthMm":"297"}', JSON.stringify({ ...defaults(), gapMm: 0 })])('falls back safely for %s', (raw) => {
    expect(parseStickerSheetSettings(raw)).toEqual(defaults())
    expect(parseStickerSheetSettings(raw)).not.toBe(DEFAULT_STICKER_SHEET_SETTINGS)
  })
})

describe('balanced sheet composition and automatic sizing', () => {
  for (const count of [1, 7, 8, 51]) {
    for (const [widthMm, heightMm] of [[297, 210], [210, 297], [279.4, 215.9], [215.9, 279.4]]) {
      it(`fits ${count} stickers on ${widthMm} × ${heightMm} with balanced, centred rows`, () => {
        const settings = { ...defaults(), widthMm: widthMm!, heightMm: heightMm! }
        const layout = createStickerSheetLayout(settings, count)
        const size = layout.settings.stickerSizeMm
        expect(layout.fits).toBe(true)
        expect(layout.placements).toHaveLength(count)
        expect(layout.placements.map((p) => p.index)).toEqual(Array.from({ length: count }, (_, i) => i))
        expect(size).toBeGreaterThan(2 * settings.borderMm)
        const rows = new Map<number, typeof layout.placements>()
        for (const placement of layout.placements) {
          expect(placement.x).toBeGreaterThanOrEqual(settings.marginMm - 1e-9)
          expect(placement.y).toBeGreaterThanOrEqual(settings.marginMm - 1e-9)
          expect(placement.x + size).toBeLessThanOrEqual(settings.widthMm - settings.marginMm + 1e-9)
          expect(placement.y + size).toBeLessThanOrEqual(settings.heightMm - settings.marginMm + 1e-9)
          const row = rows.get(placement.y) ?? []
          row.push(placement)
          rows.set(placement.y, row)
        }
        expect(rows.size).toBe(layout.rows)
        const lengths = [...rows.values()].map((row) => row.length)
        expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1)
        for (const row of rows.values()) {
          expect(row[0]!.x + row.at(-1)!.x + size).toBeCloseTo(settings.widthMm, 8)
        }
        expect(layout.placements[0]!.y + layout.placements.at(-1)!.y + size).toBeCloseTo(settings.heightMm, 8)
        for (let i = 0; i < layout.placements.length; i++) {
          for (let j = i + 1; j < layout.placements.length; j++) {
            const a = layout.placements[i]!
            const b = layout.placements[j]!
            expect(Math.abs(a.x - b.x) >= size + settings.gapMm - 1e-9 || Math.abs(a.y - b.y) >= size + settings.gapMm - 1e-9).toBe(true)
          }
        }
      })
    }
  }

  it('grows and shrinks the common finished size without overwriting the manual preference', () => {
    const settings = defaults()
    const single = createStickerSheetLayout(settings, 1)
    const seven = createStickerSheetLayout(settings, 7)
    const eight = createStickerSheetLayout(settings, 8)
    const fiftyOne = createStickerSheetLayout(settings, 51)
    expect(single.settings.stickerSizeMm).toBe(190)
    expect(seven.settings.stickerSizeMm).toBe(66.25)
    expect(eight.settings.stickerSizeMm).toBe(66.25)
    expect(fiftyOne.settings.stickerSizeMm).toBeCloseTo(245 / 9, 8)
    expect(settings.stickerSizeMm).toBe(40)
    expect(single.settings).not.toBe(settings)
  })

  it('puts the extra branding sticker last, in the same balanced cell system', () => {
    const botsOnly = createStickerSheetLayout(defaults(), 7)
    const withBranding = createStickerSheetLayout(defaults(), 7 + 1)
    expect(botsOnly.placements.filter((p) => p.y === botsOnly.placements.at(-1)!.y)).toHaveLength(3)
    expect(withBranding.placements.filter((p) => p.y === withBranding.placements.at(-1)!.y)).toHaveLength(4)
    expect(withBranding.placements.at(-1)?.index).toBe(7)
    expect(withBranding.fits).toBe(true)
  })

  it('centres and balances manual sizes without enlarging or reducing them', () => {
    const settings = manual()
    const layout = createStickerSheetLayout(settings, 7)
    expect(layout).toMatchObject({ columns: 4, rows: 2, capacity: 24, fits: true })
    expect(layout.settings.stickerSizeMm).toBe(40)
    expect(layout.placements[0]).toEqual({ index: 0, x: 62.5, y: 63 })
    expect(layout.placements[4]).toEqual({ index: 4, x: 84.5, y: 107 })
    expect(layout.placements.at(-1)).toEqual({ index: 6, x: 172.5, y: 107 })
  })

  it('reports impossible automatic spacing and borders without a partial or shrunken sheet', () => {
    for (const settings of [{ ...defaults(), gapMm: 500 }, { ...defaults(), borderMm: 34 }]) {
      expect(validateStickerSheetSettings(settings)).toBeNull()
      expect(createStickerSheetLayout(settings, 8)).toMatchObject({ capacity: 0, fits: false, placements: [] })
    }
    expect(createStickerSheetLayout({ ...defaults(), borderMm: 95 }, 1)).toMatchObject({ capacity: 0, fits: false, placements: [] })
    expect(createStickerSheetLayout({ ...defaults(), borderMm: 94.99 }, 1).fits).toBe(true)
  })

  it('uses the resolved size to validate the automatic border, independent of manual size', () => {
    const settings = { ...defaults(), stickerSizeMm: 500, borderMm: 25 }
    expect(validateStickerSheetSettings(settings)).toBeNull()
    expect(createStickerSheetLayout(settings, 1).fits).toBe(true)
    const smallManual = { ...defaults(), stickerSizeMm: 10, borderMm: 25 }
    expect(validateStickerSheetSettings(smallManual)).toBeNull()
    expect(createStickerSheetLayout(smallManual, 1).fits).toBe(true)
  })

  it('persists an explicit manual mode and rejects invalid item counts', () => {
    expect(parseStickerSheetSettings(JSON.stringify(manual())).autoFit).toBe(false)
    for (const count of [-1, 0.5, NaN, Infinity]) {
      expect(() => createStickerSheetLayout(defaults(), count)).toThrow('invalidGeometry')
    }
  })
})

describe('physical sticker outlines', () => {
  for (const shape of SHAPES) {
    it(`${shape.id}: produces one closed, simple 40 mm cut with a uniform 2 mm offset`, async () => {
      const source = new BotEngine(100, 'idle', shape.radii).sample(POSE_FIGE).bodyPath
      const outline = await createStickerOutline(source, 40, 2)
      expect(outline.cutPath.match(/M/g)).toHaveLength(1)
      expect(outline.cutPath.match(/Z/g)).toHaveLength(1)
      expect(outline.cutPath).not.toMatch(/NaN|Infinity|C/)
      const polygon = coordinates(outline.cutPath)
      const outer = bounds(polygon)
      expect(Math.max(outer.width, outer.height)).toBeCloseTo(40, 1)
      expect(outer.minX + outer.maxX).toBeCloseTo(40, 8)
      expect(outer.minY + outer.maxY).toBeCloseTo(40, 8)
      expect(outer.minX).toBeGreaterThanOrEqual(-0.03)
      expect(outer.minY).toBeGreaterThanOrEqual(-0.03)
      expect(hasCrossing(polygon)).toBe(false)

      const body = samplePath(source, outline.bodyTransform)
      const bodyBounds = bounds(body)
      expect(Math.max(bodyBounds.width, bodyBounds.height)).toBeCloseTo(36, 2)
      // Check the arc chords too; vertices alone miss the worst rounded-join error.
      for (let index = 0; index < polygon.length; index += 3) {
        const a = polygon[index]!
        const b = polygon[(index + 1) % polygon.length]!
        for (const point of [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]) {
          expect(Math.abs(boundaryDistance(point, body) - 2), `${shape.id} border at ${point.x}, ${point.y}`).toBeLessThan(0.03)
        }
      }
    })

    it(`${shape.id}: keeps original cubic geometry when the border is zero`, async () => {
      const source = new BotEngine(100, 'idle', shape.radii).sample(POSE_FIGE).bodyPath
      const outline = await createStickerOutline(source, 40, 0)
      expect(outline.cutPath.match(/C/g)?.length).toBe(source.match(/C/g)?.length)
      expect(outline.cutPath).not.toContain('L')
      const expected = samplePath(source, outline.bodyTransform)
      const actual = samplePath(outline.cutPath)
      expect(actual).toHaveLength(expected.length)
      for (let i = 0; i < actual.length; i += 17) {
        expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 6)
        expect(actual[i]!.y).toBeCloseTo(expected[i]!.y, 6)
      }
      const physical = bounds(actual)
      expect(Math.max(physical.width, physical.height)).toBeCloseTo(40, 2)
    })
  }

  it('measures cubic extrema, not anchors or the control-point box', async () => {
    // Endpoints have no height; controls span 200, but the curve itself spans 150.
    const source = 'M0 0C0 -100 100 -100 100 0C100 100 0 100 0 0Z'
    const result = await createStickerOutline(source, 40, 2)
    expect(Number(result.bodyTransform.slice(7).split(' ')[0])).toBeCloseTo(36 / 150, 8)
    expect(bounds(coordinates(result.cutPath)).height).toBeCloseTo(40, 1)
  })

  it('preserves spacing between actual cut contours in adjacent cells', async () => {
    const layout = createStickerSheetLayout(manual(), 2)
    const source = new BotEngine(100, 'idle', SHAPES.find((shape) => shape.id === 'capsule')!.radii).sample(POSE_FIGE).bodyPath
    const outer = bounds(coordinates((await createStickerOutline(source, 40, 2)).cutPath))
    const gap = layout.placements[1]!.x + outer.minX - layout.placements[0]!.x - outer.maxX
    expect(Math.abs(gap - 4)).toBeLessThan(0.03)
  })

  it.each([
    '',
    'M0 0C0 0 0 0 0 0Z',
    'M0 0C0 0 10 10 10 10C10 10 0 10 0 10C0 10 10 0 10 0C10 0 0 0 0 0Z',
    'M0 0C0 NaN 2 3 4 5Z',
    'M0 0C0 1 1 1 1 0Z M2 0C2 1 3 1 3 0Z',
    'M0 0L10 0L10 10Z',
    'M0 0C0 1 1 1 1 0'
  ])('rejects invalid, crossed or multiple contours: %s', async (path) => {
    await expect(createStickerOutline(path, 40, 2)).rejects.toThrow('invalidGeometry')
  })

  it.each([[0, 0], [40, -1], [40, 20], [Infinity, 2], [40, NaN]])('rejects invalid outline dimensions %s/%s', async (size, border) => {
    await expect(createStickerOutline(new BotEngine().sample(1).bodyPath, size!, border!)).rejects.toThrow('invalidGeometry')
  })
})
