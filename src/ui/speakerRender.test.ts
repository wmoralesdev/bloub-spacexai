// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpeakerDraft, ASPECTS, type ImageFormat, type SpeakerDraft } from './speaker'
import {
  exportSpeaker,
  fitSpeakerText,
  renderSpeaker,
  renderSpeakerLayers,
  speakerBotPlacements,
  speakerBotSvgs,
  speakerLayout,
  type SpeakerAssets
} from './speakerRender'

import { createSpeakerAnimationSnapshot } from './speakerAnimation'

interface PaintedLine { text: string; x: number; y: number; size: number; weight: number; color: string }

function contextMock() {
  const painted: PaintedLine[] = []
  return {
    painted,
    font: '',
    fillStyle: '',
    textBaseline: '',
    globalCompositeOperation: 'source-over',
    scale: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    drawImage: vi.fn(), fillRect: vi.fn(),
    getImageData: vi.fn(() => {
      if (!portraitPixels) throw new Error('Pixel readback unavailable')
      return { data: portraitPixels }
    }),
    fillText: vi.fn(function (this: { font: string; fillStyle: string }, text: string, x: number, y: number) {
      painted.push({
        text, x, y,
        size: Number(this.font.match(/([\d.]+)px/)?.[1]),
        weight: Number(this.font.split(' ')[0]),
        color: this.fillStyle
      })
    }),
    measureText(text: string) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16)
      return { width: Array.from(text).length * size * 0.51 }
    },
    createLinearGradient: vi.fn((_x1: number, _y1: number, _x2: number, _y2: number) => ({ addColorStop: vi.fn() }))
  }
}

type ContextMock = ReturnType<typeof contextMock>
let contexts: Map<HTMLCanvasElement, ContextMock>
let portraitPixels: Uint8ClampedArray | undefined

function image(width: number, height: number) {
  const img = new Image()
  Object.defineProperty(img, 'naturalWidth', { value: width })
  Object.defineProperty(img, 'naturalHeight', { value: height })
  return img
}

const assets = (): SpeakerAssets => ({ portrait: image(744, 971), bots: Array.from({ length: 5 }, () => image(512, 512)) })

beforeEach(() => {
  contexts = new Map()
  portraitPixels = undefined
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, contextMock())
    return contexts.get(this) as unknown as CanvasRenderingContext2D
  })
})

afterEach(() => vi.restoreAllMocks())

function portraitRectangle(sourceWidth: number, sourceHeight: number, draft: Partial<SpeakerDraft> = {}) {
  const canvas = document.createElement('canvas')
  const portrait = image(sourceWidth, sourceHeight)
  renderSpeaker(canvas, { ...createSpeakerDraft(), ...draft, botsVisible: false, fade: 0 }, { portrait, bots: [] })
  const photo = [...contexts.values()].find((ctx) => ctx.drawImage.mock.calls.some(([source]) => source === portrait))!
  const [, x, y, width, height] = photo.drawImage.mock.calls[0]!
  return { x: x as number, y: y as number, width: width as number, height: height as number }
}

function alphaRectangle(width: number, height: number, left: number, top: number, right: number, bottom: number) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) pixels[(y * width + x) * 4 + 3] = 255
  }
  return pixels
}

describe('speaker text line breaks', () => {
  it.each(['\n', '\r\n', '\r'])('keeps an explicit %j break even when the title fits on one line', (newline) => {
    const ctx = contextMock() as unknown as CanvasRenderingContext2D
    const box = { width: 1000, height: 200, size: 32 }
    expect(fitSpeakerText(ctx, 'Grok Bot for GTM', box).lines).toEqual(['Grok Bot for GTM'])
    const fit = fitSpeakerText(ctx, `Grok Bot for${newline}GTM`, box)
    expect(fit.lines).toEqual(['Grok Bot for', 'GTM'])
    expect(fit.size).toBe(box.size)
  })

  it('preserves internal blank lines while trimming outer whitespace', () => {
    const ctx = contextMock() as unknown as CanvasRenderingContext2D
    const fit = fitSpeakerText(ctx, '\n  Grok Bot for\n \t\nGTM  \n', { width: 1000, height: 200, size: 32 }, 3)
    expect(fit.lines).toEqual(['Grok Bot for', '', 'GTM'])
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(200)
    expect(fitSpeakerText(ctx, ' \n\t\r\n ', { width: 1000, height: 200, size: 32 }).lines).toEqual([])
  })

  it('wraps a long explicit line without joining it to the following line', () => {
    const ctx = contextMock() as unknown as CanvasRenderingContext2D
    const fit = fitSpeakerText(ctx, 'Grok Bot for Engineering\nGTM', { width: 200, height: 100, size: 20 }, 4)
    expect(fit.lines).toEqual(['Grok Bot for', 'Engineering', 'GTM'])
    expect(fit.size).toBe(20)
    for (const line of fit.lines) expect(ctx.measureText(line).width).toBeLessThanOrEqual(200)
  })

  it('keeps the existing line limit for an excessive number of manual breaks', () => {
    const ctx = contextMock() as unknown as CanvasRenderingContext2D
    const fit = fitSpeakerText(ctx, 'Uno\nDos\nTres\nCuatro', { width: 300, height: 100, size: 20 }, 3, 500, 20)
    expect(fit.lines).toEqual(['Uno', 'Dos', 'Tres…'])
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(100)
  })
})

