// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App, type Ref } from 'vue'
import type { Fige } from '@/bot/figes'
import { langue } from '@/i18n'
import { telecharge } from '@/ui/capture'
import { cle } from '@/ui/stockage'
import { createStickerSheetLayout, DEFAULT_STICKER_SHEET_SETTINGS, resolveStickerBrandingPlacement, type StickerSheetSettings } from '@/ui/stickerSheet'
import { renderStickerSheet, stickerSheetZip, stickerSheetPrintZip, type StickerSheetRender } from '@/ui/stickerSheetRender'
import { PrintExportError } from '@/ui/printExport'
import type { StickerSheetBranding } from '@/ui/stickerSheetBranding'
import StickerSheetDialog from './StickerSheetDialog.vue'

vi.mock('@/ui/capture', () => ({ telecharge: vi.fn() }))
vi.mock('@/ui/stickerSheetRender', () => ({ renderStickerSheet: vi.fn(), stickerSheetZip: vi.fn(), stickerSheetPrintZip: vi.fn() }))

const bot = (id = 'f1'): Fige => ({ id, shape: 'nuage', expression: 'heureux', color: 'orange' })
const MANUAL_SETTINGS = { ...DEFAULT_STICKER_SHEET_SETTINGS, autoFit: false }
const logo = (): StickerSheetBranding => ({ name: 'logo.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', aspectRatio: 1 })
const rendered = (settings: StickerSheetSettings, count = 1, marker = 'current', hasBranding = false): StickerSheetRender => {
  const layout = createStickerSheetLayout(settings, count)
  const placement = hasBranding ? resolveStickerBrandingPlacement(layout) : null
  const bounds = placement ? { x: placement.centerXMm - placement.sizeMm / 2, y: placement.centerYMm - placement.sizeMm / 2, width: placement.sizeMm, height: placement.sizeMm } : null
  const logoGroup = bounds ? `<g data-sticker-index="${count - 1}" transform="translate(${bounds.x} ${bounds.y})"><path d="M0 0h${bounds.width}v${bounds.height}H0Z"/></g>` : ''
  return {
    art: `<svg data-mode="art" data-marker="${marker}">${logoGroup}</svg>`,
    cut: `<svg data-mode="cut" data-marker="${marker}">${logoGroup}</svg>`,
    overlay: `<svg data-mode="overlay" data-marker="${marker}">${logoGroup}</svg>`,
    layout,
    ...(placement && bounds ? { branding: { placement, bounds }, brandingOutOfBounds: false } : {})
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class MapStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

let app: App | undefined
let host: HTMLDivElement
let items: Ref<Fige[]>
let branding: Ref<StickerSheetBranding | null>
let open: Ref<boolean>
let storage: MapStorage

async function flush() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

async function ready() {
  await vi.advanceTimersByTimeAsync(120)
  await flush()
}

async function mount(initialItems = [bot()], initiallyOpen = true, initialBranding: StickerSheetBranding | null = null) {
  items = ref(initialItems)
  branding = ref(initialBranding)
  open = ref(initiallyOpen)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(StickerSheetDialog, {
    items: items.value,
    branding: branding.value,
    open: open.value,
    'onUpdate:open': (value: boolean) => { open.value = value }
  }) })
  app.mount(host)
  await flush()
}

function unmount() {
  app?.unmount()
  app = undefined
  host?.remove()
}

function field(name: string) {
  return host.querySelector<HTMLInputElement>(`#sticker-sheet-${name}`)!
}

async function enter(name: string, value: string) {
  field(name).value = value
  field(name).dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

function button(label: string) {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

const download = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!
const source = () => decodeURIComponent(host.querySelector('.sheet-preview')?.getAttribute('src') ?? '')
const presetChoice = (preset: string) => host.querySelector<HTMLInputElement>(`input[name="sticker-sheet-preset"][value="${preset}"]`)!
const brandingTarget = () => host.querySelector<HTMLButtonElement>('.sheet-branding-target')!

function prepareDragTarget() {
  const target = brandingTarget()
  vi.spyOn(target.parentElement!, 'getBoundingClientRect').mockReturnValue({ x: 80, y: 90, top: 90, left: 80, width: 594, height: 420, right: 674, bottom: 510, toJSON: () => ({}) })
  return target
}

async function pointer(target: HTMLElement, type: string, clientX: number, clientY: number, pointerId = 1) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId, clientX, clientY }))
  await flush()
}

async function choosePreset(preset: string) {
  presetChoice(preset).click()
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers()
  storage = new MapStorage()
  vi.stubGlobal('localStorage', storage)
  langue.value = 'en'
  storage.clear()
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false })
  vi.mocked(renderStickerSheet).mockReset().mockImplementation(async (selected, settings, brand) => rendered(settings, selected.length + (brand ? 1 : 0), 'current', !!brand))
  vi.mocked(stickerSheetZip).mockReset().mockReturnValue(new Blob(['zip'], { type: 'application/zip' }))
  vi.mocked(stickerSheetPrintZip).mockReset().mockResolvedValue(new Blob(['CMYK zip'], { type: 'application/zip' }))
  vi.mocked(telecharge).mockReset()
})

