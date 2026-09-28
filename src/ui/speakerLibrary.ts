import { createSpeakerDraft, type SpeakerExportFormat, type SpeakerDraft } from './speaker'
import { cle } from './stockage'

export const SAVE_DELAY_MS = 600

export interface SpeakerPhoto {
  id: string
  src: string
  name: string
}

export interface SpeakerVariant {
  id: string
  draft: SpeakerDraft
  format: SpeakerExportFormat
  photoId: string
}

export interface SpeakerLibrary {
  version: 1
  activeId: string
  variants: SpeakerVariant[]
  photos: SpeakerPhoto[]
}

export const BUILTIN_PHOTOS: readonly SpeakerPhoto[] = [
  { id: 'walter-morales', src: `${import.meta.env.BASE_URL}speakers/walter-morales.png`, name: 'Walter Morales' },
  { id: 'speaker-2', src: `${import.meta.env.BASE_URL}speakers/speaker-2.png`, name: 'Daniela López' },
  { id: 'speaker-3', src: `${import.meta.env.BASE_URL}speakers/speaker-3.png`, name: 'Fernando Borea' },
  { id: 'saul-calderon', src: `${import.meta.env.BASE_URL}speakers/saul-calderon.png`, name: 'Saul Calderon' },
  { id: 'leonel-guerrero', src: `${import.meta.env.BASE_URL}speakers/leonel-guerrero.png`, name: 'Leonel Guerrero' }
]

const MAX_VARIANTS = 100
const MAX_PHOTOS = 100
const MAX_STORED_CHARACTERS = 5_000_000
const MAX_PHOTO_CHARACTERS = 2_000_000
const TEXT_LIMITS = {
  event: 120,
  city: 120,
  date: 120,
  talkTitle: 160,
  name: 120,
  label: 60,
  role: 240,
  time: 80,
  venue: 240,
  url: 500
} as const
const NUMBER_LIMITS = {
  photoX: [-30, 30],
  photoY: [-30, 30],
  photoScale: [70, 150],
  fade: [0, 100],
  botsScale: [60, 130]
} as const

