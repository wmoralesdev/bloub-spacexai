import { createApp, h, nextTick, ref } from 'vue'
import BloubBot from '@/components/BloubBot.vue'
import { POSE_FIGE } from '@/bot/figes'
import { regularPolygonProfile } from '@/bot/shape'
import { sansCommentaires, viewBoxExport } from './export'
import { speakerDimensions, type AspectRatio, type ImageFormat, type SpeakerDraft } from './speaker'

export interface SpeakerAssets {
  portrait: HTMLImageElement
  bots: HTMLImageElement[]
}

export type SpeakerBotDirection = 'default' | 'down-left'
export type SpeakerBotCollection = 'classic' | 'lineup'

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const BLACK = '#000000'
const WHITE = '#ffffff'
const MUTED = '#949494'

/** Independent from the avatar customizer palette: these are the event colors. */
const BOTS = [
  { shape: 'cercle', bodyColor: WHITE },
  { shape: 'galet', bodyColor: '#00bbaa' },
  { shape: 'triangle', bodyColor: '#fb299d' },
  { shape: 'nuage', bodyColor: '#1687f8' },
  { shape: 'goutte', bodyColor: '#ff9b00' }
] as const

/** Quatre invités du cadre collectif, tous distincts des cinq bots classiques. */
const LINEUP_BOTS = [
  ...BOTS,
  { shape: 'squircle', bodyColor: '#9b6dff' },
  { shape: 'capsule', bodyColor: '#f1df56' },
  { shape: 'hexagone', bodyColor: '#ee6c4d' },
  {
    shape: 'cercle', bodyColor: '#8edb62',
    // Sommets sur les axes : un losange arrondi, échantillonné comme le moteur.
    bodyRadii: regularPolygonProfile(4, 1.18, 0.3, 0)
  }
] as const

export const SPEAKER_LINEUP_BOT_COUNT = LINEUP_BOTS.length

/** Serialize the actual component so future improvements to its shapes carry over. */
export async function speakerBotSvgs(
  direction: SpeakerBotDirection = 'default',
  collection: SpeakerBotCollection = 'classic'
): Promise<string[]> {
  const host = document.createElement('div')
  const presets = collection === 'lineup' ? LINEUP_BOTS : BOTS
  const bots = presets.map(() => ref<{ rendAt: (time: number) => void } | null>(null))
  const app = createApp({
    render: () => h('div', presets.map((bot, index) => h(BloubBot, {
      ...bot,
      size: 1280,
      paper: BLACK,
      frozenAt: POSE_FIGE,
      expression: 'neutre',
      follow: false,
      playing: false,
      ...(direction === 'down-left' ? {
        ref: bots[index],
        cycle: [{ state: 'idle' as const, duration: POSE_FIGE + 1 }],
        gaze: () => ({ yaw: -28, pitch: -20, mix: 1, spin: 0, wander: 0 })
      } : {})
    })))
  })
  try {
    app.mount(host)
    await nextTick()
    if (direction === 'down-left') {
      // Le regard est installé après l'image figée initiale; rééchantillonner
      // le même repos le projette sans modifier la silhouette ni le composant.
      for (const bot of bots) {
        if (!bot.value) throw new Error('Speaker bot is unavailable')
        bot.value.rendAt(POSE_FIGE)
      }
      await nextTick()
    }
    return Array.from(host.querySelectorAll('svg'), (svg) => {
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('viewBox', viewBoxExport())
      clone.removeAttribute('class')
      return sansCommentaires(new XMLSerializer().serializeToString(clone))
    })
  } finally {
    app.unmount()
  }
}

/** Each URL remains alive until its image has decoded, including failure paths. */
export async function loadSpeakerBots(
  direction: SpeakerBotDirection = 'default',
  collection: SpeakerBotCollection = 'classic'
): Promise<HTMLImageElement[]> {
  return Promise.all((await speakerBotSvgs(direction, collection)).map(async (markup) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }))
}

