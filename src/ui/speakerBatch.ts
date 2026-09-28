import { ASPECTS, speakerExportDimensions, speakerFilename, type AspectRatio, type SpeakerExportFormat } from './speaker'
import type { SpeakerPhoto, SpeakerVariant } from './speakerLibrary'
import { exportSpeaker, loadSpeakerBots, type SpeakerAssets } from './speakerRender'
import { downloadSpeakerAnimation } from './speakerRenderClient'
import { zipBlob, type ZipEntry } from './zip'

export interface SpeakerBatchProgress {
  completed: number
  total: number
  percent: number
  name: string
  aspect: AspectRatio
  format: SpeakerExportFormat
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, 0)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}

async function loadPortrait(source: string, signal: AbortSignal): Promise<HTMLImageElement> {
  signal.throwIfAborted()
  const portrait = new Image()
  const cancel = () => portrait.removeAttribute('src')
  signal.addEventListener('abort', cancel, { once: true })
  try {
    portrait.src = source
    await portrait.decode()
    signal.throwIfAborted()
    if (!portrait.naturalWidth || !portrait.naturalHeight) throw new Error('Empty speaker portrait')
    return portrait
  } catch (error) {
    portrait.removeAttribute('src')
    signal.throwIfAborted()
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

/** Toutes les variantes puis l'affiche commune, figées au clic et rendues l'une après l'autre. */
export async function exportSpeakersZip(
  variants: readonly SpeakerVariant[],
  photos: readonly SpeakerPhoto[],
  formats: readonly SpeakerExportFormat[],
  onProgress?: (progress: SpeakerBatchProgress) => void,
  signal?: AbortSignal,
  lineupTitle = 'Speakers & talks'
): Promise<Blob> {
  const lineupVariants = variants.map((variant) => ({ ...variant, draft: { ...variant.draft } }))
  const lineupPhotos = photos.map((photo) => ({ ...photo }))
  const photoSources = new Map(lineupPhotos.map((photo) => [photo.id, photo.src]))
  const snapshot = lineupVariants.map((variant) => ({
    draft: variant.draft,
    source: photoSources.get(variant.photoId)
  }))
  const outputFormats = [...new Set(formats)]
  const batchSignal = signal ?? new AbortController().signal
  batchSignal.throwIfAborted()
  if (!snapshot.length) throw new Error('No speakers to export')
  if (!outputFormats.length) throw new Error('No speaker formats selected')
  if (outputFormats.some((format) => !['png', 'jpeg', 'mp4', 'gif'].includes(format))) {
    throw new Error('Invalid speaker export format')
  }
  if (snapshot.some((variant) => !variant.draft.name.trim())) {
    throw new Error('Every speaker needs a name')
  }
  if (snapshot.some((variant) => !variant.source?.trim())) {
    throw new Error('Every speaker needs a portrait')
  }

  const entries: ZipEntry[] = []
  const total = (snapshot.length + 1) * ASPECTS.length * outputFormats.length
  const report = (name: string, aspect: AspectRatio, format: SpeakerExportFormat, fileProgress = 0) => {
    onProgress?.({
      completed: entries.length,
      total,
      percent: Math.floor((entries.length + fileProgress / 100) / total * 100),
      name,
      aspect,
      format
    })
  }
  report(snapshot[0]!.draft.name, ASPECTS[0]!.id, outputFormats[0]!)
  await pause(batchSignal)
  const bots = snapshot.some((variant) => variant.draft.botsVisible) ? await loadSpeakerBots() : []
  try {
    for (const [index, variant] of snapshot.entries()) {
      batchSignal.throwIfAborted()
      const portrait = await loadPortrait(variant.source!, batchSignal)
      try {
        const assets: SpeakerAssets = { portrait, bots }
        const prefix = String(index + 1).padStart(2, '0')
        for (const aspect of ASPECTS) {
          const draft = { ...variant.draft, aspect: aspect.id }
          for (const format of outputFormats) {
            batchSignal.throwIfAborted()
            report(draft.name, draft.aspect, format)
            await pause(batchSignal)
            let blob: Blob
            if (format === 'mp4' || format === 'gif') {
              const { createSpeakerAnimationSnapshot } = await import('./speakerAnimation')
              batchSignal.throwIfAborted()
              const size = speakerExportDimensions(draft.aspect, format)
              const composition = await createSpeakerAnimationSnapshot(draft, assets, size.width)
              batchSignal.throwIfAborted()
              blob = await downloadSpeakerAnimation(composition, format, batchSignal, (progress) => {
                report(draft.name, draft.aspect, format, Math.min(99, progress))
              })
            } else {
              blob = await exportSpeaker(draft, assets, format)
            }
            batchSignal.throwIfAborted()
            const data = new Uint8Array(await blob.arrayBuffer())
            batchSignal.throwIfAborted()
            // L'indice distingue les variantes dupliquées et les noms équivalents.
            entries.push({ name: `${prefix}-${speakerFilename(draft, format)}`, data })
            report(draft.name, draft.aspect, format)
          }
        }
      } finally {
        portrait.removeAttribute('src')
      }
    }
    batchSignal.throwIfAborted()
    report(lineupTitle, ASPECTS[0]!.id, outputFormats[0]!)
    const {
      createSpeakerLineupDraft,
      loadSpeakerLineupAssets,
      releaseSpeakerLineupAssets,
      exportSpeakerLineup,
      createSpeakerLineupAnimationSnapshot,
      speakerLineupFilename
    } = await import('./speakerLineupRender')
    batchSignal.throwIfAborted()
    const lineupDraft = createSpeakerLineupDraft(lineupVariants, lineupVariants[0]!.draft, lineupTitle)
    const lineupAssets = await loadSpeakerLineupAssets(lineupVariants, lineupPhotos, lineupVariants[0]!.draft.botsVisible, batchSignal)
    try {
      for (const aspect of ASPECTS) {
        const draft = { ...lineupDraft, aspect: aspect.id }
        for (const format of outputFormats) {
          batchSignal.throwIfAborted()
          report(lineupTitle, aspect.id, format)
          await pause(batchSignal)
          let blob: Blob
          if (format === 'mp4' || format === 'gif') {
            const size = speakerExportDimensions(aspect.id, format)
            const composition = await createSpeakerLineupAnimationSnapshot(draft, lineupAssets, size.width)
            batchSignal.throwIfAborted()
            blob = await downloadSpeakerAnimation(composition, format, batchSignal, (progress) => {
              report(lineupTitle, aspect.id, format, Math.min(99, progress))
            })
          } else {
            blob = await exportSpeakerLineup(draft, lineupAssets, format)
          }
          batchSignal.throwIfAborted()
          const data = new Uint8Array(await blob.arrayBuffer())
          batchSignal.throwIfAborted()
          entries.push({ name: `final-${speakerLineupFilename(aspect.id, format)}`, data })
          report(lineupTitle, aspect.id, format)
        }
      }
    } finally {
      releaseSpeakerLineupAssets(lineupAssets)
    }
    await pause(batchSignal)
    batchSignal.throwIfAborted()
    return zipBlob(entries)
  } finally {
    for (const bot of bots) bot.removeAttribute('src')
  }
}
