// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { langue, t } from '@/i18n'
import { type BotCard } from '@/ui/botCard'
import { exportBotCard, renderBotCardSvg } from '@/ui/botCardRender'
import { exportBotCardsZip } from '@/ui/botCardBatch'
import { telecharge } from '@/ui/capture'
import { printExportErrorKey } from '@/ui/printExport'
import { cle } from '@/ui/stockage'
import BotCardEditor from './BotCardEditor.vue'

vi.mock('@/ui/capture', () => ({ telecharge: vi.fn() }))
vi.mock('@/ui/botCardBatch', () => ({ exportBotCardsZip: vi.fn() }))
vi.mock('@/ui/printExport', () => ({ printExportErrorKey: vi.fn(() => 'printExport.unavailable') }))
vi.mock('@/ui/botCardRender', () => ({
  renderBotCardSvg: vi.fn(),
  exportBotCard: vi.fn()
}))

class MapStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

let app: App | undefined
let host: HTMLDivElement
let storage: MapStorage

async function flush() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

async function mount() {
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(BotCardEditor)
  app.mount(host)
  await flush()
}

function unmount() {
  app?.unmount()
  app = undefined
  host?.remove()
}

function field(selector: string) {
  return host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
}

function button(label: string) {
  const found = Array.from(host.querySelectorAll('button')).find((item) =>
    item.getAttribute('aria-label') === label || item.textContent?.trim().replace(/^\+\s*/, '') === label
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

async function click(label: string) {
  button(label).click()
  await flush()
}

async function enter(selector: string, value: string) {
  const input = field(selector)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

async function selectCard(index: number) {
  const select = host.querySelector<HTMLSelectElement>('#bot-card-selected')!
  select.value = select.options[index]!.value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}

function savedCards(): BotCard[] {
  return JSON.parse(storage.getItem(cle('bot-cards'))!) as BotCard[]
}

function previewSource() {
  return host.querySelector('.card-preview img')?.getAttribute('src')
}

async function namedCard(name = 'Home robots') {
  await click('New card')
  await enter('#bot-card-name', name)
}

beforeEach(() => {
  langue.value = 'en'
  vi.useFakeTimers()
  storage = new MapStorage()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.mocked(renderBotCardSvg).mockReset().mockImplementation(async (card, side) => `<svg data-side="${side}"><text>${card.name}</text><text>${card.eventName}</text></svg>`)
  vi.mocked(exportBotCard).mockReset().mockResolvedValue(new Blob(['card'], { type: 'image/png' }))
  vi.mocked(exportBotCardsZip).mockReset().mockResolvedValue(new Blob(['zip'], { type: 'application/zip' }))
  vi.mocked(telecharge).mockReset()
  vi.mocked(printExportErrorKey).mockClear()
})

afterEach(() => {
  unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('on-demand bot cards', () => {
  it('starts empty without creating cards or touching storage', async () => {
    const write = vi.spyOn(storage, 'setItem')
    await mount()
    await vi.advanceTimersByTimeAsync(500)

    expect(host.textContent).toContain('Create your first bot card')
    expect(host.querySelector('#bot-card-selected')).toBeNull()
    expect(host.textContent).not.toContain('All PNG (ZIP)')
    expect(exportBotCardsZip).not.toHaveBeenCalled()
    expect(renderBotCardSvg).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(storage.getItem(cle('bot-cards'))).toBeNull()
  })

  it('creates blank independent cards and requires a name before exporting', async () => {
    await mount()
    await click('New card')
    expect(field('#bot-card-name').value).toBe('')
    expect(field('#bot-card-handle').value).toBe('')
    expect(field('#bot-card-description').value).toBe('')
    expect(field('#bot-card-event-name').value).toBe('')
    expect(field('#bot-card-event-name').tagName).toBe('TEXTAREA')
    expect(field('#bot-card-event-name').getAttribute('rows')).toBe('2')
    expect(field('#bot-card-event-name').getAttribute('maxlength')).toBe('80')
    expect(field('#bot-card-link').value).toBe('')
    expect(button('Download PNG').disabled).toBe(true)
    expect(button('Download SVG').disabled).toBe(true)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(host.textContent).toContain('Enter a name for your bot')
    expect(field('#bot-card-name').getAttribute('aria-invalid')).toBe('true')
    expect(exportBotCard).not.toHaveBeenCalled()

    await enter('#bot-card-name', 'Home robots')
    await enter('#bot-card-description', 'Control your home from chat.')
    await enter('#bot-card-event-name', 'Bot meetup')
    await click('Triangle')
    await click('Front')
    expect(button('Download PNG').disabled).toBe(false)
    await click('New card')
    expect(field('#bot-card-name').value).toBe('')
    expect(field('#bot-card-description').value).toBe('')
    expect(field('#bot-card-event-name').value).toBe('')
    expect(button('Circle').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector<HTMLSelectElement>('#bot-card-selected')!.options).toHaveLength(2)
    await selectCard(0)
    expect(field('#bot-card-name').value).toBe('Home robots')
    expect(field('#bot-card-description').value).toBe('Control your home from chat.')
    expect(field('#bot-card-event-name').value).toBe('Bot meetup')
    expect(button('Triangle').getAttribute('aria-pressed')).toBe('true')
  })

  it('duplicates appearance and text while keeping subsequent edits independent', async () => {
    await mount()
    await namedCard('Original')
    await enter('#bot-card-description', 'Original description')
    await enter('#bot-card-event-name', 'Original event')
    await enter('#bot-card-link', 'https://x.ai/bot/original')
    await click('Triangle')
    await enter('#bot-card-color', '#8844aa')
    await click('Duplicate')
    expect(field('#bot-card-name').value).toBe('Original')
    expect(field('#bot-card-event-name').value).toBe('Original event')
    expect(button('Triangle').getAttribute('aria-pressed')).toBe('true')
    expect(field('#bot-card-color').value).toBe('#8844aa')
    expect(field('#bot-card-link').value).toBe('https://x.ai/bot/original')
    await enter('#bot-card-name', 'Copy')
    await enter('#bot-card-description', 'Independent description')
    await enter('#bot-card-event-name', 'Another event')
    await enter('#bot-card-link', 'https://x.ai/bot/copy')
    await click('Circle')
    await vi.advanceTimersByTimeAsync(400)

    const [original, copy] = savedCards()
    expect(original).toMatchObject({ name: 'Original', eventName: 'Original event', description: 'Original description', url: 'https://x.ai/bot/original', shape: 'triangle', bodyColor: '#8844aa' })
    expect(copy).toMatchObject({ name: 'Copy', eventName: 'Another event', description: 'Independent description', url: 'https://x.ai/bot/copy', shape: 'cercle', bodyColor: '#8844aa' })
    expect(copy!.id).not.toBe(original!.id)
    await selectCard(0)
    expect(field('#bot-card-description').value).toBe('Original description')
    expect(field('#bot-card-event-name').value).toBe('Original event')
    expect(field('#bot-card-link').value).toBe('https://x.ai/bot/original')
  })

  it('confirms deletion and returns to an empty collection after deleting the last card', async () => {
    await mount()
    await namedCard()
    await click('Delete card')
    expect(host.textContent).toContain('Delete this card?')
    await click('Cancel')
    expect(field('#bot-card-name').value).toBe('Home robots')
    await click('Delete card')
    await click('Delete')
    expect(host.textContent).toContain('Create your first bot card')
    expect(host.querySelector('#bot-card-selected')).toBeNull()
    expect(previewSource()).toBeUndefined()
    window.dispatchEvent(new Event('pagehide'))
    expect(savedCards()).toEqual([])
    unmount()
    await mount()
    expect(host.textContent).toContain('Create your first bot card')
  })
})

describe('bot card persistence', () => {
  it('debounces edits and restores text and all bot customisation', async () => {
    const write = vi.spyOn(storage, 'setItem')
    await mount()
    await namedCard('Be happier')
    await enter('#bot-card-handle', '@lennysan')
    await enter('#bot-card-description', 'Protect what already matters.')
    await enter('#bot-card-event-name', 'Grok Bot\nSan Salvador Meetup')
    await enter('#bot-card-link', 'https://x.ai/bot/be-happier')
    await click('Triangle')
    await click('Happy')
    await click('Purple')
    await vi.advanceTimersByTimeAsync(399)
    expect(write).not.toHaveBeenCalled()
    await enter('#bot-card-color', '#965fce')
    await vi.advanceTimersByTimeAsync(399)
    expect(write).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Saving…')
    await vi.advanceTimersByTimeAsync(1)
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    expect(savedCards()[0]).toMatchObject({ name: 'Be happier', eventName: 'Grok Bot\nSan Salvador Meetup', handle: '@lennysan', description: 'Protect what already matters.', url: 'https://x.ai/bot/be-happier', shape: 'triangle', expression: 'heureux', color: 'violet', bodyColor: '#965fce' })
    expect(host.textContent).toContain('Saved in this browser')
    unmount()
    await mount()
    expect(field('#bot-card-name').value).toBe('Be happier')
    expect(field('#bot-card-handle').value).toBe('@lennysan')
    expect(field('#bot-card-description').value).toBe('Protect what already matters.')
    expect(field('#bot-card-event-name').value).toBe('Grok Bot\nSan Salvador Meetup')
    expect(field('#bot-card-link').value).toBe('https://x.ai/bot/be-happier')
    expect(button('Triangle').getAttribute('aria-pressed')).toBe('true')
    expect(button('Happy').getAttribute('aria-pressed')).toBe('true')
    expect(button('Purple').getAttribute('aria-pressed')).toBe('true')
    expect(field('#bot-card-color').value).toBe('#965fce')
    await click('Use palette color')
    window.dispatchEvent(new Event('pagehide'))
    expect(savedCards()[0]!.bodyColor).toBe('')
    expect(savedCards()[0]!.color).toBe('violet')
  })

  it('flushes pending changes on pagehide without a second delayed write', async () => {
    const write = vi.spyOn(storage, 'setItem')
    await mount()
    await namedCard('Before leaving')
    await enter('#bot-card-description', 'Save this latest draft.')
    await vi.advanceTimersByTimeAsync(100)
    window.dispatchEvent(new Event('pagehide'))
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(savedCards()[0]!.description).toBe('Save this latest draft.')
    await vi.advanceTimersByTimeAsync(500)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('keeps edits and allows export when storage fails, then retries saving', async () => {
    await mount()
    await namedCard('Local draft')
    await click('Front')
    const write = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
    await enter('#bot-card-description', 'Do not lose this text.')
    await vi.advanceTimersByTimeAsync(400)
    await flush()
    expect(host.textContent).toContain('Could not save in this browser')
    expect(field('#bot-card-description').value).toBe('Do not lose this text.')
    expect(button('Download SVG').disabled).toBe(false)
    expect(storage.getItem(cle('bot-cards'))).toBeNull()

    write.mockRestore()
    await click('Retry saving')
    expect(savedCards()[0]!.description).toBe('Do not lose this text.')
    expect(host.textContent).toContain('Saved in this browser')
    expect(host.textContent).not.toContain('Could not save in this browser')
  })

  it('reports invalid saved data and recovers after creating a new card', async () => {
    storage.setItem(cle('bot-cards'), '{broken')
    await mount()
    expect(host.textContent).toContain('Saved cards could not be loaded')
    expect(host.textContent).toContain('Create your first bot card')
    await namedCard('Recovered')
    await vi.advanceTimersByTimeAsync(400)
    await flush()
    expect(savedCards()[0]!.name).toBe('Recovered')
    expect(host.textContent).not.toContain('Saved cards could not be loaded')
  })
})

describe('bot card collection downloads', () => {
  it('captures the print size for both CMYK PDF faces and the full collection', async () => {
    await mount()
    await namedCard('Printed')
    await enter('#bot-card-link', 'https://x.ai/bot/printed')
    await click('Duplicate')
    await enter('#bot-card-print-size', '12.5')
    const zipped = deferred<Blob>()
    vi.mocked(exportBotCardsZip).mockReturnValueOnce(zipped.promise)
    await click(t('botCards.downloadAllPdf'))
    const [snapshot, format, , signal, options] = vi.mocked(exportBotCardsZip).mock.calls[0]!
    expect(snapshot).toHaveLength(2)
    expect(format).toBe('pdf')
    expect(options).toEqual({ sizeMm: 125 })
    expect(signal?.aborted).toBe(false)
    expect(button(t('botCards.downloadPdf')).disabled).toBe(true)
    await enter('#bot-card-print-size', '20')
    expect(options).toEqual({ sizeMm: 125 })
    zipped.resolve(new Blob(['PDF archive']))
    await flush()
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'bot-cards-cmyk-pdf.zip')
  })

  it('shows actionable PDF batch conversion errors and allows RGB exports afterward', async () => {
    await mount()
    await namedCard('Ready')
    await enter('#bot-card-link', 'https://x.ai/bot/ready')
    const failure = new Error('Print service unavailable')
    vi.mocked(exportBotCardsZip).mockRejectedValueOnce(failure)
    await click(t('botCards.downloadAllPdf'))
    expect(printExportErrorKey).toHaveBeenLastCalledWith(failure)
    expect(host.textContent).toContain(t('printExport.unavailable'))
    expect(telecharge).not.toHaveBeenCalled()
    await click('All PNG (ZIP)')
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'bot-cards-png.zip')
    expect(host.textContent).not.toContain(t('printExport.unavailable'))
  })

  it.each(['png', 'svg'] as const)('exports a snapshot of every card as %s regardless of the selected side', async (format) => {
    await mount()
    await namedCard('Same name')
    await enter('#bot-card-link', 'https://x.ai/bot/first')
    await enter('#bot-card-event-name', 'Grok Bot\nSan Salvador Meetup')
    await click('Duplicate')
    await enter('#bot-card-link', 'https://x.ai/bot/second')
    await click('Front')
    expect(host.textContent).toContain('Front and back of every card in one ZIP.')
    const zipped = deferred<Blob>()
    vi.mocked(exportBotCardsZip).mockReturnValueOnce(zipped.promise)
    const batchButton = button(format === 'png' ? 'All PNG (ZIP)' : 'All SVG (ZIP)')
    batchButton.click()
    batchButton.click()
    button(format === 'png' ? 'All SVG (ZIP)' : 'All PNG (ZIP)').click()
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()

    expect(exportBotCardsZip).toHaveBeenCalledTimes(1)
    expect(exportBotCard).not.toHaveBeenCalled()
    expect(button('All PNG (ZIP)').disabled).toBe(true)
    expect(button('All SVG (ZIP)').disabled).toBe(true)
    expect(button('Download PNG').disabled).toBe(true)
    expect(button('Download SVG').disabled).toBe(true)
    expect(host.textContent).toContain('Preparing 0 of 4 files…')
    const [snapshot, requestedFormat, progress, signal] = vi.mocked(exportBotCardsZip).mock.calls[0]!
    expect(requestedFormat).toBe(format)
    expect(snapshot).toHaveLength(2)
    expect(snapshot[0]!.id).not.toBe(snapshot[1]!.id)
    expect(snapshot.map((item) => item.url)).toEqual(['https://x.ai/bot/first', 'https://x.ai/bot/second'])
    expect(snapshot.map((item) => item.name)).toEqual(['Same name', 'Same name'])
    expect(signal?.aborted).toBe(false)
    progress!(2, 4)
    await flush()
    expect(host.textContent).toContain('Preparing 2 of 4 files…')

    await enter('#bot-card-name', 'Changed during export')
    await enter('#bot-card-event-name', 'Next event')
    expect(snapshot[1]).toMatchObject({ name: 'Same name', eventName: 'Grok Bot\nSan Salvador Meetup' })
    const blob = new Blob(['all cards'], { type: 'application/zip' })
    zipped.resolve(blob)
    await flush()
    expect(telecharge).toHaveBeenCalledWith(blob, `bot-cards-${format}.zip`)
    expect(host.textContent).toContain('ZIP downloaded')
    expect(button('Front').getAttribute('aria-pressed')).toBe('true')
    expect(button('All PNG (ZIP)').disabled).toBe(false)
    expect(button('Download SVG').disabled).toBe(false)
  })

  it.each([
    { name: '', url: 'https://x.ai/bot/second', field: '#bot-card-name', message: 'Add a name to card 2 to export all cards.', correction: 'Second' },
    { name: 'Second', url: '', field: '#bot-card-link', message: 'Add a valid link to card 2 to export both sides of all cards.', correction: 'https://x.ai/bot/second' },
    { name: 'Second', url: 'javascript:alert(1)', field: '#bot-card-link', message: 'Add a valid link to card 2 to export both sides of all cards.', correction: 'https://x.ai/bot/second' }
  ])('selects and focuses an invalid unselected card before any export: $name / $url', async (invalid) => {
    await mount()
    await namedCard('Ready')
    await enter('#bot-card-link', 'https://x.ai/bot/ready')
    await namedCard(invalid.name)
    await enter('#bot-card-link', invalid.url)
    await selectCard(0)
    await click('Front')
    await click('All SVG (ZIP)')

    expect(exportBotCardsZip).not.toHaveBeenCalled()
    expect(telecharge).not.toHaveBeenCalled()
    expect(host.querySelector<HTMLSelectElement>('#bot-card-selected')!.selectedIndex).toBe(1)
    expect(host.textContent).toContain(invalid.message)
    expect(field(invalid.field).getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field(invalid.field))
    if (invalid.field === '#bot-card-link') expect(button('Back').getAttribute('aria-pressed')).toBe('true')
    await enter(invalid.field, invalid.correction)
    await click('All SVG (ZIP)')
    expect(exportBotCardsZip).toHaveBeenCalledTimes(1)
    expect(vi.mocked(exportBotCardsZip).mock.calls[0]![0]).toHaveLength(2)
    expect(host.textContent).toContain('ZIP downloaded')
  })

  it('reports a failed collection export and allows retrying', async () => {
    await mount()
    await namedCard('Ready')
    await enter('#bot-card-link', 'https://x.ai/bot/ready')
    vi.mocked(exportBotCardsZip).mockRejectedValueOnce(new Error('Encoder unavailable'))
    await click('All PNG (ZIP)')
    expect(host.textContent).toContain('The ZIP could not be exported. Please try again.')
    expect(telecharge).not.toHaveBeenCalled()
    expect(button('All PNG (ZIP)').disabled).toBe(false)
    await click('All PNG (ZIP)')
    expect(exportBotCardsZip).toHaveBeenCalledTimes(2)
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'bot-cards-png.zip')
    expect(host.textContent).toContain('ZIP downloaded')
    expect(host.textContent).not.toContain('The ZIP could not be exported')
  })

  it('blocks collection downloads while a single-card export is running', async () => {
    await mount()
    await namedCard('Ready')
    await enter('#bot-card-link', 'https://x.ai/bot/ready')
    const encoded = deferred<Blob>()
    vi.mocked(exportBotCard).mockReturnValueOnce(encoded.promise)
    await click('Download SVG')
    expect(button('All PNG (ZIP)').disabled).toBe(true)
    expect(button('All SVG (ZIP)').disabled).toBe(true)
    await click('All PNG (ZIP)')
    expect(exportBotCardsZip).not.toHaveBeenCalled()
    encoded.resolve(new Blob(['card']))
    await flush()
    expect(button('All PNG (ZIP)').disabled).toBe(false)
  })

  it('aborts an unfinished collection export when the editor unmounts', async () => {
    await mount()
    await namedCard('Ready')
    await enter('#bot-card-link', 'https://x.ai/bot/ready')
    const zipped = deferred<Blob>()
    vi.mocked(exportBotCardsZip).mockReturnValueOnce(zipped.promise)
    await click('All SVG (ZIP)')
    const signal = vi.mocked(exportBotCardsZip).mock.calls[0]![3]!
    expect(signal.aborted).toBe(false)
    unmount()
    expect(signal.aborted).toBe(true)
    zipped.resolve(new Blob(['unused archive']))
    await flush()
    expect(telecharge).not.toHaveBeenCalled()
  })
})

describe('bot card previews and downloads', () => {
  it('exports the selected side as PDF using a default 10 cm square and a captured custom size', async () => {
    await mount()
    await namedCard('Print bot')
    await click('Front')
    expect(field('#bot-card-print-size').value).toBe('10')
    await click(t('botCards.downloadPdf'))
    expect(exportBotCard).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Print bot' }), 'pdf', 'front', { sizeMm: 100 }, expect.any(AbortSignal))
    expect(telecharge).toHaveBeenLastCalledWith(expect.any(Blob), 'bot-card-print-bot-front-cmyk.pdf')
    vi.mocked(telecharge).mockClear()
    await enter('#bot-card-link', 'https://x.ai/bot/printed')
    await click('Back')
    await enter('#bot-card-print-size', '8.5')
    const encoded = deferred<Blob>()
    vi.mocked(exportBotCard).mockReturnValueOnce(encoded.promise)
    await click(t('botCards.downloadPdf'))
    const [snapshot, format, side, options, signal] = vi.mocked(exportBotCard).mock.calls.at(-1)!
    expect({ format, side, options }).toEqual({ format: 'pdf', side: 'back', options: { sizeMm: 85 } })
    expect(signal?.aborted).toBe(false)
    await enter('#bot-card-print-size', '20')
    await enter('#bot-card-name', 'New name')
    expect(snapshot.name).toBe('Print bot')
    expect(options).toEqual({ sizeMm: 85 })
    encoded.resolve(new Blob(['printed PDF'], { type: 'application/pdf' }))
    await flush()
    expect(telecharge).toHaveBeenLastCalledWith(expect.any(Blob), 'bot-card-print-bot-cmyk.pdf')
    expect(host.textContent).not.toContain('Card downloaded')
  })

  it.each(['', '0', '0.9', '30.1'])('validates print size %j without blocking PNG or SVG', async (size) => {
    await mount()
    await namedCard('Ready')
    await enter('#bot-card-link', 'https://x.ai/bot/ready')
    await enter('#bot-card-print-size', size)
    expect(field('#bot-card-print-size').getAttribute('aria-invalid')).toBe('true')
    expect(host.textContent).toContain(t('botCards.invalidPrintSize'))
    expect(button(t('botCards.downloadPdf')).disabled).toBe(true)
    expect(button(t('botCards.downloadAllPdf')).disabled).toBe(true)
    expect(button('Download PNG').disabled).toBe(false)
    expect(button('Download SVG').disabled).toBe(false)
    expect(button('All PNG (ZIP)').disabled).toBe(false)
    await click('Download SVG')
    expect(exportBotCard).toHaveBeenLastCalledWith(expect.any(Object), 'svg', 'back')
    await enter('#bot-card-print-size', '30')
    expect(button(t('botCards.downloadPdf')).disabled).toBe(false)
  })

  it('surfaces CMYK conversion errors and recovers on retry', async () => {
    await mount()
    await namedCard('Ready')
    await click('Front')
    const failure = new Error('Print service unavailable')
    vi.mocked(exportBotCard).mockRejectedValueOnce(failure)
    await click(t('botCards.downloadPdf'))
    expect(printExportErrorKey).toHaveBeenCalledWith(failure)
    expect(host.textContent).toContain(t('printExport.unavailable'))
    expect(host.textContent).not.toContain(t('botCards.exportError'))
    expect(telecharge).not.toHaveBeenCalled()
    await click(t('botCards.downloadPdf'))
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'bot-card-ready-front-cmyk.pdf')
    expect(host.textContent).not.toContain(t('printExport.unavailable'))
  })

  it('aborts a single PDF and does not download its late response after unmount', async () => {
    await mount()
    await namedCard('Ready')
    await click('Front')
    const encoded = deferred<Blob>()
    vi.mocked(exportBotCard).mockReturnValueOnce(encoded.promise)
    await click(t('botCards.downloadPdf'))
    const signal = vi.mocked(exportBotCard).mock.calls[0]![4]!
    expect(signal.aborted).toBe(false)
    unmount()
    expect(signal.aborted).toBe(true)
    encoded.resolve(new Blob(['stale PDF']))
    await flush()
    expect(telecharge).not.toHaveBeenCalled()
  })

  it('previews the chosen side and requires a link only for the back', async () => {
    await mount()
    await namedCard()
    expect(button('Back').getAttribute('aria-pressed')).toBe('true')
    expect(button('Front').getAttribute('aria-pressed')).toBe('false')
    expect(renderBotCardSvg).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Home robots' }), 'back')
    expect(decodeURIComponent(previewSource()!)).toContain('data-side="back"')
    expect(host.querySelector('.card-preview img')?.getAttribute('alt')).toBe('Back of the bot card for Home robots')
    expect(button('Download PNG').disabled).toBe(true)
    expect(button('Download SVG').disabled).toBe(true)
    expect(host.textContent).toContain('Add a link to export the back with its QR code')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(exportBotCard).not.toHaveBeenCalled()
    expect(field('#bot-card-link').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field('#bot-card-link'))

    await enter('#bot-card-link', 'https://x.ai/bot/home')
    expect(button('Download PNG').disabled).toBe(false)
    expect(button('Download SVG').disabled).toBe(false)
    expect(field('#bot-card-link').getAttribute('aria-invalid')).toBe('false')
    await click('Download PNG')
    expect(exportBotCard).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://x.ai/bot/home' }), 'png', 'back')
    expect(telecharge).toHaveBeenLastCalledWith(expect.any(Blob), 'bot-card-home-robots.png')
    await click('Download SVG')
    expect(exportBotCard).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://x.ai/bot/home' }), 'svg', 'back')
    expect(telecharge).toHaveBeenLastCalledWith(expect.any(Blob), 'bot-card-home-robots.svg')

    await enter('#bot-card-link', '')
    expect(button('Download PNG').disabled).toBe(true)
    await click('Front')
    expect(button('Front').getAttribute('aria-pressed')).toBe('true')
    expect(button('Download PNG').disabled).toBe(false)
    expect(decodeURIComponent(previewSource()!)).toContain('data-side="front"')
    expect(host.querySelector('.card-preview img')?.getAttribute('alt')).toBe('Front of the bot card for Home robots')
    expect(host.textContent).not.toContain('Add a link to export the back with its QR code')
    await click('Download PNG')
    expect(exportBotCard).toHaveBeenLastCalledWith(expect.objectContaining({ url: '', eventName: '' }), 'png', 'front')
    expect(telecharge).toHaveBeenLastCalledWith(expect.any(Blob), 'bot-card-home-robots-front.png')
  })

  it.each([
    'javascript:alert(1)',
    'https://user:password@example.com/bot',
    'https://example.com/not a link',
    `https://example.com/${'é'.repeat(250)}`
  ])('rejects an invalid back link while allowing the front: %s', async (url) => {
    await mount()
    await namedCard()
    await enter('#bot-card-link', url)
    expect(field('#bot-card-link').getAttribute('aria-invalid')).toBe('true')
    expect(host.textContent).toContain('Enter a valid http:// or https:// link')
    expect(button('Download SVG').disabled).toBe(true)
    expect(button('Download PNG').disabled).toBe(true)
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(exportBotCard).not.toHaveBeenCalled()
    await click('Front')
    await click('Download SVG')
    expect(exportBotCard).toHaveBeenCalledWith(expect.objectContaining({ url }), 'svg', 'front')
  })

  it('keeps a back export tied to its captured side and URL when the view changes', async () => {
    await mount()
    await namedCard('QR bot')
    await enter('#bot-card-link', 'https://x.ai/bot/first')
    const encoded = deferred<Blob>()
    vi.mocked(exportBotCard).mockReturnValueOnce(encoded.promise)
    await click('Download SVG')
    await click('Front')
    await enter('#bot-card-link', 'https://x.ai/bot/second')
    const [snapshot, format, side] = vi.mocked(exportBotCard).mock.calls[0]!
    expect(snapshot.url).toBe('https://x.ai/bot/first')
    expect(format).toBe('svg')
    expect(side).toBe('back')
    const blob = new Blob(['back snapshot'], { type: 'image/svg+xml' })
    encoded.resolve(blob)
    await flush()
    expect(telecharge).toHaveBeenCalledWith(blob, 'bot-card-qr-bot.svg')
    expect(button('Front').getAttribute('aria-pressed')).toBe('true')
    expect(field('#bot-card-link').value).toBe('https://x.ai/bot/second')
    expect(host.textContent).not.toContain('Card downloaded')
    expect(button('Download SVG').disabled).toBe(false)
  })

  it('ignores an older side preview that finishes after the selected side', async () => {
    await mount()
    await namedCard()
    await enter('#bot-card-link', 'https://x.ai/bot/home')
    const front = deferred<string>()
    const back = deferred<string>()
    vi.mocked(renderBotCardSvg).mockReturnValueOnce(front.promise).mockReturnValueOnce(back.promise)
    await click('Front')
    await click('Back')
    back.resolve('<svg data-side="back-latest" />')
    await flush()
    const current = previewSource()
    expect(decodeURIComponent(current!)).toContain('back-latest')
    front.resolve('<svg data-side="front-stale" />')
    await flush()
    expect(previewSource()).toBe(current)
    expect(host.querySelector('.card-preview img')?.getAttribute('alt')).toBe('Back of the bot card for Home robots')
    expect(host.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false')
  })

  it('updates the front event preview and captures it independently during export', async () => {
    await mount()
    await namedCard('Home robots')
    await enter('#bot-card-description', 'The first version')
    await click('Front')
    await enter('#bot-card-event-name', 'Grok Bot\nSan Salvador Meetup')
    expect(renderBotCardSvg).toHaveBeenLastCalledWith(expect.objectContaining({ eventName: 'Grok Bot\nSan Salvador Meetup' }), 'front')
    expect(decodeURIComponent(previewSource()!)).toContain('Grok Bot\nSan Salvador Meetup')
    expect(exportBotCard).not.toHaveBeenCalled()
    const encoded = deferred<Blob>()
    vi.mocked(exportBotCard).mockReturnValueOnce(encoded.promise)
    const png = button('Download PNG')
    png.click()
    png.click()
    button('Download SVG').click()
    await flush()
    expect(exportBotCard).toHaveBeenCalledTimes(1)
    expect(png.disabled).toBe(true)
    expect(button('Download SVG').disabled).toBe(true)
    await enter('#bot-card-name', 'Renamed later')
    await enter('#bot-card-description', 'The newer version')
    await enter('#bot-card-event-name', 'Next event')
    await click('Triangle')
    const [snapshot, format] = vi.mocked(exportBotCard).mock.calls[0]!
    expect(snapshot).toMatchObject({ name: 'Home robots', eventName: 'Grok Bot\nSan Salvador Meetup', description: 'The first version', shape: 'cercle' })
    expect(format).toBe('png')

    const blob = new Blob(['original snapshot'], { type: 'image/png' })
    encoded.resolve(blob)
    await flush()
    expect(telecharge).toHaveBeenCalledWith(blob, 'bot-card-home-robots-front.png')
    expect(field('#bot-card-name').value).toBe('Renamed later')
    expect(field('#bot-card-event-name').value).toBe('Next event')
    expect(decodeURIComponent(previewSource()!)).toContain('Next event')
    expect(button('Download PNG').disabled).toBe(false)
    expect(host.textContent).not.toContain('Card downloaded')
  })

  it('allows retrying a failed SVG export', async () => {
    await mount()
    await namedCard('Webby')
    await enter('#bot-card-link', 'https://x.ai/bot/webby')
    vi.mocked(exportBotCard).mockRejectedValueOnce(new Error('Encoder unavailable'))
    await click('Download SVG')
    expect(host.textContent).toContain('The card could not be exported')
    expect(button('Download SVG').disabled).toBe(false)
    expect(telecharge).not.toHaveBeenCalled()
    await click('Download SVG')
    expect(exportBotCard).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Webby' }), 'svg', 'back')
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'bot-card-webby.svg')
    expect(host.textContent).toContain('Card downloaded')
  })

  it('keeps the current preview when an older selected card renders late', async () => {
    await mount()
    await namedCard('First')
    await namedCard('Second')
    const first = deferred<string>()
    const second = deferred<string>()
    vi.mocked(renderBotCardSvg).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await selectCard(0)
    await selectCard(1)
    second.resolve('<svg><text>Second latest</text></svg>')
    await flush()
    const current = previewSource()
    expect(decodeURIComponent(current!)).toContain('Second latest')
    first.resolve('<svg><text>First stale</text></svg>')
    await flush()
    expect(previewSource()).toBe(current)
    expect(host.querySelector('.card-preview img')?.getAttribute('alt')).toBe('Back of the bot card for Second')
    expect(host.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false')
  })

  it('recovers the preview on the next edit after a rendering failure', async () => {
    await mount()
    await namedCard()
    vi.mocked(renderBotCardSvg).mockRejectedValueOnce(new Error('Preview unavailable'))
    await enter('#bot-card-description', 'A new draft')
    expect(host.textContent).toContain('The preview could not be displayed')
    expect(previewSource()).toBeUndefined()
    await enter('#bot-card-name', 'Working again')
    expect(host.textContent).not.toContain('The preview could not be displayed')
    expect(decodeURIComponent(previewSource()!)).toContain('Working again')
  })
})
