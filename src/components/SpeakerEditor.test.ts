// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { langue } from '@/i18n'
import { telecharge } from '@/ui/capture'
import { exportSpeaker, loadSpeakerBots } from '@/ui/speakerRender'
import { createSpeakerAnimationSnapshot } from '@/ui/speakerAnimation'
import { downloadSpeakerAnimation, SpeakerRenderError } from '@/ui/speakerRenderClient'
import type { SpeakerAnimationSnapshot } from '@/shared/speakerAnimation'
import { BUILTIN_PHOTOS, type SpeakerLibrary } from '@/ui/speakerLibrary'
import { encodeSpeakerPhoto } from '@/ui/speakerPhoto'
import { cle } from '@/ui/stockage'
import SpeakerEditor from './SpeakerEditor.vue'

vi.mock('@/ui/capture', () => ({ telecharge: vi.fn() }))
vi.mock('@/ui/speakerRender', () => ({
  renderSpeaker: vi.fn(),
  exportSpeaker: vi.fn(),
  loadSpeakerBots: vi.fn()
}))
vi.mock('@/ui/speakerPhoto', () => ({ encodeSpeakerPhoto: vi.fn() }))
vi.mock('@/ui/speakerAnimation', () => ({ createSpeakerAnimationSnapshot: vi.fn() }))
vi.mock('@/ui/speakerRenderClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/ui/speakerRenderClient')>(),
  downloadSpeakerAnimation: vi.fn()
}))
// Keep these editor tests independent of the lazy player and browser canvas APIs.
vi.mock('./SpeakerAnimationPreview.vue', () => ({ __esModule: true, default: { render: () => null } }))

