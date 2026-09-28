import type { StickerSheetBranding } from './stickerSheetBranding'

interface Point { x: number; y: number }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
interface RasterSilhouette { width: number; height: number; contours: Point[][] }
export interface BrandingBounds { x: number; y: number; width: number; height: number }
interface BrandingGeometry { cutPath: string; scale: number; x: number; y: number; bounds: BrandingBounds }

const MAX_RASTER_SIDE = 4096
const MAX_PIXELS = 16 * 1024 * 1024
const MAX_EDGES = 200_000
const MAX_CONTOURS = 256
const MAX_POLYGON_VERTICES = 20_000
const MAX_NEAREST_OPERATIONS = 8_000_000
const invalid = (): never => { throw new Error('invalidBrandingGeometry') }

function area(path: Point[]): number {
  let sum = 0
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!
    const b = path[(i + 1) % path.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

function boundsOf(paths: Point[][]): Bounds {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const path of paths) {
    for (const point of path) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return invalid()
      bounds.minX = Math.min(bounds.minX, point.x)
      bounds.minY = Math.min(bounds.minY, point.y)
      bounds.maxX = Math.max(bounds.maxX, point.x)
      bounds.maxY = Math.max(bounds.maxY, point.y)
    }
  }
  return bounds
}

function collinear(a: Point, b: Point, c: Point): boolean {
  return (b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x)
}

/**
 * Trace every visible pixel cell, including edges touching the canvas. Even
 * semitransparent lettering belongs to the sticker; opacity is not a cut mask.
 * Clockwise turns keep diagonal-only contacts as separate contours. Holes have
 * the opposite winding and never become cut paths.
 */
export function traceAlphaContours(alpha: Uint8Array, width: number, height: number): Point[][] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_PIXELS || alpha.length !== width * height) return invalid()
  interface Edge { start: number; end: number; direction: number }
  const edges: Edge[] = []
  const outgoing = new Map<number, number[]>()
  const stride = width + 1
  const add = (x: number, y: number, dx: number, dy: number, direction: number) => {
    if (edges.length >= MAX_EDGES) return invalid()
    const start = y * stride + x
    const end = (y + dy) * stride + x + dx
    const index = edges.length
    edges.push({ start, end, direction })
    const next = outgoing.get(start) ?? []
    next.push(index)
    outgoing.set(start, next)
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (alpha[index] === 0) continue
      if (y === 0 || alpha[index - width] === 0) add(x, y, 1, 0, 0)
      if (x === width - 1 || alpha[index + 1] === 0) add(x + 1, y, 0, 1, 1)
      if (y === height - 1 || alpha[index + width] === 0) add(x + 1, y + 1, -1, 0, 2)
      if (x === 0 || alpha[index - 1] === 0) add(x, y + 1, 0, -1, 3)
    }
  }
  if (!edges.length) return invalid()
  const used = new Uint8Array(edges.length)
  const contours: Point[][] = []
  for (let first = 0; first < edges.length; first++) {
    if (used[first]) continue
    const path: Point[] = []
    let current = first
    for (let step = 0; step <= edges.length; step++) {
      if (used[current]) return invalid()
      const edge = edges[current]!
      used[current] = 1
      const point = { x: edge.start % stride, y: Math.floor(edge.start / stride) }
      while (path.length > 1 && collinear(path.at(-2)!, path.at(-1)!, point)) path.pop()
      path.push(point)
      if (edge.end === edges[first]!.start) break
      const candidates = (outgoing.get(edge.end) ?? []).filter((index) => !used[index])
      const rank = (index: number) => [1, 0, 3, 2].indexOf((edges[index]!.direction - edge.direction + 4) % 4)
      candidates.sort((a, b) => rank(a) - rank(b))
      if (!candidates.length || step === edges.length) return invalid()
      current = candidates[0]!
    }
    while (path.length > 2 && collinear(path.at(-2)!, path.at(-1)!, path[0]!)) path.pop()
    while (path.length > 2 && collinear(path.at(-1)!, path[0]!, path[1]!)) path.shift()
    if (path.length >= 3 && area(path) > 0) {
      contours.push(path)
      if (contours.length > MAX_CONTOURS) return invalid()
    }
  }
  if (!contours.length) return invalid()
  return contours
}

