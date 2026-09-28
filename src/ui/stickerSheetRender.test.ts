// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { BotEngine } from '@/bot/engine'
import { EXPRESSION_BY_ID } from '@/bot/expressions'
import { POSE_FIGE, type Fige } from '@/bot/figes'
import { RAYON } from '@/bot/repere'
import { COLORS, SHAPES, SHAPE_BY_ID } from '@/bot/skins'
import { createStickerSheetLayout, DEFAULT_STICKER_SHEET_SETTINGS, type StickerBrandingPlacement, type StickerSheetSettings } from './stickerSheet'
import { renderStickerSheet, stickerSheetZip } from './stickerSheetRender'
import { brandingStickerOutline } from './stickerBrandingOutline'

vi.mock('./stickerBrandingOutline', () => ({
  brandingStickerOutline: vi.fn(async (brand: { aspectRatio: number }, sizeMm: number, borderMm: number) => {
    const height = (sizeMm - 2 * borderMm) / brand.aspectRatio + 2 * borderMm
    const y = (sizeMm - height) / 2
    return {
      cutPath: `M0 ${y}L${sizeMm} ${y}L${sizeMm} ${y + height}L0 ${y + height}Z`,
      artwork: '<svg data-branding="" viewBox="0 0 20 10"><path d="M1 1L19 1L19 9L1 9Z" fill="#113355"/></svg>',
      bounds: { x: 0, y, width: sizeMm, height }
    }
  })
}))
const SETTINGS = { ...DEFAULT_STICKER_SHEET_SETTINGS, autoFit: false }

const items: Fige[] = SHAPES.map((shape, index) => ({
  id: `f${index}`, shape: shape.id, color: COLORS[index]!.id,
  expression: index % 2 ? 'surpris' : 'neutre'
}))
const parse = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml')

