import type { SpeakerAnimationBot, SpeakerAnimationEye, SpeakerAnimationSnapshot } from '../shared/speakerAnimation'
import type { SpeakerDraft } from './speaker'
import { renderSpeakerLayers, speakerBotPlacements, speakerBotSvgs, type SpeakerAssets, type SpeakerBotCollection, type SpeakerBotDirection } from './speakerRender'

type BotGeometry = Pick<SpeakerAnimationBot, 'color' | 'bodyPath' | 'eyes' | 'viewBox'>
const geometries = new Map<`${SpeakerBotDirection}:${SpeakerBotCollection}`, Promise<BotGeometry[]>>()

function eyesFromSvg(svg: Element): SpeakerAnimationEye[] {
  const eyes = Array.from(svg.querySelectorAll('mask path[fill="#000"]'), (eye) => ({
    d: eye.getAttribute('d') ?? '',
    matrix: eye.getAttribute('transform') ?? '',
    alpha: Number(eye.getAttribute('opacity') ?? 1)
  }))
  if (eyes.length !== 2 || eyes.some((eye) => !eye.d || !eye.matrix)) throw new Error('Speaker bot eyes are unavailable')
  return eyes
}

/** Parse the actual component once per direction and collection, preserving its silhouette. */
export function speakerBotGeometry(
  direction: SpeakerBotDirection = 'default',
  collection: SpeakerBotCollection = 'classic'
): Promise<BotGeometry[]> {
  const key = `${direction}:${collection}` as const
  const cached = geometries.get(key)
  if (cached) return cached
  const pending = speakerBotSvgs(direction, collection).then((svgs) => svgs.map((markup) => {
    const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
    const mask = svg.querySelector('mask')
    const bodyPath = mask?.querySelector('path[fill="#fff"]')?.getAttribute('d')
    const color = svg.querySelector('rect')?.getAttribute('fill')
    const viewBox = svg.getAttribute('viewBox')
    if (!mask || !bodyPath || !color || !viewBox) throw new Error('Speaker bot geometry is unavailable')
    return { bodyPath, color, viewBox, eyes: eyesFromSvg(svg) }
  })).catch((error: unknown) => {
    geometries.delete(key)
    throw error
  })
  geometries.set(key, pending)
  return pending
}

/** Capture immutable layer pixels and bot geometry at the requested image size. */
export async function createSpeakerAnimationSnapshot(
  draft: SpeakerDraft,
  assets: SpeakerAssets,
  width?: number
): Promise<SpeakerAnimationSnapshot> {
  // Freeze controls before awaiting geometry: a fast slider change cannot mix frames.
  const captured = { ...draft }
  const { background, foreground } = renderSpeakerLayers(captured, assets, width)
  try {
    const geometry = captured.botsVisible ? await speakerBotGeometry() : []
    return {
      width: background.width,
      height: background.height,
      background: background.toDataURL('image/png'),
      foreground: foreground.toDataURL('image/png'),
      bots: speakerBotPlacements(captured, background.width).map((placement, index) => ({
        ...placement,
        ...geometry[index]!,
        // Callers may clone, serialize or dispose a snapshot independently.
        eyes: geometry[index]!.eyes.map((eye) => ({ ...eye }))
      }))
    }
  } finally {
    background.width = background.height = foreground.width = foreground.height = 0
  }
}