interface BotPlacement { x: number; y: number; size: number; angle: number }
interface TextBox { x: number; y: number; width: number; height: number; size: number }
interface SpeakerLayout {
  height: number
  padding: number
  event: TextBox
  date: TextBox
  talkTitle?: TextBox
  label: TextBox
  name: TextBox
  role: TextBox
  sectionGap: number
  labelGap: number
  roleGap: number
  portrait: { centerX: number; y: number; height: number }
  bots: BotPlacement[]
  footer: TextBox
}

/** One type scale across formats: headline, speaker, identity, supporting details. */
const TYPE_SCALE = { name: 0.65, identity: 0.4, date: 0.35, detail: 0.3 } as const
const TEXT_LEADING = 1.08
const DATE_GAP = 8

/** All coordinates use a 1000-unit width. Portraits and bots keep their composition. */
export function speakerLayout(aspect: AspectRatio, hasTalkTitle = false): SpeakerLayout {
  const frame = aspect === '1:1' ? {
    height: 1000, padding: 64, top: 60, titleY: 250, titleHeight: 220, headline: 70,
    textWidth: 530, sectionGap: 35, labelGap: 9, roleGap: 12,
    portrait: { centerX: 790, y: 245, height: 790 },
    bots: [
      { x: 15, y: 960, size: 450, angle: -32 },
      { x: 153, y: 800, size: 115, angle: -26 },
      { x: 313, y: 902, size: 229, angle: 13 },
      { x: 508, y: 970, size: 265, angle: -16 },
      { x: 458, y: 810, size: 130, angle: 24 }
    ],
    footer: { x: 660, y: 837, width: 276, height: 120 }
  } : aspect === '9:16' ? {
    // Story layout: text above the portrait, with breathing room at both ends.
    height: 1000 * 16 / 9, padding: 72, top: 158, titleY: 300, titleHeight: 300, headline: 96,
    textWidth: 856, sectionGap: 40, labelGap: 12, roleGap: 16,
    portrait: { centerX: 690, y: 825, height: 1080 },
    bots: [
      { x: 15, y: 1760, size: 540, angle: -32 },
      { x: 165, y: 1515, size: 140, angle: -26 },
      { x: 340, y: 1690, size: 265, angle: 13 },
      { x: 560, y: 1805, size: 290, angle: -16 },
      { x: 490, y: 1540, size: 150, angle: 24 }
    ],
    footer: { x: 620, y: 1450, width: 308, height: 120 }

  } : {
    height: 750, padding: 60, top: 52, titleY: 150, titleHeight: 192, headline: 64,
    textWidth: 530, sectionGap: 30, labelGap: 8, roleGap: 12,
    portrait: { centerX: 792, y: 97, height: 700 },
    bots: [
      { x: 15, y: 735, size: 340, angle: -32 },
      { x: 155, y: 637, size: 92, angle: -26 },
      { x: 277, y: 723, size: 183, angle: 13 },
      { x: 454, y: 747, size: 221, angle: -16 },
      { x: 427, y: 642, size: 112, angle: 24 }
    ],
    footer: { x: 600, y: 614, width: 340, height: 103 }
  }
  const detailSize = frame.headline * TYPE_SCALE.detail
  const nameSize = frame.headline * (hasTalkTitle ? TYPE_SCALE.name : 1)
  const labelY = hasTalkTitle
    ? frame.titleY + frame.titleHeight + frame.sectionGap
    : frame.titleY + frame.sectionGap
  const nameY = labelY + detailSize * TEXT_LEADING + frame.labelGap
  const nameHeight = nameSize * TEXT_LEADING * 2
  const eventHeight = frame.headline * TYPE_SCALE.identity * TEXT_LEADING * 2
  const dateY = frame.top + eventHeight + DATE_GAP
  return {
    height: frame.height, padding: frame.padding,
    event: {
      x: frame.padding, y: frame.top, width: 620,
      height: eventHeight,
      size: frame.headline * TYPE_SCALE.identity
    },
    date: {
      x: frame.padding, y: dateY, width: frame.textWidth,
      height: frame.titleY - DATE_GAP - dateY, size: frame.headline * TYPE_SCALE.date
    },
    ...(hasTalkTitle ? { talkTitle: {
      x: frame.padding, y: frame.titleY, width: frame.textWidth,
      height: frame.titleHeight, size: frame.headline
    } } : {}),
    label: { x: frame.padding, y: labelY, width: frame.textWidth, height: detailSize * TEXT_LEADING, size: detailSize },
    name: { x: frame.padding, y: nameY, width: frame.textWidth, height: nameHeight, size: nameSize },
    role: { x: frame.padding, y: nameY + nameHeight + frame.roleGap, width: frame.textWidth * 0.9, height: detailSize * TEXT_LEADING * 2, size: detailSize },
    sectionGap: frame.sectionGap, labelGap: frame.labelGap, roleGap: frame.roleGap,
    portrait: frame.portrait, bots: frame.bots,
    footer: { ...frame.footer, size: detailSize }
  }
}