describe('transparent portrait margins', () => {
  it.each(ASPECTS)('fits the visible figure and keeps faint hair at both preview and export size in $id', ({ id }) => {
    const portrait = image(100, 120)
    portraitPixels = alphaRectangle(100, 120, 32, 1, 67, 119)
    // Retain faint strands, but ignore isolated 1/255 alpha noise in the margin.
    portraitPixels[(10 * 100 + 30) * 4 + 3] = 2
    portraitPixels[(10 * 100 + 1) * 4 + 3] = 1
    const draft = { ...createSpeakerDraft(), aspect: id, botsVisible: false, fade: 0 }
    for (const previewWidth of [800, undefined]) {
      const canvas = document.createElement('canvas')
      renderSpeaker(canvas, draft, { portrait, bots: [] }, previewWidth)
      const photo = [...contexts.values()].filter((ctx) => ctx.drawImage.mock.calls.some((call) => call[0] === portrait && call.length === 9)).at(-1)!
      const call = photo.drawImage.mock.calls[0]!
      expect(call.slice(1, 5)).toEqual([29, 0, 40, 120])
      const [, , , , , x, y, width, height] = call
      const layout = speakerLayout(id)
      expect(height).toBe(layout.portrait.height)
      expect(width / height).toBeCloseTo(40 / 120)
      expect(x + width / 2).toBeCloseTo(layout.portrait.centerX)
      expect(y).toBe(layout.portrait.y)
    }
    expect([...contexts.values()].reduce((count, ctx) => count + ctx.getImageData.mock.calls.length, 0)).toBe(1)
  })

  it('leaves close-cropped images with up to five percent padding unchanged', () => {
    portraitPixels = alphaRectangle(100, 120, 5, 6, 94, 113)
    const portrait = image(100, 120)
    renderSpeaker(document.createElement('canvas'), { ...createSpeakerDraft(), botsVisible: false }, { portrait, bots: [] })
    const draws = [...contexts.values()].flatMap((ctx) => ctx.drawImage.mock.calls).filter((call) => call[0] === portrait)
    expect(draws.some((call) => call.length === 5)).toBe(true)
    expect(draws.some((call) => call.length === 9)).toBe(false)
  })

  it('falls back to the full image and caches the result if pixel readback fails', () => {
    const portrait = image(744, 971)
    const draft = { ...createSpeakerDraft(), botsVisible: false, fade: 0 }
    for (const width of [800, 2400]) {
      expect(() => renderSpeaker(document.createElement('canvas'), draft, { portrait, bots: [] }, width)).not.toThrow()
    }
    const draws = [...contexts.values()].flatMap((ctx) => ctx.drawImage.mock.calls).filter((call) => call[0] === portrait && call.length === 5)
    expect(draws).toHaveLength(2)
    expect(draws[0]).toEqual(draws[1])
    expect([...contexts.values()].reduce((count, ctx) => count + ctx.getImageData.mock.calls.length, 0)).toBe(1)
  })

  it('keeps a fully transparent image drawable without invalid geometry', () => {
    portraitPixels = new Uint8ClampedArray(100 * 120 * 4)
    const rectangle = portraitRectangle(100, 120)
    for (const value of Object.values(rectangle)) expect(Number.isFinite(value)).toBe(true)
    expect(rectangle.width / rectangle.height).toBeCloseTo(100 / 120)
  })
})

