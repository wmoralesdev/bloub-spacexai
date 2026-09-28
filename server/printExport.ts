import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { Browser } from 'puppeteer-core'

const execute = promisify(execFile)
const MAX_SVG_BYTES = 5 * 1024 * 1024
export interface PrintRequest { svg: string; widthMm: number; heightMm: number }
export type PrintRenderer = (request: PrintRequest, signal: AbortSignal) => Promise<Buffer>
export class PrintExportError extends Error {
  status: number
  code: 'invalid_print_request' | 'print_busy' | 'print_unavailable' | 'print_failed'
  constructor(status: number, code: PrintExportError['code'], message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined)
    this.status = status
    this.code = code
  }
}

export function validatePrintRequest(value: unknown): PrintRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PrintExportError(400, 'invalid_print_request', 'Expected SVG artwork and its dimensions in millimetres.')
  const input = value as Record<string, unknown>
  if (typeof input.svg !== 'string' || !input.svg.trim() || Buffer.byteLength(input.svg) > MAX_SVG_BYTES
    || /<!DOCTYPE|<!ENTITY|<\?/i.test(input.svg)
    || ![input.widthMm, input.heightMm].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 1000)) {
    throw new PrintExportError(400, 'invalid_print_request', 'Use a self-contained SVG up to 5 MB and dimensions between 1 and 1,000 mm.')
  }
  return { svg: input.svg, widthMm: input.widthMm as number, heightMm: input.heightMm as number }
}

