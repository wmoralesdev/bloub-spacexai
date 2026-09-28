// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { PrintExportError, PrintExportService, normalizePrintPage, printOutputIntent, sanitizePrintSvg, validatePrintRequest, type PrintRenderer } from '../../server/printExport.ts'
import { createSpeakerRenderServer } from '../../server/speakerRenderService.ts'

const art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fb299d"/></svg>'
const request = () => ({ svg: art, widthMm: 70, heightMm: 70 })
const services: ReturnType<typeof createSpeakerRenderServer>[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(async ({ server, manager }) => {
    server.emit('close')
    await manager.close()
  }))
  vi.restoreAllMocks()
})

function server(renderer: PrintRenderer) {
  const service = createSpeakerRenderServer({ printRenderer: renderer, allowedOrigins: ['http://localhost:5190'] })
  services.push(service)
  return service.server
}
function send(instance: ReturnType<typeof server>, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(options.body ?? request()))]), {
    url: '/api/print-export', method: options.method ?? 'POST', headers: { host: '127.0.0.1:5191', 'content-type': 'application/json', ...options.headers }
  })
  const chunks: Buffer[] = []
  let status = 0
  let headers: Record<string, string | number> = {}
  const res = Object.assign(new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } }), {
    headersSent: false,
    writeHead(code: number, values: Record<string, string | number>) { status = code; headers = values; this.headersSent = true; return this }
  })
  const result = new Promise<{ status: number; headers: Record<string, string | number>; body: Buffer }>((resolve, reject) => {
    res.once('finish', () => resolve({ status, headers, body: Buffer.concat(chunks) }))
    res.once('error', reject)
  })
  instance.emit('request', req, res)
  return { result, req, res }
}

describe('print request boundary', () => {
  it('copies only artwork and physical dimensions', () => {
    const source = { ...request(), filename: '../../private.pdf', command: 'run me' }
    const captured = validatePrintRequest(source)
    source.svg = 'changed'
    expect(captured).toEqual(request())
  })
  it.each([
    null, [], {}, { ...request(), svg: '' }, { ...request(), svg: 'x'.repeat(5 * 1024 * 1024 + 1) },
    { ...request(), widthMm: NaN }, { ...request(), widthMm: 0 }, { ...request(), heightMm: 1001 },
    { ...request(), widthMm: '70' }, { ...request(), svg: '<!DOCTYPE svg><svg/>' },
    { ...request(), svg: '<!ENTITY attack SYSTEM "file:///etc/passwd"><svg/>' }
  ])('rejects invalid/oversized input %#', (input) => {
    expect(() => validatePrintRequest(input)).toThrow(expect.objectContaining({ code: 'invalid_print_request', status: 400 }))
  })
})