describe('speaker date header', () => {
  it.each(ASPECTS)('keeps the complete standard date on one line, independent of the title in $id', ({ id }) => {
    const draft = { ...createSpeakerDraft(), aspect: id, time: '3 PM' }
    const dates = ['', 'Grok Bot for Engineering', 'Grok Bot for Research & Experiments: building the next generation of intelligent agents'].map((talkTitle) => {
      const canvas = document.createElement('canvas')
      renderSpeaker(canvas, { ...draft, talkTitle }, assets())
      const drawn = contexts.get(canvas)!.painted
      const schedule = drawn.filter(({ text }) => text.includes(draft.date))
      expect(schedule).toHaveLength(1)
      const date = schedule[0]!
      expect(date.text).toBe(`${draft.date} · ${draft.time}`)
      expect(date.color).toBe('#ffffff')
      expect(date.size).toBe(speakerLayout(id).date.size)
      expect(date.y + date.size * 1.08).toBeLessThan(speakerLayout(id, true).talkTitle!.y)
      expect(drawn.filter(({ y }) => y >= speakerLayout(id).footer.y)).toEqual([])
      return date
    })
    expect(dates[1]).toEqual(dates[0])
    expect(dates[2]).toEqual(dates[0])
  })

  it.each(ASPECTS)('fits a long date below a two-line identity without touching the title in $id', ({ id }) => {
    const canvas = document.createElement('canvas')
    renderSpeaker(canvas, {
      ...createSpeakerDraft(), aspect: id, event: 'Grok Bot\nSan Salvador Meetup', city: '',
      date: 'Saturday, September 19th, 2026\nDoors open at 2:30 PM', time: '3 PM – 6 PM', talkTitle: 'Grok Bot'
    }, assets())
    const drawn = contexts.get(canvas)!.painted
    const titleIndex = drawn.findIndex(({ y }) => y === speakerLayout(id, true).talkTitle!.y)
    const identity = drawn.slice(0, 2)
    expect(identity.map(({ text }) => text)).toEqual(['Grok Bot', 'San Salvador Meetup'])
    const schedule = drawn.slice(2, titleIndex)
    expect(schedule.length).toBeGreaterThan(0)
    expect(schedule[0]!.y).toBeGreaterThanOrEqual(identity[1]!.y + identity[1]!.size * 1.08)
    for (const line of schedule) {
      expect(line.y + line.size * 1.08).toBeLessThan(drawn[titleIndex]!.y)
      expect(line.x + Array.from(line.text).length * line.size * 0.51).toBeLessThanOrEqual(1000)
    }
  })

  it.each([
    { date: '', time: '', expected: '' },
    { date: ' Saturday, September 19th ', time: '', expected: 'Saturday, September 19th' },
    { date: '', time: ' 3 PM ', expected: '3 PM' }
  ])('handles missing schedule fields without stray separators: $expected', ({ date, time, expected }) => {
    const canvas = document.createElement('canvas')
    renderSpeaker(canvas, { ...createSpeakerDraft(), event: '', city: '', date, time }, assets())
    const header = contexts.get(canvas)!.painted.filter(({ y }) => y < speakerLayout('4:3').label.y)
    expect(header.map(({ text }) => text)).toEqual(expected ? [expected] : [])
  })

  it('shades the footer only when venue or URL use it', () => {
    for (const footer of [{ venue: '', url: '' }, { venue: 'BINAES', url: '' }, { venue: '', url: 'luma.com/bot' }]) {
      const canvas = document.createElement('canvas')
      renderSpeaker(canvas, { ...createSpeakerDraft(), ...footer }, assets())
      expect(contexts.get(canvas)!.fillRect).toHaveBeenCalledTimes(footer.venue || footer.url ? 2 : 1)
    }
  })
})