export function makeSpeakerVariant(draft: SpeakerDraft, photoId: string, format: SpeakerExportFormat): SpeakerVariant {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `speaker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    draft: { ...draft },
    photoId,
    format
  }
}

function builtinVariant(photo: SpeakerPhoto): SpeakerVariant {
  return {
    id: `variant-${photo.id}`,
    draft: { ...createSpeakerDraft(), name: photo.name },
    format: 'png',
    photoId: photo.id
  }
}

export function createSpeakerLibrary(): SpeakerLibrary {
  const variants = BUILTIN_PHOTOS.map(builtinVariant)
  return {
    version: 1,
    activeId: variants[0]!.id,
    variants,
    photos: BUILTIN_PHOTOS.map((photo) => ({ ...photo }))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
}

function isPhotoSource(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_PHOTO_CHARACTERS) return false
  const prefix = /^data:image\/(?:png|webp);base64,/.exec(value)
  if (!prefix) return false
  const data = value.slice(prefix[0].length)
  return data.length > 0 && data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data)
}

/** Rebuild each record from known fields; never trust a saved object as app state. */
function sanitizeLibrary(value: unknown): { library: SpeakerLibrary; error: boolean } {
  const fallback = () => ({ library: createSpeakerLibrary(), error: true })
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.variants) || !Array.isArray(value.photos)) {
    return fallback()
  }

  let error = value.variants.length > MAX_VARIANTS || value.photos.length > MAX_PHOTOS + BUILTIN_PHOTOS.length
  const photos = new Map(BUILTIN_PHOTOS.map((photo) => [photo.id, { ...photo }]))
  const seenPhotos = new Set<string>()
  for (const photo of value.photos.slice(0, MAX_PHOTOS + BUILTIN_PHOTOS.length)) {
    if (!isRecord(photo) || !isId(photo.id) || seenPhotos.has(photo.id)) {
      error = true
      continue
    }
    seenPhotos.add(photo.id)
    const builtin = BUILTIN_PHOTOS.find((item) => item.id === photo.id)
    if (builtin) {
      // Bundled portraits stay local and cannot be replaced by stored URLs.
      if (photo.src !== builtin.src) error = true
      continue
    }
    if (!isPhotoSource(photo.src) || typeof photo.name !== 'string' || !photo.name.trim()) {
      error = true
      continue
    }
    if (photo.name.length > 160) error = true
    photos.set(photo.id, { id: photo.id, src: photo.src, name: photo.name.slice(0, 160) })
  }

  const seenVariants = new Set<string>()
  const variants: SpeakerVariant[] = []
  for (const candidate of value.variants.slice(0, MAX_VARIANTS)) {
    if (!isRecord(candidate) || !isId(candidate.id) || seenVariants.has(candidate.id)
      || typeof candidate.photoId !== 'string' || !photos.has(candidate.photoId) || !isRecord(candidate.draft)) {
      error = true
      continue
    }
    seenVariants.add(candidate.id)
    const draft = createSpeakerDraft()
    for (const key of Object.keys(TEXT_LIMITS) as Array<keyof typeof TEXT_LIMITS>) {
      const text = candidate.draft[key]
      if (typeof text !== 'string') {
        error = true
        continue
      }
      if (text.length > TEXT_LIMITS[key]) error = true
      draft[key] = text.slice(0, TEXT_LIMITS[key])
    }
    for (const key of Object.keys(NUMBER_LIMITS) as Array<keyof typeof NUMBER_LIMITS>) {
      const number = candidate.draft[key]
      if (typeof number !== 'number' || !Number.isFinite(number)) {
        error = true
        continue
      }
      const [min, max] = NUMBER_LIMITS[key]
      draft[key] = Math.max(min, Math.min(max, number))
      if (draft[key] !== number) error = true
    }
    if (candidate.draft.aspect === '4:3' || candidate.draft.aspect === '1:1' || candidate.draft.aspect === '9:16') {
      draft.aspect = candidate.draft.aspect
    } else error = true
    if (typeof candidate.draft.botsVisible === 'boolean') draft.botsVisible = candidate.draft.botsVisible
    else error = true
    const validFormat = candidate.format === 'png' || candidate.format === 'jpeg'
      || candidate.format === 'mp4' || candidate.format === 'gif'
    const format = validFormat ? candidate.format as SpeakerExportFormat : 'png'
    if (!validFormat) error = true
    variants.push({ id: candidate.id, draft, photoId: candidate.photoId, format })
  }

  if (!variants.length) return fallback()
  // Bundled photos persist even after a variant is deleted. Only an unseen
  // portrait adds a new default, preserving edits, selection and prior deletions.
  for (const photo of BUILTIN_PHOTOS) {
    if (variants.length >= MAX_VARIANTS) break
    if (seenPhotos.has(photo.id) || variants.some((variant) => variant.photoId === photo.id)) continue
    const variant = builtinVariant(photo)
    if (seenVariants.has(variant.id)) variant.id = makeSpeakerVariant(variant.draft, photo.id, variant.format).id
    variants.push(variant)
    seenVariants.add(variant.id)
  }
  const activeId = typeof value.activeId === 'string' && variants.some((variant) => variant.id === value.activeId)
    ? value.activeId
    : variants[0]!.id
  if (activeId !== value.activeId) error = true
  const usedPhotos = new Set([...BUILTIN_PHOTOS.map((photo) => photo.id), ...variants.map((variant) => variant.photoId)])
  return {
    library: { version: 1, activeId, variants, photos: [...photos.values()].filter((photo) => usedPhotos.has(photo.id)) },
    error
  }
}

/** A blocked getter, invalid JSON or damaged record must not prevent editing. */
export function readSpeakerLibrary(): { library: SpeakerLibrary; error: boolean } {
  try {
    const raw = localStorage.getItem(cle('speakers'))
    if (raw === null) return { library: createSpeakerLibrary(), error: false }
    if (raw.length > MAX_STORED_CHARACTERS) return { library: createSpeakerLibrary(), error: true }
    return sanitizeLibrary(JSON.parse(raw))
  } catch {
    return { library: createSpeakerLibrary(), error: true }
  }
}

/** Store an atomic snapshot. Duplicated variants share one photo payload. */
export function writeSpeakerLibrary(library: SpeakerLibrary): boolean {
  try {
    const cleaned = sanitizeLibrary(library)
    if (cleaned.error) return false
    const serialized = JSON.stringify(cleaned.library)
    if (serialized.length > MAX_STORED_CHARACTERS) return false
    localStorage.setItem(cle('speakers'), serialized)
    return true
  } catch {
    return false
  }
}
