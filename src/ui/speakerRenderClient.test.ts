import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadSpeakerAnimation, SpeakerRenderError } from './speakerRenderClient'
import type { SpeakerAnimationSnapshot } from '../shared/speakerAnimation'

const snapshot: SpeakerAnimationSnapshot = { width: 960, height: 960, background: '', foreground: '', bots: [] }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('speaker render client', () => {
  it('polls progress and downloads only the completed job', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ id: 'job-1', status: 'rendering', progress: 10 }))
      .mockResolvedValueOnce(json({ id: 'job-1', status: 'completed', progress: 100 }))
      .mockResolvedValueOnce(new Response('gif-bytes', { headers: { 'Content-Type': 'image/gif' } }))
    vi.stubGlobal('fetch', fetch)
    const progress = vi.fn()
    const result = downloadSpeakerAnimation(snapshot, 'gif', new AbortController().signal, progress)
    await vi.advanceTimersByTimeAsync(500)
    expect(await (await result).text()).toBe('gif-bytes')
    expect(progress.mock.calls).toEqual([[10], [100]])
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/speaker-renders', '/api/speaker-renders/job-1', '/api/speaker-renders/job-1/file'])
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ format: 'gif', snapshot })
  })

  it('cancels the server job even when aborted before creation finishes', async () => {
    let resolve!: (value: Response) => void
    const fetch = vi.fn().mockReturnValueOnce(new Promise<Response>((done) => { resolve = done })).mockResolvedValue(json({}))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const result = downloadSpeakerAnimation(snapshot, 'mp4', controller.signal, vi.fn())
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    resolve(json({ id: 'job-2', status: 'queued', progress: 0 }))
    await rejected
    expect(fetch).toHaveBeenLastCalledWith('/api/speaker-renders/job-2', expect.objectContaining({ method: 'DELETE' }))
  })

  it('cleans up a failed render before reporting the error', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'job-3', status: 'failed', progress: 50 })).mockResolvedValue(json({}))
    vi.stubGlobal('fetch', fetch)
    await expect(downloadSpeakerAnimation(snapshot, 'gif', new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'failed' })
    expect(fetch).toHaveBeenLastCalledWith('/api/speaker-renders/job-3', expect.objectContaining({ method: 'DELETE' }))
  })

  it('waits for cancellation cleanup before allowing an immediate retry', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ id: 'job-4', status: 'queued', progress: 0 }))
      .mockResolvedValueOnce(json({ id: 'job-4', status: 'cancelling', progress: 0 }))
      .mockResolvedValueOnce(json({ id: 'job-4', status: 'cancelled', progress: 0 }))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    let settled = false
    const result = downloadSpeakerAnimation(snapshot, 'gif', controller.signal, vi.fn())
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    void result.catch(() => { settled = true })
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(500)
    await rejected
    expect(settled).toBe(true)
    expect(fetch).toHaveBeenLastCalledWith('/api/speaker-renders/job-4', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it.each([[409, 'busy'], [503, 'unavailable'], [400, 'failed']])('reports HTTP %s as %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, status as number)))
    const result = downloadSpeakerAnimation(snapshot, 'mp4', new AbortController().signal, vi.fn())
    await expect(result).rejects.toEqual(new SpeakerRenderError(code as 'busy' | 'unavailable' | 'failed'))
  })

  it('reports unavailable service without starting a polling loop', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetch)
    await expect(downloadSpeakerAnimation(snapshot, 'gif', new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'unavailable' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
