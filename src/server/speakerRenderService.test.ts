import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  createSpeakerRenderServer, renderDimensions, SpeakerRenderManager, validateRenderRequest,
  type Renderer, type RenderRequest
} from '../../server/speakerRenderService.ts'

// The request validator reads dimensions from IHDR; image decoding belongs to Chrome.
function layer(width = 2400, height = 1800) {
  const header = Buffer.from('89504e470d0a1a0a0000000d494844520000000000000000080600000000000000', 'hex')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return `data:image/png;base64,${header.toString('base64')}`
}
function request(format: 'mp4' | 'gif' = 'mp4', width = 2400, height = 1800): RenderRequest {
  return { format, filename: 'speaker-example', snapshot: { width, height, background: layer(width, height), foreground: layer(width, height), bots: [{
    x: 20, y: 1700, size: 900, angle: -32, color: '#ffffff', bodyPath: 'M 0 0 L 10 10 Z', viewBox: '-50 -50 100 100',
    eyes: [{ d: 'M 0 0 L 2 2', matrix: 'matrix(1 0 0 1 0 0)', alpha: 1 }]
  }] } }
}
const managers: SpeakerRenderManager[] = []
const directories: string[] = []
const servers: ReturnType<typeof createSpeakerRenderServer>['server'][] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })))
  await Promise.all(managers.splice(0).map((manager) => manager.close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  vi.restoreAllMocks()
})
async function manager(renderer: Renderer, options: { ttlMs?: number; now?: () => number } = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'bloub-service-test-'))
  directories.push(temporaryRoot)
  const instance = new SpeakerRenderManager({ renderer, temporaryRoot, ...options })
  managers.push(instance)
  return { instance, temporaryRoot }
}
const successful: Renderer = async ({ outputPath, progress }) => {
  progress(40)
  await writeFile(outputPath, 'rendered-animation')
}
/** Exercise the real HTTP handler without requiring permission to bind a port. */
async function send(server: ReturnType<typeof createSpeakerRenderServer>['server'], path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const req = Object.assign(Readable.from(options.body ? [Buffer.from(options.body)] : []), {
    url: path, method: options.method ?? 'GET', headers: { host: '127.0.0.1:5191', ...options.headers }
  })
  const chunks: Buffer[] = []
  let status = 0
  let headers: Record<string, string | number> = {}
  const res = Object.assign(new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } }), {
    headersSent: false,
    writeHead(code: number, values: Record<string, string | number>) { status = code; headers = values; this.headersSent = true; return this }
  })
  const finished = new Promise<void>((resolve, reject) => { res.once('finish', resolve); res.once('error', reject) })
  server.emit('request', req, res)
  await finished
  const body = Buffer.concat(chunks).toString('utf8')
  return { status, headers, body, json: () => JSON.parse(body) }
}

describe('speaker render requests', () => {
  it('allows native dimensions and gives GIFs their own resolution and frame rate', () => {
    for (const [width, height, gifWidth, gifHeight] of [[2400, 1800, 960, 720], [2000, 2000, 960, 960], [1080, 1920, 540, 960]]) {
      expect(renderDimensions(validateRenderRequest(request('mp4', width, height)))).toEqual({ width, height, fps: 30 })
      expect(renderDimensions(validateRenderRequest(request('gif', width, height)))).toEqual({ width: gifWidth, height: gifHeight, fps: 15 })
      expect(renderDimensions(validateRenderRequest(request('gif', gifWidth, gifHeight)))).toEqual({ width: gifWidth, height: gifHeight, fps: 15 })
    }
  })
  it('rejects URLs, mismatched layers, script-bearing SVG values and oversized inputs', () => {
    const cases = [
      { ...request(), format: 'html' },
      { ...request(), snapshot: { ...request().snapshot, background: 'https://example.com/portrait.png' } },
      { ...request(), snapshot: { ...request().snapshot, foreground: layer(2000, 2000) } },
      { ...request(), snapshot: { ...request().snapshot, width: 100000 } },
      { ...request(), snapshot: { ...request().snapshot, bots: [{ ...request().snapshot.bots[0], color: 'red" onload="alert(1)' }] } },
      { ...request(), snapshot: { ...request().snapshot, bots: [{ ...request().snapshot.bots[0], bodyPath: 'M0 0</path><script>alert(1)</script>' }] } }
    ]
    for (const value of cases) expect(() => validateRenderRequest(value)).toThrow()
  })
  it('freezes a copy of geometry and allows bots to be hidden', () => {
    const input = request()
    const validated = validateRenderRequest(input)
    input.snapshot.bots[0]!.x = 900
    input.snapshot.bots[0]!.eyes[0]!.d = 'M 1 1'
    expect(validated.snapshot.bots[0]!.x).toBe(20)
    expect(validated.snapshot.bots[0]!.eyes[0]!.d).toBe('M 0 0 L 2 2')
    expect(validateRenderRequest({ ...input, snapshot: { ...input.snapshot, bots: [] } }).snapshot.bots).toEqual([])
  })
  it('validates neutral eye paths, matrices, alpha and eye counts', () => {
    const input = request()
    const bot = input.snapshot.bots[0]!
    const eye = bot.eyes[0]!
    for (const eyes of [
      undefined, [], [{ ...eye, d: 'M0 0</path><script>alert(1)</script>' }],
      [{ ...eye, d: 'M 1e20 0' }], [{ ...eye, matrix: 'rotate(30)' }],
      [{ ...eye, matrix: 'matrix(1 0 0 1 0 10001)' }],
      [{ ...eye, alpha: -0.1 }], [{ ...eye, alpha: 1.1 }], [{ ...eye, alpha: NaN }],
      [eye, eye, eye]
    ]) {
      expect(() => validateRenderRequest({ ...input, snapshot: { ...input.snapshot, bots: [{ ...bot, eyes }] } })).toThrow()
    }
  })
  it('copies only known snapshot, bot and eye properties', () => {
    const input = request()
    const bot = input.snapshot.bots[0]!
    const validated = validateRenderRequest({
      ...input,
      snapshot: {
        ...input.snapshot, html: '<script>alert(1)</script>',
        bots: [{ ...bot, target: 'body', eyes: bot.eyes.map((eye) => ({ ...eye, onload: 'alert(1)' })) }]
      }
    })
    expect(validated).toEqual(input)
  })
})