describe('speaker composition', () => {
  it.each(ASPECTS)('keeps a consistent type hierarchy with the talk above the speaker in $id', ({ id }) => {
    const layout = speakerLayout(id, true)
    const title = layout.talkTitle!
    expect(title.y).toBeGreaterThanOrEqual(layout.event.y + layout.event.height)
    expect(title.y + title.height).toBeLessThanOrEqual(layout.label.y)
    expect(title.x + title.width).toBeLessThanOrEqual(1000)
    expect(layout.name.y + layout.name.height).toBeLessThanOrEqual(layout.role.y)
    expect(layout.name.size / title.size).toBeCloseTo(0.65, 2)
    expect(layout.event.size / title.size).toBeCloseTo(0.4, 2)
    for (const field of ['label', 'role', 'footer'] as const) {
      expect(layout[field].size / title.size).toBeCloseTo(0.3, 2)
    }

    const text = 'De la idea a la realidad: construyendo agentes con Grok'
    const ctx = contextMock() as unknown as CanvasRenderingContext2D
    const fit = fitSpeakerText(ctx, text, title, 3, 500)
    expect(fit.lines.join(' ')).toBe(text)
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(title.height)

    const canvas = document.createElement('canvas')
    renderSpeaker(canvas, { ...createSpeakerDraft(), aspect: id, talkTitle: text }, assets())
    const paintedText = contexts.get(canvas)!.fillText.mock.calls.map(([line]) => line).join(' ')
    expect(paintedText).toContain(text)
    expect(paintedText).toContain('Walter Morales')
    const drawn = contexts.get(canvas)!.painted
    const labelIndex = drawn.findIndex(({ text: line }) => line === 'SPEAKER')
    const titleLines = drawn.slice(0, labelIndex).filter(({ y }) => y >= title.y)
    const name = drawn.find(({ text: line }) => line === 'Walter Morales')!
    const identity = drawn.find(({ y }) => y === layout.event.y)!
    expect(titleLines[0]!.size).toBeGreaterThan(name.size)
    expect(name.size).toBeGreaterThan(identity.size)
    const label = drawn[labelIndex]!
    const lastTitleLine = titleLines.at(-1)!
    expect(lastTitleLine.y + lastTitleLine.size).toBeLessThan(label.y)
  })

  it('keeps a compact identity and readable header date when the talk title is blank', () => {
    expect(speakerLayout('4:3').talkTitle).toBeUndefined()
    const canvas = document.createElement('canvas')
    const draft = { ...createSpeakerDraft(), talkTitle: '   ' }
    renderSpeaker(canvas, draft, assets())
    const drawn = contexts.get(canvas)!.painted
    expect(drawn.some(({ text }) => text === '   ')).toBe(false)
    expect(drawn.map(({ text }) => text).join(' ')).toContain(`${draft.event} · ${draft.city}`)
    const date = drawn.find(({ text }) => text.includes(draft.date))!
    const name = drawn.find(({ text }) => text === draft.name)!
    expect(date.y + date.size).toBeLessThan(name.y)
    expect(date.color).toBe('#ffffff')
  })

  it.each(ASPECTS)('groups date and time in the header, with venue and URL in the footer for $id', ({ id }) => {
    const canvas = document.createElement('canvas')
    const draft = {
      ...createSpeakerDraft(), aspect: id, talkTitle: 'Grok Bot for Engineering',
      role: 'Ai Labs', date: '19 de septiembre', time: '3 PM', venue: 'BINAES', url: 'luma.com/bot'
    }
    renderSpeaker(canvas, draft, assets())
    const drawn = contexts.get(canvas)!.painted
    const layout = speakerLayout(id, true)
    const dateIndex = drawn.findIndex(({ text }) => text.includes(draft.date))
    const identity = drawn.slice(0, dateIndex)
    expect(identity.map(({ text }) => text).join(' ')).toBe(`${draft.event} · ${draft.city}`)
    expect(identity.every(({ weight, color }) => weight === 400 && color === '#ffffff')).toBe(true)
    const date = drawn[dateIndex]!
    expect(date.text).toBe(`${draft.date} · ${draft.time}`)
    expect(date.color).toBe('#ffffff')
    expect(date.y).toBeGreaterThan(identity.at(-1)!.y + identity.at(-1)!.size)
    expect(date.y + date.size).toBeLessThan(layout.talkTitle!.y)
    const footer = drawn.filter(({ y }) => y >= layout.footer.y)
    const details = footer.map(({ text }) => text).join(' ')
    for (const text of [draft.venue, draft.url]) expect(details).toContain(text)
    for (const text of [draft.date, draft.time]) {
      expect(details).not.toContain(text)
      expect(drawn.filter((line) => line.text.includes(text))).toHaveLength(1)
    }
    expect(footer.every(({ weight, color }) => weight === 400 && color === '#949494')).toBe(true)
    expect(new Set(drawn.map(({ weight }) => weight))).toEqual(new Set([400, 500]))

    const title = drawn.find(({ text }) => text.startsWith('Grok Bot for'))!
    const name = drawn.find(({ text }) => text === draft.name)!
    expect(title.size).toBeGreaterThan(name.size)
    expect(name.size).toBeGreaterThan(identity[0]!.size)
    expect(title.weight).toBe(500)
    expect(name.weight).toBe(500)
  })

  it.each(ASPECTS)('keeps the role adjacent to both single-line and multiline names in $id', ({ id }) => {
    for (const name of ['Walter Morales', 'María José de los Ángeles Rodríguez Hernández']) {
      const canvas = document.createElement('canvas')
      renderSpeaker(canvas, {
        ...createSpeakerDraft(), aspect: id, talkTitle: 'Grok Bot for Engineering', name, role: 'Ai Labs'
      }, assets())
      const drawn = contexts.get(canvas)!.painted
      const labelIndex = drawn.findIndex(({ text }) => text === 'SPEAKER')
      const roleIndex = drawn.findIndex(({ text }) => text === 'Ai Labs')
      const nameLines = drawn.slice(labelIndex + 1, roleIndex)
      expect(nameLines.map(({ text }) => text).join(' ')).toBe(name)
      expect(nameLines.length).toBe(name === 'Walter Morales' ? 1 : 2)
      const lastNameLine = nameLines.at(-1)!
      const role = drawn[roleIndex]!
      const gap = role.y - (lastNameLine.y + lastNameLine.size)
      expect(gap).toBeGreaterThanOrEqual(0)
      expect(gap).toBeLessThan(lastNameLine.size * 0.6)
      expect(role.y + role.size).toBeLessThan(speakerLayout(id, true).footer.y)
    }
  })

  it.each(ASPECTS)('fits editable text in reserved areas for $id', ({ id }) => {
    const layout = speakerLayout(id)
    for (const field of ['event', 'date', 'label', 'name', 'role', 'footer'] as const) {
      const box = layout[field]
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(1000)
      expect(box.y + box.height).toBeLessThanOrEqual(layout.height)
    }
    expect(layout.name.y + layout.name.height).toBeLessThanOrEqual(layout.role.y)
    const ctx = contextMock() as unknown as CanvasRenderingContext2D
    const name = 'María José de los Ángeles Rodríguez Hernández'
    const fit = fitSpeakerText(ctx, name, layout.name)
    expect(fit.lines.join(' ')).toBe(name)
    expect(fit.lines.length).toBeLessThanOrEqual(2)
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(layout.name.height)
    for (const line of fit.lines) expect(ctx.measureText(line).width).toBeLessThanOrEqual(layout.name.width)
  })

  it('fits unbroken input and truncates only input that exceeds the minimum size', () => {
    const ctx = contextMock() as unknown as CanvasRenderingContext2D
    const fit = fitSpeakerText(ctx, 'A'.repeat(600), { width: 260, height: 50, size: 40 })
    expect(fit.lines).toHaveLength(2)
    expect(fit.lines[1]).toMatch(/…$/)
    for (const line of fit.lines) expect(ctx.measureText(line).width).toBeLessThanOrEqual(260)
  })

  it.each(ASPECTS)('preserves portrait proportions and the diagonal mask in $id', ({ id, width: exportWidth, height: exportHeight }) => {
    const canvas = document.createElement('canvas')
    const draft = { ...createSpeakerDraft(), aspect: id }
    const pictures = assets()
    renderSpeaker(canvas, draft, pictures, 800)
    expect([canvas.width, canvas.height]).toEqual([800, Math.round(800 * exportHeight / exportWidth)])
    const output = contexts.get(canvas)!
    expect(output.fillRect).toHaveBeenNthCalledWith(1, 0, 0, 1000, speakerLayout(id).height)
    const photo = [...contexts.values()].find((ctx) => ctx !== output)!
    const [, , , width, height] = photo.drawImage.mock.calls[0]!
    expect(width / height).toBeCloseTo(744 / 971)
    const [x1, y1, x2, y2] = photo.createLinearGradient.mock.calls[0]!
    expect(x1).toBeLessThan(x2)
    expect(y1).toBeGreaterThan(y2)
    const stops = photo.createLinearGradient.mock.results[0]!.value.addColorStop.mock.calls
    expect(stops[0]).toEqual([0, 'rgba(0,0,0,0)'])
    expect(stops.at(-1)).toEqual([1, 'rgba(0,0,0,1)'])
    expect(photo.globalCompositeOperation).toBe('destination-in')
    expect(output.drawImage).toHaveBeenCalledTimes(6)
  })

  it.each(ASPECTS)('preserves existing tall portrait framing in $id', ({ id }) => {
    const layout = speakerLayout(id)
    for (const [sourceWidth, sourceHeight] of [[744, 971], [447, 856]]) {
      for (const controls of [{ photoX: 0, photoY: 0, photoScale: 100 }, { photoX: -12, photoY: 9, photoScale: 125 }]) {
        const rectangle = portraitRectangle(sourceWidth!, sourceHeight!, { aspect: id, ...controls })
        const height = layout.portrait.height * controls.photoScale / 100
        const width = height * sourceWidth! / sourceHeight!
        expect(rectangle.width).toBeCloseTo(width)
        expect(rectangle.height).toBeCloseTo(height)
        expect(rectangle.x).toBeCloseTo(layout.portrait.centerX - width / 2 + controls.photoX * 10)
        expect(rectangle.y).toBeCloseTo(layout.portrait.y + (layout.portrait.height - height) / 2 + controls.photoY * layout.height / 100)
      }
    }
  })

  it.each(ASPECTS)('keeps near-square and wide portraits inside the right edge by default in $id', ({ id }) => {
    const layout = speakerLayout(id)
    for (const [sourceWidth, sourceHeight] of [[900, 1000], [816, 790], [1000, 1000], [1600, 800]]) {
      const rectangle = portraitRectangle(sourceWidth!, sourceHeight!, { aspect: id })
      expect(rectangle.x).toBeGreaterThanOrEqual(0)
      expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(984.00001)
      expect(rectangle.width).toBeLessThanOrEqual((id === '9:16' ? 856 : 500) + 0.00001)
      expect(rectangle.width / rectangle.height).toBeCloseTo(sourceWidth! / sourceHeight!)
      expect(rectangle.y + rectangle.height / 2).toBeCloseTo(layout.portrait.y + layout.portrait.height / 2)
    }
  })

  it.each(ASPECTS)('applies manual positioning and zoom after fitting a wide portrait in $id', ({ id }) => {
    const original = portraitRectangle(816, 790, { aspect: id })
    const adjusted = portraitRectangle(816, 790, { aspect: id, photoX: 20, photoY: -10, photoScale: 130 })
    expect(adjusted.width).toBeCloseTo(original.width * 1.3)
    expect(adjusted.height).toBeCloseTo(original.height * 1.3)
    expect(adjusted.x + adjusted.width / 2).toBeCloseTo(original.x + original.width / 2 + 200)
    expect(adjusted.y + adjusted.height / 2).toBeCloseTo(original.y + original.height / 2 - speakerLayout(id).height * 0.1)
    // Deliberate manual cropping must remain possible.
    expect(adjusted.x + adjusted.width).toBeGreaterThan(1000)
  })

  it.each(ASPECTS)('changes portrait framing continuously around the fit transition in $id', ({ id }) => {
    for (const sourceWidth of [8000, 9000]) {
      const before = portraitRectangle(sourceWidth - 1, 10000, { aspect: id })
      const after = portraitRectangle(sourceWidth + 1, 10000, { aspect: id })
      for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(after[coordinate] - before[coordinate])).toBeLessThan(1)
      }
    }
  })

  it('softens the bottom edge of a width-fitted portrait without changing its rectangle or diagonal fade', () => {
    const rectangle = portraitRectangle(816, 790)
    expect(rectangle.y + rectangle.height).toBeLessThan(speakerLayout('4:3').height)
    const portrait = image(816, 790)
    renderSpeaker(document.createElement('canvas'), { ...createSpeakerDraft(), botsVisible: false }, { portrait, bots: [] })
    const photo = [...contexts.values()].find((ctx) => ctx.drawImage.mock.calls.some(([source]) => source === portrait))!
    expect(photo.drawImage).toHaveBeenCalledWith(portrait, rectangle.x, rectangle.y, rectangle.width, rectangle.height)
    expect(photo.createLinearGradient).toHaveBeenCalledTimes(2)
    const [x1, y1, x2, y2] = photo.createLinearGradient.mock.calls[0]!
    expect(x1).toBeLessThan(x2)
    expect(y1).toBeGreaterThan(y2)
    expect(photo.createLinearGradient.mock.calls[1]).toEqual([0, rectangle.y + rectangle.height * 0.88, 0, rectangle.y + rectangle.height])
    expect(photo.createLinearGradient.mock.results[1]!.value.addColorStop.mock.calls).toEqual([
      [0, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,0)']
    ])
    expect(photo.globalCompositeOperation).toBe('destination-in')
  })

  it.each([[744, 971], [447, 856]])('keeps the original single fade for a tall %i by %i portrait', (width, height) => {
    const portrait = image(width, height)
    renderSpeaker(document.createElement('canvas'), { ...createSpeakerDraft(), botsVisible: false }, { portrait, bots: [] })
    const photo = [...contexts.values()].find((ctx) => ctx.drawImage.mock.calls.some(([source]) => source === portrait))!
    expect(photo.createLinearGradient).toHaveBeenCalledTimes(1)
  })

  it('leaves fitted portrait edges unmasked when the fade is disabled', () => {
    portraitRectangle(816, 790, { fade: 0 })
    const photo = [...contexts.values()].find((ctx) => ctx.drawImage.mock.calls.some(([source]) => source instanceof HTMLImageElement))!
    expect(photo.createLinearGradient).not.toHaveBeenCalled()
    expect(photo.globalCompositeOperation).toBe('source-over')
  })

  it('can hide the bots and turn off the fade completely', () => {
    const canvas = document.createElement('canvas')
    const pictures = { portrait: image(744, 971), bots: [] }
    renderSpeaker(canvas, { ...createSpeakerDraft(), botsVisible: false, fade: 0 }, pictures)
    const output = contexts.get(canvas)!
    expect(output.drawImage).toHaveBeenCalledTimes(1)
    const photo = [...contexts.values()].find((ctx) => ctx !== output)!
    expect(photo.createLinearGradient).not.toHaveBeenCalled()
    expect(photo.globalCompositeOperation).toBe('source-over')
  })

  it('does not export an unloaded portrait or missing bot artwork', () => {
    const canvas = document.createElement('canvas')
    expect(() => renderSpeaker(canvas, createSpeakerDraft(), { ...assets(), portrait: image(0, 0) })).toThrow('portrait')
    expect(() => renderSpeaker(canvas, createSpeakerDraft(), { ...assets(), bots: [] })).toThrow('bots')
  })
})

