import { createApp, h, nextTick } from 'vue'
import BloubBot from '@/components/BloubBot.vue'
import { POSE_FIGE } from '@/bot/figes'
import { RAYON } from '@/bot/repere'
import { BOT_CARD_SIZE, BOT_CARD_PRINT_SIZE_MM, botCardHandle, normalizeBotCardUrl, validBotCardPrintSize, type BotCard, type BotCardFormat, type BotCardPrintOptions, type BotCardSide } from './botCard'
import { botCardQrSvg, createBotCardQr } from './botCardQr'
import { versPng } from './capture'
import { DEMI_CADRE, sansCommentaires, viewBoxExport } from './export'
import { exportPrintPdf } from './printExport'

const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif'
const WHITE = '#ffffff'
const BLACK = '#000000'
const MUTED = '#949494'

interface TextBox { x: number; y: number; width: number; height: number; size: number; leading: number }
interface FittedText { lines: string[]; size: number; lineHeight: number }

/** Coordonnees communes au SVG et au PNG, sur un carre de 1000 unites. */
export const BOT_CARD_LAYOUT = {
  bot: { x: 78, y: 63, size: 232 },
  qr: { x: 650, y: 62, size: 280 },
  name: { x: 100, y: 367, width: 800, height: 88, size: 76, leading: 1.08 },
  handle: { x: 100, y: 457, width: 800, height: 86, size: 76, leading: 1.08 },
  description: { x: 100, y: 580, width: 800, height: 330, size: 49, leading: 1.24 }
} as const

/** Le titre garde un espace lisible au-dessus du collage de bots. */
export const BOT_CARD_FRONT_LAYOUT = {
  eventName: { x: 70, y: 60, width: 860, height: 200, size: 84, leading: 1.08 },
  bots: [
    { x: 100, y: 970, radius: 350, rotation: 8, shape: 'cercle', bodyColor: WHITE, expression: 'neutre' },
    { x: 115, y: 390, radius: 90, rotation: -24, shape: 'galet', bodyColor: '#00bbaa', expression: 'neutre' },
    { x: 445, y: 440, radius: 155, rotation: 13, shape: 'triangle', bodyColor: '#fb299d', expression: 'neutre' },
    { x: 835, y: 485, radius: 175, rotation: 10, shape: 'nuage', bodyColor: '#1687f8', expression: 'neutre' },
    { x: 505, y: 750, radius: 130, rotation: -14, shape: 'goutte', bodyColor: '#ff9b00', expression: 'curieux' }
  ],
  personalized: { x: 810, y: 950, radius: 245, rotation: -15 }
} as const

function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  if (!text.trim()) return []
  const lines: string[] = []
  for (const paragraph of text.trim().split(/\r\n|\r|\n/)) {
    let current = ''
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word
      if (ctx.measureText(candidate).width <= width) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      current = ''
      // Un pseudo, une URL ou un texte sans espaces se coupe sans rien perdre.
      for (const character of Array.from(word)) {
        if (current && ctx.measureText(current + character).width > width) {
          lines.push(current)
          current = character
        } else current += character
      }
    }
    lines.push(current)
  }
  return lines
}

/** Reduit la taille autant que necessaire, sans ellipses ni texte masque. */
export function fitBotCardText(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Pick<TextBox, 'width' | 'height' | 'size' | 'leading'>,
  maxLines = Infinity
): FittedText {
  const atSize = (size: number) => {
    ctx.font = `400 ${size}px ${FONT}`
    const lines = wrapText(ctx, text, box.width)
    return { lines, size, lineHeight: size * box.leading }
  }
  const fits = (fit: FittedText) => fit.lines.length <= maxLines &&
    fit.lines.length * fit.lineHeight <= box.height &&
    fit.lines.every((line) => ctx.measureText(line).width <= box.width)
  const full = atSize(box.size)
  if (fits(full)) return full
  let low = 0
  let high = box.size
  let result = atSize(0.01)
  for (let i = 0; i < 16; i++) {
    const size = (low + high) / 2
    const next = atSize(size)
    if (fits(next)) {
      low = size
      result = next
    } else high = size
  }
  return result
}

function textSvg(ctx: CanvasRenderingContext2D, text: string, box: TextBox, color: string, maxLines = Infinity): string {
  const fit = fitBotCardText(ctx, text, box, maxLines)
  if (!fit.lines.length) return ''
  // Une ligne de base explicite s'exporte aussi dans les lecteurs sans CSS.
  const lines = fit.lines.map((line, i) =>
    `<tspan x="${box.x}" y="${box.y + fit.size * 0.91 + i * fit.lineHeight}">${escapeXml(line)}</tspan>`
  ).join('')
  return `<text fill="${color}" font-family="${FONT}" font-size="${fit.size}" font-weight="400">${lines}</text>`
}

const botCache = new Map<string, Promise<string>>()

async function botSvg(card: BotCard, paper = WHITE): Promise<string> {
  const bodyColor = /^#[\da-f]{6}$/i.test(card.bodyColor) ? card.bodyColor : undefined
  const key = JSON.stringify([card.shape, card.color, card.expression, bodyColor, paper])
  const cached = botCache.get(key)
  if (cached) return cached
  const pending = (async () => {
    const host = document.createElement('div')
    const app = createApp({
      render: () => h(BloubBot, {
        shape: card.shape,
        color: card.color,
        expression: card.expression,
        bodyColor,
        paper,
        frozenAt: POSE_FIGE,
        state: 'idle',
        playing: false,
        follow: false
      })
    })
    try {
      app.mount(host)
      await nextTick()
      const svg = host.querySelector('svg')
      if (!svg) throw new Error('Bot card avatar unavailable')
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('viewBox', viewBoxExport())
      clone.removeAttribute('width')
      clone.removeAttribute('height')
      clone.removeAttribute('class')
      clone.removeAttribute('role')
      clone.removeAttribute('aria-label')
      return sansCommentaires(new XMLSerializer().serializeToString(clone))
    } finally {
      app.unmount()
    }
  })()
  if (botCache.size >= 32) botCache.delete(botCache.keys().next().value!)
  botCache.set(key, pending)
  try {
    return await pending
  } catch (error) {
    botCache.delete(key)
    throw error
  }
}