afterEach(() => {
  unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('sticker sheet controls', () => {
  it('automatically sizes all stickers by default while retaining the separate manual size', async () => {
    await mount(Array.from({ length: 25 }, (_, i) => bot(`f${i}`)))
    await ready()
    const autoLayout = createStickerSheetLayout(DEFAULT_STICKER_SHEET_SETTINGS, 25)
    expect(field('auto-fit').checked).toBe(true)
    expect(field('size').readOnly).toBe(true)
    expect(Number(field('size').value)).toBeCloseTo(autoLayout.settings.stickerSizeMm / 10, 3)
    expect(Number(field('size').value)).toBeLessThan(4)
    expect(download().disabled).toBe(false)
    field('auto-fit').click()
    await flush()
    await ready()
    expect(field('size').readOnly).toBe(false)
    expect(field('size').value).toBe('4')
    expect(download().disabled).toBe(true)
    expect(host.textContent).toContain('Some stickers do not fit')
    await enter('size', '3')
    await ready()
    expect(download().disabled).toBe(false)
    field('auto-fit').click()
    await flush()
    expect(field('size').readOnly).toBe(true)
    expect(Number(field('size').value)).toBeCloseTo(autoLayout.settings.stickerSizeMm / 10, 3)
    field('auto-fit').click()
    await flush()
    expect(field('size').value).toBe('3')
    expect(JSON.parse(storage.getItem(cle('sticker-sheet'))!)).toMatchObject({ autoFit: false, stickerSizeMm: 30 })
    unmount()
    await mount()
    expect(field('auto-fit').checked).toBe(false)
    expect(field('size').value).toBe('3')
  })

  it('blocks automatic sheets whose border leaves no room for the stickers', async () => {
    await mount()
    await enter('border', '100')
    await ready()
    expect(host.textContent).toContain('Stickers: 1 · Capacity: 0')
    expect(host.textContent).toContain('No sticker fits')
    expect(download().disabled).toBe(true)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    expect(stickerSheetZip).not.toHaveBeenCalled()
  })

  it('opens on first mount and delegates modal dismissal and cleanup to native dialog', async () => {
    await mount()
    const dialog = host.querySelector('dialog')!
    expect(dialog.open).toBe(true)
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(dialog.getAttribute('aria-labelledby')).toBe('sticker-sheet-title')
    expect(presetChoice('a4').autofocus).toBe(true)
    expect(host.querySelectorAll('input[type="radio"][name="sticker-sheet-preview"]')).toHaveLength(3)
    const cancel = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancel)
    await flush()
    expect(cancel.defaultPrevented).toBe(true)
    expect(open.value).toBe(false)
    expect(dialog.open).toBe(false)
    open.value = true
    await flush()
    expect(dialog.open).toBe(true)
    unmount()
    expect(dialog.open).toBe(false)
  })

  it('uses physical defaults, preserves orientation across presets, and persists valid settings only', async () => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify(MANUAL_SETTINGS))
    await mount()
    expect(field('width').value).toBe('29.7')
    expect(field('height').value).toBe('21')
    expect(field('size').value).toBe('4')
    expect(field('border').value).toBe('2')
    expect(presetChoice('a4').checked).toBe(true)
    expect(presetChoice('letter').checked).toBe(false)
    expect(presetChoice('custom').checked).toBe(false)
    expect(field('width').readOnly).toBe(true)
    expect(field('height').readOnly).toBe(true)
    button('Swap orientation').click()
    await flush()
    expect(presetChoice('a4').checked).toBe(true)
    await choosePreset('letter')
    expect(presetChoice('a4').checked).toBe(false)
    expect(presetChoice('letter').checked).toBe(true)
    expect(Number(field('width').value)).toBeCloseTo(21.59)
    expect(field('height').value).toBe('27.94')
    await choosePreset('a4')
    expect(field('width').value).toBe('21')
    expect(field('height').value).toBe('29.7')
    await enter('size', '5')
    const stored = storage.getItem(cle('sticker-sheet'))!
    expect(JSON.parse(stored)).toEqual({ ...MANUAL_SETTINGS, widthMm: 210, heightMm: 297, stickerSizeMm: 50 })
    await enter('gap', '0')
    expect(storage.getItem(cle('sticker-sheet'))).toBe(stored)
    expect(host.textContent).toContain('Enter a spacing greater than zero')
    expect(field('gap').getAttribute('aria-invalid')).toBe('true')
    expect(download().disabled).toBe(true)
    unmount()
    await mount()
    expect(field('size').value).toBe('5')
    expect(field('gap').value).toBe('4')
    expect(storage.length).toBe(1)
  })

  it.each([
    ['half-letter', '21.59', '13.97', 215.9, 139.7],
    ['quarter-letter', '13.97', '10.795', 139.7, 107.95]
  ] as const)('selects %s with exact physical dimensions and retains its orientation on reload', async (preset, widthCm, heightCm, widthMm, heightMm) => {
    await mount()
    await choosePreset(preset)
    expect(presetChoice(preset).checked).toBe(true)
    expect(presetChoice('a4').checked).toBe(false)
    expect(host.querySelectorAll('input[name="sticker-sheet-preset"]:checked')).toHaveLength(1)
    expect(field('width').value).toBe(widthCm)
    expect(field('height').value).toBe(heightCm)
    expect(field('width').readOnly).toBe(true)
    expect(field('height').readOnly).toBe(true)
    await ready()
    expect(renderStickerSheet).toHaveBeenLastCalledWith([bot()], expect.objectContaining({ preset, widthMm, heightMm }), null)
    button('Swap orientation').click()
    await flush()
    expect(presetChoice(preset).checked).toBe(true)
    expect(field('width').value).toBe(heightCm)
    expect(field('height').value).toBe(widthCm)
    expect(JSON.parse(storage.getItem(cle('sticker-sheet'))!)).toMatchObject({ preset, widthMm: heightMm, heightMm: widthMm })
    unmount()
    await mount()
    expect(presetChoice(preset).checked).toBe(true)
    expect(field('width').value).toBe(heightCm)
    expect(field('height').value).toBe(widthCm)
    await choosePreset('a4')
    await choosePreset(preset)
    expect(field('width').value).toBe(heightCm)
    expect(field('height').value).toBe(widthCm)
  })

  it('edits dimensions only in Custom and retains the preset through orientation changes and reloads', async () => {
    await mount()
    await choosePreset('custom')
    expect(presetChoice('custom').checked).toBe(true)
    expect(field('width').readOnly).toBe(false)
    expect(field('height').readOnly).toBe(false)
    expect(field('width').value).toBe('29.7')
    expect(field('height').value).toBe('21')
    await enter('width', '32')
    await enter('height', '24')
    button('Swap orientation').click()
    await flush()
    expect(presetChoice('custom').checked).toBe(true)
    expect(field('width').value).toBe('24')
    expect(field('height').value).toBe('32')
    unmount()
    await mount()
    expect(presetChoice('custom').checked).toBe(true)
    expect(field('width').value).toBe('24')
    expect(field('height').value).toBe('32')
    await choosePreset('letter')
    expect(field('width').readOnly).toBe(true)
    expect(Number(field('width').value)).toBeCloseTo(21.59)
    expect(field('height').value).toBe('27.94')
    unmount()
    await mount()
    expect(presetChoice('letter').checked).toBe(true)
    expect(field('height').readOnly).toBe(true)
  })

  it('updates colour through the picker or hex field and persists and renders only valid colours', async () => {
    await mount()
    expect(field('background-color').value).toBe('#ffffff')
    expect(field('background-hex').value).toBe('#ffffff')
    await enter('background-color', '#1a2b3c')
    expect(field('background-hex').value).toBe('#1a2b3c')
    await ready()
    expect(renderStickerSheet).toHaveBeenLastCalledWith([bot()], expect.objectContaining({ backgroundColor: '#1a2b3c' }), null)
    await enter('background-hex', '#AABBCC')
    await ready()
    expect(field('background-color').value.toLowerCase()).toBe('#aabbcc')
    expect(renderStickerSheet).toHaveBeenLastCalledWith([bot()], expect.objectContaining({ backgroundColor: '#AABBCC' }), null)
    const stored = storage.getItem(cle('sticker-sheet'))
    const renders = vi.mocked(renderStickerSheet).mock.calls.length
    await enter('background-hex', '#xyz')
    await ready()
    expect(host.textContent).toContain('six-digit hexadecimal colour')
    expect(field('background-hex').getAttribute('aria-invalid')).toBe('true')
    expect(download().disabled).toBe(true)
    expect(renderStickerSheet).toHaveBeenCalledTimes(renders)
    expect(storage.getItem(cle('sticker-sheet'))).toBe(stored)
    await enter('background-color', '#fedcba')
    await ready()
    expect(download().disabled).toBe(false)
    expect(field('background-hex').value).toBe('#fedcba')
    expect(field('background-hex').getAttribute('aria-invalid')).toBe('false')
    unmount()
    await mount()
    expect(field('background-hex').value).toBe('#fedcba')
    expect(field('background-color').value).toBe('#fedcba')
  })

  it('recovers malformed stored settings and requires selected bots', async () => {
    storage.setItem(cle('sticker-sheet'), '{broken')
    await mount([])
    await ready()
    expect(field('width').value).toBe('29.7')
    expect(host.textContent).toContain('Stickers: 0 · Capacity: 0')
    expect(host.textContent).toContain('select bots or upload branding in Stills')
    expect(host.textContent).not.toContain('Some stickers do not fit')
    expect(renderStickerSheet).not.toHaveBeenCalled()
    expect(download().disabled).toBe(true)
  })

  it('shows capacity, blocks overflow, and enables a sheet when every selected bot fits', async () => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify(MANUAL_SETTINGS))
    await mount(Array.from({ length: 25 }, (_, i) => bot(`f${i}`)))
    await ready()
    expect(host.textContent).toContain('Stickers: 25 · Capacity: 24')
    expect(host.textContent).toContain('Some stickers do not fit')
    expect(source()).toContain('data-mode="art"')
    expect(download().disabled).toBe(true)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    expect(stickerSheetZip).not.toHaveBeenCalled()
    items.value = items.value.slice(0, 24)
    await flush()
    await ready()
    expect(host.textContent).toContain('Stickers: 24 · Capacity: 24')
    expect(download().disabled).toBe(false)
  })

  it.each([
    ['width', '', 'positive, finite sheet width'],
    ['size', '0', 'positive, finite sticker size'],
    ['border', '20', 'smaller than half'],
    ['margin', '150', 'leaves space'],
    ['size', '40', 'No sticker fits']
  ])('rejects invalid %s configuration before rendering', async (name, value, message) => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify(MANUAL_SETTINGS))
    await mount()
    if (name === 'width') await choosePreset('custom')
    await enter(name, value)
    await ready()
    expect(host.textContent).toContain(message)
    expect(renderStickerSheet).not.toHaveBeenCalled()
    expect(download().disabled).toBe(true)
  })
})