describe('speaker bot assets', () => {
  it('uses five frozen component silhouettes with black underlays and the event colors', async () => {
    const svgs = await speakerBotSvgs()
    expect(svgs).toHaveLength(5)
    expect(document.body.children).toHaveLength(0)
    const colors = ['#ffffff', '#00bbaa', '#fb299d', '#1687f8', '#ff9b00']
    const bodies = new Set<string>()
    svgs.forEach((markup, index) => {
      const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
      expect(Number(svg.getAttribute('width'))).toBeGreaterThanOrEqual(1200)
      expect(svg.querySelector('rect')?.getAttribute('fill')).toBe(colors[index])
      expect(svg.querySelector('g[opacity] > path')?.getAttribute('fill')).toBe('#000000')
      expect(svg.querySelectorAll('mask path[fill="#000"]').length).toBeGreaterThanOrEqual(2)
      bodies.add(svg.querySelector('mask > path')!.getAttribute('d')!)
      expect(markup).not.toContain('<!--')
    })
    expect(bodies.size).toBe(5)
  })
})

describe('rectangular export', () => {
  it.each(ASPECTS.flatMap((aspect) => (['png', 'jpeg'] as ImageFormat[]).map((format) => ({ ...aspect, format }))))(
    'preserves title breaks and spacing from preview to $id $format export', async ({ id, format }) => {
      let exported: ContextMock | undefined
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, mime) {
        exported = contexts.get(this)
        callback(new Blob(['encoded'], { type: mime }))
      })
      for (const [talkTitle, expectedLines] of [
        ['Grok Bot for\nGTM', ['Grok Bot for', 'GTM']],
        ['Grok Bot for\r\nGTM', ['Grok Bot for', 'GTM']],
        ['Grok Bot for\n\nGTM', ['Grok Bot for', '', 'GTM']]
      ] as const) {
        const draft = { ...createSpeakerDraft(), aspect: id, talkTitle }
        const pictures = assets()
        const preview = document.createElement('canvas')
        renderSpeaker(preview, draft, pictures, 800)
        const previewText = contexts.get(preview)!.painted
        const titleLines = previewText.filter(({ y }) => y >= speakerLayout(id, true).talkTitle!.y).slice(0, expectedLines.length)
        expect(titleLines.map(({ text }) => text)).toEqual(expectedLines)
        expect(titleLines[0]!.y).toBe(speakerLayout(id, true).talkTitle!.y)
        const label = previewText.find(({ text }) => text === 'SPEAKER')!
        const lastTitleLine = titleLines.at(-1)!
        expect(lastTitleLine.y + lastTitleLine.size).toBeLessThan(label.y)
        for (let i = 1; i < titleLines.length; i++) {
          expect(titleLines[i]!.y).toBeGreaterThan(titleLines[i - 1]!.y + titleLines[i - 1]!.size)
        }

        const blob = await exportSpeaker(draft, pictures, format)
        expect(blob.type).toBe(`image/${format}`)
        expect(exported!.painted).toEqual(previewText)
      }
    }
  )

  it.each(ASPECTS.flatMap((aspect) => (['png', 'jpeg'] as ImageFormat[]).map((format) => ({ ...aspect, format }))))(
    'encodes $id as $format at the full size', async ({ id, width, height, format }) => {
      const encoder = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, mime) {
        expect([this.width, this.height]).toEqual([width, height])
        callback(new Blob(['encoded'], { type: mime }))
      })
      const blob = await exportSpeaker({ ...createSpeakerDraft(), aspect: id }, assets(), format)
      expect(blob.type).toBe(`image/${format}`)
      expect(encoder.mock.calls[0]![2]).toBe(format === 'jpeg' ? 0.95 : undefined)
    }
  )

  it('reports encoder failure instead of producing an empty download', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null))
    await expect(exportSpeaker(createSpeakerDraft(), assets(), 'png')).rejects.toThrow('encode')
  })
})