/** Runs in Chrome's isolated evaluation context, before any supplied node is mounted. */
export function sanitizePrintSvg(source: string): string {
  const invalid = (): never => { throw new Error('invalid_print_request') }
  const ns = 'http://www.w3.org/2000/svg'
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(source)) return invalid()
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = parsed.documentElement
  if (!root || root.localName !== 'svg' || root.namespaceURI !== ns || parsed.querySelector('parsererror')) return invalid()
  const tags = new Set(['svg', 'g', 'defs', 'symbol', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use', 'text', 'tspan', 'title', 'desc'])
  const allowed = new Set(('id x y x1 x2 y1 y2 cx cy r rx ry width height fx fy fr d points viewBox preserveAspectRatio transform gradientTransform gradientUnits spreadMethod clipPathUnits maskUnits maskContentUnits offset pathLength dx dy textLength lengthAdjust rotate fill stroke color stop-color fill-rule clip-rule clip-path mask stroke-linecap stroke-linejoin stroke-width stroke-miterlimit stroke-dasharray stroke-dashoffset fill-opacity stroke-opacity stop-opacity opacity vector-effect display visibility overflow mask-type isolation mix-blend-mode text-anchor font-style font-weight font-family font-size letter-spacing word-spacing shape-rendering color-interpolation paint-order enable-background').split(' '))
  const ids = new Map<string, Element>()
  const botOutlines = new Set<Element>()
  const references: Array<{ element: Element; id: string; kind: string }> = []
  const all = [root, ...root.querySelectorAll('*')]
  if (all.length > 20_000) return invalid()
  for (const element of all) {
    if (element.namespaceURI !== ns || !tags.has(element.localName)) return invalid()
    let depth = 0
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (++depth > 64) return invalid()
    for (const child of [...element.childNodes]) if (![1, 3, 4, 8].includes(child.nodeType)) return invalid()
    if (element.hasAttribute('data-bot-outline')) botOutlines.add(element)
    for (const attr of [...element.attributes]) {
      const { name, localName, value, namespaceURI } = attr
      if (/^on/i.test(localName) || name === 'xml:base') return invalid()
      if (name === 'xmlns' || name === 'xmlns:xlink') continue
      if (name.startsWith('data-') || name.startsWith('aria-') || ['class', 'role', 'version', 'baseProfile'].includes(name)) {
        element.removeAttribute(name)
        continue
      }
      if (name === 'xml:space' && ['default', 'preserve'].includes(value)) continue
      if (localName === 'href') {
        if ((namespaceURI && namespaceURI !== 'http://www.w3.org/1999/xlink') || !['use', 'linearGradient', 'radialGradient'].includes(element.localName) || !/^#[a-zA-Z0-9_.:-]+$/.test(value)) return invalid()
        references.push({ element, id: value.slice(1), kind: 'href' })
        continue
      }
      if (namespaceURI) return invalid()
      if (name === 'style') {
        // Sanitized branding uses CSS only for these two non-presentation properties.
        if (!/^(?:(?:isolation\s*:\s*(?:auto|isolate)|mix-blend-mode\s*:\s*(?:normal|multiply|screen|overlay|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity))\s*;?\s*)*$/.test(value)) return invalid()
        continue
      }
      if (!allowed.has(name) || /[\\@{};]|(?:https?|file|data|javascript)\s*:/i.test(value)) return invalid()
      if (name === 'id') {
        if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(value) || ids.has(value)) return invalid()
        ids.set(value, element)
      }
      if (/url\s*\(/i.test(value)) {
        const match = value.match(/^url\(\s*(['"]?)#([a-zA-Z0-9_.:-]+)\1\s*\)$/)
        if (!match || !['fill', 'stroke', 'clip-path', 'mask'].includes(name)) return invalid()
        references.push({ element, id: match[2]!, kind: name })
      }
    }
  }
  for (const reference of references) {
    const target = ids.get(reference.id)
    if (!target) return invalid()
    if ((['fill', 'stroke'].includes(reference.kind) || ['linearGradient', 'radialGradient'].includes(reference.element.localName)) && !['linearGradient', 'radialGradient'].includes(target.localName)) return invalid()
    if (reference.kind === 'mask' && target.localName !== 'mask') return invalid()
    if (reference.kind === 'clip-path' && target.localName !== 'clipPath') return invalid()
    if (reference.kind === 'href' && reference.element.localName === 'use' && !['svg', 'g', 'symbol', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use'].includes(target.localName)) return invalid()
  }
  // Reject recursive or explosively expanded local <use>/mask/gradient references.
  const links = new Map<Element, Element[]>()
  for (const ref of references) links.set(ref.element, [...(links.get(ref.element) ?? []), ids.get(ref.id)!])
  let visits = 0
  const walk = (element: Element, chain: Set<Element>): void => {
    if (chain.has(element) || chain.size > 64 || ++visits > 100_000) return invalid()
    const next = new Set(chain).add(element)
    for (const child of [...element.children, ...(links.get(element) ?? [])]) walk(child, next)
  }
  walk(root, new Set())
  // Chrome/GS can rasterize luminance masks and leave a coloured hairline at
  // their rectangular bounds. Frozen bots already have an opaque paper-colour
  // silhouette underneath the mask, so their known mask can be expressed as
  // solid vector artwork: coloured body, paper-colour eyes clipped to that body.
  // Only this exact app-owned structure is transformed; uploaded logo masks stay.
  let clipIndex = 0
  for (const group of all.filter((element) => element.localName === 'g' && element.hasAttribute('mask'))) {
    const paper = group.previousElementSibling
    const rect = group.firstElementChild
    const maskRef = references.find((ref) => ref.element === group && ref.kind === 'mask')
    const mask = maskRef ? ids.get(maskRef.id) : undefined
    const body = mask?.firstElementChild
    if (!paper || !botOutlines.has(paper) || paper.localName !== 'path' || !paper.hasAttribute('fill')
      || group.children.length !== 1 || rect?.localName !== 'rect' || !rect.hasAttribute('fill')
      || body?.localName !== 'path' || body.getAttribute('d') !== paper.getAttribute('d')
      || !['white', '#fff', '#ffffff'].includes((body.getAttribute('fill') ?? '').toLowerCase())
      || ![...mask!.children].slice(1).every((eye) => ['path', 'circle'].includes(eye.localName)
        && ['black', '#000', '#000000'].includes((eye.getAttribute('fill') ?? '').toLowerCase()))) continue
    let clipId: string
    do { clipId = `bloub-print-clip-${clipIndex++}` } while (ids.has(clipId))
    const clip = parsed.createElementNS(ns, 'clipPath')
    clip.setAttribute('id', clipId)
    clip.setAttribute('clipPathUnits', 'userSpaceOnUse')
    const clipBody = body.cloneNode(true) as Element
    clipBody.removeAttribute('id')
    clip.appendChild(clipBody)
    mask!.parentNode!.appendChild(clip)
    const paintedBody = body.cloneNode(true) as Element
    paintedBody.removeAttribute('id')
    paintedBody.setAttribute('fill', rect.getAttribute('fill')!)
    const eyes = parsed.createElementNS(ns, 'g')
    eyes.setAttribute('clip-path', `url(#${clipId})`)
    for (const original of [...mask!.children].slice(1)) {
      const eye = original.cloneNode(true) as Element
      eye.removeAttribute('id')
      eye.setAttribute('fill', paper.getAttribute('fill')!)
      eyes.appendChild(eye)
    }
    group.removeAttribute('mask')
    group.replaceChildren(paintedBody, eyes)
  }
  return new XMLSerializer().serializeToString(root)
}

function chromeExecutable(): string {
  const configured = process.env.PRODUCER_HEADLESS_SHELL_PATH || process.env.HYPERFRAMES_BROWSER_PATH
  const candidates = configured ? [configured] : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? [join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  const executable = candidates.find((path) => existsSync(path))
  if (!executable) throw new PrintExportError(503, 'print_unavailable', 'CMYK export needs local Chrome or Chromium. Set HYPERFRAMES_BROWSER_PATH if it is installed elsewhere.')
  return executable
}

/** Escape a filesystem path for a PostScript string; never put request data into PS. */
function psString(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') }

export function printOutputIntent(profile: string): string {
  return `[/_objdef {BloubICC} /type /stream /OBJ pdfmark
[{BloubICC} << /N 4 >> /PUT pdfmark
[{BloubICC} (${psString(profile)}) (r) file /PUT pdfmark
[/_objdef {BloubOutputIntent} /type /dict /OBJ pdfmark
[{BloubOutputIntent} << /Type /OutputIntent /S /GTS_PDFX
 /DestOutputProfile {BloubICC} /OutputConditionIdentifier (CGATS TR 001)
 /Info (SWOP CMYK - Ghostscript default_cmyk.icc)
 /RegistryName (http://www.color.org) >> /PUT pdfmark
[{Catalog} << /OutputIntents [{BloubOutputIntent}] >> /PUT pdfmark
`
}

/** Crop a padded Chrome page in PDF coordinates, preserving the SVG's scale. */
export async function normalizePrintPage(input: Uint8Array, widthMm: number, heightMm: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const document = await PDFDocument.load(input)
  if (document.getPageCount() !== 1) throw new Error('Expected one print page')
  const page = document.getPage(0)
  const width = widthMm * 72 / 25.4
  const height = heightMm * 72 / 25.4
  // PDF's origin is bottom-left. Moving down by the removed padding leaves the
  // artwork's top-left at the top-left of the smaller page, with no rescaling.
  page.translateContent(0, height - page.getHeight())
  page.setMediaBox(0, 0, width, height)
  page.setCropBox(0, 0, width, height)
  return document.save({ useObjectStreams: false })
}

export const renderPrintPdf: PrintRenderer = async (request, outerSignal) => {
  const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(90_000)])
  signal.throwIfAborted()
  const executablePath = chromeExecutable()
  const ghostscript = process.env.BLOUB_GHOSTSCRIPT_PATH || (existsSync('/opt/homebrew/bin/gs') ? '/opt/homebrew/bin/gs' : process.platform === 'win32' ? 'gswin64c' : 'gs')
  let profile: string
  try {
    const { stdout } = await execute(ghostscript, ['-h'], { timeout: 10_000, maxBuffer: 64 * 1024, signal })
    // Profile paths are not necessarily in findlibfile's search path. Derive
    // versioned installation roots from GS itself, then try distribution paths.
    const roots = (stdout.split('Search path:')[1]?.split('Ghostscript is also')[0] ?? '')
      .split(/\s+:\s+|\r?\n/).map((line) => line.trim().replace(/\s+:$/, ''))
      .filter((path) => /[\\/](?:lib|Resource[\\/]Init)$/.test(path))
      .map((path) => /[\\/]Init$/.test(path) ? dirname(dirname(path)) : dirname(path))
    const candidates = [
      ...roots.map((root) => join(root, 'iccprofiles/default_cmyk.icc')),
      '/opt/homebrew/share/ghostscript/iccprofiles/default_cmyk.icc',
      '/usr/local/share/ghostscript/iccprofiles/default_cmyk.icc',
      '/usr/share/ghostscript/iccprofiles/default_cmyk.icc',
      '/usr/share/color/icc/ghostscript/default_cmyk.icc'
    ]
    const found = candidates.find((path) => existsSync(path))
    if (!found) throw new Error('CMYK profile unavailable')
    profile = found
    const header = await readFile(profile)
    if (header.length < 128 || header.toString('ascii', 16, 20) !== 'CMYK' || header.toString('ascii', 36, 40) !== 'acsp') throw new Error('Invalid CMYK profile')
  } catch (cause) {
    if (signal.aborted) signal.throwIfAborted()
    throw new PrintExportError(503, 'print_unavailable', `CMYK export needs Ghostscript and its default CMYK profile. Install Ghostscript or set BLOUB_GHOSTSCRIPT_PATH. ${cause instanceof Error ? cause.message : ''}`)
  }
  const directory = await mkdtemp(join(tmpdir(), 'bloub-print-'))
  let browser: Browser | undefined
  const abort = () => { void browser?.close().catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const { default: puppeteer } = await import('puppeteer-core')
    try {
      browser = await puppeteer.launch({ executablePath, headless: true, timeout: 20_000, args: ['--disable-background-networking', '--disable-extensions', '--no-first-run'] })
    } catch (cause) {
      if (signal.aborted) signal.throwIfAborted()
      throw new PrintExportError(503, 'print_unavailable', 'Chrome could not start for the CMYK export. Check HYPERFRAMES_BROWSER_PATH and the local render service.', cause)
    }
    signal.throwIfAborted()
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (networkRequest) => { void networkRequest.abort().catch(() => undefined) })
    await page.setContent('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; font-src \'none\'; img-src \'none\'"></head><body></body></html>')
    let svg: string
    try { svg = await page.evaluate(sanitizePrintSvg, request.svg) }
    catch { throw new PrintExportError(400, 'invalid_print_request', 'The SVG contains unsupported content or external resources.') }
    // Only the already validated XML reaches the document. CSS and page dimensions are numeric.
    await page.evaluate(({ svg, widthMm, heightMm }) => {
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
      parsed.setAttribute('width', `${widthMm}mm`)
      parsed.setAttribute('height', `${heightMm}mm`)
      const style = document.createElement('style')
      // Chrome rounds its paper sizes. A padded page prevents that rounding from
      // clipping the right/bottom SVG edge; normalizePrintPage removes padding.
      style.textContent = `@page { size: ${widthMm + 1}mm ${heightMm + 1}mm; margin: 0; } html,body { margin: 0; padding: 0; width: ${widthMm + 1}mm; height: ${heightMm + 1}mm; } svg { display: block; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`
      document.head.appendChild(style)
      document.body.appendChild(document.importNode(parsed, true))
    }, { svg, widthMm: request.widthMm, heightMm: request.heightMm })
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const inputPath = join(directory, 'artwork-rgb.pdf')
    const outputPath = join(directory, 'artwork-cmyk.pdf')
    const intentPath = join(directory, 'output-intent.ps')
    const rgbPdf = await page.pdf({ width: `${request.widthMm + 1}mm`, height: `${request.heightMm + 1}mm`, printBackground: true, preferCSSPageSize: true, margin: { top: 0, bottom: 0, left: 0, right: 0 }, tagged: false, timeout: 30_000 })
    await writeFile(inputPath, await normalizePrintPage(rgbPdf, request.widthMm, request.heightMm))
    await browser.close()
    browser = undefined
    signal.throwIfAborted()
    await writeFile(intentPath, printOutputIntent(profile))
    await execute(ghostscript, [
      '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7',
      '-sColorConversionStrategy=CMYK', '-dProcessColorModel=/DeviceCMYK',
      '-sBlendConversionStrategy=Simple',
      `-sDefaultCMYKProfile=${profile}`, `-sOutputICCProfile=${profile}`,
      '-dAutoRotatePages=/None', '-dEmbedAllFonts=true', '-dSubsetFonts=true',
      '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false',
      `--permit-file-read=${profile}`, `-sOutputFile=${outputPath}`, intentPath, inputPath
    ], { timeout: 45_000, maxBuffer: 1024 * 1024, signal })
    const pdf = await readFile(outputPath)
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')) || !pdf.includes(Buffer.from('/OutputIntents')) || !pdf.includes(Buffer.from('/N 4'))) throw new Error('CMYK PDF verification failed')
    return pdf
  } catch (error) {
    if (error instanceof PrintExportError) throw error
    if (outerSignal.aborted) outerSignal.throwIfAborted()
    throw new PrintExportError(500, 'print_failed', 'The CMYK PDF could not be generated. Please retry.', error)
  } finally {
    signal.removeEventListener('abort', abort)
    await browser?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
}

/** Single print job per local server; disconnects cancel the native processes. */
export class PrintExportService {
  private active: AbortController | undefined
  private renderer: PrintRenderer
  constructor(renderer: PrintRenderer = renderPrintPdf) { this.renderer = renderer }
  async render(value: unknown, signal: AbortSignal): Promise<Buffer> {
    const request = validatePrintRequest(value)
    if (this.active) throw new PrintExportError(409, 'print_busy', 'Another CMYK PDF is being prepared. Please wait and retry.')
    const controller = new AbortController()
    this.active = controller
    try { return await this.renderer(request, AbortSignal.any([signal, controller.signal])) }
    finally { if (this.active === controller) this.active = undefined }
  }
  close(): void { this.active?.abort() }
}