interface FittedText { lines: string[]; size: number; lineHeight: number }

function linesAt(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  if (!text.trim()) return lines
  // Manual line breaks are layout instructions; wrap each line independently.
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
      // A long handle or a language without spaces still has to fit the canvas.
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

/** Fit complete text first; truncate only at the minimum size for extreme input. */
export function fitSpeakerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Pick<TextBox, 'width' | 'height' | 'size'>,
  maxLines = 2,
  weight = 400,
  minimumSize = 14,
  leading = 1.08
): FittedText {
  let size = box.size
  let lines: string[] = []
  while (size >= minimumSize) {
    ctx.font = `${weight} ${size}px ${FONT}`
    lines = linesAt(ctx, text, box.width)
    if (lines.length <= maxLines && lines.length * size * leading <= box.height) {
      return { lines, size, lineHeight: size * leading }
    }
    size -= 1
  }
  size = minimumSize
  ctx.font = `${weight} ${size}px ${FONT}`
  lines = linesAt(ctx, text, box.width)
  const count = Math.max(1, Math.min(maxLines, Math.floor(box.height / (size * leading))))
  if (lines.length > count) {
    lines = lines.slice(0, count)
    let last = lines[count - 1]!
    while (last && ctx.measureText(`${last}…`).width > box.width) last = Array.from(last).slice(0, -1).join('')
    lines[count - 1] = `${last}…`
  }
  return { lines, size, lineHeight: size * leading }
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: TextBox,
  color = WHITE,
  maxLines = 1,
  weight = 400,
  leading = TEXT_LEADING,
  minimumSize = 14
): FittedText {
  const fit = fitSpeakerText(ctx, text, box, maxLines, weight, minimumSize, leading)
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  ctx.font = `${weight} ${fit.size}px ${FONT}`
  fit.lines.forEach((line, i) => ctx.fillText(line, box.x, box.y + i * fit.lineHeight))
  return fit
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Cached per destination canvas: slider changes do not allocate a new photo layer. */
const portraitLayers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()

interface PortraitSource { x: number; y: number; width: number; height: number }
const portraitSources = new WeakMap<HTMLImageElement, { src: string; width: number; height: number; bounds: PortraitSource }>()

/** Ignore transparent margins and 1/255 alpha noise while retaining faint hair. */
export function portraitSource(portrait: HTMLImageElement): PortraitSource {
  const width = portrait.naturalWidth
  const height = portrait.naturalHeight
  const src = portrait.currentSrc || portrait.src
  const cached = portraitSources.get(portrait)
  if (cached && cached.src === src && cached.width === width && cached.height === height) return cached.bounds
  let bounds = { x: 0, y: 0, width, height }
  const probe = document.createElement('canvas')
  try {
    probe.width = width
    probe.height = height
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.drawImage(portrait, 0, 0)
      const pixels = ctx.getImageData(0, 0, width, height).data
      let left = width, top = height, right = -1, bottom = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (pixels[(y * width + x) * 4 + 3]! > 1) {
            left = Math.min(left, x)
            top = Math.min(top, y)
            right = Math.max(right, x)
            bottom = Math.max(bottom, y)
          }
        }
      }
      if (right >= left && bottom >= top && (
        left > width * 0.05 || width - right - 1 > width * 0.05 ||
        top > height * 0.05 || height - bottom - 1 > height * 0.05
      )) {
        const x = Math.max(0, left - Math.ceil(width * 0.01))
        const y = Math.max(0, top - Math.ceil(height * 0.01))
        bounds = {
          x, y,
          width: Math.min(width, right + 1 + Math.ceil(width * 0.01)) - x,
          height: Math.min(height, bottom + 1 + Math.ceil(height * 0.01)) - y
        }
      }
    }
  } catch {
    // A browser may deny pixel readback; drawing the full image still works.
  } finally {
    probe.width = probe.height = 0
  }
  portraitSources.set(portrait, { src, width, height, bounds })
  return bounds
}