function placeBot(markup: string, placement: { x: number; y: number; size: number }, namespace: string): string {
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  // Cached portraits may appear twice on a front. Each placement needs its own
  // masks and gradients so the complete artwork stays a valid standalone SVG.
  const ids = new Map<string, string>()
  svg.querySelectorAll('[id]').forEach((element, index) => {
    const oldId = element.getAttribute('id')!
    const newId = `${namespace}-${index}`
    ids.set(oldId, newId)
    element.setAttribute('id', newId)
  })
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      let value = attribute.value.replace(/url\(#([^)]*)\)/g, (match, id: string) =>
        ids.has(id) ? `url(#${ids.get(id)})` : match
      )
      if (attribute.localName === 'href' && value.startsWith('#') && ids.has(value.slice(1))) {
        value = `#${ids.get(value.slice(1))}`
      }
      if (value !== attribute.value) element.setAttributeNS(attribute.namespaceURI, attribute.name, value)
    }
  }
  svg.setAttribute('x', String(placement.x))
  svg.setAttribute('y', String(placement.y))
  svg.setAttribute('width', String(placement.size))
  svg.setAttribute('height', String(placement.size))
  return new XMLSerializer().serializeToString(svg)
}

async function frontSvg(card: BotCard, ctx: CanvasRenderingContext2D): Promise<string> {
  const layout = BOT_CARD_FRONT_LAYOUT
  const placements = [
    ...layout.bots.map((bot) => ({ card: { ...card, shape: bot.shape, bodyColor: bot.bodyColor, expression: bot.expression }, placement: bot })),
    { card, placement: layout.personalized }
  ]
  const bots = await Promise.all(placements.map(async ({ card: appearance, placement }, index) => {
    const size = placement.radius * 2 * DEMI_CADRE / RAYON
    const markup = await botSvg(appearance, BLACK)
    return `<g transform="translate(${placement.x} ${placement.y}) rotate(${placement.rotation})">${placeBot(markup, { x: -size / 2, y: -size / 2, size }, `card-front-${index}`)}</g>`
  }))
  const title = card.eventName.trim()
  const explicitLines = title.split(/\r\n|\r|\n/).length
  // Les retours choisis restent en place ; reduire le texte evite de recouper ces lignes.
  const eventName = textSvg(ctx, title, layout.eventName, WHITE, explicitLines > 1 ? explicitLines : 3)
  return `<rect width="1000" height="1000" fill="${BLACK}"/>${bots.join('')}${eventName}`
}

/** Le meme document vectoriel sert a l'apercu et aux formats exportes. */
export async function renderBotCardSvg(card: BotCard, side: BotCardSide = 'back'): Promise<string> {
  const snapshot = { ...card }
  const outer = `<svg xmlns="http://www.w3.org/2000/svg" width="${BOT_CARD_SIZE}" height="${BOT_CARD_SIZE}" viewBox="0 0 1000 1000">`
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  if (side === 'front') return `${outer}${await frontSvg(snapshot, ctx)}</svg>`
  const bot = placeBot(await botSvg(snapshot), BOT_CARD_LAYOUT.bot, 'card-back')
  const url = normalizeBotCardUrl(snapshot.url)
  const qr = url ? botCardQrSvg(await createBotCardQr(url), BOT_CARD_LAYOUT.qr) : ''
  const name = textSvg(ctx, snapshot.name.replace(/\s+/g, ' ').trim(), BOT_CARD_LAYOUT.name, BLACK, 2)
  const handle = textSvg(ctx, botCardHandle(snapshot.handle).replace(/\s+/g, ' '), BOT_CARD_LAYOUT.handle, MUTED, 1)
  const description = textSvg(ctx, snapshot.description, BOT_CARD_LAYOUT.description, BLACK)
  return `${outer}<rect width="1000" height="1000" fill="${WHITE}"/>${bot}${qr}${name}${handle}${description}</svg>`
}

export async function exportBotCard(
  card: BotCard,
  format: BotCardFormat,
  side: BotCardSide = 'back',
  printOptions: BotCardPrintOptions = { sizeMm: BOT_CARD_PRINT_SIZE_MM },
  signal?: AbortSignal
): Promise<Blob> {
  const snapshot = { ...card }
  const sizeMm = printOptions.sizeMm
  signal?.throwIfAborted()
  if (format === 'pdf' && !validBotCardPrintSize(sizeMm)) throw new RangeError('Invalid card print size')
  if (side === 'back' && !normalizeBotCardUrl(snapshot.url)) {
    throw new Error('A valid bot URL is required to export the back')
  }
  const markup = await renderBotCardSvg(snapshot, side)
  signal?.throwIfAborted()
  if (format === 'pdf') return exportPrintPdf(markup, sizeMm, sizeMm, signal)
  return format === 'svg'
    ? new Blob([markup], { type: 'image/svg+xml' })
    : versPng(markup, BOT_CARD_SIZE)
}
