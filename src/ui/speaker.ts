/** Editable data and output sizes for a single speaker announcement. */
export type AspectRatio = '4:3' | '1:1' | '9:16'
export type ImageFormat = 'png' | 'jpeg'
export type SpeakerExportFormat = ImageFormat | 'mp4' | 'gif'

export const ASPECTS: ReadonlyArray<{ id: AspectRatio; width: number; height: number }> = [
  { id: '4:3', width: 2400, height: 1800 },
  { id: '1:1', width: 2000, height: 2000 },
  { id: '9:16', width: 1080, height: 1920 }
]

export interface SpeakerDraft {
  event: string
  city: string
  date: string
  talkTitle: string
  name: string
  label: string
  role: string
  time: string
  venue: string
  url: string
  aspect: AspectRatio
  photoX: number
  photoY: number
  photoScale: number
  fade: number
  botsVisible: boolean
  botsScale: number
}

export function createSpeakerDraft(): SpeakerDraft {
  return {
    event: 'Grok Bot',
    city: 'San Salvador Meetup',
    date: 'Saturday, September 19th',
    talkTitle: '',
    name: 'Walter Morales',
    label: 'Speaker',
    role: '',
    time: '',
    venue: '',
    url: '',
    aspect: '4:3',
    photoX: 0,
    photoY: 0,
    photoScale: 100,
    fade: 65,
    botsVisible: true,
    botsScale: 100
  }
}

export function speakerDimensions(aspect: AspectRatio, width?: number) {
  const output = ASPECTS.find((item) => item.id === aspect) ?? ASPECTS[0]!
  const target = width === undefined ? output.width : Math.max(1, Math.round(width))
  if (!Number.isFinite(target)) throw new Error('Invalid speaker image dimensions')
  return { width: target, height: Math.round((target * output.height) / output.width) }
}

/** Animated GIFs stay small enough to share; the other formats retain native dimensions. */
export function speakerExportDimensions(aspect: AspectRatio, format: SpeakerExportFormat) {
  const dimensions = speakerDimensions(aspect)
  if (format !== 'gif') return dimensions
  const scale = Math.min(1, 960 / Math.max(dimensions.width, dimensions.height))
  return {
    width: Math.round(dimensions.width * scale),
    height: Math.round(dimensions.height * scale)
  }
}

export function speakerFilename(draft: SpeakerDraft, format: SpeakerExportFormat) {
  const name = draft.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '') || 'speaker'
  return `grok-bot-${name}-${draft.aspect.replace(':', 'x')}.${format === 'jpeg' ? 'jpg' : format}`
}