function drawPortrait(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  draft: SpeakerDraft,
  portrait: HTMLImageElement,
  layout: SpeakerLayout,
  scale: number
) {
  let layer = portraitLayers.get(canvas)
  if (!layer) {
    layer = document.createElement('canvas')
    portraitLayers.set(canvas, layer)
  }
  layer.width = canvas.width
  layer.height = canvas.height
  const photo = layer.getContext('2d')
  if (!photo) throw new Error('Canvas unavailable')
  photo.scale(scale, scale)
  photo.imageSmoothingEnabled = true
  photo.imageSmoothingQuality = 'high'

  const source = portraitSource(portrait)
  const ratio = source.width / source.height
  // Tall portraits keep their existing framing. Blend into a width fit as a
  // source approaches square, so a slightly different crop cannot cause a jump.
  const transition = clamp((ratio - 0.8) / 0.1, 0, 1)
  const fit = transition * transition * (3 - 2 * transition)
  const maxWidth = draft.aspect === '9:16' ? 1000 - layout.padding * 2 : 500
  const fittedHeight = Math.min(layout.portrait.height, maxWidth / ratio)
  const baseHeight = layout.portrait.height + (fittedHeight - layout.portrait.height) * fit
  const fittedCenter = Math.min(layout.portrait.centerX, 984 - baseHeight * ratio / 2)
  const centerX = layout.portrait.centerX + (fittedCenter - layout.portrait.centerX) * fit
  // Fit only the default frame; manual zoom and offsets remain unrestricted.
  const height = baseHeight * clamp(draft.photoScale, 70, 150) / 100
  const width = height * ratio
  const x = centerX - width / 2 + clamp(draft.photoX, -30, 30) * 10
  const y = layout.portrait.y + (layout.portrait.height - height) / 2 + clamp(draft.photoY, -30, 30) * layout.height / 100
  if (source.width === portrait.naturalWidth && source.height === portrait.naturalHeight) {
    photo.drawImage(portrait, x, y, width, height)
  } else {
    photo.drawImage(portrait, source.x, source.y, source.width, source.height, x, y, width, height)
  }

  if (draft.fade > 0) {
    const strength = clamp(draft.fade, 0, 100) / 100
    const fade = photo.createLinearGradient(x, y + height, x + width * 0.86, y + height * 0.17)
    fade.addColorStop(0, 'rgba(0,0,0,0)')
    fade.addColorStop(0.06 + strength * 0.24, 'rgba(0,0,0,0)')
    fade.addColorStop(0.43 + strength * 0.36, 'rgba(0,0,0,1)')
    fade.addColorStop(1, 'rgba(0,0,0,1)')
    photo.globalCompositeOperation = 'destination-in'
    photo.fillStyle = fade
    photo.fillRect(0, 0, 1000, layout.height)
    if (baseHeight < layout.portrait.height) {
      // A width-fitted photo can end inside the canvas. Soften that source edge
      // while retaining the diagonal mask and leaving tall portraits unchanged.
      const bottomFade = photo.createLinearGradient(0, y + height * 0.88, 0, y + height)
      bottomFade.addColorStop(0, 'rgba(0,0,0,1)')
      bottomFade.addColorStop(1, 'rgba(0,0,0,0)')
      photo.fillStyle = bottomFade
      photo.fillRect(0, 0, 1000, layout.height)
    }
  }
  ctx.drawImage(layer, 0, 0, 1000, layout.height)
}