const animationSnapshot: SpeakerAnimationSnapshot = {
  width: 2400,
  height: 1800,
  background: 'data:image/png;base64,YmFja2dyb3VuZA==',
  foreground: 'data:image/png;base64,Zm9yZWdyb3VuZA==',
  bots: []
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

function storedPhoto(source: string) {
  return `data:image/webp;base64,${btoa(source)}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const decode = vi.fn<(source: string) => Promise<void>>()
let app: App | undefined
let host: HTMLDivElement
let nextUrl: number
let storage: MapStorage

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

async function mount() {
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(SpeakerEditor)
  app.mount(host)
  await flush()
}

function input(selector: string) {
  return host.querySelector<HTMLInputElement>(selector)!
}

function portraitSource() {
  return host.querySelector('img[alt="Selected speaker portrait"]')?.getAttribute('src')
}

function button(label: string) {
  const found = Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.trim() === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

function savedLibrary() {
  return JSON.parse(storage.getItem(cle('speakers'))!) as SpeakerLibrary
}

async function selectVariant(index: number) {
  const select = host.querySelector<HTMLSelectElement>('#speaker-variant')!
  select.value = select.options[index]!.value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}

async function chooseRadio(name: string, value: string) {
  const radio = input(`input[name="${name}"][value="${value}"]`)
  radio.checked = true
  radio.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}

function unmount() {
  app?.unmount()
  app = undefined
  host?.remove()
}

function downloadButton() {
  return Array.from(host.querySelectorAll('button')).find((button) =>
    /Download|Preparing/.test(button.textContent ?? '')
  )!
}

async function enter(selector: string, value: string) {
  const field = input(selector)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

async function upload(file: File) {
  const field = input('input[type=file]')
  Object.defineProperty(field, 'files', { value: [file], configurable: true })
  field.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}

beforeEach(() => {
  langue.value = 'en'
  nextUrl = 0
  storage = new MapStorage()
  vi.stubGlobal('localStorage', storage)
  decode.mockReset().mockResolvedValue(undefined)
  vi.mocked(loadSpeakerBots).mockReset().mockResolvedValue([])
  vi.mocked(exportSpeaker).mockReset().mockResolvedValue(new Blob(['art'], { type: 'image/png' }))
  vi.mocked(createSpeakerAnimationSnapshot).mockReset().mockResolvedValue(animationSnapshot)
  vi.mocked(downloadSpeakerAnimation).mockReset().mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }))
  vi.mocked(telecharge).mockReset()
  vi.mocked(encodeSpeakerPhoto).mockReset().mockImplementation((image) => storedPhoto(image.src))
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:photo-${++nextUrl}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('Image', class {
    src = ''
    naturalWidth = 864
    naturalHeight = 1184
    decode() { return decode(this.src) }
  })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('speaker editor image lifecycle', () => {
  it('waits for the portrait and validates a blank name before exporting', async () => {
    const photo = deferred<void>()
    decode.mockReturnValueOnce(photo.promise)
    await mount()
    expect(downloadButton().disabled).toBe(true)
    photo.resolve(undefined)
    await flush()
    expect(downloadButton().disabled).toBe(false)

    await enter('#speaker-name', '   ')
    input('#speaker-name').dispatchEvent(new Event('blur'))
    await flush()
    expect(downloadButton().disabled).toBe(true)
    expect(host.querySelector('#speaker-name-error')?.textContent).toContain('Enter the speaker')
    expect(input('#speaker-name').getAttribute('aria-invalid')).toBe('true')
  })

  it('keeps the valid portrait after a decode error and validates uploads before decoding', async () => {
    await mount()
    const initialSource = portraitSource()
    decode.mockRejectedValueOnce(new Error('Invalid image bytes'))
    await upload(new File(['not an image'], 'broken.png', { type: 'image/png' }))
    expect(portraitSource()).toBe(initialSource)
    expect(host.textContent).toContain('This image could not be opened')
    expect(downloadButton().disabled).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1')

    const attempts = decode.mock.calls.length
    await upload(new File(['image'], 'photo.jpg', { type: 'image/jpeg' }))
    expect(host.textContent).toContain('Choose a PNG or WebP')
    const oversized = new File(['image'], 'large.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 21 * 1024 * 1024 })
    await upload(oversized)
    expect(host.textContent).toContain('This image is too large')
    expect(decode).toHaveBeenCalledTimes(attempts)
  })

  it('keeps the latest upload when two images finish out of order and releases both URLs', async () => {
    await mount()
    const first = deferred<void>()
    const second = deferred<void>()
    decode.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await upload(new File(['one'], 'first.png', { type: 'image/png' }))
    await upload(new File(['two'], 'second.webp', { type: 'image/webp' }))
    expect(downloadButton().disabled).toBe(true)

    second.resolve(undefined)
    await flush()
    expect(portraitSource()).toBe(storedPhoto('blob:photo-2'))
    expect(downloadButton().disabled).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-2')
    first.resolve(undefined)
    await flush()
    expect(portraitSource()).toBe(storedPhoto('blob:photo-2'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1')
    expect(encodeSpeakerPhoto).toHaveBeenCalledTimes(1)
  })

  it('recovers from a missing sample by accepting a user photo', async () => {
    decode.mockRejectedValueOnce(new Error('Missing sample'))
    await mount()
    expect(downloadButton().disabled).toBe(true)
    expect(host.textContent).toContain('The sample photo could not be loaded')
    await upload(new File(['valid'], 'speaker.png', { type: 'image/png' }))
    expect(downloadButton().disabled).toBe(false)
    expect(host.textContent).not.toContain('The sample photo could not be loaded')
  })

  it('ignores a pending upload after switching to another speaker', async () => {
    await mount()
    const pending = deferred<void>()
    decode.mockReturnValueOnce(pending.promise)
    await upload(new File(['old'], 'old-speaker.png', { type: 'image/png' }))
    await selectVariant(1)
    expect(input('#speaker-name').value).toBe('Daniela López')
    expect(portraitSource()).toBe(BUILTIN_PHOTOS[1]!.src)
    pending.resolve(undefined)
    await flush()

    expect(portraitSource()).toBe(BUILTIN_PHOTOS[1]!.src)
    expect(encodeSpeakerPhoto).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1')
    window.dispatchEvent(new Event('pagehide'))
    const saved = savedLibrary()
    expect(saved.variants[0]!.photoId).toBe(BUILTIN_PHOTOS[0]!.id)
    expect(saved.variants[1]!.photoId).toBe(BUILTIN_PHOTOS[1]!.id)
    expect(saved.photos).toHaveLength(BUILTIN_PHOTOS.length)
  })

  it('ignores an uploaded photo whose optimized copy finishes decoding after a variant switch', async () => {
    await mount()
    const optimized = deferred<void>()
    decode.mockResolvedValueOnce(undefined).mockReturnValueOnce(optimized.promise)
    await upload(new File(['old'], 'old-speaker.png', { type: 'image/png' }))
    expect(decode).toHaveBeenLastCalledWith(storedPhoto('blob:photo-1'))
    await selectVariant(2)
    optimized.resolve(undefined)
    await flush()

    expect(input('#speaker-name').value).toBe('Fernando Borea')
    expect(portraitSource()).toBe(BUILTIN_PHOTOS[2]!.src)
    expect(downloadButton().disabled).toBe(false)
    window.dispatchEvent(new Event('pagehide'))
    const saved = savedLibrary()
    expect(saved.variants[0]!.photoId).toBe(BUILTIN_PHOTOS[0]!.id)
    expect(saved.variants[2]!.photoId).toBe(BUILTIN_PHOTOS[2]!.id)
    expect(saved.photos).toHaveLength(BUILTIN_PHOTOS.length)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1')
  })
})

describe('saved speaker variants', () => {
  beforeEach(() => vi.useFakeTimers())

  it('saves only after 600 ms without further edits, with the latest field values', async () => {
    const write = vi.spyOn(storage, 'setItem')
    await mount()
    await vi.advanceTimersByTimeAsync(600)
    write.mockClear()

    await enter('#speaker-talk-title', 'Agentes para ingeniería')
    await vi.advanceTimersByTimeAsync(500)
    expect(write).not.toHaveBeenCalled()
    await enter('#speaker-role', 'Co-founder')
    expect(host.textContent).toContain('Saving…')
    await vi.advanceTimersByTimeAsync(599)
    expect(write).not.toHaveBeenCalled()
    expect(savedLibrary().variants[0]!.draft.talkTitle).toBe('')
    await vi.advanceTimersByTimeAsync(1)
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    expect(savedLibrary().variants[0]!.draft).toMatchObject({
      talkTitle: 'Agentes para ingeniería', role: 'Co-founder'
    })
    expect(host.textContent).toContain('Saved in this browser')
  })

  it('flushes pending edits to the correct variant before switching', async () => {
    await mount()
    await enter('#speaker-talk-title', 'La ponencia de Walter')
    await vi.advanceTimersByTimeAsync(150)
    await selectVariant(1)
    expect(savedLibrary().variants[0]!.draft.talkTitle).toBe('La ponencia de Walter')
    expect(input('#speaker-talk-title').value).toBe('')

    await enter('#speaker-talk-title', 'La ponencia de Daniela')
    await vi.advanceTimersByTimeAsync(600)
    const saved = savedLibrary()
    expect(saved.activeId).toBe(saved.variants[1]!.id)
    expect(saved.variants[0]!.draft.talkTitle).toBe('La ponencia de Walter')
    expect(saved.variants[1]!.draft.talkTitle).toBe('La ponencia de Daniela')
    await selectVariant(0)
    expect(input('#speaker-talk-title').value).toBe('La ponencia de Walter')
  })

  it('restores the active variant, text, composition, format and uploaded portrait on remount', async () => {
    await mount()
    await selectVariant(2)
    await enter('#speaker-talk-title', 'Construcción de agentes')
    await enter('#speaker-role', 'Founder, Borea Labs')
    await enter('#speaker-photoX', '14')
    await chooseRadio('speaker-aspect', '9:16')
    await chooseRadio('speaker-format', 'jpeg')
    await upload(new File(['portrait'], 'fernando.webp', { type: 'image/webp' }))
    downloadButton().click()
    await flush()
    expect(vi.mocked(exportSpeaker).mock.calls[0]![1].portrait.src).toBe(storedPhoto('blob:photo-1'))
    await vi.advanceTimersByTimeAsync(600)
    unmount()
    await mount()

    const select = host.querySelector<HTMLSelectElement>('#speaker-variant')!
    expect(select.selectedIndex).toBe(2)
    expect(input('#speaker-name').value).toBe('Fernando Borea')
    expect(input('#speaker-talk-title').value).toBe('Construcción de agentes')
    expect(input('#speaker-role').value).toBe('Founder, Borea Labs')
    expect(input('#speaker-photoX').value).toBe('14')
    expect(input('input[name="speaker-aspect"][value="9:16"]').checked).toBe(true)
    expect(input('input[name="speaker-format"][value="jpeg"]').checked).toBe(true)
    expect(portraitSource()).toBe(storedPhoto('blob:photo-1'))
    expect(decode).toHaveBeenLastCalledWith(storedPhoto('blob:photo-1'))
    expect(downloadButton().disabled).toBe(false)
    expect(host.textContent).not.toContain('Saved variants could not be loaded')
  })

  it('duplicates a speaker with independent fields and a shared durable photo payload', async () => {
    await mount()
    await enter('#speaker-talk-title', 'Título original')
    await upload(new File(['portrait'], 'walter.png', { type: 'image/png' }))
    button('Duplicate').click()
    await flush()
    expect(host.querySelector<HTMLSelectElement>('#speaker-variant')!.options).toHaveLength(BUILTIN_PHOTOS.length + 1)
    expect(input('#speaker-talk-title').value).toBe('Título original')
    await enter('#speaker-talk-title', 'Segunda versión')
    await enter('#speaker-name', 'Walter Morales — taller')
    await vi.advanceTimersByTimeAsync(600)

    const saved = savedLibrary()
    const original = saved.variants[0]!
    const duplicate = saved.variants[BUILTIN_PHOTOS.length]!
    expect(original.draft.talkTitle).toBe('Título original')
    expect(original.draft.name).toBe('Walter Morales')
    expect(duplicate.draft.talkTitle).toBe('Segunda versión')
    expect(duplicate.draft.name).toBe('Walter Morales — taller')
    expect(duplicate.photoId).toBe(original.photoId)
    expect(saved.photos.filter((photo) => photo.id === original.photoId)).toHaveLength(1)
    expect(saved.photos).toHaveLength(BUILTIN_PHOTOS.length + 1)
    await selectVariant(0)
    expect(input('#speaker-talk-title').value).toBe('Título original')
    expect(portraitSource()).toBe(storedPhoto('blob:photo-1'))
  })

  it('saves and restores an uploaded photo with an unusually long filename', async () => {
    await mount()
    const filename = `${'retrato-de-la-ponente-'.repeat(10)}.png`
    await upload(new File(['portrait'], filename, { type: 'image/png' }))
    await vi.advanceTimersByTimeAsync(600)
    expect(host.textContent).toContain('Saved in this browser')
    const saved = savedLibrary()
    const photo = saved.photos.find((item) => item.id === saved.variants[0]!.photoId)!
    expect(photo.name).toBe(filename.slice(0, 160))
    expect(photo.src).toBe(storedPhoto('blob:photo-1'))
    unmount()
    await mount()
    expect(portraitSource()).toBe(storedPhoto('blob:photo-1'))
    expect(host.textContent).not.toContain('Saved variants could not be loaded')
  })

  it('keeps unsaved edits available and retries after browser storage is full', async () => {
    await mount()
    await vi.advanceTimersByTimeAsync(600)
    const write = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
    await enter('#speaker-talk-title', 'No perder esta ponencia')
    await vi.advanceTimersByTimeAsync(600)
    await flush()

    expect(host.textContent).toContain('Could not save in this browser')
    expect(input('#speaker-talk-title').value).toBe('No perder esta ponencia')
    expect(savedLibrary().variants[0]!.draft.talkTitle).toBe('')
    expect(downloadButton().disabled).toBe(false)
    write.mockRestore()
    button('Retry saving').click()
    await flush()

    expect(savedLibrary().variants[0]!.draft.talkTitle).toBe('No perder esta ponencia')
    expect(host.textContent).toContain('Saved in this browser')
    expect(host.textContent).not.toContain('Could not save in this browser')
  })

  it('flushes pending changes on pagehide before the debounce timer expires', async () => {
    const write = vi.spyOn(storage, 'setItem')
    await mount()
    await vi.advanceTimersByTimeAsync(600)
    write.mockClear()
    await enter('#speaker-talk-title', 'Guardar antes de salir')
    await vi.advanceTimersByTimeAsync(100)
    window.dispatchEvent(new Event('pagehide'))
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    expect(savedLibrary().variants[0]!.draft.talkTitle).toBe('Guardar antes de salir')
    await vi.advanceTimersByTimeAsync(600)
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('speaker editor downloads', () => {
  it('prevents duplicate exports and keeps the filename matched to the captured artwork', async () => {
    await mount()
    await enter('#speaker-talk-title', 'Diseñar conversaciones con Grok')
    expect(host.querySelector('canvas')?.getAttribute('aria-label')).toContain('Diseñar conversaciones con Grok')
    const encoded = deferred<Blob>()
    vi.mocked(exportSpeaker).mockReturnValueOnce(encoded.promise)
    const button = downloadButton()
    button.click()
    button.click()
    await flush()
    expect(exportSpeaker).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    await enter('#speaker-name', 'María Pérez')
    await enter('#speaker-talk-title', 'Una nueva ponencia')
    const story = input('input[name="speaker-aspect"][value="9:16"]')
    story.checked = true
    story.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()

    const snapshot = vi.mocked(exportSpeaker).mock.calls[0]![0]
    expect(snapshot.name).toBe('Walter Morales')
    expect(snapshot.talkTitle).toBe('Diseñar conversaciones con Grok')
    expect(snapshot.aspect).toBe('4:3')
    const file = new Blob(['captured artwork'], { type: 'image/png' })
    encoded.resolve(file)
    await flush()
    expect(telecharge).toHaveBeenCalledWith(file, 'grok-bot-walter-morales-4x3.png')
    expect(button.disabled).toBe(false)
    expect(input('#speaker-name').value).toBe('María Pérez')
    expect(host.querySelector('canvas')?.getAttribute('aria-label')).toContain('Una nueva ponencia')
    expect(story.checked).toBe(true)
  })

  it('allows a retry after an encoding failure', async () => {
    await mount()
    vi.mocked(exportSpeaker).mockRejectedValueOnce(new Error('Encoder unavailable'))
    downloadButton().click()
    await flush()
    expect(host.textContent).toContain('The file could not be exported')
    expect(downloadButton().disabled).toBe(false)
    expect(telecharge).not.toHaveBeenCalled()
    downloadButton().click()
    await flush()
    expect(telecharge).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('File downloaded')
  })
})

describe('animated speaker downloads', () => {
  it.each([
    ['mp4', '4:3', '2400 × 1800 px'],
    ['mp4', '1:1', '2000 × 2000 px'],
    ['mp4', '9:16', '1080 × 1920 px'],
    ['gif', '4:3', '960 × 720 px'],
    ['gif', '1:1', '960 × 960 px'],
    ['gif', '9:16', '540 × 960 px']
  ])('shows the actual output size for %s in %s', async (format, aspect, dimensions) => {
    await mount()
    await chooseRadio('speaker-format', format)
    await chooseRadio('speaker-aspect', aspect)
    expect(host.textContent).toContain(dimensions)
    expect(host.textContent).toContain('6-second')
    expect(host.textContent).toContain(format === 'mp4'
      ? 'Enable repeat in your video player' : 'The GIF repeats continuously')
    expect(host.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('captures the draft, portrait, output format and filename before later edits', async () => {
    await mount()
    await chooseRadio('speaker-format', 'mp4')
    await enter('#speaker-talk-title', 'Original talk')
    const capture = deferred<SpeakerAnimationSnapshot>()
    vi.mocked(createSpeakerAnimationSnapshot).mockReturnValueOnce(capture.promise)
    downloadButton().click()
    await vi.waitFor(() => expect(createSpeakerAnimationSnapshot).toHaveBeenCalledTimes(1))
    await enter('#speaker-name', 'María Pérez')
    await enter('#speaker-talk-title', 'Edited talk')
    await chooseRadio('speaker-aspect', '9:16')
    await chooseRadio('speaker-format', 'gif')
    await selectVariant(1)

    const [draft, assets, width] = vi.mocked(createSpeakerAnimationSnapshot).mock.calls[0]!
    expect(draft).toMatchObject({ name: 'Walter Morales', talkTitle: 'Original talk', aspect: '4:3' })
    expect(assets.portrait.src).toBe(BUILTIN_PHOTOS[0]!.src)
    expect(width).toBe(2400)
    capture.resolve(animationSnapshot)
    await vi.waitFor(() => expect(telecharge).toHaveBeenCalledTimes(1))
    expect(downloadSpeakerAnimation).toHaveBeenCalledWith(animationSnapshot, 'mp4', expect.any(AbortSignal), expect.any(Function))
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'grok-bot-walter-morales-4x3.mp4')
    expect(exportSpeaker).not.toHaveBeenCalled()
  })

  it('renders only the requested GIF at its reduced size', async () => {
    await mount()
    await chooseRadio('speaker-format', 'gif')
    await chooseRadio('speaker-aspect', '9:16')
    downloadButton().click()
    await vi.waitFor(() => expect(telecharge).toHaveBeenCalledTimes(1))
    expect(createSpeakerAnimationSnapshot).toHaveBeenCalledWith(expect.objectContaining({ aspect: '9:16' }), expect.anything(), 540)
    expect(downloadSpeakerAnimation).toHaveBeenCalledTimes(1)
    expect(downloadSpeakerAnimation).toHaveBeenCalledWith(animationSnapshot, 'gif', expect.any(AbortSignal), expect.any(Function))
    expect(telecharge).toHaveBeenCalledWith(expect.any(Blob), 'grok-bot-walter-morales-9x16.gif')
    expect(exportSpeaker).not.toHaveBeenCalled()
  })

  it('shows progress, blocks duplicate exports and cancels the active render', async () => {
    await mount()
    await chooseRadio('speaker-format', 'mp4')
    vi.mocked(downloadSpeakerAnimation).mockImplementationOnce((_snapshot, _format, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
    const download = downloadButton()
    download.click()
    download.click()
    await vi.waitFor(() => expect(downloadSpeakerAnimation).toHaveBeenCalledTimes(1))
    const [, , signal, progress] = vi.mocked(downloadSpeakerAnimation).mock.calls[0]!
    progress(42)
    await flush()
    expect(download.disabled).toBe(true)
    expect(host.querySelector('progress')?.value).toBe(42)
    expect(host.textContent).toContain('Rendering… 42%')
    button('Cancel export').click()
    await flush()
    expect(signal.aborted).toBe(true)
    expect(host.textContent).toContain('Export cancelled')
    expect(host.querySelector('progress')).toBeNull()
    expect(download.disabled).toBe(false)
    expect(telecharge).not.toHaveBeenCalled()
  })

  it('cancels before snapshot preparation finishes without starting a server render', async () => {
    await mount()
    await chooseRadio('speaker-format', 'gif')
    const capture = deferred<SpeakerAnimationSnapshot>()
    vi.mocked(createSpeakerAnimationSnapshot).mockReturnValueOnce(capture.promise)
    downloadButton().click()
    await vi.waitFor(() => expect(createSpeakerAnimationSnapshot).toHaveBeenCalledTimes(1))
    button('Cancel export').click()
    capture.resolve(animationSnapshot)
    await flush()
    expect(host.textContent).toContain('Export cancelled')
    expect(downloadSpeakerAnimation).not.toHaveBeenCalled()
    expect(telecharge).not.toHaveBeenCalled()
    expect(downloadButton().disabled).toBe(false)
  })

  it.each([
    ['unavailable', 'The render service is unavailable'],
    ['busy', 'Another export is in progress'],
    ['failed', 'The file could not be exported']
  ] as const)('allows retry after a %s render error', async (code, message) => {
    await mount()
    await chooseRadio('speaker-format', 'mp4')
    vi.mocked(downloadSpeakerAnimation).mockRejectedValueOnce(new SpeakerRenderError(code))
    downloadButton().click()
    await vi.waitFor(() => expect(host.textContent).toContain(message))
    expect(telecharge).not.toHaveBeenCalled()
    expect(downloadButton().disabled).toBe(false)
    button('Retry export').click()
    await vi.waitFor(() => expect(telecharge).toHaveBeenCalledTimes(1))
    expect(downloadSpeakerAnimation).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('File downloaded')
    expect(host.textContent).not.toContain(message)
  })

  it('aborts on unmount and ignores a render result that arrives later', async () => {
    await mount()
    await chooseRadio('speaker-format', 'mp4')
    const rendered = deferred<Blob>()
    vi.mocked(downloadSpeakerAnimation).mockReturnValueOnce(rendered.promise)
    downloadButton().click()
    await vi.waitFor(() => expect(downloadSpeakerAnimation).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(downloadSpeakerAnimation).mock.calls[0]![2]
    unmount()
    expect(signal.aborted).toBe(true)
    rendered.resolve(new Blob(['late render']))
    await flush()
    expect(telecharge).not.toHaveBeenCalled()
  })

  it.each(['mp4', 'gif'])('restores %s independently for each saved speaker', async (format) => {
    await mount()
    await chooseRadio('speaker-format', format)
    await selectVariant(1)
    expect(input('input[name="speaker-format"][value="png"]').checked).toBe(true)
    await chooseRadio('speaker-format', 'jpeg')
    await selectVariant(0)
    expect(input(`input[name="speaker-format"][value="${format}"]`).checked).toBe(true)
    unmount()
    await mount()
    expect(input(`input[name="speaker-format"][value="${format}"]`).checked).toBe(true)
    expect(host.textContent).not.toContain('Saved variants could not be loaded')
    await selectVariant(1)
    expect(input('input[name="speaker-format"][value="jpeg"]').checked).toBe(true)
  })
})
