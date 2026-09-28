/** Preset dimensions in millimetres, with the longer side first. */
export const STICKER_SHEET_PRESETS = {
  a4: [297, 210],
  letter: [279.4, 215.9],
  'half-letter': [215.9, 139.7],
  'quarter-letter': [139.7, 107.95]
} as const

export type StickerSheetPreset = keyof typeof STICKER_SHEET_PRESETS | 'custom'

function isStickerSheetPreset(value: unknown): value is StickerSheetPreset {
  return value === 'custom' || (typeof value === 'string' && Object.hasOwn(STICKER_SHEET_PRESETS, value))
}

/** Physical sheet dimensions and contour coordinates are always in millimetres. */
export interface StickerBrandingPlacement {
  sizeMm: number
  centerXMm: number
  centerYMm: number
}

export interface StickerSheetSettings {
  widthMm: number
  heightMm: number
  stickerSizeMm: number
  borderMm: number
  gapMm: number
  marginMm: number
  backgroundColor: string
  preset: StickerSheetPreset
  autoFit: boolean
  brandingPlacement?: StickerBrandingPlacement
}

export const DEFAULT_STICKER_SHEET_SETTINGS: StickerSheetSettings = {
  widthMm: 297,
  heightMm: 210,
  stickerSizeMm: 40,
  borderMm: 2,
  gapMm: 4,
  marginMm: 10,
  backgroundColor: '#ffffff',
  preset: 'a4',
  autoFit: true
}

/** Recognise saved paper dimensions independently of the selected orientation. */
export function stickerSheetPreset(widthMm: number, heightMm: number): StickerSheetPreset {
  const width = Math.min(widthMm, heightMm)
  const height = Math.max(widthMm, heightMm)
  const matches = (w: number, h: number) => Math.abs(width - w) <= 1e-6 && Math.abs(height - h) <= 1e-6
  for (const preset of Object.keys(STICKER_SHEET_PRESETS) as Array<keyof typeof STICKER_SHEET_PRESETS>) {
    const [long, short] = STICKER_SHEET_PRESETS[preset]
    if (matches(short, long)) return preset
  }
  return 'custom'
}

export interface StickerSheetLayout {
  settings: StickerSheetSettings
  columns: number
  rows: number
  capacity: number
  fits: boolean
  placements: Array<{ index: number; x: number; y: number }>
}

/** The logo keeps its own size and centre independently of the automatic bot layout. */
export function resolveStickerBrandingPlacement(layout: StickerSheetLayout): StickerBrandingPlacement | null {
  const cell = layout.placements.at(-1)
  if (!cell) return null
  if (layout.settings.brandingPlacement) return { ...layout.settings.brandingPlacement }
  const sizeMm = layout.settings.stickerSizeMm
  return { sizeMm, centerXMm: cell.x + sizeMm / 2, centerYMm: cell.y + sizeMm / 2 }
}

function validBrandingPlacement(value: unknown, borderMm: number): value is StickerBrandingPlacement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const placement = value as Record<string, unknown>
  return typeof placement.sizeMm === 'number' && Number.isFinite(placement.sizeMm) && placement.sizeMm > 2 * borderMm &&
    typeof placement.centerXMm === 'number' && Number.isFinite(placement.centerXMm) &&
    typeof placement.centerYMm === 'number' && Number.isFinite(placement.centerYMm)
}

function gridSize(settings: StickerSheetSettings) {
  const { widthMm, heightMm, stickerSizeMm, gapMm, marginMm } = settings
  const pitch = stickerSizeMm + gapMm
  // A tiny relative allowance avoids losing the final cell to floating-point rounding.
  const cells = (span: number) => Math.floor((span - marginMm * 2 + gapMm) / pitch + 1e-12)
  const columns = cells(widthMm)
  const rows = cells(heightMm)
  return { columns, rows, capacity: columns * rows }
}