describe('speaker animation layers', () => {
  it.each(ASPECTS)('keeps portrait and shade below bots and all text above them in $id', ({ id }) => {
    const draft = { ...createSpeakerDraft(), aspect: id, talkTitle: 'Grok Bot for\nEngineering', venue: 'BINAES' }
    const pictures = assets()
    const still = document.createElement('canvas')
    renderSpeaker(still, draft, pictures, 800)
    const layers = renderSpeakerLayers(draft, pictures, 800)
    const original = contexts.get(still)!
    const background = contexts.get(layers.background)!
    const foreground = contexts.get(layers.foreground)!
    expect([layers.background.width, layers.background.height]).toEqual([still.width, still.height])
    expect([layers.foreground.width, layers.foreground.height]).toEqual([still.width, still.height])
    expect(background.fillText).not.toHaveBeenCalled()
    expect(background.drawImage).toHaveBeenCalledTimes(1)
    expect(background.fillRect.mock.calls).toEqual(original.fillRect.mock.calls)
    expect(foreground.fillRect).not.toHaveBeenCalled()
    expect(foreground.drawImage).not.toHaveBeenCalled()
    expect(foreground.painted).toEqual(original.painted)
    // In the unchanged image path, the shade precedes the five bot draws.
    expect(original.fillRect.mock.invocationCallOrder.at(-1)).toBeLessThan(original.drawImage.mock.invocationCallOrder[1]!)
    expect(original.drawImage.mock.invocationCallOrder.at(-1)).toBeLessThan(original.fillText.mock.invocationCallOrder[0]!)
  })

  it.each(ASPECTS)('matches the existing static bot transforms at both scale limits in $id', ({ id }) => {
    for (const botsScale of [60, 130]) {
      const draft = { ...createSpeakerDraft(), aspect: id, botsScale }
      const canvas = document.createElement('canvas')
      renderSpeaker(canvas, draft, assets(), 800)
      const painted = contexts.get(canvas)!
      const placements = speakerBotPlacements(draft, 800)
      placements.forEach((placement, index) => {
        expect(painted.translate.mock.calls[index]![0] * 0.8).toBeCloseTo(placement.x)
        expect(painted.translate.mock.calls[index]![1] * 0.8).toBeCloseTo(placement.y)
        expect(painted.rotate.mock.calls[index]![0]).toBe(placement.angle * Math.PI / 180)
        expect(painted.drawImage.mock.calls[index + 1]![3]! as number * 0.8).toBeCloseTo(placement.size)
      })
    }
  })

  it('freezes controls before asynchronous geometry and preserves actual component shapes', async () => {
    const encoded = new Map<HTMLCanvasElement, string>()
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
      const value = `data:image/png;base64,${encoded.size}`
      encoded.set(this, value)
      return value
    })
    const draft = createSpeakerDraft()
    const expected = speakerBotPlacements(draft, 800)
    const pending = createSpeakerAnimationSnapshot(draft, assets(), 800)
    draft.botsScale = 60
    draft.botsVisible = false
    const snapshot = await pending
    expect([snapshot.width, snapshot.height]).toEqual([800, 600])
    expect(snapshot.bots.map(({ x, y, size, angle }) => ({ x, y, size, angle }))).toEqual(expected)
    const originalSvgs = await speakerBotSvgs()
    snapshot.bots.forEach((bot, index) => {
      const source = new DOMParser().parseFromString(originalSvgs[index]!, 'image/svg+xml').documentElement
      expect(bot.bodyPath).toBe(source.querySelector('mask > path')!.getAttribute('d'))
      expect(bot.color).toBe(source.querySelector('rect')!.getAttribute('fill'))
      expect(bot.eyes.map(({ d }) => d)).toEqual(Array.from(source.querySelectorAll('mask path[fill="#000"]'), (eye) => eye.getAttribute('d')))
    })
    expect(encoded.size).toBe(2)
    expect([...encoded.keys()].every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true)

    const nextSnapshot = await createSpeakerAnimationSnapshot(createSpeakerDraft(), assets(), 800)
    snapshot.bots[0]!.eyes[0]!.d = 'mutated neutral'
    expect(nextSnapshot.bots[0]!.eyes[0]!.d).not.toBe('mutated neutral')
  })

  it('has no bot geometry when bots are hidden and releases raster canvases after errors', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==')
    const snapshot = await createSpeakerAnimationSnapshot({ ...createSpeakerDraft(), botsVisible: false }, assets(), 800)
    expect(snapshot.bots).toEqual([])
    expect(speakerBotPlacements({ ...createSpeakerDraft(), botsVisible: false })).toEqual([])
    const canvases: HTMLCanvasElement[] = []
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push(this)
      throw new Error('Encoding failed')
    })
    await expect(createSpeakerAnimationSnapshot(createSpeakerDraft(), assets())).rejects.toThrow('Encoding failed')
    expect(canvases[0]!.width).toBe(0)
  })
})