describe('inert print SVG validation', () => {
  it('preserves vector shapes, nested SVGs, text, gradients, local masks and local use', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs><linearGradient id="paint"><stop offset="0" stop-color="#fb299d"/><stop offset="1" stop-color="blue"/></linearGradient>
      <mask id="eyes"><path d="M 0 0 H 100 V 100 Z" fill="white"/><circle cx="10" cy="10" r="2" fill="black"/></mask>
      <path id="body" d="M 0 0 H 10 V 10 Z"/></defs>
      <svg x="2" y="3" width="50" height="50" viewBox="0 0 100 100"><g mask="url(#eyes)"><use href="#body" fill="url(#paint)"/></g></svg>
      <text x="0" y="90" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"><tspan>Bloub &amp; friends</tspan></text>
    </svg>`
    const clean = sanitizePrintSvg(source)
    expect(clean).toContain('mask="url(#eyes)"')
    expect(clean).toContain('fill="url(#paint)"')
    expect(clean).toContain('Bloub &amp; friends')
    expect(clean).toContain('<use href="#body"')
  })
  it.each([
    '<script>alert(1)</script>', '<foreignObject><div>HTML</div></foreignObject>', '<image href="https://example.com/a.png"/>',
    '<style>@import "https://example.com";</style>', '<animate attributeName="href" to="file:///tmp/secret"/>',
    '<use href="file:///tmp/secret"/>', '<use href="data:image/svg+xml,example"/>', '<a href="https://example.com">link</a>',
    '<rect onload="alert(1)"/>', '<rect style="background:url(https://example.com)"/>',
    '<rect fill="url(https://example.com/paint)"/>', '<rect fill="url(#missing)"/>',
    '<g xml:base="file:///tmp/"><use href="#thing"/></g>',
    '<g id="a"><use href="#a"/></g>', '<g id="same"/><g id="same"/>',
    '<text xmlns="http://www.w3.org/1999/xhtml">not SVG</text>'
  ])('rejects executable, external, or recursive content %#', (content) => {
    expect(() => sanitizePrintSvg(`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`)).toThrow('invalid_print_request')
  })
  it('rejects XML directives and bounded-but-excessive structure before mounting', () => {
    expect(() => sanitizePrintSvg('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow()
    expect(() => sanitizePrintSvg(`<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(66)}${'</g>'.repeat(66)}</svg>`)).toThrow()
  })
  it('retains only the two supported branding style declarations', () => {
    expect(sanitizePrintSvg('<svg xmlns="http://www.w3.org/2000/svg"><g style="isolation:isolate;mix-blend-mode:multiply"/></svg>')).toContain('mix-blend-mode:multiply')
    expect(() => sanitizePrintSvg('<svg xmlns="http://www.w3.org/2000/svg"><g style="isolation:isolate;filter:url(#a)"/></svg>')).toThrow()
  })
  it.each(['#ffffff', '#000000'])('replaces only known bot masks with clipped vector eyes on %s paper', (paper) => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-125 -125 250 250"><defs><mask id="bot"><path d="M 0 0 L 10 0 L 10 10 Z" fill="#fff"/><path d="M 1 1 L 2 2 Z" transform="matrix(1 0 0 1 2 3)" opacity="0.5" fill="#000"/></mask></defs><g opacity="0.8"><path data-bot-outline="" d="M 0 0 L 10 0 L 10 10 Z" fill="${paper}"/><g mask="url(#bot)"><rect x="-158" y="-158" width="316" height="316" fill="#00bbaa"/></g></g></svg>`
    const clean = new DOMParser().parseFromString(sanitizePrintSvg(source), 'image/svg+xml')
    expect(clean.querySelector('g[mask]')).toBeNull()
    expect(clean.querySelector('clipPath path')?.getAttribute('d')).toBe('M 0 0 L 10 0 L 10 10 Z')
    expect(clean.querySelector('g[clip-path] path')?.getAttribute('fill')).toBe(paper)
    expect(clean.querySelector('g[clip-path] path')?.getAttribute('opacity')).toBe('0.5')
    expect(clean.querySelector('g[clip-path] path')?.getAttribute('transform')).toBe('matrix(1 0 0 1 2 3)')
    expect(clean.querySelector('path[fill="#00bbaa"]')?.getAttribute('d')).toBe('M 0 0 L 10 0 L 10 10 Z')
    expect(clean.querySelector('g[opacity="0.8"]')).not.toBeNull()
  })
})