describe('individual sticker branding controls', () => {
  it('uses centimetres, persists independent logo size and centre, and restores them without resizing bots', async () => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify(MANUAL_SETTINGS))
    await mount([bot('f1'), bot('f2')], true, logo())
    await ready()
    await enter('branding-size', '7')
    await enter('branding-x', '14')
    await enter('branding-y', '8.5')
    await ready()
    const placement = { sizeMm: 70, centerXMm: 140, centerYMm: 85 }
    expect(renderStickerSheet).toHaveBeenLastCalledWith([bot('f1'), bot('f2')], { ...MANUAL_SETTINGS, brandingPlacement: placement }, logo())
    expect(field('size').value).toBe('4')
    const after = await vi.mocked(renderStickerSheet).mock.results.at(-1)!.value
    expect(after.layout.settings.stickerSizeMm).toBe(MANUAL_SETTINGS.stickerSizeMm)
    expect(after.branding?.placement).toEqual(placement)
    expect(JSON.parse(storage.getItem(cle('sticker-sheet'))!)).toEqual({ ...MANUAL_SETTINGS, brandingPlacement: placement })
    unmount()
    await mount([bot('f1'), bot('f2')], true, logo())
    await ready()
    expect(field('branding-size').value).toBe('7')
    expect(field('branding-x').value).toBe('14')
    expect(field('branding-y').value).toBe('8.5')
    expect(field('size').value).toBe('4')
    download().click()
    await flush()
    expect(vi.mocked(stickerSheetZip).mock.calls[0]![0].branding?.placement).toEqual(placement)
  })

  it('resets all logo adjustments to automatic defaults without changing sheet settings', async () => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify({ ...MANUAL_SETTINGS, brandingPlacement: { sizeMm: 80, centerXMm: 140, centerYMm: 85 } }))
    await mount([bot()], true, logo())
    await ready()
    button('Reset logo').click()
    await flush()
    await ready()
    const automatic = resolveStickerBrandingPlacement(createStickerSheetLayout(MANUAL_SETTINGS, 2))!
    expect(Number(field('branding-size').value)).toBeCloseTo(automatic.sizeMm / 10, 3)
    expect(Number(field('branding-x').value)).toBeCloseTo(automatic.centerXMm / 10, 3)
    expect(Number(field('branding-y').value)).toBeCloseTo(automatic.centerYMm / 10, 3)
    expect(field('size').value).toBe('4')
    expect(JSON.parse(storage.getItem(cle('sticker-sheet'))!)).toEqual(MANUAL_SETTINGS)
    expect(renderStickerSheet).toHaveBeenLastCalledWith([bot()], MANUAL_SETTINGS, logo())
  })

  it('hides branding controls when no logo is present and omits stored branding adjustments from bot-only rendering', async () => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify({ ...MANUAL_SETTINGS, brandingPlacement: { sizeMm: 80, centerXMm: 140, centerYMm: 85 } }))
    await mount()
    await ready()
    expect(field('branding-size')).toBeNull()
    expect(brandingTarget()).toBeNull()
    expect(host.textContent).not.toContain('Branding size & position')
    expect(renderStickerSheet).toHaveBeenLastCalledWith([bot()], MANUAL_SETTINGS, null)
    expect(download().disabled).toBe(false)
    branding.value = logo()
    await flush()
    await ready()
    expect(field('branding-size').value).toBe('8')
    branding.value = null
    await flush()
    await ready()
    expect(field('branding-size')).toBeNull()
    expect(brandingTarget()).toBeNull()
    expect(download().disabled).toBe(false)
  })

  it.each([
    ['branding-size', '0.4'],
    ['branding-x', ''],
    ['branding-y', '']
  ])('keeps invalid %s edits out of rendering, storage, and downloads and allows reset', async (name, value) => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify(MANUAL_SETTINGS))
    await mount([bot()], true, logo())
    await ready()
    const stored = storage.getItem(cle('sticker-sheet'))
    await enter(name, value)
    await ready()
    expect(field(name).getAttribute('aria-invalid')).toBe('true')
    expect(host.textContent).toContain('Enter a valid logo size greater than twice the white border')
    expect(renderStickerSheet).toHaveBeenCalledOnce()
    expect(storage.getItem(cle('sticker-sheet'))).toBe(stored)
    expect(download().disabled).toBe(true)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    expect(stickerSheetZip).not.toHaveBeenCalled()
    button('Reset logo').click()
    await flush()
    await ready()
    expect(field(name).getAttribute('aria-invalid')).toBe('false')
    expect(download().disabled).toBe(false)
  })

  it.each([
    ['brandingOutOfBounds', 'The logo extends beyond the sheet margin'],
    ['brandingOverlaps', 'Not enough room beside the logo']
  ])('shows a %s preview for correction, blocks exporting it, and recovers after moving the logo', async (flag, message) => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify(MANUAL_SETTINGS))
    await mount([bot()], true, logo())
    await ready()
    vi.mocked(renderStickerSheet).mockImplementationOnce(async (selected, settings) => ({ ...rendered(settings, selected.length + 1, 'outside', true), [flag]: true }))
    await enter('branding-x', '0')
    await ready()
    expect(source()).toContain('outside')
    expect(brandingTarget()).not.toBeNull()
    expect(host.textContent).toContain(message)
    expect(download().disabled).toBe(true)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flush()
    expect(stickerSheetZip).not.toHaveBeenCalled()
    await enter('branding-x', '14')
    await ready()
    expect(host.textContent).not.toContain(message)
    expect(download().disabled).toBe(false)
    download().click()
    await flush()
    expect(vi.mocked(stickerSheetZip).mock.calls[0]![0].branding?.placement.centerXMm).toBe(140)
  })

  it('moves a focused logo by 1 mm with arrows and 5 mm with Shift while preserving its size', async () => {
    const placement = { sizeMm: 70, centerXMm: 140, centerYMm: 85 }
    storage.setItem(cle('sticker-sheet'), JSON.stringify({ ...MANUAL_SETTINGS, brandingPlacement: placement }))
    await mount([bot()], true, logo())
    await ready()
    const target = brandingTarget()
    target.focus()
    expect(document.activeElement).toBe(target)
    for (const [key, shiftKey, x, y] of [
      ['ArrowRight', false, '14.1', '8.5'],
      ['ArrowUp', true, '14.1', '8'],
      ['ArrowLeft', true, '13.6', '8'],
      ['ArrowDown', false, '13.6', '8.1']
    ] as const) {
      const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      await flush()
      expect(event.defaultPrevented).toBe(true)
      expect(field('branding-x').value).toBe(x)
      expect(field('branding-y').value).toBe(y)
      await ready()
    }
    expect(field('branding-size').value).toBe('7')
    expect(field('size').value).toBe('4')
    const unrelated = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    target.dispatchEvent(unrelated)
    await ready()
    expect(unrelated.defaultPrevented).toBe(false)
    expect(renderStickerSheet).toHaveBeenCalledTimes(5)
  })

  it('converts pointer movement to physical sheet coordinates and previews the move before committing it', async () => {
    const placement = { sizeMm: 70, centerXMm: 140, centerYMm: 85 }
    storage.setItem(cle('sticker-sheet'), JSON.stringify({ ...MANUAL_SETTINGS, brandingPlacement: placement }))
    await mount([bot()], true, logo())
    await ready()
    const target = prepareDragTarget()
    const capture = vi.spyOn(target, 'setPointerCapture')
    const stored = storage.getItem(cle('sticker-sheet'))
    await pointer(target, 'pointerdown', 210, 180)
    expect(capture).toHaveBeenCalledWith(1)
    expect(download().disabled).toBe(true)
    await pointer(target, 'pointermove', 250, 200, 2)
    expect(source()).toContain('transform="translate(105 50)"')
    await pointer(target, 'pointermove', 250, 200)
    expect(source()).toContain('transform="translate(125 60)"')
    expect(Number.parseFloat(target.style.left)).toBeCloseTo(125 / 297 * 100)
    expect(Number.parseFloat(target.style.top)).toBeCloseTo(60 / 210 * 100)
    expect(field('branding-x').value).toBe('14')
    expect(field('branding-y').value).toBe('8.5')
    expect(storage.getItem(cle('sticker-sheet'))).toBe(stored)
    expect(renderStickerSheet).toHaveBeenCalledOnce()
    await pointer(target, 'pointerup', 250, 200)
    expect(field('branding-x').value).toBe('16')
    expect(field('branding-y').value).toBe('9.5')
    expect(download().disabled).toBe(true)
    expect(source()).toContain('transform="translate(125 60)"')
    expect(Number.parseFloat(target.style.left)).toBeCloseTo(125 / 297 * 100)
    await ready()
    expect(renderStickerSheet).toHaveBeenCalledTimes(2)
    expect(source()).toContain('transform="translate(125 60)"')
    expect(download().disabled).toBe(false)
    expect(JSON.parse(storage.getItem(cle('sticker-sheet'))!).brandingPlacement).toEqual({ ...placement, centerXMm: 160, centerYMm: 95 })
  })

  it.each(['pointercancel', 'lostpointercapture'])('discards uncommitted movement on %s', async (eventType) => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify({ ...MANUAL_SETTINGS, brandingPlacement: { sizeMm: 70, centerXMm: 140, centerYMm: 85 } }))
    await mount([bot()], true, logo())
    await ready()
    const target = prepareDragTarget()
    const initialSource = source()
    const stored = storage.getItem(cle('sticker-sheet'))
    await pointer(target, 'pointerdown', 210, 180)
    await pointer(target, 'pointermove', 250, 200)
    expect(source()).not.toBe(initialSource)
    await pointer(target, eventType, 250, 200)
    await pointer(target, 'pointerup', 250, 200)
    await ready()
    expect(source()).toBe(initialSource)
    expect(field('branding-x').value).toBe('14')
    expect(field('branding-y').value).toBe('8.5')
    expect(storage.getItem(cle('sticker-sheet'))).toBe(stored)
    expect(renderStickerSheet).toHaveBeenCalledOnce()
    expect(download().disabled).toBe(false)
  })

  it('discards a drag if the selected bots change before pointer release', async () => {
    const placement = { sizeMm: 70, centerXMm: 140, centerYMm: 85 }
    storage.setItem(cle('sticker-sheet'), JSON.stringify({ ...MANUAL_SETTINGS, brandingPlacement: placement }))
    await mount([bot()], true, logo())
    await ready()
    const target = prepareDragTarget()
    await pointer(target, 'pointerdown', 210, 180)
    await pointer(target, 'pointermove', 250, 200)
    items.value = [bot('replacement')]
    await flush()
    await pointer(target, 'pointerup', 250, 200)
    await ready()
    expect(field('branding-x').value).toBe('14')
    expect(field('branding-y').value).toBe('8.5')
    expect(renderStickerSheet).toHaveBeenLastCalledWith([bot('replacement')], { ...MANUAL_SETTINGS, brandingPlacement: placement }, logo())
    expect(download().disabled).toBe(false)
  })

  it('ignores stale branding adjustments and disables dragging while their replacement preview renders', async () => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify(MANUAL_SETTINGS))
    await mount([bot()], true, logo())
    await ready()
    const target = prepareDragTarget()
    const older = deferred<StickerSheetRender>()
    const newer = deferred<StickerSheetRender>()
    vi.mocked(renderStickerSheet).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    await enter('branding-size', '5')
    await ready()
    await pointer(target, 'pointerdown', 210, 180)
    await pointer(target, 'pointermove', 250, 200)
    await pointer(target, 'pointerup', 250, 200)
    expect(target.classList.contains('is-dragging')).toBe(false)
    await enter('branding-size', '6')
    await ready()
    const olderSettings = vi.mocked(renderStickerSheet).mock.calls[1]![1]
    const newerSettings = vi.mocked(renderStickerSheet).mock.calls[2]![1]
    expect(olderSettings.brandingPlacement?.sizeMm).toBe(50)
    expect(newerSettings.brandingPlacement?.sizeMm).toBe(60)
    const latest = rendered(newerSettings, 2, 'latest-logo', true)
    newer.resolve(latest)
    await flush()
    older.resolve(rendered(olderSettings, 2, 'stale-logo', true))
    await flush()
    expect(source()).toContain('latest-logo')
    expect(source()).not.toContain('stale-logo')
    expect(field('branding-size').value).toBe('6')
    expect(download().disabled).toBe(false)
    download().click()
    await flush()
    expect(stickerSheetZip).toHaveBeenCalledWith(latest)
  })
})

