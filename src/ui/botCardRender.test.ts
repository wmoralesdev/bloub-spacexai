// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BotEngine } from '@/bot/engine'
import { EXPRESSION_BY_ID } from '@/bot/expressions'
import { POSE_FIGE } from '@/bot/figes'
import { RAYON } from '@/bot/repere'
import { COLOR_BY_ID, SHAPE_BY_ID } from '@/bot/skins'
import { BOT_CARD_SIZE, createBotCard } from './botCard'
import { BOT_CARD_FRONT_LAYOUT, BOT_CARD_LAYOUT, exportBotCard, fitBotCardText, renderBotCardSvg } from './botCardRender'
import { versPng } from './capture'
import { exportPrintPdf } from './printExport'

vi.mock('./capture', () => ({ versPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }))
vi.mock('./printExport', () => ({ exportPrintPdf: vi.fn(async () => new Blob(['%PDF-print'], { type: 'application/pdf' })) }))

function contextMock() {
  return {
    font: '',
    measureText(this: { font: string }, text: string) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16)
      return { width: Array.from(text).length * size * 0.51 }
    }
  } as unknown as CanvasRenderingContext2D
}

beforeEach(() => {
  vi.mocked(exportPrintPdf).mockClear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => contextMock())
})
afterEach(() => vi.restoreAllMocks())

const parse = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml')
const BOT_URL = 'https://x.ai/bot/k0-KTE52S_yByrmgrzniJ'