export function validateStickerSheetSettings(settings: StickerSheetSettings): string | null {
  const { widthMm, heightMm, stickerSizeMm, borderMm, gapMm, marginMm } = settings
  if (![widthMm, heightMm].every((v) => Number.isFinite(v) && v > 0)) return 'invalidDimensions'
  if (!Number.isFinite(stickerSizeMm) || stickerSizeMm <= 0) return 'invalidSize'
  if (!Number.isFinite(borderMm) || borderMm < 0 || (!settings.autoFit && borderMm >= stickerSizeMm / 2)) return 'invalidBorder'
  if (!Number.isFinite(gapMm) || gapMm <= 0) return 'invalidSpacing'
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm * 2 >= Math.min(widthMm, heightMm)) {
    return 'invalidMargin'
  }
  if (typeof settings.backgroundColor !== 'string' || !/^#[\da-f]{6}$/i.test(settings.backgroundColor)) return 'invalidColor'
  if (!isStickerSheetPreset(settings.preset)) return 'invalidPreset'
  if (settings.brandingPlacement !== undefined && !validBrandingPlacement(settings.brandingPlacement, borderMm)) {
    return 'invalidBrandingPlacement'
  }
  if (!settings.autoFit) {
    const { columns, rows, capacity } = gridSize(settings)
    if (columns < 1 || rows < 1 || !Number.isSafeInteger(capacity) || capacity < 1) return 'noCapacity'
  }
  return null
}

/** Invalid or incomplete persisted settings cannot prevent Stills from opening. */
export function parseStickerSheetSettings(raw: string | null): StickerSheetSettings {
  const fallback = () => ({ ...DEFAULT_STICKER_SHEET_SETTINGS })
  if (!raw) return fallback()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback()
    const data = parsed as Record<string, unknown>
    const settings = fallback()
    for (const key of ['widthMm', 'heightMm', 'stickerSizeMm', 'borderMm', 'gapMm', 'marginMm'] as const) {
      if (typeof data[key] !== 'number') return fallback()
      settings[key] = data[key]
    }
    if (data.backgroundColor !== undefined) {
      if (typeof data.backgroundColor !== 'string') return fallback()
      settings.backgroundColor = data.backgroundColor
    }
    if (data.preset === undefined) {
      settings.preset = stickerSheetPreset(settings.widthMm, settings.heightMm)
    } else {
      if (!isStickerSheetPreset(data.preset)) return fallback()
      settings.preset = data.preset
    }
    if (data.autoFit !== undefined) {
      if (typeof data.autoFit !== 'boolean') return fallback()
      settings.autoFit = data.autoFit
    }
    if (validBrandingPlacement(data.brandingPlacement, settings.borderMm)) {
      const { sizeMm, centerXMm, centerYMm } = data.brandingPlacement
      settings.brandingPlacement = { sizeMm, centerXMm, centerYMm }
    }
    return validateStickerSheetSettings(settings) ? fallback() : settings
  } catch {
    return fallback()
  }
}