describe('sticker sheet rendering and export', () => {
  it('offers CMYK as a separate print export without rerendering the SVG preview', async () => {
    await mount()
    await ready()
    host.querySelector<HTMLInputElement>('input[name="sticker-sheet-export-format"][value="pdf"]')!.click()
    await flush()
    expect(host.textContent).toContain('SWOP')
    download().click()
    await flush()
    expect(stickerSheetPrintZip).toHaveBeenCalledWith(rendered(DEFAULT_STICKER_SHEET_SETTINGS), expect.any(AbortSignal))
    expect(stickerSheetZip).not.toHaveBeenCalled()
    expect(renderStickerSheet).toHaveBeenCalledOnce()
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'bloub-sticker-sheet-cmyk.zip')
  })

  it('reports missing print service and can still download the original RGB SVG files', async () => {
    vi.mocked(stickerSheetPrintZip).mockRejectedValueOnce(new PrintExportError('unavailable'))
    await mount()
    await ready()
    host.querySelector<HTMLInputElement>('input[name="sticker-sheet-export-format"][value="pdf"]')!.click()
    await flush()
    download().click()
    await flush()
    expect(host.textContent).toContain('CMYK export is unavailable')
    expect(telecharge).not.toHaveBeenCalled()
    host.querySelector<HTMLInputElement>('input[name="sticker-sheet-export-format"][value="svg"]')!.click()
    await flush()
    download().click()
    await flush()
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'bloub-sticker-sheet.zip')
  })

  it.each(['close', 'settings', 'format'])('cancels pending CMYK conversion after a %s change', async (change) => {
    const pending = deferred<Blob>()
    vi.mocked(stickerSheetPrintZip).mockReturnValueOnce(pending.promise)
    await mount()
    await ready()
    host.querySelector<HTMLInputElement>('input[name="sticker-sheet-export-format"][value="pdf"]')!.click()
    await flush()
    download().click()
    await flush()
    const signal = vi.mocked(stickerSheetPrintZip).mock.calls[0]![1]!
    if (change === 'close') button('Close').click()
    else if (change === 'settings') await enter('border', '3')
    else host.querySelector<HTMLInputElement>('input[name="sticker-sheet-export-format"][value="svg"]')!.click()
    await flush()
    expect(signal.aborted).toBe(true)
    pending.resolve(new Blob(['stale PDF']))
    await flush()
    expect(telecharge).not.toHaveBeenCalled()
  })

  it('counts the logo as an additional sticker and allows a branding-only sheet', async () => {
    const brand = logo()
    await mount([], true, brand)
    await ready()
    expect(host.textContent).toContain('Stickers: 1 · Capacity: 1')
    expect(host.textContent).not.toContain('select bots or upload branding')
    expect(download().disabled).toBe(false)
    expect(renderStickerSheet).toHaveBeenLastCalledWith([], DEFAULT_STICKER_SHEET_SETTINGS, brand)
    expect(vi.mocked(renderStickerSheet).mock.calls[0]![2]).not.toBe(branding.value)
    download().click()
    await flush()
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'bloub-sticker-sheet.zip')
    const singleSize = Number(field('size').value)
    items.value = [bot()]
    await flush()
    await ready()
    expect(host.textContent).toContain('Stickers: 2')
    expect(Number(field('size').value)).toBeLessThan(singleSize)
    expect(renderStickerSheet).toHaveBeenLastCalledWith([bot()], DEFAULT_STICKER_SHEET_SETTINGS, brand)
    await enter('gap', '5')
    expect(JSON.parse(storage.getItem(cle('sticker-sheet'))!)).toEqual({ ...DEFAULT_STICKER_SHEET_SETTINGS, gapMm: 5 })
  })

  it('invalidates stale branding renders and disables download when the last logo is removed', async () => {
    const older = deferred<StickerSheetRender>()
    vi.mocked(renderStickerSheet).mockReturnValueOnce(older.promise)
    await mount([], true, logo())
    await ready()
    branding.value = { ...logo(), name: 'replacement.svg' }
    await flush()
    await ready()
    expect(renderStickerSheet).toHaveBeenLastCalledWith([], DEFAULT_STICKER_SHEET_SETTINGS, expect.objectContaining({ name: 'replacement.svg' }))
    expect(download().disabled).toBe(false)
    older.resolve(rendered(DEFAULT_STICKER_SHEET_SETTINGS, 1, 'stale-logo'))
    await flush()
    expect(source()).not.toContain('stale-logo')
    branding.value = null
    await flush()
    expect(source()).toBe('')
    expect(download().disabled).toBe(true)
    expect(host.textContent).toContain('select bots or upload branding in Stills')
  })

  it('makes preview cut lines legible on white without changing downloaded physical strokes', async () => {
    const cutPath = '<path d="M0 0L10 0L10 10Z" fill="none" stroke="#ff00a8" stroke-width="0.1"/>'
    const original = rendered(DEFAULT_STICKER_SHEET_SETTINGS)
    original.cut = `<svg>${cutPath}</svg>`
    original.overlay = `<svg><rect width="10" height="10" fill="white"/>${cutPath}</svg>`
    vi.mocked(renderStickerSheet).mockResolvedValueOnce(original)
    await mount()
    await ready()
    for (const mode of ['cut', 'overlay']) {
      host.querySelector<HTMLInputElement>(`input[value="${mode}"]`)!.click()
      await flush()
      expect(source()).toContain('stroke-width="1" vector-effect="non-scaling-stroke"')
      expect(source()).not.toContain('stroke-width="0.1"')
      expect(host.querySelector('.sheet-preview')!.classList.contains('bg-white')).toBe(true)
    }
    download().click()
    await flush()
    const exported = vi.mocked(stickerSheetZip).mock.calls[0]![0]
    expect(exported).toBe(original)
    expect(exported.cut).toBe(`<svg>${cutPath}</svg>`)
    expect(exported.overlay).toContain('stroke-width="0.1"')
    expect(exported.overlay).not.toContain('non-scaling-stroke')
  })

  it('switches native preview radios without rendering again and downloads the displayed artwork', async () => {
    await mount()
    expect(download().disabled).toBe(true)
    await ready()
    for (const mode of ['cut', 'overlay', 'art']) {
      const input = host.querySelector<HTMLInputElement>(`input[value="${mode}"]`)!
      input.click()
      await flush()
      expect(input.checked).toBe(true)
      expect(source()).toContain(`data-mode="${mode}"`)
    }
    expect(renderStickerSheet).toHaveBeenCalledOnce()
    download().click()
    download().click()
    await flush()
    expect(stickerSheetZip).toHaveBeenCalledOnce()
    expect(stickerSheetZip).toHaveBeenCalledWith(rendered(DEFAULT_STICKER_SHEET_SETTINGS))
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'bloub-sticker-sheet.zip')
    expect(host.textContent).toContain('Sticker sheet downloaded')
  })

  it('coalesces rapid settings edits and ignores an older render that finishes last', async () => {
    storage.setItem(cle('sticker-sheet'), JSON.stringify(MANUAL_SETTINGS))
    const older = deferred<StickerSheetRender>()
    const newer = deferred<StickerSheetRender>()
    vi.mocked(renderStickerSheet).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    await mount()
    await ready()
    await enter('size', '4.5')
    await enter('size', '5')
    await enter('size', '6')
    expect(download().disabled).toBe(true)
    await ready()
    expect(renderStickerSheet).toHaveBeenCalledTimes(2)
    expect(vi.mocked(renderStickerSheet).mock.calls[0]![1].stickerSizeMm).toBe(40)
    expect(vi.mocked(renderStickerSheet).mock.calls[1]![1].stickerSizeMm).toBe(60)
    const latest = rendered({ ...MANUAL_SETTINGS, stickerSizeMm: 60 }, 1, 'latest')
    newer.resolve(latest)
    await flush()
    expect(source()).toContain('latest')
    older.resolve(rendered(MANUAL_SETTINGS, 1, 'stale'))
    await flush()
    expect(source()).toContain('latest')
    expect(source()).not.toContain('stale')
    download().click()
    await flush()
    expect(stickerSheetZip).toHaveBeenCalledWith(latest)
  })

  it('invalidates rendered results immediately when the selected bots change or disappear', async () => {
    await mount([bot('f1'), bot('f2')])
    await ready()
    const pending = deferred<StickerSheetRender>()
    vi.mocked(renderStickerSheet).mockReturnValueOnce(pending.promise)
    items.value = [{ ...bot('f2'), color: 'bleu' }]
    await flush()
    expect(source()).toBe('')
    expect(download().disabled).toBe(true)
    await ready()
    expect(renderStickerSheet).toHaveBeenLastCalledWith([{ ...bot('f2'), color: 'bleu' }], DEFAULT_STICKER_SHEET_SETTINGS, null)
    items.value = []
    await flush()
    pending.resolve(rendered(DEFAULT_STICKER_SHEET_SETTINGS, 1, 'deleted'))
    await flush()
    expect(source()).toBe('')
    expect(download().disabled).toBe(true)
    expect(host.textContent).toContain('select bots or upload branding in Stills')
  })

  it('reports geometry errors and allows retrying, then reports and retries download failure', async () => {
    vi.mocked(renderStickerSheet).mockRejectedValueOnce(new Error('invalidGeometry'))
    await mount()
    await ready()
    expect(host.textContent).toContain('valid closed cut line')
    expect(download().disabled).toBe(true)
    button('Try again').click()
    await flush()
    await ready()
    expect(download().disabled).toBe(false)
    vi.mocked(stickerSheetZip).mockImplementationOnce(() => { throw new Error('ZIP failed') })
    download().click()
    await flush()
    expect(host.textContent).toContain('could not be downloaded')
    expect(download().disabled).toBe(false)
    expect(telecharge).not.toHaveBeenCalled()
    download().click()
    await flush()
    expect(telecharge).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('Sticker sheet downloaded')
  })

  it('ignores stale errors and closed previews, and does not download after dismissal', async () => {
    const old = deferred<StickerSheetRender>()
    vi.mocked(renderStickerSheet).mockReturnValueOnce(old.promise)
    await mount()
    await ready()
    await enter('border', '3')
    await ready()
    old.reject(new Error('old renderer failed'))
    await flush()
    expect(host.textContent).not.toContain('could not be prepared')
    download().click()
    button('Close').click()
    await flush()
    expect(open.value).toBe(false)
    expect(telecharge).not.toHaveBeenCalled()
    expect(stickerSheetZip).not.toHaveBeenCalled()
    expect(source()).toBe('')
  })
})