describe('print service lifecycle and HTTP API', () => {
  it('removes Chrome paper padding while preserving vector scale and the top-left origin', async () => {
    const source = await PDFDocument.create()
    const sourcePage = source.addPage([300, 300])
    sourcePage.drawRectangle({ x: 0, y: 290, width: 20, height: 10 })
    const bytes = await normalizePrintPage(await source.save(), 100, 100)
    const result = await PDFDocument.load(bytes)
    const page = result.getPage(0)
    const target = 100 * 72 / 25.4
    expect(page.getWidth()).toBeCloseTo(target, 8)
    expect(page.getHeight()).toBeCloseTo(target, 8)
    expect(page.getCropBox()).toEqual(page.getMediaBox())
    const contents = page.node.Contents() as PDFArray
    const streams = contents.asArray().map((ref) => result.context.lookup(ref) as PDFRawStream)
    const operators = streams.map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n')
    const translations = [...operators.matchAll(/1 0 0 1 0 ([\d.-]+) cm/g)].map((match) => Number(match[1]))
    // The original top-edge rectangle remains a 20x10 vector at the new top edge.
    expect(translations.reduce((sum, y) => sum + y, 0) + 10).toBeCloseTo(target, 8)
    expect(operators).toContain('20 10 l')
    expect(operators).not.toMatch(/\/\w+ Do/)
  })
  it('refuses unexpected multiple pages instead of silently dropping artwork', async () => {
    const source = await PDFDocument.create()
    source.addPage()
    source.addPage()
    await expect(normalizePrintPage(await source.save(), 100, 100)).rejects.toThrow('Expected one print page')
  })
  it('exports application/pdf and preserves physical dimensions', async () => {
    const renderer = vi.fn<PrintRenderer>().mockResolvedValue(Buffer.from('%PDF-CMYK'))
    const response = await send(server(renderer)).result
    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toBe('application/pdf')
    expect(response.headers['Cache-Control']).toBe('no-store')
    expect(response.body.toString()).toBe('%PDF-CMYK')
    expect(renderer).toHaveBeenCalledWith(request(), expect.any(AbortSignal))
  })
  it('shares same-origin restrictions and never invokes a renderer for invalid input', async () => {
    const renderer = vi.fn<PrintRenderer>().mockResolvedValue(Buffer.from('%PDF-CMYK'))
    const instance = server(renderer)
    expect((await send(instance, { headers: { origin: 'https://evil.example' } }).result).status).toBe(403)
    expect((await send(instance, { method: 'GET' }).result).status).toBe(405)
    const invalid = await send(instance, { body: { ...request(), widthMm: -1 } }).result
    expect(invalid.status).toBe(400)
    expect(JSON.parse(invalid.body.toString()).error.code).toBe('invalid_print_request')
    expect(renderer).not.toHaveBeenCalled()
  })
  it('returns actionable unavailable errors without replacing the file with an RGB PDF', async () => {
    const renderer: PrintRenderer = async () => { throw new PrintExportError(503, 'print_unavailable', 'Install Ghostscript.') }
    const response = await send(server(renderer)).result
    expect(response.status).toBe(503)
    expect(JSON.parse(response.body.toString()).error).toEqual({ code: 'print_unavailable', message: 'Install Ghostscript.' })
  })
  it('limits concurrent print jobs and releases its slot after failure', async () => {
    let reject!: (error: Error) => void
    const renderer = vi.fn<PrintRenderer>()
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
      .mockResolvedValue(Buffer.from('%PDF-retry'))
    const service = new PrintExportService(renderer)
    const first = service.render(request(), new AbortController().signal)
    await expect(service.render(request(), new AbortController().signal)).rejects.toMatchObject({ code: 'print_busy', status: 409 })
    reject(new PrintExportError(500, 'print_failed', 'Failed'))
    await expect(first).rejects.toMatchObject({ code: 'print_failed' })
    await expect(service.render(request(), new AbortController().signal)).resolves.toEqual(Buffer.from('%PDF-retry'))
  })
  it('propagates response disconnects to the active renderer', async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let renderingSignal!: AbortSignal
    const renderer: PrintRenderer = (_request, signal) => new Promise((resolve) => {
      renderingSignal = signal
      signal.addEventListener('abort', () => resolve(Buffer.from('%PDF-aborted')), { once: true })
      started()
    })
    const { res } = send(server(renderer))
    await ready
    res.destroy()
    await new Promise<void>((resolve) => res.once('close', resolve))
    expect(renderingSignal.aborted).toBe(true)
  })
  it('cancels an active print when the service closes', async () => {
    let signal!: AbortSignal
    const service = new PrintExportService(async (_request, activeSignal) => {
      signal = activeSignal
      await new Promise<void>((resolve) => activeSignal.addEventListener('abort', () => resolve(), { once: true }))
      return Buffer.from('closed')
    })
    const pending = service.render(request(), new AbortController().signal)
    service.close()
    await pending
    expect(signal.aborted).toBe(true)
  })
  it('embeds a four-channel SWOP OutputIntent without declaring PDF/X conformance', () => {
    const intent = printOutputIntent('/tmp/profile (cmyk).icc')
    expect(intent).toContain('/N 4')
    expect(intent).toContain('/OutputIntents')
    expect(intent).toContain('/DestOutputProfile')
    expect(intent).toContain('profile \\(cmyk\\).icc')
    expect(intent).not.toContain('GTS_PDFXVersion')
  })
})