/** Shared layout coordinates, scaled to the destination image's native pixels. */
export function speakerBotPlacements(draft: SpeakerDraft, width = 1000): BotPlacement[] {
  if (!draft.botsVisible) return []
  const layout = speakerLayout(draft.aspect, !!draft.talkTitle.trim())
  const size = clamp(draft.botsScale, 60, 130) / 100
  const scale = width / 1000
  return layout.bots.map((bot) => ({
    x: bot.x * size * scale,
    y: (layout.height + (bot.y - layout.height) * size) * scale,
    size: bot.size * size * scale,
    angle: bot.angle
  }))
}

function prepareSpeakerCanvas(canvas: HTMLCanvasElement, draft: SpeakerDraft, width?: number) {
  const dimensions = speakerDimensions(draft.aspect, width)
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  const scale = dimensions.width / 1000
  const layout = speakerLayout(draft.aspect, !!draft.talkTitle.trim())
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { ctx, layout, scale }
}

function drawSpeakerBackground(
  canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D,
  draft: SpeakerDraft, assets: SpeakerAssets, layout: SpeakerLayout, scale: number
) {
  ctx.fillStyle = BLACK
  ctx.fillRect(0, 0, 1000, layout.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  drawPortrait(canvas, ctx, draft, assets.portrait, layout, scale)
  if ([draft.venue, draft.url].some((value) => value.trim())) {
    // Shade the portrait before the bots so the footer never cuts their silhouettes.
    const footer = layout.footer
    const shade = ctx.createLinearGradient(0, footer.y - 25, 0, layout.height)
    shade.addColorStop(0, 'rgba(0,0,0,0)')
    shade.addColorStop(0.5, 'rgba(0,0,0,0.78)')
    shade.addColorStop(1, 'rgba(0,0,0,0.94)')
    ctx.fillStyle = shade
    ctx.fillRect(footer.x - 20, footer.y - 25, 1000 - footer.x + 20, layout.height - footer.y + 25)
  }
}

function drawSpeakerForeground(ctx: CanvasRenderingContext2D, draft: SpeakerDraft, layout: SpeakerLayout) {
  const identity = [draft.event.trim(), draft.city.trim()].filter(Boolean).join(' · ')
  // Event and date stay readable regardless of how much the talk title must shrink.
  const event = drawText(ctx, identity, layout.event, WHITE, 2)
  const schedule = [draft.date.trim(), draft.time.trim()].filter(Boolean).join(' · ')
  if (schedule) {
    const dateY = layout.event.y + event.lines.length * event.lineHeight + (identity ? DATE_GAP : 0)
    drawText(ctx, schedule, {
      ...layout.date, y: dateY, height: layout.date.y + layout.date.height - dateY
    }, WHITE, 2)
  }
  let typeScale = 1
  let speakerY = layout.label.y
  let nameSize = layout.name.size
  if (layout.talkTitle) {
    const title = drawText(ctx, draft.talkTitle, layout.talkTitle, WHITE, 3, 500, TEXT_LEADING, layout.talkTitle.size * 0.6)
    speakerY = layout.talkTitle.y + title.lines.length * title.lineHeight + layout.sectionGap
    // Long titles retain their lead over the name even when they need to fit.
    nameSize = Math.min(nameSize, title.size * TYPE_SCALE.name)
    typeScale = title.size / layout.talkTitle.size
  }
  const detailSize = Math.max(14, layout.role.size * typeScale)
  if (draft.label.trim()) {
    const label = drawText(ctx, draft.label.toLocaleUpperCase(), { ...layout.label, y: speakerY, size: detailSize }, MUTED)
    speakerY += label.lines.length * label.lineHeight + layout.labelGap
  }
  const name = drawText(ctx, draft.name, { ...layout.name, y: speakerY, size: nameSize }, WHITE, 2, 500)
  const roleY = speakerY + name.lines.length * name.lineHeight + layout.roleGap
  drawText(ctx, draft.role, { ...layout.role, y: roleY, size: detailSize }, MUTED, 2)

  const details = draft.venue.trim()
  if (details || draft.url.trim()) {
    const footer = { ...layout.footer, size: detailSize }
    const urlHeight = draft.url.trim() ? footer.size * TEXT_LEADING + 6 : 0
    const detailsBox = { ...footer, height: footer.height - urlHeight }
    const detailsFit = fitSpeakerText(ctx, details, detailsBox, 3)
    const detailsHeight = detailsFit.lines.length * detailsFit.lineHeight
    const footerY = footer.y + footer.height - detailsHeight - urlHeight
    drawText(ctx, details, { ...detailsBox, y: footerY }, MUTED, 3)
    if (draft.url.trim()) drawText(ctx, draft.url, {
      ...footer,
      y: footerY + detailsHeight + (details ? 6 : 0),
      height: footer.size * TEXT_LEADING
    }, MUTED)

  }
}

/** Raster layers around the bots, using precisely the same drawing operations as PNG/JPEG. */
export function renderSpeakerLayers(draft: SpeakerDraft, assets: SpeakerAssets, width?: number) {
  if (!assets.portrait.naturalWidth || !assets.portrait.naturalHeight) {
    throw new Error('Speaker portrait is not ready')
  }
  const background = document.createElement('canvas')
  const back = prepareSpeakerCanvas(background, draft, width)
  drawSpeakerBackground(background, back.ctx, draft, assets, back.layout, back.scale)
  const foreground = document.createElement('canvas')
  const front = prepareSpeakerCanvas(foreground, draft, width)
  drawSpeakerForeground(front.ctx, draft, front.layout)
  return { background, foreground }
}

/** The preview and both encoders call this exact drawing path. */
export function renderSpeaker(
  canvas: HTMLCanvasElement,
  draft: SpeakerDraft,
  assets: SpeakerAssets,
  width?: number
): void {
  if (!assets.portrait.naturalWidth || !assets.portrait.naturalHeight) {
    throw new Error('Speaker portrait is not ready')
  }
  if (draft.botsVisible && (assets.bots.length !== BOTS.length || assets.bots.some((bot) => !bot.naturalWidth))) {
    throw new Error('Speaker bots are not ready')
  }
  const { ctx, layout, scale } = prepareSpeakerCanvas(canvas, draft, width)
  drawSpeakerBackground(canvas, ctx, draft, assets, layout, scale)
  if (draft.botsVisible) {
    const size = clamp(draft.botsScale, 60, 130) / 100
    layout.bots.forEach((bot, i) => {
      ctx.save()
      // Scale the whole group around the bottom-left corner, preserving spacing.
      ctx.translate(bot.x * size, layout.height + (bot.y - layout.height) * size)
      ctx.rotate(bot.angle * Math.PI / 180)
      ctx.drawImage(assets.bots[i]!, -bot.size * size / 2, -bot.size * size / 2, bot.size * size, bot.size * size)
      ctx.restore()
    })
  }

  drawSpeakerForeground(ctx, draft, layout)
}

export async function exportSpeaker(
  draft: SpeakerDraft,
  assets: SpeakerAssets,
  format: ImageFormat
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  renderSpeaker(canvas, draft, assets)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Could not encode speaker artwork')),
      format === 'jpeg' ? 'image/jpeg' : 'image/png',
      format === 'jpeg' ? 0.95 : undefined
    )
  })
}