describe('static bot card rendering', () => {
  it('exports the actual frozen component as vectors inside a white square', async () => {
    const card = { ...createBotCard(), name: 'Home robots', handle: '@SawyerMerritt', description: 'Control your home robots from chat.', shape: 'triangle' as const, expression: 'curieux' as const }
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const svg = parse(await renderBotCardSvg(card))
    const root = svg.documentElement
    expect(root.getAttribute('width')).toBe(String(BOT_CARD_SIZE))
    expect(root.getAttribute('height')).toBe(String(BOT_CARD_SIZE))
    expect(root.getAttribute('viewBox')).toBe('0 0 1000 1000')
    expect(root.firstElementChild?.getAttribute('fill')).toBe('#ffffff')
    expect(svg.querySelectorAll('foreignObject, image, animate, animateTransform, style, script')).toHaveLength(0)
    const frame = new BotEngine(RAYON, 'idle', SHAPE_BY_ID.get(card.shape)!.radii, EXPRESSION_BY_ID.get(card.expression)!).sample(POSE_FIGE)
    const mask = svg.querySelector('mask')!
    expect(mask.firstElementChild?.getAttribute('d')).toBe(frame.bodyPath)
    expect(mask.querySelectorAll('path')[1]?.getAttribute('transform')).toBe(frame.eyes[0]!.matrix)
    expect(svg.querySelector('g[mask] rect')?.getAttribute('fill')).toBe(COLOR_BY_ID.get(card.color)!.hex)
    expect(raf).not.toHaveBeenCalled()
    expect([...svg.querySelectorAll('text')].map((text) => text.textContent?.replace(/\s/g, '')))
      .toEqual([card.name, card.handle, card.description].map((text) => text.replace(/\s/g, '')))
  })

  it('preserves custom bot colors and XML characters without creating markup', async () => {
    const card = { ...createBotCard(), name: 'A <bot> & "friend"', handle: '@name', description: '<script>alert("x")</script> & done', bodyColor: '#00c77a' }
    const markup = await renderBotCardSvg(card)
    const svg = parse(markup)
    expect(svg.querySelector('parsererror, script')).toBeNull()
    expect(svg.querySelector('g[mask] rect')?.getAttribute('fill')).toBe(card.bodyColor)
    expect(svg.querySelector('text')?.textContent).toBe(card.name)
    expect(svg.querySelectorAll('text')[2]?.textContent?.replace(/\s/g, '')).toBe(card.description.replace(/\s/g, ''))
    expect(markup).toContain('&lt;script&gt;')
  })

  it('leaves blank cards blank instead of putting placeholder copy in the artwork', async () => {
    expect(parse(await renderBotCardSvg(createBotCard())).querySelectorAll('text')).toHaveLength(0)
  })

  it('fits complete long names, handles, unbroken words and paragraphs into their boxes', () => {
    const ctx = contextMock()
    const samples = [
      { text: 'Long event name '.repeat(5), box: BOT_CARD_FRONT_LAYOUT.eventName, maxLines: 3 },
      { text: 'W'.repeat(80), box: BOT_CARD_FRONT_LAYOUT.eventName, maxLines: 3 },
      { text: 'Long name '.repeat(8), box: BOT_CARD_LAYOUT.name, maxLines: 2 },
      { text: '@' + 'h'.repeat(60), box: BOT_CARD_LAYOUT.handle, maxLines: 1 },
      { text: 'W'.repeat(600), box: BOT_CARD_LAYOUT.description, maxLines: Infinity },
      { text: 'Useful descriptions '.repeat(30), box: BOT_CARD_LAYOUT.description, maxLines: Infinity },
      { text: 'A\n'.repeat(299) + 'Z', box: BOT_CARD_LAYOUT.description, maxLines: Infinity }
    ]
    for (const { text, box, maxLines } of samples) {
      const fit = fitBotCardText(ctx, text, box, maxLines)
      expect(fit.lines.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
      expect(fit.lines.length).toBeLessThanOrEqual(maxLines)
      expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(box.height)
      ctx.font = `400 ${fit.size}px sans-serif`
      expect(fit.lines.every((line) => ctx.measureText(line).width <= box.width)).toBe(true)
    }
  })

  it('uses the same static SVG for SVG downloads and the PNG encoder', async () => {
    const card = { ...createBotCard(), name: 'Webby', description: 'Manage your personal site.', url: BOT_URL }
    const svgBlob = await exportBotCard(card, 'svg')
    expect(svgBlob.type).toBe('image/svg+xml')
    const markup = await svgBlob.text()
    expect(parse(markup).querySelector('text')?.textContent).toBe('Webby')
    const pngBlob = await exportBotCard(card, 'png')
    expect(pngBlob.type).toBe('image/png')
    expect(versPng).toHaveBeenLastCalledWith(markup, BOT_CARD_SIZE)
  })

  it.each(['front', 'back'] as const)('converts the same %s SVG into a CMYK PDF at its snapshotted physical size', async (side) => {
    const card = { ...createBotCard(), name: 'Print card', eventName: 'Meetup', url: BOT_URL }
    const markup = await renderBotCardSvg(card, side)
    const options = { sizeMm: 125 }
    const signal = new AbortController().signal
    const pending = exportBotCard(card, 'pdf', side, options, signal)
    options.sizeMm = 200
    card.name = 'Changed after clicking'
    const blob = await pending
    expect(blob.type).toBe('application/pdf')
    expect(exportPrintPdf).toHaveBeenLastCalledWith(markup, 125, 125, signal)
  })

  it('defaults PDFs to 100 mm and rejects invalid sizes or cancelled requests before conversion', async () => {
    const card = { ...createBotCard(), name: 'Print card', url: BOT_URL }
    await exportBotCard(card, 'pdf')
    expect(exportPrintPdf).toHaveBeenLastCalledWith(expect.any(String), 100, 100, undefined)
    vi.mocked(exportPrintPdf).mockClear()
    for (const sizeMm of [0, 9, 301, NaN, Infinity]) {
      await expect(exportBotCard(card, 'pdf', 'back', { sizeMm })).rejects.toThrow('print size')
    }
    const controller = new AbortController()
    controller.abort()
    await expect(exportBotCard(card, 'pdf', 'back', { sizeMm: 100 }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(exportPrintPdf).not.toHaveBeenCalled()
    await expect(exportBotCard(card, 'svg', 'back', { sizeMm: NaN })).resolves.toBeInstanceOf(Blob)
  })

  it('renders a full square black front with six frozen bots, one personalized, and no text', async () => {
    const card = { ...createBotCard(), name: 'Name is only on the back', handle: 'handle', description: 'Description is only on the back', shape: 'hexagone' as const, bodyColor: '#c177ff', expression: 'surpris' as const, url: BOT_URL }
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const svg = parse(await renderBotCardSvg(card, 'front'))
    expect(svg.documentElement.getAttribute('width')).toBe(String(BOT_CARD_SIZE))
    expect(svg.documentElement.getAttribute('height')).toBe(String(BOT_CARD_SIZE))
    expect(svg.documentElement.firstElementChild?.getAttribute('fill')).toBe('#000000')
    expect(svg.querySelectorAll('text, image, foreignObject, animate, animateTransform, style, script')).toHaveLength(0)
    expect(svg.querySelectorAll('mask')).toHaveLength(6)
    expect([...svg.querySelectorAll('g[mask] rect')].map((rect) => rect.getAttribute('fill')))
      .toEqual(['#ffffff', '#00bbaa', '#fb299d', '#1687f8', '#ff9b00', card.bodyColor])
    const frame = new BotEngine(RAYON, 'idle', SHAPE_BY_ID.get(card.shape)!.radii, EXPRESSION_BY_ID.get(card.expression)!).sample(POSE_FIGE)
    expect(svg.querySelectorAll('mask')[5]?.firstElementChild?.getAttribute('d')).toBe(frame.bodyPath)
    expect([...svg.querySelectorAll('svg:not([data-bot-card-qr]) > g[opacity] > path')].every((path) => path.getAttribute('fill') === '#000000')).toBe(true)
    expect(svg.querySelector('[data-bot-card-qr]')).toBeNull()
    expect(raf).not.toHaveBeenCalled()
  })

  it.each(BOT_CARD_FRONT_LAYOUT.bots)('keeps SVG IDs unique when the personalized bot matches the fixed $shape portrait', async ({ shape, bodyColor, expression }) => {
    const card = { ...createBotCard(), shape, bodyColor, expression }
    const markup = await renderBotCardSvg(card, 'front')
    const svg = parse(markup)
    const ids = [...svg.querySelectorAll('[id]')].map((element) => element.getAttribute('id'))
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(ids.length)
    const masks = [...svg.querySelectorAll('[mask]')].map((element) => element.getAttribute('mask'))
    expect(masks).toEqual(ids.map((id) => `url(#${id})`))
    await exportBotCard(card, 'pdf', 'front')
    expect(exportPrintPdf).toHaveBeenLastCalledWith(markup, 100, 100, undefined)
  })

  it('adds the editable event name only to the front, escaping markup and fitting long names', async () => {
    const card = { ...createBotCard(), eventName: 'Cursor <Buildathon> & Friends', url: BOT_URL }
    const front = parse(await renderBotCardSvg(card, 'front'))
    expect(front.querySelector('parsererror, Buildathon, script')).toBeNull()
    expect(front.querySelector('text')?.getAttribute('fill')).toBe('#ffffff')
    expect(front.querySelector('text')?.textContent?.replace(/\s/g, ''))
      .toBe(card.eventName.replace(/\s/g, ''))
    expect(front.querySelector('[data-bot-card-qr]')).toBeNull()
    const other = { ...card, eventName: 'Another event' }
    expect(await renderBotCardSvg(card, 'back')).toBe(await renderBotCardSvg(other, 'back'))
    const longName = 'W'.repeat(80)
    const longFront = parse(await renderBotCardSvg({ ...card, eventName: longName }, 'front'))
    expect(longFront.querySelector('text')?.textContent).toBe(longName)
    expect(longFront.querySelectorAll('tspan').length).toBeLessThanOrEqual(3)
  })

  it.each(['\n', '\r\n', '\r'])('preserves explicit event title lines in previews and both exports (%j)', async (newline) => {
    const lines = ['Grok Bot', 'San Salvador Meetup']
    const card = { ...createBotCard(), eventName: lines.join(newline) }
    const markup = await renderBotCardSvg(card, 'front')
    const spans = [...parse(markup).querySelectorAll('text tspan')]
    expect(spans.map((span) => span.textContent)).toEqual(lines)
    expect(Number(spans[1]!.getAttribute('y'))).toBeGreaterThan(Number(spans[0]!.getAttribute('y')))
    expect(await (await exportBotCard(card, 'svg', 'front')).text()).toBe(markup)
    await exportBotCard(card, 'png', 'front')
    expect(versPng).toHaveBeenLastCalledWith(markup, BOT_CARD_SIZE)
  })

  it('fits each manually chosen line without additional wrapping, including more than three lines', async () => {
    for (const lines of [
      ['Grok Bot', 'San Salvador Meetup for local builders and friends'],
      ['Grok Bot', 'San Salvador', 'Meetup', '2026']
    ]) {
      const svg = parse(await renderBotCardSvg({ ...createBotCard(), eventName: lines.join('\n') }, 'front'))
      const spans = [...svg.querySelectorAll('text tspan')]
      expect(spans.map((span) => span.textContent)).toEqual(lines)
      const size = Number(svg.querySelector('text')!.getAttribute('font-size'))
      expect(size).toBeGreaterThan(20)
      expect(size * BOT_CARD_FRONT_LAYOUT.eventName.leading * lines.length).toBeLessThanOrEqual(BOT_CARD_FRONT_LAYOUT.eventName.height)
    }
  })

  it('keeps the front unchanged when the link changes and encodes the new link only on the back', async () => {
    const first = { ...createBotCard(), name: 'Webby', description: 'Manage your site.', url: BOT_URL }
    const second = { ...first, url: 'https://x.ai/bot/another-bot' }
    expect(await renderBotCardSvg(first, 'front')).toBe(await renderBotCardSvg(second, 'front'))
    expect(parse(await renderBotCardSvg(first, 'front')).querySelector('[data-bot-card-qr]')).toBeNull()
    const firstBack = parse(await renderBotCardSvg(first, 'back'))
    const secondBack = parse(await renderBotCardSvg(second, 'back'))
    const qr = firstBack.querySelector('[data-bot-card-qr]')!
    expect(qr.getAttribute('x')).toBe(String(BOT_CARD_LAYOUT.qr.x))
    expect(qr.getAttribute('y')).toBe(String(BOT_CARD_LAYOUT.qr.y))
    expect(qr.querySelector('path')?.getAttribute('fill')).toBe('#000000')
    expect(BOT_CARD_LAYOUT.qr.y + BOT_CARD_LAYOUT.qr.size).toBeLessThan(BOT_CARD_LAYOUT.name.y)
    expect(qr.querySelector('path')?.getAttribute('d'))
      .not.toBe(secondBack.querySelector('[data-bot-card-qr] path')?.getAttribute('d'))
  })

  it('allows a back preview without a link but rejects a QR-less back export', async () => {
    for (const url of ['', 'not-a-url', 'javascript:alert(1)']) {
      const card = { ...createBotCard(), url }
      const svg = parse(await renderBotCardSvg(card, 'back'))
      expect(svg.querySelectorAll('mask')).toHaveLength(1)
      expect(svg.querySelector('[data-bot-card-qr]')).toBeNull()
      await expect(exportBotCard(card, 'svg', 'back')).rejects.toThrow('valid bot URL')
      await expect(exportBotCard(card, 'png', 'back')).rejects.toThrow('valid bot URL')
      await expect(exportBotCard(card, 'svg', 'front')).resolves.toBeInstanceOf(Blob)
    }
  })

  it('uses the selected front document for both exports', async () => {
    const card = { ...createBotCard(), eventName: 'Cursor Buildathon', url: '' }
    const svgBlob = await exportBotCard(card, 'svg', 'front')
    const markup = await svgBlob.text()
    expect(parse(markup).querySelector('[data-bot-card-qr]')).toBeNull()
    expect(parse(markup).querySelector('text')?.textContent).toBe(card.eventName)
    expect(parse(markup).documentElement.firstElementChild?.getAttribute('fill')).toBe('#000000')
    await exportBotCard(card, 'png', 'front')
    expect(versPng).toHaveBeenLastCalledWith(markup, BOT_CARD_SIZE)
  })
})