const rasterCache = new Map<string, Promise<RasterSilhouette>>()

async function rasterize(branding: StickerSheetBranding): Promise<RasterSilhouette> {
  const ratio = branding.aspectRatio
  if (!Number.isFinite(ratio) || ratio < 0.02 || ratio > 50) return invalid()
  // Fractional draw dimensions keep the original aspect ratio exact; only the
  // backing canvas rounds up to integral pixels.
  const width = ratio >= 1 ? MAX_RASTER_SIDE : MAX_RASTER_SIDE * ratio
  const height = ratio >= 1 ? MAX_RASTER_SIDE / ratio : MAX_RASTER_SIDE
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width)
  canvas.height = Math.ceil(height)
  if (canvas.width * canvas.height > MAX_PIXELS) return invalid()
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return invalid()
  const url = URL.createObjectURL(new Blob([branding.svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, width, height)
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
    const alpha = new Uint8Array(canvas.width * canvas.height)
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!
    return { width, height, contours: traceAlphaContours(alpha, canvas.width, canvas.height) }
  } finally {
    URL.revokeObjectURL(url)
    canvas.width = 0
    canvas.height = 0
  }
}

function silhouette(branding: StickerSheetBranding): Promise<RasterSilhouette> {
  const previous = rasterCache.get(branding.svg)
  if (previous) {
    rasterCache.delete(branding.svg)
    rasterCache.set(branding.svg, previous)
    return previous
  }
  const pending = rasterize(branding).catch((error: unknown) => {
    if (rasterCache.get(branding.svg) === pending) rasterCache.delete(branding.svg)
    throw error
  })
  rasterCache.set(branding.svg, pending)
  while (rasterCache.size > 3) rasterCache.delete(rasterCache.keys().next().value!)
  return pending
}

function nearestOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0
  return { x: a.x + t * dx, y: a.y + t * dy }
}

interface Connection { a: Point; b: Point; distance: number }
interface Segment extends Bounds { a: Point; b: Point }
interface SegmentTree extends Bounds { segments?: Segment[]; left?: SegmentTree; right?: SegmentTree }

/** A spatial hierarchy avoids comparing every staircase vertex to every edge. */
function segmentTree(path: Point[]): SegmentTree {
  const build = (segments: Segment[]): SegmentTree => {
    const node: SegmentTree = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const segment of segments) {
      node.minX = Math.min(node.minX, segment.minX)
      node.minY = Math.min(node.minY, segment.minY)
      node.maxX = Math.max(node.maxX, segment.maxX)
      node.maxY = Math.max(node.maxY, segment.maxY)
    }
    if (segments.length <= 8) node.segments = segments
    else {
      const axis = node.maxX - node.minX >= node.maxY - node.minY ? 'x' : 'y'
      segments.sort((a, b) => (a.a[axis] + a.b[axis]) - (b.a[axis] + b.b[axis]))
      const middle = Math.floor(segments.length / 2)
      node.left = build(segments.slice(0, middle))
      node.right = build(segments.slice(middle))
    }
    return node
  }
  return build(path.map((a, index) => {
    const b = path[(index + 1) % path.length]!
    return { a, b, minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) }
  }))
}

function boxDistance(point: Point, box: Bounds): number {
  return Math.max(box.minX - point.x, point.x - box.maxX, 0) ** 2 + Math.max(box.minY - point.y, point.y - box.maxY, 0) ** 2
}

