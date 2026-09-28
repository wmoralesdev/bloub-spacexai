import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpeakerDraft } from './speaker'
import {
  BUILTIN_PHOTOS,
  SAVE_DELAY_MS,
  createSpeakerLibrary,
  makeSpeakerVariant,
  readSpeakerLibrary,
  writeSpeakerLibrary
} from './speakerLibrary'
import { cle } from './stockage'

const PNG = 'data:image/png;base64,aGVsbG8='
const WEBP = 'data:image/webp;base64,d2VicA=='
let storage: Map<string, string>

function saveRaw(value: unknown) {
  storage.set(cle('speakers'), JSON.stringify(value))
}

beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value)
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('speaker library', () => {
  it('seeds five independent speaker drafts and bundled portraits', () => {
    const library = createSpeakerLibrary()
    expect(SAVE_DELAY_MS).toBe(600)
    expect(library.variants.map((variant) => variant.draft.name)).toEqual(['Walter Morales', 'Daniela López', 'Fernando Borea', 'Saul Calderon', 'Leonel Guerrero'])
    expect(library.variants.every((variant) => variant.draft.talkTitle === '')).toBe(true)
    expect(library.photos).toEqual(BUILTIN_PHOTOS)
    expect(library.photos.map((photo) => photo.src)).toEqual([
      '/speakers/walter-morales.png', '/speakers/speaker-2.png', '/speakers/speaker-3.png', '/speakers/saul-calderon.png', '/speakers/leonel-guerrero.png'
    ])
    library.variants[0]!.draft.event = 'Changed'
    library.photos[0]!.name = 'Changed'
    expect(library.variants[1]!.draft.event).toBe('Grok Bot')
    expect(createSpeakerLibrary().variants[0]!.draft.event).toBe('Grok Bot')
    expect(BUILTIN_PHOTOS[0]!.name).toBe('Walter Morales')
  })

  it('starts cleanly when no saved library exists', () => {
    expect(readSpeakerLibrary()).toEqual({ library: createSpeakerLibrary(), error: false })
    expect(storage.size).toBe(0)
  })

  it('roundtrips the active variant, composition, accents and output format', () => {
    const library = createSpeakerLibrary()
    const speaker = library.variants[1]!
    library.activeId = speaker.id
    Object.assign(speaker.draft, {
      talkTitle: 'Diseñando con inteligencia artificial',
      role: 'Ingeniera · organización',
      aspect: '9:16',
      photoX: -17,
      photoY: 8,
      photoScale: 125,
      fade: 42,
      botsVisible: false,
      botsScale: 85
    })
    speaker.format = 'jpeg'
    expect(writeSpeakerLibrary(library)).toBe(true)
    expect(storage.has('bloub:speakers')).toBe(true)
    expect(readSpeakerLibrary()).toEqual({ library, error: false })
  })

  it('duplicates a draft without duplicating or sharing its mutable fields', () => {
    const draft = createSpeakerDraft()
    const first = makeSpeakerVariant(draft, 'speaker-2', 'jpeg')
    const second = makeSpeakerVariant(first.draft, first.photoId, first.format)
    expect(first.id).not.toBe(second.id)
    expect(first.draft).toEqual(second.draft)
    second.draft.name = 'New speaker'
    expect(first.draft.name).toBe('Walter Morales')
    expect(draft.name).toBe('Walter Morales')
    expect(second.photoId).toBe(first.photoId)
  })

  it.each(['png', 'jpeg', 'mp4', 'gif'] as const)('roundtrips %s for version 1 variants', (format) => {
    const library = createSpeakerLibrary()
    library.variants[0]!.format = format
    const duplicate = makeSpeakerVariant(library.variants[0]!.draft, 'speaker-2', format)
    library.variants.push(duplicate)
    library.activeId = duplicate.id
    expect(writeSpeakerLibrary(library)).toBe(true)
    expect(readSpeakerLibrary()).toEqual({ library, error: false })
    expect(readSpeakerLibrary().library.version).toBe(1)
  })

  it('restores previous version 1 libraries with static formats unchanged', () => {
    const library = createSpeakerLibrary()
    library.variants[1]!.format = 'jpeg'
    saveRaw(library)
    expect(readSpeakerLibrary()).toEqual({ library, error: false })
  })

  it('adds Saul once to an older library while preserving edits and selection', () => {
    const library = createSpeakerLibrary()
    library.photos = library.photos.slice(0, 3)
    library.variants = library.variants.slice(0, 3)
    library.activeId = library.variants[1]!.id
    library.variants[1]!.draft.name = 'Daniela — keynote'
    library.variants[1]!.draft.talkTitle = 'Una ponencia guardada'
    library.variants[1]!.format = 'gif'
    saveRaw(library)

    const result = readSpeakerLibrary()
    expect(result.error).toBe(false)
    expect(result.library.version).toBe(1)
    expect(result.library.activeId).toBe(library.activeId)
    expect(result.library.variants.slice(0, 3)).toEqual(library.variants)
    expect(result.library.variants[3]).toEqual({
      id: 'variant-saul-calderon',
      draft: { ...createSpeakerDraft(), name: 'Saul Calderon' },
      photoId: 'saul-calderon',
      format: 'png'
    })
    expect(result.library.photos).toEqual(BUILTIN_PHOTOS)
    expect(writeSpeakerLibrary(result.library)).toBe(true)
    expect(readSpeakerLibrary()).toEqual(result)
  })

  it('does not restore intentionally deleted variants during or after migration', () => {
    const library = createSpeakerLibrary()
    library.photos = library.photos.slice(0, 3)
    library.variants = library.variants.slice(0, 1)
    saveRaw(library)
    const migrated = readSpeakerLibrary().library
    expect(migrated.variants.map((variant) => variant.photoId)).toEqual(['walter-morales', 'saul-calderon', 'leonel-guerrero'])

    migrated.variants = migrated.variants.slice(0, 1)
    expect(writeSpeakerLibrary(migrated)).toBe(true)
    expect(readSpeakerLibrary().library.variants).toEqual(library.variants)
    expect(readSpeakerLibrary().library.photos).toEqual(BUILTIN_PHOTOS)
  })

  it('adds Leonel once to a four-speaker library without changing saved drafts or selection', () => {
    const library = createSpeakerLibrary()
    library.photos = library.photos.slice(0, 4)
    library.variants = library.variants.slice(0, 4)
    const saul = library.variants[3]!
    library.activeId = saul.id
    Object.assign(saul.draft, {
      name: 'Saul — ponencia', talkTitle: 'Una ponencia guardada',
      aspect: '9:16', photoX: 8, photoScale: 125, botsVisible: false
    })
    saul.format = 'mp4'
    saveRaw(library)

    const result = readSpeakerLibrary()
    expect(result.error).toBe(false)
    expect(result.library.version).toBe(1)
    expect(result.library.activeId).toBe(library.activeId)
    expect(result.library.variants.slice(0, 4)).toEqual(library.variants)
    expect(result.library.variants).toHaveLength(5)
    expect(result.library.variants[4]).toEqual({
      id: 'variant-leonel-guerrero',
      draft: { ...createSpeakerDraft(), name: 'Leonel Guerrero' },
      photoId: 'leonel-guerrero',
      format: 'png'
    })
    expect(result.library.photos).toEqual(BUILTIN_PHOTOS)
    expect(writeSpeakerLibrary(result.library)).toBe(true)
    expect(readSpeakerLibrary()).toEqual(result)
  })

  it('keeps an intentionally deleted Leonel variant deleted after reload', () => {
    const library = createSpeakerLibrary()
    library.variants = library.variants.filter((variant) => variant.photoId !== 'leonel-guerrero')
    library.activeId = library.variants[3]!.id
    saveRaw(library)

    expect(readSpeakerLibrary()).toEqual({ library, error: false })
    expect(writeSpeakerLibrary(library)).toBe(true)
    expect(readSpeakerLibrary()).toEqual({ library, error: false })
    expect(readSpeakerLibrary().library.photos.find((photo) => photo.id === 'leonel-guerrero')).toBeDefined()
  })

  it('restores bundled photo records without duplicating a renamed speaker variant', () => {
    const library = createSpeakerLibrary()
    library.photos = library.photos.slice(0, 3)
    library.variants[3]!.draft.name = 'Saul — taller'
    library.variants[3]!.id = 'custom-saul'
    library.activeId = 'custom-saul'
    saveRaw(library)

    expect(readSpeakerLibrary()).toEqual({
      library: { ...library, photos: BUILTIN_PHOTOS },
      error: false
    })
  })

  it('keeps a full library intact and makes the new portrait available', () => {
    const library = createSpeakerLibrary()
    library.photos = library.photos.slice(0, 3)
    library.variants = Array.from({ length: 100 }, () => makeSpeakerVariant(createSpeakerDraft(), 'walter-morales', 'png'))
    library.activeId = library.variants[99]!.id
    saveRaw(library)

    const result = readSpeakerLibrary()
    expect(result).toEqual({ library: { ...library, photos: BUILTIN_PHOTOS }, error: false })
    expect(writeSpeakerLibrary(result.library)).toBe(true)
  })

  it('stores an uploaded image once for duplicate variants and collects unused images', () => {
    const library = createSpeakerLibrary()
    library.photos.push(
      { id: 'uploaded', name: 'Portrait.png', src: PNG },
      { id: 'unused', name: 'Unused.webp', src: WEBP }
    )
    library.variants.push(
      makeSpeakerVariant(createSpeakerDraft(), 'uploaded', 'png'),
      makeSpeakerVariant(createSpeakerDraft(), 'uploaded', 'jpeg')
    )
    expect(writeSpeakerLibrary(library)).toBe(true)
    const raw = storage.get(cle('speakers'))!
    expect(raw.split(PNG)).toHaveLength(2)
    expect(raw).not.toContain(WEBP)
    const saved = readSpeakerLibrary()
    expect(saved.error).toBe(false)
    expect(saved.library.variants.slice(-2).map((variant) => variant.photoId)).toEqual(['uploaded', 'uploaded'])
    expect(saved.library.photos).toHaveLength(BUILTIN_PHOTOS.length + 1)
    expect(library.photos).toHaveLength(BUILTIN_PHOTOS.length + 2)
  })

  it.each(['{broken', 'null', '[]', '{"version":2}', 'x'.repeat(5_000_001)])('recovers malformed or oversized storage without throwing (%#)', (raw) => {
    storage.set(cle('speakers'), raw)
    expect(readSpeakerLibrary()).toEqual({ library: createSpeakerLibrary(), error: true })
    expect(storage.get(cle('speakers'))).toBe(raw)
  })

  it('reports denied storage reads and writes while keeping an editable library', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('blocked', 'SecurityError') },
      setItem: () => { throw new DOMException('blocked', 'SecurityError') }
    })
    expect(readSpeakerLibrary()).toEqual({ library: createSpeakerLibrary(), error: true })
    expect(writeSpeakerLibrary(createSpeakerLibrary())).toBe(false)
  })

  it('reports a throwing localStorage getter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new DOMException('blocked', 'SecurityError') }
    })
    try {
      expect(readSpeakerLibrary().error).toBe(true)
      expect(writeSpeakerLibrary(createSpeakerLibrary())).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })

  it('retains the previous snapshot when quota is exhausted', () => {
    const library = createSpeakerLibrary()
    expect(writeSpeakerLibrary(library)).toBe(true)
    const previous = storage.get(cle('speakers'))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError') }
    })
    library.variants[0]!.draft.name = 'Unsaved'
    expect(writeSpeakerLibrary(library)).toBe(false)
    expect(storage.get(cle('speakers'))).toBe(previous)
  })

  it('rebuilds allowed fields, bounds text and sliders and defaults invalid field types', () => {
    const library = createSpeakerLibrary()
    const value = {
      ...library,
      injected: true,
      variants: [{
        ...library.variants[0],
        injected: true,
        format: 'webm',
        draft: {
          ...library.variants[0]!.draft,
          injected: true,
          name: 'Á'.repeat(130),
          talkTitle: 'T'.repeat(170),
          photoX: -900,
          photoY: 900,
          photoScale: 999,
          botsScale: -10,
          fade: '100',
          event: {},
          aspect: '16:9',
          botsVisible: 'false'
        }
      }]
    }
    saveRaw(value)
    const result = readSpeakerLibrary()
    expect(result.error).toBe(true)
    expect(result.library).not.toHaveProperty('injected')
    const variant = result.library.variants[0]!
    expect(variant).not.toHaveProperty('injected')
    expect(variant.draft).not.toHaveProperty('injected')
    expect(variant.draft).toMatchObject({
      name: 'Á'.repeat(120), talkTitle: 'T'.repeat(160), photoX: -30, photoY: 30,
      photoScale: 150, botsScale: 60, fade: 65, event: 'Grok Bot', aspect: '4:3', botsVisible: true
    })
    expect(variant.format).toBe('png')
  })

  it('rejects non-restorable image URLs and dangling variants, preserving good records', () => {
    const library = createSpeakerLibrary()
    library.photos.push(
      { id: 'remote', src: 'https://example.com/photo.png', name: 'Remote' },
      { id: 'blob', src: 'blob:http://localhost/photo', name: 'Blob' },
      { id: 'svg', src: 'data:image/svg+xml;base64,aGVsbG8=', name: 'SVG' },
      { id: 'bad-base64', src: 'data:image/png;base64,not base64!', name: 'Malformed' }
    )
    library.variants.push(...['remote', 'blob', 'svg', 'bad-base64', 'missing'].map((id) => makeSpeakerVariant(createSpeakerDraft(), id, 'png')))
    library.activeId = 'missing-variant'
    saveRaw(library)
    const result = readSpeakerLibrary()
    expect(result.error).toBe(true)
    expect(result.library.variants).toHaveLength(BUILTIN_PHOTOS.length)
    expect(result.library.photos).toEqual(BUILTIN_PHOTOS)
    expect(result.library.activeId).toBe(result.library.variants[0]!.id)
  })

  it('does not let duplicate IDs replace a valid photo or variant', () => {
    const library = createSpeakerLibrary()
    library.photos.push({ id: 'speaker-2', src: PNG, name: 'Override' })
    library.variants.push({ ...library.variants[0]!, draft: { ...createSpeakerDraft(), name: 'Duplicate' } })
    saveRaw(library)
    const result = readSpeakerLibrary()
    expect(result.error).toBe(true)
    expect(result.library.variants).toHaveLength(BUILTIN_PHOTOS.length)
    expect(result.library.variants[0]!.draft.name).toBe('Walter Morales')
    expect(result.library.photos).toEqual(BUILTIN_PHOTOS)
  })

  it('rejects oversized uploads and variant lists without replacing the saved snapshot', () => {
    const library = createSpeakerLibrary()
    expect(writeSpeakerLibrary(library)).toBe(true)
    const previous = storage.get(cle('speakers'))
    library.photos.push({ id: 'too-large', name: 'Large.png', src: `data:image/png;base64,${'a'.repeat(2_000_000)}` })
    library.variants[0]!.photoId = 'too-large'
    expect(writeSpeakerLibrary(library)).toBe(false)
    const many = createSpeakerLibrary()
    many.variants.push(...Array.from({ length: 100 }, () => makeSpeakerVariant(createSpeakerDraft(), 'speaker-2', 'png')))
    expect(writeSpeakerLibrary(many)).toBe(false)
    expect(storage.get(cle('speakers'))).toBe(previous)
  })
})
