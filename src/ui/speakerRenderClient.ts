import type { SpeakerAnimationSnapshot } from '@/shared/speakerAnimation'

export class SpeakerRenderError extends Error {
  constructor(readonly code: 'unavailable' | 'busy' | 'failed') {
    super(code)
  }
}

interface RenderStatus {
  id: string
  status: 'queued' | 'rendering' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
  progress: number
}

const API = `${import.meta.env.BASE_URL}api/speaker-renders`

function aborted(signal: AbortSignal) {
  signal.throwIfAborted()
}

async function response(url: string, init: RequestInit, signal: AbortSignal) {
  try {
    const result = await fetch(url, { ...init, signal })
    if (!result.ok) {
      throw new SpeakerRenderError(result.status === 409 ? 'busy' : result.status >= 500 ? 'unavailable' : 'failed')
    }
    return result
  } catch (error) {
    aborted(signal)
    if (error instanceof SpeakerRenderError) throw error
    throw new SpeakerRenderError('unavailable')
  }
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, 500)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}

/** Le serveur garde une copie du travail, indépendante des prochaines éditions. */
export async function downloadSpeakerAnimation(
  snapshot: SpeakerAnimationSnapshot,
  format: 'mp4' | 'gif',
  signal: AbortSignal,
  progress: (value: number) => void
): Promise<Blob> {
  aborted(signal)
  let jobId: string | undefined
  let complete = false
  try {
    // Laisser la création répondre même en cas d'annulation : son id permet de
    // supprimer le travail, au lieu d'abandonner un rendu orphelin sur le serveur.
    const creationSignal = AbortSignal.timeout(30_000)
    const created = await response(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, snapshot })
    }, creationSignal)
    let job = await created.json() as RenderStatus
    jobId = job.id
    if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new SpeakerRenderError('failed')
    aborted(signal)
    while (true) {
      progress(Math.max(0, Math.min(100, Math.round(job.progress))))
      if (job.status === 'completed') break
      if (job.status === 'failed') throw new SpeakerRenderError('failed')
      if (job.status === 'cancelled' || job.status === 'cancelling') throw new DOMException('Cancelled', 'AbortError')
      await pause(signal)
      job = await (await response(`${API}/${jobId}`, {}, signal)).json() as RenderStatus
    }
    const file = await response(`${API}/${jobId}/file`, {}, signal)
    const blob = await file.blob()
    aborted(signal)
    complete = true
    return blob
  } finally {
    if (jobId && !complete) {
      // DELETE acknowledges cancellation before Chrome/FFmpeg finish stopping.
      // Keep the button busy until the server releases its single render slot.
      const cleanupSignal = AbortSignal.timeout(30_000)
      try {
        const cancelled = await fetch(`${API}/${jobId}`, {
          method: 'DELETE', keepalive: true, signal: cleanupSignal
        })
        if (cancelled.ok) {
          let state = await cancelled.json() as RenderStatus
          while (['queued', 'rendering', 'cancelling'].includes(state.status)) {
            await pause(cleanupSignal)
            const status = await fetch(`${API}/${jobId}`, { signal: cleanupSignal })
            if (!status.ok) break
            state = await status.json() as RenderStatus
          }
        }
      } catch { /* A disconnected service must not prevent leaving the editor. */ }
    }
  }
}
