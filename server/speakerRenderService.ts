import { createReadStream, existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { createSpeakerComposition, SPEAKER_ANIMATION_MAX_BOTS, type SpeakerAnimationSnapshot } from '../src/shared/speakerAnimation.ts'
import { PrintExportError, PrintExportService, type PrintRenderer } from './printExport.ts'

const TTL_MS = 15 * 60 * 1000
const MAX_BODY_BYTES = 48 * 1024 * 1024
const MAX_LAYER_BYTES = 16 * 1024 * 1024
const NATIVE_DIMENSIONS = new Set(['2400x1800', '2000x2000', '1080x1920'])
const GIF_DIMENSIONS = new Set(['960x720', '960x960', '540x960'])
const NUMBER = '[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?'
const NUMBERS = new RegExp(NUMBER, 'g')
const MATRIX = new RegExp(`^matrix\\(\\s*${NUMBER}(?:[ ,]+${NUMBER}){5}\\s*\\)$`)
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export type AnimatedFormat = 'mp4' | 'gif'
export type RenderStatus = 'queued' | 'rendering' | 'cancelling' | 'completed' | 'cancelled' | 'failed'
export interface RenderRequest {
  format: AnimatedFormat
  snapshot: SpeakerAnimationSnapshot
  filename?: string
}
export interface RenderState {
  id: string
  status: RenderStatus
  progress: number
  format: AnimatedFormat
  width: number
  height: number
  fps: number
  error?: { code: string; message: string }
  downloadUrl?: string
  expiresAt?: number
}
interface RenderTask {
  request: RenderRequest
  projectDir: string
  outputPath: string
  signal: AbortSignal
  progress: (value: number) => void
}
export type Renderer = (task: RenderTask) => Promise<void>
interface InternalJob {
  state: RenderState
  controller: AbortController
  directory?: string
  outputPath?: string
  filename: string
  settled?: Promise<void>
  expiresAt?: number
}

export class RenderHttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
function invalid(message: string): never {
  throw new RenderHttpError(400, 'invalid_request', message)
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
function safePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100_000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]+$/.test(value)) return false
  return (value.match(NUMBERS) ?? []).every((part) => bounded(Number(part), -100_000, 100_000))
}
function safeMatrix(value: unknown): value is string {
  return typeof value === 'string' && MATRIX.test(value)
    && (value.match(NUMBERS) ?? []).every((part) => bounded(Number(part), -10_000, 10_000))
}
function validatedEyes(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) invalid('Invalid eye geometry.')
  return value.map((eye) => {
    if (!record(eye) || !safePath(eye.d) || !safeMatrix(eye.matrix) || !bounded(eye.alpha, 0, 1)) invalid('Invalid eye geometry.')
    return { d: eye.d, matrix: eye.matrix, alpha: eye.alpha }
  })
}
function validPng(value: unknown, width: number, height: number): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_LAYER_BYTES * 4 / 3) + 22
    || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  const png = Buffer.from(value.slice(22), 'base64')
  return png.length >= 33 && png.length <= MAX_LAYER_BYTES
    && png.subarray(0, 8).equals(PNG_SIGNATURE)
    && png.readUInt32BE(8) === 13 && png.toString('ascii', 12, 16) === 'IHDR'
    && png.readUInt32BE(16) === width && png.readUInt32BE(20) === height
}

/** Only our raster layers and SVG geometry cross the service boundary, never HTML or URLs. */
export function validateRenderRequest(value: unknown): RenderRequest {
  if (!record(value) || (value.format !== 'mp4' && value.format !== 'gif') || !record(value.snapshot)) invalid('Expected an MP4 or GIF render and a speaker snapshot.')
  const snapshot = value.snapshot
  const { width, height } = snapshot
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || !(NATIVE_DIMENSIONS.has(`${width}x${height}`) || (value.format === 'gif' && GIF_DIMENSIONS.has(`${width}x${height}`)))) invalid('Unsupported speaker dimensions.')
  const w = width as number
  const h = height as number
  if (!validPng(snapshot.background, w, h) || !validPng(snapshot.foreground, w, h)) invalid('Both static layers must be PNG images with the speaker dimensions.')
  if (!Array.isArray(snapshot.bots) || snapshot.bots.length > SPEAKER_ANIMATION_MAX_BOTS) invalid(`Expected up to ${SPEAKER_ANIMATION_MAX_BOTS} bots.`)
  const bots: SpeakerAnimationSnapshot['bots'] = []
  for (const bot of snapshot.bots) {
    if (!record(bot) || !bounded(bot.x, -2 * w, 3 * w) || !bounded(bot.y, -2 * h, 3 * h)
      || !bounded(bot.size, 1, 4 * Math.max(w, h)) || !bounded(bot.angle, -360, 360)
      || typeof bot.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(bot.color)
      || !safePath(bot.bodyPath) || typeof bot.viewBox !== 'string'
      || !new RegExp(`^\\s*${NUMBER}(?:[ ,]+${NUMBER}){3}\\s*$`).test(bot.viewBox)) invalid('Invalid bot geometry.')
    const viewBox = bot.viewBox.match(NUMBERS)!.map(Number)
    if (!viewBox.every((part) => bounded(part, -10_000, 10_000)) || viewBox[2]! <= 0 || viewBox[3]! <= 0) invalid('Invalid SVG view box.')
    const eyes = validatedEyes(bot.eyes)
    bots.push({
      x: bot.x, y: bot.y, size: bot.size, angle: bot.angle, color: bot.color,
      bodyPath: bot.bodyPath, viewBox: bot.viewBox, eyes
    })
  }
  if (value.filename !== undefined && (typeof value.filename !== 'string' || value.filename.length > 180)) invalid('Invalid filename.')
  // Copy only allowed properties: an in-flight job never follows subsequent editor changes.
  return {
    format: value.format,
    filename: value.filename as string | undefined,
    snapshot: { width: w, height: h, background: snapshot.background, foreground: snapshot.foreground, bots }
  }
}

