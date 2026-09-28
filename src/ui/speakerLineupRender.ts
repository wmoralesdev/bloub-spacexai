import type { SpeakerAnimationSnapshot } from '../shared/speakerAnimation'
import { speakerDimensions, type AspectRatio, type ImageFormat, type SpeakerDraft, type SpeakerExportFormat } from './speaker'
import type { SpeakerPhoto, SpeakerVariant } from './speakerLibrary'
import { fitSpeakerText, loadSpeakerBots, portraitSource, SPEAKER_LINEUP_BOT_COUNT } from './speakerRender'

export interface SpeakerLineupDraft extends Pick<SpeakerDraft,
  'aspect' | 'event' | 'city' | 'date' | 'time' | 'venue' | 'url' | 'botsVisible' | 'botsScale'
> {
  title: string
  speakers: Array<{ name: string; talkTitle: string }>
}

export interface SpeakerLineupAssets {
  portraits: HTMLImageElement[]
  bots: HTMLImageElement[]
  cornerBots: HTMLImageElement[]
}

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const WHITE = '#ffffff'
const MUTED = '#b2b2b2'
const LEADING = 1.12

interface Box { x: number; y: number; width: number; height: number }
interface PortraitPlacement extends Box {
  index: number
  source: Box
}
interface TextRun {
  x: number
  y: number
  width: number
  color: string
  weight: number
  centered: boolean
  fit: ReturnType<typeof fitSpeakerText>
}
interface BotPlacement { x: number; y: number; size: number; angle: number; assetIndex: number }
interface LineupLayout {
  height: number
  portraits: PortraitPlacement[]
  fades: Box[]
  text: TextRun[]
  bots: BotPlacement[]
}

/** Le programme suit l'ordre et les textes actuels de la bibliothèque. */
export function createSpeakerLineupDraft(
  variants: readonly SpeakerVariant[], event: SpeakerDraft, title: string
): SpeakerLineupDraft {
  return {
    title,
    aspect: event.aspect,
    event: event.event,
    city: event.city,
    date: event.date,
    time: event.time,
    venue: event.venue,
    url: event.url,
    botsVisible: event.botsVisible,
    botsScale: event.botsScale,
    speakers: variants.map(({ draft }) => ({ name: draft.name, talkTitle: draft.talkTitle }))
  }
}

export function releaseSpeakerLineupAssets(assets: SpeakerLineupAssets): void {
  for (const image of [...assets.portraits, ...assets.bots, ...assets.cornerBots]) image.removeAttribute('src')
}

