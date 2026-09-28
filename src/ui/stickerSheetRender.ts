import type { Fige } from '@/bot/figes'
import { portraitsDuBot } from './capture'
import { DEMI_CADRE, sansCommentaires } from './export'
import {
  createStickerOutline,
  createStickerSheetLayout,
  resolveStickerBrandingPlacement,
  type StickerBrandingPlacement,
  type StickerSheetLayout,
  type StickerSheetSettings
} from './stickerSheet'
import { zipBlob } from './zip'
import type { StickerSheetBranding } from './stickerSheetBranding'
import { brandingStickerOutline, type BrandingBounds } from './stickerBrandingOutline'
import { exportPrintPdf } from './printExport'

export interface StickerSheetRender {
  art: string
  cut: string
  overlay: string
  layout: StickerSheetLayout
  branding?: { placement: StickerBrandingPlacement; bounds: BrandingBounds }
  brandingOutOfBounds?: boolean
  brandingOverlaps?: boolean
}

/** Move only rows that need room for the logo, keeping their bot order and spacing. */
function reflowRowsForBranding(layout: StickerSheetLayout, brandingIndex: number, bounds: BrandingBounds): boolean {
  const { stickerSizeMm: size, gapMm: gap, marginMm: margin } = layout.settings
  const rows = new Map<number, StickerSheetLayout['placements']>()
  for (const placement of layout.placements) {
    if (placement.index >= brandingIndex) continue
    const row = rows.get(placement.y) ?? []
    row.push(placement)
    rows.set(placement.y, row)
  }
  // Contour generation has the same 0.03 mm physical tolerance as the sheet edges.
  const tolerance = 0.03
  let overlaps = false
  for (const [y, row] of rows) {
    if (y + size + gap <= bounds.y + tolerance || bounds.y + bounds.height + gap <= y + tolerance) continue
    const left = Math.min(...row.map((placement) => placement.x))
    const right = Math.max(...row.map((placement) => placement.x + size))
    if (right + gap <= bounds.x + tolerance || bounds.x + bounds.width + gap <= left + tolerance) continue
    const needed = right + gap - bounds.x
    const available = Math.max(0, left - margin)
    const shift = Math.min(needed, available)
    for (const placement of row) placement.x -= shift
    if (needed - shift > tolerance) overlaps = true
  }
  return overlaps
}

/** A capture host reuses its mask IDs. Give every placed portrait its own namespace. */
function portraitContents(svg: SVGSVGElement, index: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const ids = new Map<string, string>()
  clone.querySelectorAll('[id]').forEach((element, n) => {
    const oldId = element.getAttribute('id')!
    const newId = `sticker-${index}-${n}`
    ids.set(oldId, newId)
    element.setAttribute('id', newId)
  })
  clone.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      let value = attribute.value.replace(/url\(#([^)]*)\)/g, (match, id: string) =>
        ids.has(id) ? `url(#${ids.get(id)})` : match
      )
      if ((attribute.localName === 'href') && value.startsWith('#') && ids.has(value.slice(1))) {
        value = `#${ids.get(value.slice(1))}`
      }
      if (value !== attribute.value) element.setAttributeNS(attribute.namespaceURI, attribute.name, value)
    }
  })
  const serializer = new XMLSerializer()
  return sansCommentaires([...clone.children].map((child) => serializer.serializeToString(child)).join(''))
}