describe('branding row spacing', () => {
  const tenBots = Array.from({ length: 10 }, (_, index) => ({ ...items[index % items.length]!, id: `row-${index}` }))
  const brand = { name: 'wide.svg', svg: '<svg viewBox="0 0 100 5"/>', aspectRatio: 20 }
  const paper: StickerSheetSettings = {
    ...DEFAULT_STICKER_SHEET_SETTINGS, preset: 'quarter-letter', widthMm: 139.7, heightMm: 107.95
  }
  const render = (brandingPlacement?: StickerBrandingPlacement) => renderStickerSheet(tenBots, { ...paper, brandingPlacement }, brand)

  it('moves only the two bottom-row bots left when the quarter-letter logo grows to 52 mm', async () => {
    const base = await render()
    const sheet = await render({ sizeMm: 52, centerXMm: 100.5, centerYMm: 84.63 })
    const size = sheet.layout.settings.stickerSizeMm
    expect(size).toBeCloseTo(26.65)
    expect(sheet.layout.placements.slice(0, 8)).toEqual(base.layout.placements.slice(0, 8))
    expect(sheet.layout.placements[10]).toEqual(base.layout.placements[10])
    expect(sheet.layout.placements[8]!.x).toBeCloseTo(13.2)
    expect(sheet.layout.placements[9]!.x).toBeCloseTo(43.85)
    for (const index of [8, 9]) {
      const placement = sheet.layout.placements[index]!
      expect(base.layout.placements[index]!.x - placement.x).toBeCloseTo(12.675)
      expect(placement.y).toBe(base.layout.placements[index]!.y)
      for (const markup of [sheet.art, sheet.cut, sheet.overlay]) {
        for (const group of parse(markup).querySelectorAll(`[data-sticker-index="${index}"]`)) {
          expect(group.getAttribute('transform')).toBe(`translate(${placement.x} ${placement.y})`)
        }
      }
      expect(parse(sheet.art).querySelector(`[data-sticker-index="${index}"]`)?.innerHTML)
        .toBe(parse(base.art).querySelector(`[data-sticker-index="${index}"]`)?.innerHTML)
    }
    expect(sheet.layout.placements[9]!.x + size + paper.gapMm).toBeCloseTo(sheet.branding!.bounds.x)
    expect(sheet.layout.placements[9]!.x - sheet.layout.placements[8]!.x).toBeCloseTo(size + paper.gapMm)
    expect(sheet.branding?.placement).toEqual({ sizeMm: 52, centerXMm: 100.5, centerYMm: 84.63 })
    expect(sheet.brandingOverlaps).toBe(false)
    expect(sheet.brandingOutOfBounds).toBe(false)
    expect(() => stickerSheetZip(sheet)).not.toThrow()
  })

  it('recomputes row movement from the base grid when the logo grows, shrinks, or resets', async () => {
    const base = createStickerSheetLayout(paper, 11)
    for (const [sizeMm, expectedShift] of [[52, 12.675], [40, 6.675], [20, 0], [52, 12.675]]) {
      const sheet = await render({ sizeMm: sizeMm!, centerXMm: 100.5, centerYMm: 84.63 })
      for (const index of [8, 9]) {
        expect(base.placements[index]!.x - sheet.layout.placements[index]!.x).toBeCloseTo(expectedShift!)
      }
      expect(sheet.layout.settings.stickerSizeMm).toBe(base.settings.stickerSizeMm)
      expect(sheet.brandingOverlaps).toBe(false)
    }
    expect((await render()).layout.placements).toEqual(base.placements)
  })

  it('stops at the left margin and blocks export if the logo still leaves insufficient room', async () => {
    const sheet = await render({ sizeMm: 64, centerXMm: 97.5, centerYMm: 84.63 })
    const base = createStickerSheetLayout(paper, 11)
    expect(sheet.layout.placements.slice(0, 8)).toEqual(base.placements.slice(0, 8))
    expect(sheet.layout.placements[8]!.x).toBe(paper.marginMm)
    expect(sheet.layout.placements[9]!.x).toBeCloseTo(40.65)
    expect(sheet.brandingOutOfBounds).toBe(false)
    expect(sheet.brandingOverlaps).toBe(true)
    expect(() => stickerSheetZip(sheet)).toThrow('incompleteSheet')
  })

  it.each([
    { sizeMm: 20, centerXMm: 115, centerYMm: 84.63 },
    { sizeMm: 8, centerXMm: 15, centerYMm: 84.63 }
  ])('keeps a row in place when the logo is separated to either side: %j', async (placement) => {
    const sheet = await render(placement)
    expect(sheet.layout.placements).toEqual(createStickerSheetLayout(paper, 11).placements)
    expect(sheet.brandingOverlaps).toBe(false)
    expect(() => stickerSheetZip(sheet)).not.toThrow()
  })
})