export function createStickerSheetLayout(settings: StickerSheetSettings, count: number): StickerSheetLayout {
  const error = validateStickerSheetSettings(settings)
  if (error) throw new Error(error)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalidGeometry')
  settings = { ...settings, ...(settings.brandingPlacement ? { brandingPlacement: { ...settings.brandingPlacement } } : {}) }
  const empty = (): StickerSheetLayout => ({ settings: { ...settings }, columns: 0, rows: 0, capacity: 0, fits: false, placements: [] })
  if (count === 0) return empty()
  const width = settings.widthMm - 2 * settings.marginMm
  const height = settings.heightMm - 2 * settings.marginMm
  const gap = settings.gapMm
  let size = settings.stickerSizeMm
  let rows = 0
  let columns = 0
  let capacity = 0
  let placedCount = count

  if (settings.autoFit) {
    size = 0
    for (let candidateRows = 1; candidateRows <= count; candidateRows++) {
      const candidateColumns = Math.ceil(count / candidateRows)
      const candidateSize = Math.min(
        (width - (candidateColumns - 1) * gap) / candidateColumns,
        (height - (candidateRows - 1) * gap) / candidateRows
      )
      // Iteration order deliberately keeps the arrangement with fewer rows on ties.
      if (candidateSize > size + 1e-9) {
        size = candidateSize
        rows = candidateRows
        columns = candidateColumns
      }
      if (height - candidateRows * gap <= 0) break
    }
    if (!Number.isFinite(size) || size <= 2 * settings.borderMm || rows === 0) return empty()
    capacity = gridSize({ ...settings, stickerSizeMm: size }).capacity
    if (!Number.isSafeInteger(capacity) || capacity < count) return empty()
  } else {
    const grid = gridSize(settings)
    capacity = grid.capacity
    placedCount = Math.min(count, capacity)
    let bestScore = Infinity
    for (let candidateRows = 1; candidateRows <= Math.min(placedCount, grid.rows); candidateRows++) {
      const candidateColumns = Math.ceil(placedCount / candidateRows)
      if (candidateColumns > grid.columns) continue
      const groupWidth = candidateColumns * size + (candidateColumns - 1) * gap
      const groupHeight = candidateRows * size + (candidateRows - 1) * gap
      // Log aspect distance treats portrait and landscape arrangements symmetrically.
      const score = Math.abs(Math.log((groupWidth / groupHeight) / (width / height)))
      if (score < bestScore - 1e-12) {
        bestScore = score
        rows = candidateRows
        columns = candidateColumns
      }
    }
    if (rows === 0) return empty()
  }

  const placements: StickerSheetLayout['placements'] = []
  const pitch = size + gap
  const top = (settings.heightMm - (rows * size + (rows - 1) * gap)) / 2
  const perRow = Math.floor(placedCount / rows)
  const extra = placedCount % rows
  for (let row = 0; row < rows; row++) {
    const rowCount = perRow + (row < extra ? 1 : 0)
    const left = (settings.widthMm - (rowCount * size + (rowCount - 1) * gap)) / 2
    for (let column = 0; column < rowCount; column++) {
      placements.push({ index: placements.length, x: left + column * pitch, y: top + row * pitch })
    }
  }
  return { settings: { ...settings, stickerSizeMm: size }, columns, rows, capacity, fits: count <= capacity, placements }
}

interface Point { x: number; y: number }
interface Cubic { p0: Point; p1: Point; p2: Point; p3: Point }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

const FLATNESS_MM = 0.005
const ARC_TOLERANCE_MM = 0.01
const MAX_ERROR_MM = 0.03
const EPSILON = 1e-9
const failGeometry = (): never => { throw new Error('invalidGeometry') }

/** The bot engine emits exactly one closed, absolute M/C/Z contour. */
function parseBodyPath(path: string): Cubic[] {
  const pattern = /[MCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g
  const tokens = path.match(pattern)
  if (!tokens || tokens.length > 50_000 || path.replace(pattern, '').replace(/[\s,]/g, '')) return failGeometry()
  let index = 0
  const number = () => {
    const token = tokens[index++]
    if (!token || /^[MCZ]$/.test(token)) return failGeometry()
    const value = Number(token)
    return Number.isFinite(value) ? value : failGeometry()
  }
  const point = (): Point => ({ x: number(), y: number() })
  if (tokens[index++] !== 'M') return failGeometry()
  const first = point()
  let current = first
  const curves: Cubic[] = []
  while (tokens[index] === 'C') {
    index++
    const p1 = point()
    const p2 = point()
    const p3 = point()
    curves.push({ p0: current, p1, p2, p3 })
    current = p3
  }
  if (tokens[index++] !== 'Z' || index !== tokens.length || curves.length === 0) return failGeometry()
  // Support the implicit straight closing edge without changing zero-border cubics.
  if (Math.hypot(current.x - first.x, current.y - first.y) > EPSILON) {
    curves.push({ p0: current, p1: current, p2: first, p3: first })
  }
  return curves
}

function at(curve: Cubic, t: number): Point {
  const u = 1 - t
  return {
    x: u ** 3 * curve.p0.x + 3 * u * u * t * curve.p1.x + 3 * u * t * t * curve.p2.x + t ** 3 * curve.p3.x,
    y: u ** 3 * curve.p0.y + 3 * u * u * t * curve.p1.y + 3 * u * t * t * curve.p2.y + t ** 3 * curve.p3.y
  }
}

function extrema(a: number, b: number, c: number, d: number): number[] {
  const qa = -a + 3 * b - 3 * c + d
  const qb = 2 * (a - 2 * b + c)
  const qc = b - a
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(qa), Math.abs(qb), Math.abs(qc)) * 8
  if (Math.abs(qa) <= tolerance) return Math.abs(qb) <= tolerance ? [] : [-qc / qb]
  const discriminant = qb * qb - 4 * qa * qc
  if (discriminant < 0) return []
  const root = Math.sqrt(discriminant)
  return [(-qb + root) / (2 * qa), (-qb - root) / (2 * qa)]
}