describe('speaker render lifecycle', () => {
  it('keeps one active render, reports progress and deletes source layers on success', async () => {
    let finish!: () => void
    let entered!: () => void
    const rendering = new Promise<void>((resolve) => { entered = resolve })
    const { instance, temporaryRoot } = await manager(async (task) => {
      task.progress(43)
      task.progress(20)
      entered()
      await new Promise<void>((resolve) => { finish = resolve })
      await successful(task)
    })
    const initial = instance.start(request())
    await rendering
    expect(initial.status).toBe('queued')
    expect(instance.get(initial.id)).toMatchObject({ status: 'rendering', progress: 43 })
    expect(() => instance.start(request())).toThrow('Another speaker card is rendering')
    finish()
    await instance.waitForSettled(initial.id)
    expect(instance.get(initial.id)).toMatchObject({ status: 'completed', progress: 100, downloadUrl: `/api/speaker-renders/${initial.id}/file` })
    expect(await readFile(instance.file(initial.id).path, 'utf8')).toBe('rendered-animation')
    const [jobDirectory] = await readdir(temporaryRoot)
    expect(await readdir(join(temporaryRoot, jobDirectory!))).toEqual(['speaker.mp4'])
    expect(instance.start(request('gif')).format).toBe('gif')
  })
  it('aborts active work, cleans all temporary files and releases the slot', async () => {
    let entered!: () => void
    const rendering = new Promise<void>((resolve) => { entered = resolve })
    let attempts = 0
    const { instance, temporaryRoot } = await manager(async (task) => {
      if (attempts++ > 0) return successful(task)
      const { signal, outputPath } = task
      await writeFile(outputPath, 'partial')
      entered()
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    const job = instance.start(request())
    await rendering
    expect(instance.cancel(job.id).status).toBe('cancelling')
    expect(() => instance.start(request())).toThrow()
    while (instance.get(job.id).status === 'cancelling') await new Promise<void>((resolve) => setImmediate(resolve))
    expect(instance.get(job.id).status).toBe('cancelled')
    expect(await readdir(temporaryRoot)).toEqual([])
    expect(() => instance.file(job.id)).toThrow('not ready')
    const retry = instance.start(request())
    await instance.waitForSettled(retry.id)
    expect(instance.get(retry.id).status).toBe('completed')
  })
  it('cleans failed work and permits a successful retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let attempts = 0
    const { instance, temporaryRoot } = await manager(async (task) => {
      if (attempts++ === 0) { await writeFile(task.outputPath, 'partial'); throw new Error('Chrome unavailable') }
      await successful(task)
    })
    const failed = instance.start(request())
    await instance.waitForSettled(failed.id)
    expect(instance.get(failed.id)).toMatchObject({ status: 'failed', error: { code: 'render_failed' } })
    expect(await readdir(temporaryRoot)).toEqual([])
    const retry = instance.start(request())
    await instance.waitForSettled(retry.id)
    expect(instance.get(retry.id).status).toBe('completed')
  })
  it('expires downloads after fifteen minutes and removes the files', async () => {
    let now = 1000
    const { instance, temporaryRoot } = await manager(successful, { now: () => now })
    const job = instance.start(request())
    await instance.waitForSettled(job.id)
    expect(instance.get(job.id).expiresAt).toBe(901000)
    now = 901001
    expect(() => instance.file(job.id)).toThrow('expired')
    await instance.removeExpired()
    expect(await readdir(temporaryRoot)).toEqual([])
  })
})

describe('speaker render HTTP API', () => {
  it('starts, polls and downloads renders while rejecting cross-origin writes', async () => {
    const { instance } = await manager(successful)
    const { server } = createSpeakerRenderServer({ manager: instance, allowedOrigins: ['http://localhost:5190'] })
    servers.push(server)
    const base = '/api/speaker-renders'
    expect((await send(server, `${base}/health`)).status).toBe(200)
    const denied = await send(server, base, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' }, body: JSON.stringify(request()) })
    expect(denied.status).toBe(403)
    const badType = await send(server, base, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
    expect(badType.status).toBe(415)
    const created = await send(server, base, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5190' }, body: JSON.stringify(request('gif')) })
    expect(created.status).toBe(202)
    const job = created.json() as { id: string }
    await instance.waitForSettled(job.id)
    expect((await send(server, `${base}/${job.id}`)).json()).toMatchObject({ status: 'completed' })
    const downloaded = await send(server, `${base}/${job.id}/file`)
    expect(downloaded.headers['Content-Type']).toBe('image/gif')
    expect(downloaded.headers['Content-Disposition']).toContain('speaker-example.gif')
    expect(downloaded.body).toBe('rendered-animation')
  })
})