/** All three vector views use exactly the same geometry, in millimetres. */
export async function renderStickerSheet(
  items: Fige[],
  settings: StickerSheetSettings,
  branding: StickerSheetBranding | null = null
): Promise<StickerSheetRender> {
  const brand = branding ? { ...branding } : null
  const layout = createStickerSheetLayout({ ...settings }, items.length + (brand ? 1 : 0))
  const portraits = items.slice(0, layout.placements.length).map((item) => ({ ...item }))
  const captures = await portraitsDuBot(portraits, DEMI_CADRE * 2, (svg, index) => {
    const bodyPath = svg.querySelector('[data-bot-outline]')?.getAttribute('d')
    if (!bodyPath) throw new Error('invalidGeometry')
    // Serialize now: the next capture mutates this same live SVG element.
    return { bodyPath, artwork: portraitContents(svg, index) }
  }, { paper: '#ffffff' })

  let renderedBranding: StickerSheetRender['branding']
  let brandingOutOfBounds = false
  let brandingOverlaps = false
  let brandingSticker: { outline: Awaited<ReturnType<typeof brandingStickerOutline>>; x: number; y: number } | null = null
  if (brand && layout.placements[items.length]) {
    const placement = resolveStickerBrandingPlacement(layout)!
    const outline = await brandingStickerOutline(brand, placement.sizeMm, layout.settings.borderMm)
    const x = placement.centerXMm - placement.sizeMm / 2
    const y = placement.centerYMm - placement.sizeMm / 2
    const bounds = { ...outline.bounds, x: x + outline.bounds.x, y: y + outline.bounds.y }
    renderedBranding = { placement, bounds }
    brandingSticker = { outline, x, y }
    const { widthMm, heightMm, marginMm } = layout.settings
    const tolerance = 0.03
    brandingOutOfBounds = bounds.x < marginMm - tolerance || bounds.y < marginMm - tolerance ||
      bounds.x + bounds.width > widthMm - marginMm + tolerance || bounds.y + bounds.height > heightMm - marginMm + tolerance
    brandingOverlaps = reflowRowsForBranding(layout, items.length, bounds)
  }

  const placedSticker = (cutPath: string, artwork: string, index: number, placement = layout.placements[index]!) => {
    const { x, y } = placement
    const position = `translate(${x} ${y})`
    return {
      cut: `<g data-sticker-index="${index}" transform="${position}"><path d="${cutPath}" fill="none" stroke="#ff00a8" stroke-width="0.1" stroke-linejoin="round"/></g>`,
      art: `<g data-sticker-index="${index}" transform="${position}"><path data-sticker-border="" d="${cutPath}" fill="#ffffff"/>${artwork}</g>`
    }
  }
  const stickers = await Promise.all(captures.map(async (capture, index) => {
    const outline = await createStickerOutline(capture.bodyPath, layout.settings.stickerSizeMm, layout.settings.borderMm)
    return placedSticker(outline.cutPath, `<g transform="${outline.bodyTransform}">${capture.artwork}</g>`, index)
  }))
  if (brandingSticker) {
    const { outline, x, y } = brandingSticker
    stickers.push(placedSticker(outline.cutPath, outline.artwork, items.length, { index: items.length, x, y }))
  }
  const { widthMm, heightMm, backgroundColor } = layout.settings
  const document = (contents: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">${contents}</svg>`
  const background = `<rect width="${widthMm}" height="${heightMm}" fill="${backgroundColor}"/>`
  const artwork = stickers.map((sticker) => sticker.art).join('')
  const cutlines = stickers.map((sticker) => sticker.cut).join('')
  return {
    art: document(background + artwork),
    cut: document(cutlines),
    overlay: document(background + artwork + cutlines),
    layout,
    ...(renderedBranding ? { branding: renderedBranding, brandingOutOfBounds, brandingOverlaps } : {})
  }
}

/** Partial previews must never turn into incomplete print jobs. */
function assertCompleteSheet(sheet: StickerSheetRender): void {
  if (!sheet.layout.fits || !sheet.layout.placements.length || sheet.brandingOutOfBounds || sheet.brandingOverlaps) throw new Error('incompleteSheet')
}

export function stickerSheetZip(sheet: StickerSheetRender): Blob {
  assertCompleteSheet(sheet)
  const encode = new TextEncoder()
  return zipBlob([
    { name: 'arte.svg', data: encode.encode(sheet.art) },
    { name: 'troquel.svg', data: encode.encode(sheet.cut) }
  ])
}

/** CMYK affects artwork only; the cutter receives the original physical contours. */
export async function stickerSheetPrintZip(sheet: StickerSheetRender, signal?: AbortSignal): Promise<Blob> {
  assertCompleteSheet(sheet)
  const { art, cut } = sheet
  const { widthMm, heightMm } = sheet.layout.settings
  const pdf = await exportPrintPdf(art, widthMm, heightMm, signal)
  const data = new Uint8Array(await pdf.arrayBuffer())
  signal?.throwIfAborted()
  return zipBlob([
    { name: 'arte-cmyk.pdf', data },
    { name: 'troquel.svg', data: new TextEncoder().encode(cut) }
  ])
}