function boundsOfPoints(points: Point[]): Bounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return failGeometry()
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.maxY = Math.max(bounds.maxY, point.y)
  }
  return bounds
}

/** Control points are not bounds: a cubic can turn before its endpoint. */
function curveBounds(curves: Cubic[]): Bounds {
  const points: Point[] = []
  for (const curve of curves) {
    points.push(curve.p0, curve.p3)
    for (const axis of ['x', 'y'] as const) {
      for (const t of extrema(curve.p0[axis], curve.p1[axis], curve.p2[axis], curve.p3[axis])) {
        if (t > 0 && t < 1) points.push(at(curve, t))
      }
    }
  }
  return boundsOfPoints(points)
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2))
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

function midpoint(a: Point, b: Point): Point { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }

/** Convex-hull flatness bounds the curve-to-polyline error in physical units. */
function flatten(curve: Cubic, points: Point[], depth = 0): void {
  if (points.length > 65_536 || depth > 24) return failGeometry()
  if (Math.max(distanceToSegment(curve.p1, curve.p0, curve.p3), distanceToSegment(curve.p2, curve.p0, curve.p3)) <= FLATNESS_MM) {
    points.push(curve.p3)
    return
  }
  const a = midpoint(curve.p0, curve.p1)
  const b = midpoint(curve.p1, curve.p2)
  const c = midpoint(curve.p2, curve.p3)
  const d = midpoint(a, b)
  const e = midpoint(b, c)
  const middle = midpoint(d, e)
  flatten({ p0: curve.p0, p1: a, p2: d, p3: middle }, points, depth + 1)
  flatten({ p0: middle, p1: e, p2: c, p3: curve.p3 }, points, depth + 1)
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPSILON || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPSILON ||
      Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPSILON || Math.max(c.y, d.y) < Math.min(a.y, b.y) - EPSILON) return false
  const direction = (p: Point, q: Point, r: Point) => {
    const value = cross(p, q, r)
    const tolerance = EPSILON * Math.max(1, Math.hypot(q.x - p.x, q.y - p.y))
    return Math.abs(value) <= tolerance ? 0 : Math.sign(value)
  }
  return direction(a, b, c) * direction(a, b, d) <= 0 && direction(c, d, a) * direction(c, d, b) <= 0
}

/** Reject crossed/touching contours, including holes returned as extra paths. */
function simplePolygon(raw: Point[]): Point[] {
  const points = raw.filter((p, index) => index === 0 || Math.hypot(p.x - raw[index - 1]!.x, p.y - raw[index - 1]!.y) > EPSILON)
  if (points.length > 1 && Math.hypot(points[0]!.x - points.at(-1)!.x, points[0]!.y - points.at(-1)!.y) <= EPSILON) points.pop()
  if (points.length < 3 || points.length > 65_536) return failGeometry()
  boundsOfPoints(points)
  let area = 0
  const edges = points.map((a, index) => {
    const b = points[(index + 1) % points.length]!
    return { a, b, index, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x) }
  })
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const c = points[(i + 2) % points.length]!
    area += a.x * b.y - b.x * a.y
    // Consecutive edges may share a vertex, but must not double back over one another.
    if (Math.abs(cross(a, b, c)) <= EPSILON && (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > EPSILON) return failGeometry()
  }
  // Sweep the x intervals instead of comparing all pairs on finely sampled, large sheets.
  edges.sort((a, b) => a.minX - b.minX)
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]!
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j]!
      if (b.minX > a.maxX + EPSILON) break
      const separation = Math.abs(a.index - b.index)
      if (separation === 1 || separation === points.length - 1) continue
      if (intersects(a.a, a.b, b.a, b.b)) return failGeometry()
    }
  }
  if (!Number.isFinite(area) || Math.abs(area) < 1e-10) return failGeometry()
  return area < 0 ? points.reverse() : points
}