function nearestConnection(a: Point[], b: Point[], treeA: SegmentTree, treeB: SegmentTree, budget: { operations: number }): Connection {
  let result: Connection = { a: a[0]!, b: b[0]!, distance: (a[0]!.x - b[0]!.x) ** 2 + (a[0]!.y - b[0]!.y) ** 2 }
  const inspect = (point: Point, node: SegmentTree, reversed: boolean) => {
    if (++budget.operations > MAX_NEAREST_OPERATIONS) return invalid()
    if (boxDistance(point, node) >= result.distance) return
    if (node.segments) {
      for (const segment of node.segments) {
        if (++budget.operations > MAX_NEAREST_OPERATIONS) return invalid()
        if (boxDistance(point, segment) >= result.distance) continue
        const closest = nearestOnSegment(point, segment.a, segment.b)
        const distance = (point.x - closest.x) ** 2 + (point.y - closest.y) ** 2
        if (distance < result.distance) result = { a: reversed ? closest : point, b: reversed ? point : closest, distance }
      }
    } else {
      const left = node.left!
      const right = node.right!
      if (boxDistance(point, left) <= boxDistance(point, right)) {
        inspect(point, left, reversed)
        inspect(point, right, reversed)
      } else {
        inspect(point, right, reversed)
        inspect(point, left, reversed)
      }
    }
  }
  for (const point of a) inspect(point, treeB, false)
  for (const point of b) inspect(point, treeA, true)
  return result
}

/** Prim's tree joins glyphs with the shortest available boundary-to-boundary links. */
function connectingTree(paths: Point[][]): Connection[] {
  const connected = new Set([0])
  const best = new Map<number, Connection>()
  const links: Connection[] = []
  const budget = { operations: 0 }
  const trees = paths.map(segmentTree)
  let newest = 0
  while (connected.size < paths.length) {
    for (let i = 0; i < paths.length; i++) {
      if (connected.has(i)) continue
      const connection = nearestConnection(paths[newest]!, paths[i]!, trees[newest]!, trees[i]!, budget)
      if (!best.has(i) || connection.distance < best.get(i)!.distance) best.set(i, connection)
    }
    let chosen = -1
    let distance = Infinity
    for (const [index, connection] of best) {
      if (!connected.has(index) && connection.distance < distance) {
        chosen = index
        distance = connection.distance
      }
    }
    if (chosen < 0) return invalid()
    links.push(best.get(chosen)!)
    connected.add(chosen)
    newest = chosen
  }
  return links
}

function number(value: number): string {
  if (!Number.isFinite(value)) return invalid()
  return String(Number(value.toFixed(12)))
}

/** Pure physical composition, separate from browser sampling for deterministic QA. */
export async function outlineBrandingContours(contours: Point[][], sizeMm: number, borderMm: number): Promise<BrandingGeometry> {
  if (!Number.isFinite(sizeMm) || sizeMm <= 0 || !Number.isFinite(borderMm) || borderMm < 0 || borderMm >= sizeMm / 2 ||
      !contours.length || contours.length > MAX_CONTOURS || contours.some((path) => path.length < 3) ||
      contours.reduce((sum, path) => sum + path.length, 0) > MAX_POLYGON_VERTICES) return invalid()
  boundsOf(contours)
  const { unionD, simplifyPathsD, inflatePathsD, FillRule, JoinType, EndType } = await import('clipper2-ts')
  const exteriors = (paths: Point[][]) => paths.filter((path) => path.length >= 3 && area(path) > 0)
  let bodies = exteriors(unionD(simplifyPathsD(contours, 0.5), [], FillRule.NonZero, 3))
  if (!bodies.length || bodies.length > MAX_CONTOURS) return invalid()
  if (bodies.length > 1) {
    if (borderMm === 0) return invalid()
    const original = boundsOf(bodies)
    const initialScale = (sizeMm - 2 * borderMm) / Math.max(original.maxX - original.minX, original.maxY - original.minY)
    // Bridges remain thin before the requested white border is added. Build them
    // in source coordinates so their ends are included in the final-size bounds.
    const radius = Math.max(0.5, Math.max(0.02, Math.min(0.15, borderMm / 10)) / initialScale)
    const bridges: Point[][] = []
    for (const link of connectingTree(bodies)) {
      if (link.distance < 1e-12) {
        bridges.push(Array.from({ length: 16 }, (_, i) => ({
          x: link.a.x + Math.cos(i * Math.PI / 8) * radius,
          y: link.a.y + Math.sin(i * Math.PI / 8) * radius
        })))
      } else {
        bridges.push(...inflatePathsD([[link.a, link.b]], radius, JoinType.Round, EndType.Round, 2, 3, 0.2))
      }
    }
    bodies = exteriors(unionD([...bodies, ...bridges], [], FillRule.NonZero, 3))
  }
  if (bodies.length !== 1) return invalid()
  const bodyBounds = boundsOf(bodies)
  const longest = Math.max(bodyBounds.maxX - bodyBounds.minX, bodyBounds.maxY - bodyBounds.minY)
  if (!Number.isFinite(longest) || longest <= 0) return invalid()
  const scale = (sizeMm - 2 * borderMm) / longest
  let x = sizeMm / 2 - (bodyBounds.minX + bodyBounds.maxX) * scale / 2
  let y = sizeMm / 2 - (bodyBounds.minY + bodyBounds.maxY) * scale / 2
  const physical = bodies.map((path) => path.map((p) => ({ x: p.x * scale + x, y: p.y * scale + y })))
  const cut = borderMm > 0 ? exteriors(inflatePathsD(physical, borderMm, JoinType.Round, EndType.Polygon, 2, 3, 0.01)) : physical
  if (cut.length !== 1 || cut[0]!.length > MAX_POLYGON_VERTICES || area(cut[0]!) <= 0) return invalid()
  const outer = boundsOf(cut)
  if (Math.abs(Math.max(outer.maxX - outer.minX, outer.maxY - outer.minY) - sizeMm) > 0.03) return invalid()
  const dx = sizeMm / 2 - (outer.minX + outer.maxX) / 2
  const dy = sizeMm / 2 - (outer.minY + outer.maxY) / 2
  x += dx
  y += dy
  const points = cut[0]!
  if (new Set(points.map((p) => `${p.x},${p.y}`)).size !== points.length) return invalid()
  const cutPath = points.map((p, index) => `${index ? 'L' : 'M'}${number(p.x + dx)} ${number(p.y + dy)}`).join('') + 'Z'
  return {
    cutPath, scale, x, y,
    bounds: { x: outer.minX + dx, y: outer.minY + dy, width: outer.maxX - outer.minX, height: outer.maxY - outer.minY }
  }
}

