import { EXPRESSION_BY_ID, type ExpressionId } from '@/bot/expressions'
import { COLOR_BY_ID, SHAPE_BY_ID, type ColorId, type ShapeId } from '@/bot/skins'

export const BOT_CARD_SIZE = 2000
export const BOT_CARD_PRINT_SIZE_MM = 100
export const MAX_BOT_CARDS = 50
export const CARD_LIMITS = { name: 80, eventName: 80, handle: 60, description: 600, url: 1200 } as const

export type BotCardSide = 'front' | 'back'
export type BotCardFormat = 'png' | 'svg' | 'pdf'
export interface BotCardPrintOptions { sizeMm: number }

export function validBotCardPrintSize(sizeMm: number): boolean {
  return Number.isFinite(sizeMm) && sizeMm >= 10 && sizeMm <= 300
}

export interface BotCard {
  id: string
  name: string
  eventName: string
  handle: string
  description: string
  url: string
  shape: ShapeId
  color: ColorId
  expression: ExpressionId
  /** Une chaine vide conserve la couleur du catalogue. */
  bodyColor: string
}

export function createBotCard(existing: BotCard[] = []): BotCard {
  const taken = new Set(existing.map((card) => card.id))
  let n = 1
  while (taken.has(`card${n}`)) n++
  return {
    id: `card${n}`,
    name: '',
    eventName: '',
    handle: '',
    description: '',
    url: '',
    shape: 'cercle',
    color: 'vert',
    expression: 'neutre',
    bodyColor: ''
  }
}

/** Le champ accepte un pseudo avec ou sans son arobase. */
export function botCardHandle(handle: string): string {
  const value = handle.trim().replace(/^[@\s]+/, '')
  return value ? `@${value}` : ''
}

/** Une URL canonique assure que les accents sont encodes avant le QR. */
export function normalizeBotCardUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed) || /\s|[\u0000-\u001f\u007f]/.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    if (!url.hostname || url.username || url.password || url.href.length > CARD_LIMITS.url) return null
    return url.href
  } catch {
    return null
  }
}

function boundedText(text: string, limit: number): string {
  // Les controles XML ne sont pas du texte imprimable dans le SVG exporte.
  return Array.from(text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''))
    .slice(0, limit).join('')
}

/** Le stockage est une entree non fiable, bornee avant et apres le JSON. */
export function parseBotCards(raw: string | null): BotCard[] {
  if (!raw || raw.length > 1_000_000) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out: BotCard[] = []
  const seen = new Set<string>()
  for (const item of data.slice(0, MAX_BOT_CARDS)) {
    if (!item || typeof item !== 'object') continue
    const { id, name, eventName, handle, description, url, shape, color, expression, bodyColor } = item as Record<string, unknown>
    if (typeof id !== 'string' || !id.trim() || id.length > 100 || seen.has(id)) continue
    if (typeof name !== 'string' || typeof handle !== 'string' || typeof description !== 'string') continue
    if (typeof shape !== 'string' || !SHAPE_BY_ID.has(shape)) continue
    if (typeof color !== 'string' || !COLOR_BY_ID.has(color)) continue
    if (typeof expression !== 'string' || !EXPRESSION_BY_ID.has(expression)) continue
    seen.add(id)
    out.push({
      id,
      name: boundedText(name, CARD_LIMITS.name),
      eventName: typeof eventName === 'string' ? boundedText(eventName, CARD_LIMITS.eventName) : '',
      handle: boundedText(handle, CARD_LIMITS.handle),
      description: boundedText(description, CARD_LIMITS.description),
      // Les cartes anterieures au recto n'ont pas encore de lien.
      url: typeof url === 'string' ? boundedText(url, CARD_LIMITS.url) : '',
      shape: shape as ShapeId,
      color: color as ColorId,
      expression: expression as ExpressionId,
      bodyColor: typeof bodyColor === 'string' && /^#[\da-f]{6}$/i.test(bodyColor) ? bodyColor.toLowerCase() : ''
    })
  }
  return out
}

export function botCardFilename(card: BotCard, format: BotCardFormat, side: BotCardSide = 'back'): string {
  const name = card.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '') || 'untitled'
  return `bot-card-${name}${side === 'front' ? '-front' : ''}${format === 'pdf' ? '-cmyk' : ''}.${format}`
}