function format(value: number): string {
  if (!Number.isFinite(value)) return failGeometry()
  return String(Number(value.toFixed(9)))
}

function transformed(curves: Cubic[], scale: number, tx: number, ty: number): Cubic[] {
  const point = (p: Point) => ({ x: p.x * scale + tx, y: p.y * scale + ty })
  return curves.map((c) => ({ p0: point(c.p0), p1: point(c.p1), p2: point(c.p2), p3: point(c.p3) }))
}

function cubicPath(curves: Cubic[]): string {
  const pair = (p: Point) => `${format(p.x)} ${format(p.y)}`
  return `M${pair(curves[0]!.p0)}${curves.map((c) => `C${pair(c.p1)} ${pair(c.p2)} ${pair(c.p3)}`).join('')}Z`
}

/**
 * Returns one reusable cut contour and the matching transform for the captured SVG.
 * Flattening (0.005), round arcs (0.01) and Clipper rounding (<0.001) stay below
 * the 0.03 mm geometry budget. No offsetting library loads for ordinary Stills.
 */
export async function createStickerOutline(bodyPath: string, sizeMm: number, borderMm: number): Promise<{ cutPath: string; bodyTransform: string }> {
  if (!Number.isFinite(sizeMm) || sizeMm <= 0 || !Number.isFinite(borderMm) || borderMm < 0 || borderMm >= sizeMm / 2) return failGeometry()
  const curves = parseBodyPath(bodyPath)
  const bounds = curveBounds(curves)
  const maxDimension = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  if (!Number.isFinite(maxDimension) || maxDimension <= EPSILON) return failGeometry()
  const scale = (sizeMm - 2 * borderMm) / maxDimension
  let tx = sizeMm / 2 - (bounds.minX + bounds.maxX) * scale / 2
  let ty = sizeMm / 2 - (bounds.minY + bounds.maxY) * scale / 2
  const scaled = transformed(curves, scale, tx, ty)
  const points: Point[] = [scaled[0]!.p0]
  for (const curve of scaled) flatten(curve, points)
  const polygon = simplePolygon(points)
  if (borderMm === 0) {
    return { cutPath: cubicPath(scaled), bodyTransform: `matrix(${format(scale)} 0 0 ${format(scale)} ${format(tx)} ${format(ty)})` }
  }
  const { inflatePathsD, JoinType, EndType } = await import('clipper2-ts')
  const expanded = inflatePathsD([polygon], borderMm, JoinType.Round, EndType.Polygon, 2, 3, ARC_TOLERANCE_MM)
  if (expanded.length !== 1) return failGeometry()
  const contour = simplePolygon(expanded[0]!)
  const outer = boundsOfPoints(contour)
  const dimension = Math.max(outer.maxX - outer.minX, outer.maxY - outer.minY)
  if (Math.abs(dimension - sizeMm) > MAX_ERROR_MM) return failGeometry()
  const dx = sizeMm / 2 - (outer.minX + outer.maxX) / 2
  const dy = sizeMm / 2 - (outer.minY + outer.maxY) / 2
  tx += dx
  ty += dy
  const cutPath = `${contour.map((p, index) => `${index === 0 ? 'M' : 'L'}${format(p.x + dx)} ${format(p.y + dy)}`).join('')}Z`
  return { cutPath, bodyTransform: `matrix(${format(scale)} 0 0 ${format(scale)} ${format(tx)} ${format(ty)})` }
}