export function renderDimensions(request: RenderRequest): { width: number; height: number; fps: number } {
  const { width, height } = request.snapshot
  const scale = request.format === 'gif' ? Math.min(1, 960 / Math.max(width, height)) : 1
  return { width: Math.round(width * scale), height: Math.round(height * scale), fps: request.format === 'gif' ? 15 : 30 }
}

/** Importing Producer happens only when an animated export is requested. */
export const renderWithHyperframes: Renderer = async ({ request, projectDir, outputPath, signal, progress }) => {
  signal.throwIfAborted()
  if (!process.env.HYPERFRAMES_BROWSER_PATH && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
    const chromeCandidates = process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : process.platform === 'win32'
        ? [join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')]
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    const chrome = chromeCandidates.find((candidate) => existsSync(candidate))
    if (chrome) process.env.HYPERFRAMES_BROWSER_PATH = chrome
  }
  // A completed/cancelled job must release its browser, including when the
  // service exits. Ordinary screenshots preserve the SVG mask rendering.
  process.env.PRODUCER_ENABLE_BROWSER_POOL = 'false'
  process.env.PRODUCER_FORCE_SCREENSHOT = 'true'
  process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE = 'false'
  const [{ createRenderJob, executeRenderJob }, gsapSource] = await Promise.all([
    import('@hyperframes/producer'),
    readFile(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'), 'utf8')
  ])
  signal.throwIfAborted()
  const { width, height, fps } = renderDimensions(request)
  // Producer captures the dimensions declared by the composition. Its resolution
  // presets only support upscaling, so author a proportionally scaled GIF scene.
  const scale = width / request.snapshot.width
  const composition = {
    ...request.snapshot, width, height, background: 'background.png', foreground: 'foreground.png',
    bots: request.snapshot.bots.map((bot) => ({ ...bot, x: bot.x * scale, y: bot.y * scale, size: bot.size * scale }))
  }
  await Promise.all([
    writeFile(join(projectDir, 'background.png'), Buffer.from(request.snapshot.background.slice(22), 'base64')),
    writeFile(join(projectDir, 'foreground.png'), Buffer.from(request.snapshot.foreground.slice(22), 'base64')),
    writeFile(join(projectDir, 'index.html'), createSpeakerComposition(composition, gsapSource))
  ])
  const job = createRenderJob({
    format: request.format, fps, quality: 'high',
    workers: 1, hdrMode: 'force-sdr', gifLoop: 0
  })
  await executeRenderJob(job, projectDir, outputPath, (current) => progress(current.progress), signal)
}

export class SpeakerRenderManager {
  private jobs = new Map<string, InternalJob>()
  private activeId: string | undefined
  private renderer: Renderer
  private ttlMs: number
  private temporaryRoot: string
  private now: () => number
  private timer: ReturnType<typeof setInterval>
  private closing = false
  constructor(options: { renderer?: Renderer; ttlMs?: number; temporaryRoot?: string; now?: () => number } = {}) {
    this.renderer = options.renderer ?? renderWithHyperframes
    this.ttlMs = options.ttlMs ?? TTL_MS
    this.temporaryRoot = options.temporaryRoot ?? tmpdir()
    this.now = options.now ?? Date.now
    this.timer = setInterval(() => { void this.removeExpired().catch((error) => console.error('Render cleanup failed:', error)) }, 30_000)
    this.timer.unref()
  }
  start(input: unknown): RenderState {
    if (this.closing) throw new RenderHttpError(503, 'unavailable', 'The render service is shutting down.')
    if (this.activeId) throw new RenderHttpError(409, 'busy', 'Another speaker card is rendering. Wait for it to finish or cancel it.')
    const request = validateRenderRequest(input)
    const id = randomUUID()
    const state: RenderState = { id, status: 'queued', progress: 0, format: request.format, ...renderDimensions(request) }
    const filename = (request.filename ?? 'speaker-card').replace(/\.(?:mp4|gif)$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'speaker-card'
    const job: InternalJob = { state, filename: `${filename}.${request.format}`, controller: new AbortController() }
    this.jobs.set(id, job)
    this.activeId = id
    job.settled = this.execute(job, request)
    return { ...state }
  }
  private async execute(job: InternalJob, request: RenderRequest): Promise<void> {
    try {
      job.directory = await mkdtemp(join(this.temporaryRoot, 'bloub-speaker-'))
      const projectDir = join(job.directory, 'project')
      await mkdir(projectDir)
      job.outputPath = join(job.directory, `speaker.${request.format}`)
      job.controller.signal.throwIfAborted()
      job.state.status = 'rendering'
      await this.renderer({ request, projectDir, outputPath: job.outputPath, signal: job.controller.signal, progress: (value) => {
        if (Number.isFinite(value)) job.state.progress = Math.max(job.state.progress, Math.min(99, Math.max(0, value)))
      } })
      job.controller.signal.throwIfAborted()
      if (!(await stat(job.outputPath)).size) throw new Error('Renderer returned an empty file.')
      await rm(projectDir, { recursive: true, force: true })
      job.controller.signal.throwIfAborted()
      job.state.status = 'completed'
      job.state.progress = 100
      job.state.downloadUrl = `/api/speaker-renders/${job.state.id}/file`
      job.expiresAt = this.now() + this.ttlMs
      job.state.expiresAt = job.expiresAt
    } catch (error) {
      if (!job.controller.signal.aborted) {
        job.state.error = { code: 'render_failed', message: 'The animation could not be rendered. Check that Chrome and FFmpeg are installed, then retry.' }
        console.error(`Speaker render ${job.state.id} failed:`, error)
      }
      if (job.directory) {
        try {
          await rm(job.directory, { recursive: true, force: true })
          job.directory = undefined
        } catch (cleanupError) {
          // Retain the directory for the periodic cleanup retry, while removing
          // download access immediately. Cleanup failures must not crash Node.
          console.error(`Speaker render ${job.state.id} cleanup failed:`, cleanupError)
        }
      }
      job.outputPath = undefined
      job.expiresAt = this.now() + this.ttlMs
      // Terminal status means cleanup has finished and the single render slot
      // can be released synchronously by finally before the next poll/retry.
      job.state.status = job.controller.signal.aborted ? 'cancelled' : 'failed'
      if (job.state.status === 'cancelled') job.state.error = undefined
    } finally {
      if (this.activeId === job.state.id) this.activeId = undefined
    }
  }
  get(id: string): RenderState {
    return { ...this.lookup(id).state }
  }
  private lookup(id: string): InternalJob {
    const job = this.jobs.get(id)
    if (!job || (job.expiresAt !== undefined && job.expiresAt <= this.now())) throw new RenderHttpError(404, 'not_found', 'This render is missing or has expired.')
    return job
  }
  cancel(id: string): RenderState {
    const job = this.lookup(id)
    if (job.state.status === 'queued' || job.state.status === 'rendering') {
      job.state.status = 'cancelling'
      job.controller.abort()
    }
    return { ...job.state }
  }
  file(id: string): { path: string; format: AnimatedFormat; filename: string } {
    const job = this.lookup(id)
    if (job.state.status !== 'completed' || !job.outputPath) throw new RenderHttpError(409, 'not_ready', 'This render is not ready to download.')
    return { path: job.outputPath, format: job.state.format, filename: job.filename }
  }
  async waitForSettled(id: string): Promise<void> {
    await this.jobs.get(id)?.settled
  }
  async removeExpired(): Promise<void> {
    for (const [id, job] of this.jobs) {
      if (job.expiresAt !== undefined && job.expiresAt <= this.now()) {
        if (job.directory) await rm(job.directory, { recursive: true, force: true })
        this.jobs.delete(id)
      }
    }
  }
  async close(): Promise<void> {
    this.closing = true
    clearInterval(this.timer)
    for (const job of this.jobs.values()) job.controller.abort()
    await Promise.all([...this.jobs.values()].map((job) => job.settled))
    await Promise.all([...this.jobs.values()].map((job) => job.directory ? rm(job.directory, { recursive: true, force: true }) : undefined))
    this.jobs.clear()
  }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new RenderHttpError(415, 'content_type', 'Use application/json.')
  const declaredLength = Number(req.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new RenderHttpError(413, 'too_large', 'The speaker snapshot is too large.')
  let length = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    length += chunk.length
    if (length > MAX_BODY_BYTES) throw new RenderHttpError(413, 'too_large', 'The speaker snapshot is too large.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new RenderHttpError(400, 'invalid_json', 'The request is not valid JSON.') }
}
function checkOrigin(req: IncomingMessage, allowedOrigins: Set<string>): void {
  const origin = req.headers.origin
  const hostname = new URL(`http://${req.headers.host ?? 'invalid'}`).hostname
  // Browser requests must be same-origin (including the explicit Vite frontend origin).
  // Requests with no Origin are useful for local CLI checks; Fetch Metadata still denies cross-site requests.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    || req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}` && !allowedOrigins.has(origin))) {
    throw new RenderHttpError(403, 'forbidden_origin', 'Use the render service from the Bloub app.')
  }
}
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
}
export function createSpeakerRenderServer(options: { manager?: SpeakerRenderManager; printRenderer?: PrintRenderer; distDirectory?: string; allowedOrigins?: string[] } = {}) {
  const manager = options.manager ?? new SpeakerRenderManager()
  const printService = new PrintExportService(options.printRenderer)
  const allowedOrigins = new Set(options.allowedOrigins ?? [])
  const dist = options.distDirectory ? resolve(options.distDirectory) : undefined
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      if (path.startsWith('/api/')) {
        checkOrigin(req, allowedOrigins)
        if (path === '/api/print-export') {
          if (req.method !== 'POST') throw new RenderHttpError(405, 'method_not_allowed', 'Use POST for a CMYK print export.')
          const controller = new AbortController()
          const disconnect = () => { if (!res.writableEnded) controller.abort() }
          res.once('close', disconnect)
          req.once('aborted', disconnect)
          try {
            const pdf = await printService.render(await readJson(req), controller.signal)
            if (controller.signal.aborted) return
            res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': 'attachment; filename="artwork-cmyk.pdf"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
            res.end(pdf)
            return
          } catch (error) {
            if (controller.signal.aborted) return
            throw error
          } finally {
            res.removeListener('close', disconnect)
            req.removeListener('aborted', disconnect)
          }
        }
        if (path === '/api/speaker-renders/health' && req.method === 'GET') return json(res, 200, { ready: true })
        if (path === '/api/speaker-renders' && req.method === 'POST') return json(res, 202, manager.start(await readJson(req)))
        const match = /^\/api\/speaker-renders\/([0-9a-f-]{36})(\/file)?$/.exec(path)
        if (!match) throw new RenderHttpError(404, 'not_found', 'Unknown API endpoint.')
        const id = match[1]!
        if (!match[2] && req.method === 'GET') return json(res, 200, manager.get(id))
        if (!match[2] && req.method === 'DELETE') return json(res, 202, manager.cancel(id))
        if (match[2] && req.method === 'GET') {
          const file = manager.file(id)
          const info = await stat(file.path)
          res.writeHead(200, { 'Content-Type': file.format === 'mp4' ? 'video/mp4' : 'image/gif', 'Content-Length': info.size, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
          const stream = createReadStream(file.path)
          stream.on('error', () => res.destroy())
          res.once('close', () => stream.destroy())
          stream.pipe(res)
          return
        }
        throw new RenderHttpError(405, 'method_not_allowed', 'Unsupported method.')
      }
      if (!dist || (req.method !== 'GET' && req.method !== 'HEAD')) throw new RenderHttpError(404, 'not_found', 'Not found.')
      const decodedPath = decodeURIComponent(path)
      const filePath = resolve(dist, `.${decodedPath}`)
      if (filePath !== dist && !filePath.startsWith(dist + sep)) throw new RenderHttpError(404, 'not_found', 'Not found.')
      let target = filePath
      let info = await stat(target).catch(() => undefined)
      if (!info?.isFile()) {
        if (extname(decodedPath)) throw new RenderHttpError(404, 'not_found', 'Not found.')
        target = join(dist, 'index.html')
        info = await stat(target).catch(() => undefined)
      }
      if (!info?.isFile()) throw new RenderHttpError(404, 'not_built', 'Build the frontend with pnpm build first.')
      res.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
      if (req.method === 'HEAD') { res.end(); return }
      const stream = createReadStream(target)
      stream.on('error', () => res.destroy())
      res.once('close', () => stream.destroy())
      stream.pipe(res)
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return }
      if (error instanceof RenderHttpError || error instanceof PrintExportError) json(res, error.status, { error: { code: error.code, message: error.message } })
      else {
        console.error('Speaker service request failed:', error)
        json(res, 500, { error: { code: 'internal_error', message: 'The render service could not complete this request.' } })
      }
    }
  })
  server.requestTimeout = 120_000
  server.once('close', () => printService.close())
  return { server, manager, printService }
}