function vectorArtwork(branding: StickerSheetBranding, raster: RasterSilhouette, geometry: BrandingGeometry): string {
  const document = new DOMParser().parseFromString(branding.svg, 'image/svg+xml')
  const root = document.documentElement
  if (root.localName !== 'svg' || document.querySelector('parsererror, image, script, foreignObject, style')) return invalid()
  const elements = [root, ...root.querySelectorAll('*')]
  const ids = new Map<string, string>()
  for (const [index, element] of elements.entries()) {
    if (!element.hasAttribute('id')) continue
    const old = element.getAttribute('id')!
    const replacement = `branding-${index}`
    ids.set(old, replacement)
    element.setAttribute('id', replacement)
  }
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      let value = attribute.value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (match, _quote: string, id: string) =>
        ids.has(id) ? `url(#${ids.get(id)})` : match)
      if (attribute.localName === 'href' && value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`
      if (value !== attribute.value) element.setAttributeNS(attribute.namespaceURI, attribute.name, value)
    }
  }
  root.setAttribute('x', '0')
  root.setAttribute('y', '0')
  root.setAttribute('width', number(raster.width))
  root.setAttribute('height', number(raster.height))
  root.setAttribute('overflow', 'hidden')
  const transform = `matrix(${number(geometry.scale)} 0 0 ${number(geometry.scale)} ${number(geometry.x)} ${number(geometry.y)})`
  return `<g transform="${transform}">${new XMLSerializer().serializeToString(root)}</g>`
}

/** Only contour detection uses pixels. The returned printable artwork remains SVG. */
export async function brandingStickerOutline(branding: StickerSheetBranding, sizeMm: number, borderMm: number): Promise<{ cutPath: string; artwork: string; bounds: BrandingBounds }> {
  try {
    const raster = await silhouette(branding)
    const geometry = await outlineBrandingContours(raster.contours, sizeMm, borderMm)
    return { cutPath: geometry.cutPath, artwork: vectorArtwork(branding, raster, geometry), bounds: geometry.bounds }
  } catch {
    return invalid()
  }
}