/** Les sources sont figées avant le chargement; l'annulation libère les images en cours. */
export async function loadSpeakerLineupAssets(
  variants: readonly SpeakerVariant[],
  photos: readonly SpeakerPhoto[],
  botsVisible: boolean,
  signal?: AbortSignal
): Promise<SpeakerLineupAssets> {
  signal?.throwIfAborted()
  const sources = new Map(photos.map((photo) => [photo.id, photo.src]))
  const snapshot = variants.map((variant) => ({ name: variant.draft.name, source: sources.get(variant.photoId) }))
  if (!snapshot.length) throw new Error('No speakers to include in the lineup')
  const missing = snapshot.find((speaker) => !speaker.source?.trim())
  if (missing) throw new Error(`Missing portrait for ${missing.name || 'speaker'}`)

  const assets: SpeakerLineupAssets = { portraits: snapshot.map(() => new Image()), bots: [], cornerBots: [] }
  let released = false
  const release = () => {
    released = true
    releaseSpeakerLineupAssets(assets)
  }
  let rejectAbort: ((reason: unknown) => void) | undefined
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  const cancel = () => {
    release()
    rejectAbort?.(signal?.reason ?? new DOMException('Cancelled', 'AbortError'))
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const portraits = Promise.all(snapshot.map(async (speaker, index) => {
      const image = assets.portraits[index]!
      image.src = speaker.source!
      try {
        await image.decode()
        signal?.throwIfAborted()
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty portrait')
      } catch (error) {
        signal?.throwIfAborted()
        throw new Error(`Could not load portrait for ${speaker.name || 'speaker'}`, { cause: error })
      }
    }))
    const bots = botsVisible ? Promise.all((['default', 'down-left'] as const).map(async (direction) => {
      const images = await loadSpeakerBots(direction, direction === 'down-left' ? 'lineup' : 'classic')
      if (released) {
        for (const image of images) image.removeAttribute('src')
      } else if (direction === 'down-left') assets.cornerBots = images
      else assets.bots = images
    })) : Promise.resolve()
    await Promise.race([Promise.all([portraits, bots]), aborted])
    signal?.throwIfAborted()
    return assets
  } catch (error) {
    release()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

/** Le haut reste intact; les portraits en pied deviennent des cadrages de buste. */
function bustSource(portrait: HTMLImageElement): Box {
  const source = portraitSource(portrait)
  return { ...source, height: Math.min(source.height, source.width * 1.4) }
}

function placePortrait(index: number, source: Box, box: Box): PortraitPlacement {
  const scale = Math.min(box.width / source.width, box.height / source.height)
  const width = source.width * scale
  const height = source.height * scale
  return {
    index, source, width, height,
    x: box.x + (box.width - width) / 2,
    y: box.y + box.height - height
  }
}

function createLayout(
  ctx: CanvasRenderingContext2D, draft: SpeakerLineupDraft, assets: SpeakerLineupAssets, height: number
): LineupLayout {
  const story = draft.aspect === '9:16'
  const square = draft.aspect === '1:1'
  const frame = story
    ? { padding: 72, top: 88, eventSize: 32, titleSize: 22, dateSize: 27, nameSize: 29, talkSize: 38, footerSize: 22 }
    : square
      ? { padding: 60, top: 54, eventSize: 30, titleSize: 17, dateSize: 23, nameSize: 21, talkSize: 31, footerSize: 19 }
      : { padding: 52, top: 40, eventSize: 28, titleSize: 15, dateSize: 21, nameSize: 18, talkSize: 26, footerSize: 17 }
  const text: TextRun[] = []
  const portraits: PortraitPlacement[] = []
  const fades: Box[] = []
  const contentWidth = 1000 - frame.padding * 2
  const factor = Math.max(60, Math.min(130, draft.botsScale)) / 100
  const leftAccents: BotPlacement[] = [
    { assetIndex: 5, x: -54, y: 22, size: 46, angle: 12 },
    { assetIndex: 7, x: -126, y: 24, size: 42, angle: -8 }
  ]
  const lowerAccents: BotPlacement[] = [
    { assetIndex: 6, x: 400, y: 206, size: 62, angle: -26 },
    { assetIndex: 8, x: 386, y: 283, size: 54, angle: 12 }
  ]
  // Le groupe entier reste dans le coin; le blanc mène, sans corps coupés en bas.
  const corner = !story && draft.botsVisible
    ? { x: 984 - 430 * factor, y: 4, width: 430 * factor, height: 168 * factor }
    : undefined
  const headerWidth = corner ? corner.x - frame.padding - 24 : contentWidth
  const addText = (
    value: string, box: Box, size: number, maxLines: number,
    color = WHITE, weight = 400, centered = false, minimumSize = Math.min(14, size * 0.7)
  ) => {
    const fit = fitSpeakerText(ctx, value, { ...box, size }, maxLines, weight, minimumSize, LEADING)
    text.push({ x: box.x, y: box.y, width: box.width, color, weight, centered, fit })
    return fit.lines.length * fit.lineHeight
  }
  // Le petit retour gauche passe au-dessus du titre, sans réduire sa largeur.
  let y = corner
    ? Math.max(frame.top, ...leftAccents.map((bot) => corner.y + (bot.y + bot.size / 2) * factor + 12))
    : frame.top
  const identity = [draft.event.trim(), draft.city.trim()].filter(Boolean).join(' · ')
  if (identity) {
    y += addText(identity, { x: frame.padding, y, width: headerWidth, height: frame.eventSize * LEADING * 2 }, frame.eventSize, 2)
    y += 10
  }
  const schedule = [draft.date.trim(), draft.time.trim()].filter(Boolean).join(' · ')
  if (schedule) {
    y += addText(schedule, { x: frame.padding, y, width: headerWidth, height: frame.dateSize * LEADING * 2 }, frame.dateSize, 2)
  }
  y += story ? 24 : 20
  if (draft.title.trim()) {
    y += addText(draft.title, {
      x: frame.padding, y, width: headerWidth, height: frame.titleSize * LEADING
    }, frame.titleSize, 1, MUTED, 500)
    y += story ? 20 : 18
  }
  if (corner) y = Math.max(y, corner.y + corner.height + 12)

  const count = draft.speakers.length
  const logistics = [draft.venue.trim(), draft.url.trim()].filter(Boolean).join('\n')
  let storyRowHeight = 0

  if (story) {
    // Une ligne par personne: le texte alterne avec un portrait plus présent.
    const bottom = height - (draft.botsVisible ? 200 : logistics ? 130 : 72)
    storyRowHeight = Math.max(1, bottom - y) / count
    const density = Math.min(1, storyRowHeight / 250)
    draft.speakers.forEach((speaker, index) => {
      const photoOnLeft = index % 2 === 0
      const top = y + index * storyRowHeight
      const photo = placePortrait(index, bustSource(assets.portraits[index]!), {
        x: photoOnLeft ? 72 : 612,
        y: top + storyRowHeight * 0.02,
        width: 316,
        height: storyRowHeight * 0.96
      })
      portraits.push(photo)
      fades.push({ x: photo.x, y: photo.y + photo.height * 0.83, width: photo.width, height: photo.height * 0.17 })

      const x = photoOnLeft ? 426 : 92
      const width = 482
      const talk = fitSpeakerText(ctx, speaker.talkTitle.replace(/\s+/g, ' ').trim(), {
        width, height: storyRowHeight * 0.57, size: frame.talkSize * density
      }, 3, 500, Math.min(22, frame.talkSize * density * 0.7), LEADING)
      const name = fitSpeakerText(ctx, speaker.name, {
        width, height: frame.nameSize * density * LEADING * 2, size: frame.nameSize * density
      }, 2, 400, Math.min(18, frame.nameSize * density * 0.7), LEADING)
      const gap = talk.lines.length ? 12 * density : 0
      const textHeight = name.lines.length * name.lineHeight + gap + talk.lines.length * talk.lineHeight
      const textY = top + (storyRowHeight - textHeight) / 2
      text.push({ x, y: textY, width, color: MUTED, weight: 400, centered: false, fit: name })
      text.push({
        x, y: textY + name.lines.length * name.lineHeight + gap,
        width, color: WHITE, weight: 500, centered: false, fit: talk
      })
    })
  } else {
    // L'agenda occupe le haut; les bustes se chevauchent dans une seule rangée.
    const photoHeight = Math.min(height * (square ? 0.48 : 0.45), Math.max(1, height - y) * 0.62)
    const photoTop = height - photoHeight
    const columns = count > 8 ? 3 : Math.min(2, count)
    const rows = Math.ceil(count / columns)
    const columnGap = square ? 44 : 40
    const cellWidth = (contentWidth - columnGap * (columns - 1)) / columns
    const rowHeight = Math.max(1, photoTop - y - 24) / rows
    const density = Math.min(1, rowHeight / (square ? 102 : 76))
    draft.speakers.forEach((speaker, index) => {
      const x = frame.padding + (index % columns) * (cellWidth + columnGap)
      const top = y + Math.floor(index / columns) * rowHeight
      let width = index === count - 1 && index % columns === 0 ? contentWidth : cellWidth
      // Les accents du cadre réservent une marge uniquement aux lignes voisines.
      if (corner) {
        for (const bot of lowerAccents) {
          if (top < corner.y + (bot.y + bot.size / 2) * factor + 12
            && top + rowHeight > corner.y + (bot.y - bot.size / 2) * factor - 12) {
            width = Math.min(width, corner.x + (bot.x - bot.size / 2) * factor - 16 - x)
          }
        }
      }
      const nameSize = frame.nameSize * density
      const nameHeight = nameSize * LEADING * 2
      // Les retours manuels des cartes individuelles n'imposent pas leur largeur ici.
      const title = speaker.talkTitle.replace(/\s+/g, ' ').trim()
      const talkHeight = title ? addText(title, {
        x, y: top, width, height: Math.max(1, rowHeight - nameSize * LEADING - 14)
      }, frame.talkSize * density, 2, WHITE, 500, false, Math.min(18, frame.talkSize * density * 0.7)) : 0
      addText(speaker.name, {
        x, y: top + talkHeight + (title ? 6 : 0), width,
        height: Math.min(nameHeight, Math.max(1, rowHeight - talkHeight - 10))
      }, nameSize, 2, MUTED, 400, false, Math.min(14, nameSize * 0.7))
    })

    const photoColumns = Math.min(5, count)
    const photoRows = Math.ceil(count / photoColumns)
    const rowHeightPhoto = photoHeight / photoRows
    for (let row = 0; row < photoRows; row++) {
      const rowCount = Math.min(photoColumns, count - row * photoColumns)
      const step = Math.min(194, 940 / rowCount)
      const firstCenter = (1000 - step * (rowCount - 1)) / 2
      // Peindre de droite à gauche garde les premiers speakers au premier plan.
      for (let column = rowCount - 1; column >= 0; column--) {
        const index = row * photoColumns + column
        const progression = rowCount === 1 ? 1 : 0.9 + 0.1 * column / (rowCount - 1)
        const width = Math.min(square ? 350 : 320, step * 1.7)
        const portraitHeight = rowHeightPhoto * progression
        portraits.push(placePortrait(index, bustSource(assets.portraits[index]!), {
          x: firstCenter + step * column - width / 2,
          y: photoTop + (row + 1) * rowHeightPhoto - portraitHeight,
          width, height: portraitHeight
        }))
      }
      const fadeHeight = Math.min(logistics ? 100 : 64, rowHeightPhoto * 0.23)
      fades.push({ x: 0, y: photoTop + (row + 1) * rowHeightPhoto - fadeHeight, width: 1000, height: fadeHeight })
    }
  }

  if (logistics) {
    const x = story && draft.botsVisible ? 250 : frame.padding
    addText(logistics, {
      x, y: height - (story ? 116 : 76), width: 1000 - x * 2,
      height: story ? 84 : 62
    }, frame.footerSize, 3, WHITE, 400, true)
  }
  // Les neuf placements du coin utilisent chacun leur propre personnage.
  const storyBots = [
    { x: 8, y: height - 12, size: 300, angle: -32 },
    { x: 1010, y: y + storyRowHeight, size: 138, angle: 25 },
    { x: 177, y: height - 25, size: 146, angle: 13 },
    { x: 953, y: height + 12, size: 290, angle: -16 },
    { x: 995, y: y + storyRowHeight * Math.min(3, count), size: 112, angle: 24 }
  ]
  const cornerBots: BotPlacement[] = [
    { x: 128, y: 82, size: 164, angle: -26 },
    { x: 32, y: 34, size: 64, angle: -26 },
    { x: 262, y: 115, size: 98, angle: 13 },
    { x: 366, y: 64, size: 116, angle: -16 },
    { x: 244, y: 32, size: 64, angle: 24 }
  ].map((bot, assetIndex) => ({ ...bot, assetIndex }))
  cornerBots.push(leftAccents[0]!, lowerAccents[0]!, leftAccents[1]!, lowerAccents[1]!)
  const bots = !draft.botsVisible ? [] : corner
    ? cornerBots.map((bot) => ({
      x: corner.x + bot.x * factor,
      y: corner.y + bot.y * factor,
      size: bot.size * factor,
      angle: bot.angle,
      assetIndex: bot.assetIndex
    }))
    : storyBots.map((bot, assetIndex) => ({ ...bot, assetIndex, size: bot.size * factor }))
  return { height, portraits, fades, text, bots }
}

function validateAssets(draft: SpeakerLineupDraft, assets: SpeakerLineupAssets) {
  if (!draft.speakers.length) throw new Error('No speakers to include in the lineup')
  if (assets.portraits.length !== draft.speakers.length
    || assets.portraits.some((portrait) => !portrait.naturalWidth || !portrait.naturalHeight)) {
    throw new Error('Speaker lineup portraits are not ready')
  }
  const bots = draft.aspect === '9:16' ? assets.bots : assets.cornerBots
  const expectedBots = draft.aspect === '9:16' ? 5 : SPEAKER_LINEUP_BOT_COUNT
  if (draft.botsVisible && (bots.length !== expectedBots || bots.some((bot) => !bot.naturalWidth))) {
    throw new Error('Speaker bots are not ready')
  }
}

function prepareCanvas(canvas: HTMLCanvasElement, draft: SpeakerLineupDraft, width?: number) {
  const size = speakerDimensions(draft.aspect, width)
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  const scale = size.width / 1000
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { ctx, scale, height: size.height / scale }
}

function drawBackground(ctx: CanvasRenderingContext2D, layout: LineupLayout, assets: SpeakerLineupAssets) {
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, 1000, layout.height)
  for (const box of layout.portraits) {
    const { source } = box
    ctx.drawImage(assets.portraits[box.index]!, source.x, source.y, source.width, source.height,
      box.x, box.y, box.width, box.height)
  }
  // Le fondu commun n'efface pas les voisins entre deux portraits superposés.
  for (const box of layout.fades) {
    const fade = ctx.createLinearGradient(0, box.y, 0, box.y + box.height)
    fade.addColorStop(0, 'rgba(0,0,0,0)')
    fade.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = fade
    ctx.fillRect(box.x, box.y, box.width, box.height)
  }
}

function drawForeground(ctx: CanvasRenderingContext2D, layout: LineupLayout) {
  ctx.textBaseline = 'top'
  for (const run of layout.text) {
    ctx.fillStyle = run.color
    ctx.font = `${run.weight} ${run.fit.size}px ${FONT}`
    run.fit.lines.forEach((line, index) => {
      const x = run.x + (run.centered ? (run.width - ctx.measureText(line).width) / 2 : 0)
      ctx.fillText(line, x, run.y + index * run.fit.lineHeight)
    })
  }
}

/** Le preview et les exports fixes partagent les couches de l'animation. */
export function renderSpeakerLineup(
  canvas: HTMLCanvasElement, draft: SpeakerLineupDraft, assets: SpeakerLineupAssets, width?: number
): void {
  validateAssets(draft, assets)
  const { ctx, height } = prepareCanvas(canvas, draft, width)
  const layout = createLayout(ctx, draft, assets, height)
  const bots = draft.aspect === '9:16' ? assets.bots : assets.cornerBots
  drawBackground(ctx, layout, assets)
  layout.bots.forEach((bot) => {
    ctx.save()
    ctx.translate(bot.x, bot.y)
    ctx.rotate(bot.angle * Math.PI / 180)
    ctx.drawImage(bots[bot.assetIndex]!, -bot.size / 2, -bot.size / 2, bot.size, bot.size)
    ctx.restore()
  })
  drawForeground(ctx, layout)
}

export async function exportSpeakerLineup(
  draft: SpeakerLineupDraft, assets: SpeakerLineupAssets, format: ImageFormat
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  try {
    renderSpeakerLineup(canvas, draft, assets)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Could not encode speaker lineup')),
      format === 'jpeg' ? 'image/jpeg' : 'image/png',
      format === 'jpeg' ? 0.95 : undefined
    ))
  } finally {
    canvas.width = canvas.height = 0
  }
}