describe('sticker sheet print documents', () => {
  it('preserves bot geometry when independent branding fits without moving its row', async () => {
    const brand = { name: 'logo.svg', svg: '<svg viewBox="0 0 100 5"/>', aspectRatio: 20 }
    const before = await renderStickerSheet(items.slice(0, 7), { ...DEFAULT_STICKER_SHEET_SETTINGS }, brand)
    const placement = { sizeMm: 100, centerXMm: 200, centerYMm: 194 }
    const after = await renderStickerSheet(items.slice(0, 7), { ...DEFAULT_STICKER_SHEET_SETTINGS, brandingPlacement: placement }, brand)
    expect(brandingStickerOutline).toHaveBeenLastCalledWith(brand, 100, 2)
    expect(after.layout.placements).toEqual(before.layout.placements)
    expect(after.layout.settings.stickerSizeMm).toBe(before.layout.settings.stickerSizeMm)
    const beforeArt = parse(before.art)
    const afterArt = parse(after.art)
    for (let index = 0; index < 7; index++) {
      expect(afterArt.querySelector(`[data-sticker-index="${index}"]`)?.outerHTML)
        .toBe(beforeArt.querySelector(`[data-sticker-index="${index}"]`)?.outerHTML)
    }
    for (const markup of [after.art, after.cut, after.overlay]) {
      const groups = parse(markup).querySelectorAll('[data-sticker-index="7"]')
      for (const group of groups) expect(group.getAttribute('transform')).toBe('translate(150 144)')
    }
    expect(afterArt.querySelector('[data-sticker-index="7"] [data-sticker-border]')?.getAttribute('d'))
      .toBe(parse(after.cut).querySelector('[data-sticker-index="7"] path')?.getAttribute('d'))
    expect(after.branding).toEqual({ placement, bounds: { x: 150, y: 189.6, width: 100, height: 8.8 } })
    expect(after.brandingOutOfBounds).toBe(false)
    expect(after.brandingOverlaps).toBe(false)
    expect(() => stickerSheetZip(after)).not.toThrow()
  })

  it('allows a wide logo near the page edge using its visible contour rather than its square canvas', async () => {
    const brand = { name: 'wide.svg', svg: '<svg viewBox="0 0 100 5"/>', aspectRatio: 20 }
    const sheet = await renderStickerSheet([], {
      ...DEFAULT_STICKER_SHEET_SETTINGS,
      brandingPlacement: { sizeMm: 100, centerXMm: 148.5, centerYMm: 15 }
    }, brand)
    expect(parse(sheet.art).querySelector('[data-sticker-index="0"]')?.getAttribute('transform')).toBe('translate(98.5 -35)')
    expect(sheet.branding!.bounds.y).toBeCloseTo(10.6)
    expect(sheet.branding!.bounds.height).toBeCloseTo(8.8)
    expect(sheet.brandingOutOfBounds).toBe(false)
    expect(() => stickerSheetZip(sheet)).not.toThrow()
  })

  it.each([
    [{ sizeMm: 100, centerXMm: 59.98, centerYMm: 100 }, false],
    [{ sizeMm: 100, centerXMm: 59.9, centerYMm: 100 }, true],
    [{ sizeMm: 100, centerXMm: 237.1, centerYMm: 100 }, true],
    [{ sizeMm: 100, centerXMm: 150, centerYMm: 35.9 }, true],
    [{ sizeMm: 100, centerXMm: 150, centerYMm: 174.1 }, true]
  ])('flags actual branding outside margins and prevents incomplete exports: %j', async (brandingPlacement, outside) => {
    const brand = { name: 'logo.svg', svg: '<svg viewBox="0 0 20 10"/>', aspectRatio: 2 }
    const sheet = await renderStickerSheet([], { ...DEFAULT_STICKER_SHEET_SETTINGS, brandingPlacement }, brand)
    expect(sheet.brandingOutOfBounds).toBe(outside)
    if (outside) expect(() => stickerSheetZip(sheet)).toThrow('incompleteSheet')
    else expect(() => stickerSheetZip(sheet)).not.toThrow()
  })

  it('snapshots nested branding placement before asynchronous capture', async () => {
    const placement = { sizeMm: 90, centerXMm: 150, centerYMm: 100 }
    const brand = { name: 'logo.svg', svg: '<svg viewBox="0 0 20 10"/>', aspectRatio: 2 }
    const pending = renderStickerSheet(items.slice(0, 1), { ...DEFAULT_STICKER_SHEET_SETTINGS, brandingPlacement: placement }, brand)
    placement.sizeMm = 500
    placement.centerXMm = 0
    const sheet = await pending
    expect(sheet.branding?.placement).toEqual({ sizeMm: 90, centerXMm: 150, centerYMm: 100 })
    expect(sheet.layout.settings.brandingPlacement).toEqual(sheet.branding?.placement)
  })

  it('includes vector branding as a cut sticker in the same auto-fitted layout', async () => {
    const brand = { name: 'logo.svg', svg: '<svg viewBox="0 0 20 10"><path d="M1 1L19 9"/></svg>', aspectRatio: 2 }
    const sheet = await renderStickerSheet(items.slice(0, 7), { ...DEFAULT_STICKER_SHEET_SETTINGS, backgroundColor: '#ddeeff' }, brand)
    expect(sheet.layout.placements).toHaveLength(8)
    expect(sheet.layout.settings.stickerSizeMm).toBe(66.25)
    expect(brandingStickerOutline).toHaveBeenLastCalledWith(brand, 66.25, 2)
    const art = parse(sheet.art)
    const cut = parse(sheet.cut)
    expect(art.documentElement.firstElementChild?.getAttribute('fill')).toBe('#ddeeff')
    expect(parse(sheet.overlay).documentElement.firstElementChild?.getAttribute('fill')).toBe('#ddeeff')
    expect(cut.querySelectorAll('rect')).toHaveLength(0)
    expect(cut.querySelectorAll('path')).toHaveLength(8)
    const logo = art.querySelector('[data-sticker-index="7"]')!
    const logoCut = cut.querySelector('[data-sticker-index="7"]')!
    expect(logo.getAttribute('transform')).toBe(logoCut.getAttribute('transform'))
    expect(logo.querySelector('[data-sticker-border]')?.getAttribute('d')).toBe(logoCut.querySelector('path')?.getAttribute('d'))
    expect(logo.querySelector('svg path')?.getAttribute('fill')).toBe('#113355')
    expect(art.querySelectorAll('image')).toHaveLength(0)
  })

  it('can export a branding-only sheet, with one cut and the chosen paper colour', async () => {
    const brand = { name: 'logo.svg', svg: '<svg viewBox="0 0 20 10"/>', aspectRatio: 2 }
    const sheet = await renderStickerSheet([], { ...DEFAULT_STICKER_SHEET_SETTINGS, backgroundColor: '#eebb99' }, brand)
    expect(sheet.layout.fits).toBe(true)
    expect(parse(sheet.cut).querySelectorAll('path')).toHaveLength(1)
    expect(() => stickerSheetZip(sheet)).not.toThrow()
  })

  it('shares physical placement and one exterior outline per bot across art and die', async () => {
    const sheet = await renderStickerSheet(items, { ...SETTINGS })
    const art = parse(sheet.art)
    const cut = parse(sheet.cut)
    expect(sheet.layout.fits).toBe(true)
    for (const document of [art, cut, parse(sheet.overlay)]) {
      expect(document.querySelector('parsererror')).toBeNull()
      expect(document.documentElement.getAttribute('width')).toBe('297mm')
      expect(document.documentElement.getAttribute('height')).toBe('210mm')
      expect(document.documentElement.getAttribute('viewBox')).toBe('0 0 297 210')
      expect(document.querySelectorAll('image, foreignObject, animate, animateTransform, script, style')).toHaveLength(0)
    }
    expect(cut.querySelectorAll('path')).toHaveLength(items.length)
    expect(cut.querySelectorAll('rect, circle, mask, image')).toHaveLength(0)
    const artGroups = [...art.querySelectorAll('[data-sticker-index]')]
    const cutGroups = [...cut.querySelectorAll('[data-sticker-index]')]
    for (let index = 0; index < items.length; index++) {
      expect(artGroups[index]!.getAttribute('transform')).toBe(cutGroups[index]!.getAttribute('transform'))
      const whiteBorder = artGroups[index]!.querySelector('[data-sticker-border]')!
      const cutPath = cutGroups[index]!.querySelector('path')!
      expect(whiteBorder.getAttribute('d')).toBe(cutPath.getAttribute('d'))
      expect(whiteBorder.getAttribute('fill')).toBe('#ffffff')
      expect(cutPath.getAttribute('fill')).toBe('none')
      expect(cutPath.getAttribute('stroke-width')).toBe('0.1')
      expect(cutPath.getAttribute('d')).toMatch(/Z$/)
    }
  })

  it('preserves each frozen identity and white eyes when the capture host is reused', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    try {
      const sheet = await renderStickerSheet([...items, { ...items[0]!, id: 'duplicate' }], { ...SETTINGS })
      const art = parse(sheet.art)
      const ids = [...art.querySelectorAll('[id]')].map((element) => element.id)
      expect(new Set(ids).size).toBe(ids.length)
      const portraits = [...art.querySelectorAll('[data-sticker-index]')]
      for (const [index, item] of [...items, items[0]!].entries()) {
        const portrait = portraits[index]!
        const mask = portrait.querySelector('mask')!
        expect(portrait.querySelector('g[mask]')?.getAttribute('mask')).toBe(`url(#${mask.id})`)
        expect(portrait.querySelector('g[mask] rect')?.getAttribute('fill')).toBe(COLORS.find((color) => color.id === item.color)!.hex)
        expect(portrait.querySelector('[data-bot-outline]')?.getAttribute('fill')).toBe('#ffffff')
        const frame = new BotEngine(RAYON, 'idle', SHAPE_BY_ID.get(item.shape)!.radii, EXPRESSION_BY_ID.get(item.expression)!).sample(POSE_FIGE)
        expect(mask.firstElementChild?.getAttribute('d')).toBe(frame.bodyPath)
        expect(mask.querySelectorAll('path')[1]?.getAttribute('transform')).toBe(frame.eyes[0]!.matrix)
      }
      expect(raf).not.toHaveBeenCalled()
    } finally {
      raf.mockRestore()
    }
  })

  it('exports exactly two matching SVG files in the ZIP', async () => {
    const sheet = await renderStickerSheet(items.slice(0, 2), { ...SETTINGS, widthMm: 215.9, heightMm: 279.4 })
    const blob = stickerSheetZip(sheet)
    expect(blob.type).toBe('application/zip')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const data = new DataView(bytes.buffer)
    const entries: Record<string, string> = {}
    let offset = 0
    while (data.getUint32(offset, true) === 0x04034b50) {
      const length = data.getUint32(offset + 18, true)
      const nameLength = data.getUint16(offset + 26, true)
      const extraLength = data.getUint16(offset + 28, true)
      const decoder = new TextDecoder()
      const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
      const start = offset + 30 + nameLength + extraLength
      entries[name] = decoder.decode(bytes.subarray(start, start + length))
      offset = start + length
    }
    expect(entries).toEqual({ 'arte.svg': sheet.art, 'troquel.svg': sheet.cut })
    expect(parse(entries['arte.svg']!).documentElement.getAttribute('width')).toBe('215.9mm')
  })

  it('shows a capacity-limited preview but rejects incomplete or empty print jobs', async () => {
    const overflow = await renderStickerSheet(items, { ...SETTINGS, widthMm: 60, heightMm: 60 })
    expect(overflow.layout.capacity).toBe(1)
    expect(parse(overflow.cut).querySelectorAll('path')).toHaveLength(1)
    expect(() => stickerSheetZip(overflow)).toThrow('incompleteSheet')
    const empty = await renderStickerSheet([], { ...SETTINGS })
    expect(() => stickerSheetZip(empty)).toThrow('incompleteSheet')
  })

  it('snapshots dimensions before asynchronous capture and leaves existing exports independent', async () => {
    const settings = { ...SETTINGS }
    const pending = renderStickerSheet(items.slice(0, 1), settings)
    settings.widthMm = 100
    settings.stickerSizeMm = 500
    const sheet = await pending
    expect(sheet.layout.settings.widthMm).toBe(297)
    expect(sheet.layout.settings.stickerSizeMm).toBe(40)
    expect(parse(sheet.art).documentElement.getAttribute('width')).toBe('297mm')
  })
})