/** Capture les pixels avant tout await: les éditions suivantes n'altèrent pas le rendu. */
export async function createSpeakerLineupAnimationSnapshot(
  draft: SpeakerLineupDraft, assets: SpeakerLineupAssets, width?: number
): Promise<SpeakerAnimationSnapshot> {
  const captured = { ...draft, speakers: draft.speakers.map((speaker) => ({ ...speaker })) }
  validateAssets(captured, assets)
  const background = document.createElement('canvas')
  const foreground = document.createElement('canvas')
  try {
    const back = prepareCanvas(background, captured, width)
    const front = prepareCanvas(foreground, captured, width)
    const layout = createLayout(back.ctx, captured, assets, back.height)
    drawBackground(back.ctx, layout, assets)
    drawForeground(front.ctx, layout)
    const backgroundImage = background.toDataURL('image/png')
    const foregroundImage = foreground.toDataURL('image/png')
    const story = captured.aspect === '9:16'
    const geometry = captured.botsVisible
      ? await (await import('./speakerAnimation')).speakerBotGeometry(story ? 'default' : 'down-left', story ? 'classic' : 'lineup')
      : []
    return {
      width: background.width,
      height: background.height,
      background: backgroundImage,
      foreground: foregroundImage,
      bots: layout.bots.map((bot) => ({
        x: bot.x * back.scale,
        y: bot.y * back.scale,
        size: bot.size * back.scale,
        angle: bot.angle,
        ...geometry[bot.assetIndex]!,
        eyes: geometry[bot.assetIndex]!.eyes.map((eye) => ({ ...eye }))
      }))
    }
  } finally {
    background.width = background.height = foreground.width = foreground.height = 0
  }
}

export function speakerLineupFilename(aspect: AspectRatio, format: SpeakerExportFormat): string {
  return `grok-bot-lineup-${aspect.replace(':', 'x')}.${format === 'jpeg' ? 'jpg' : format}`
}
