/** A locally uploaded, self-contained vector logo. Saved markup is never trusted. */
export interface StickerSheetBranding {
  name: string
  svg: string
  aspectRatio: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const MAX_BYTES = 256 * 1024
const invalid = (): never => { throw new Error('invalidBranding') }
const idPattern = /^[a-zA-Z0-9_.:-]+$/
const numberPattern = /^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?$/
const elements = new Set(['svg', 'g', 'defs', 'symbol', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use', 'title', 'desc'])
const graphics = new Set(['svg', 'g', 'symbol', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use'])
const geometry = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'fx', 'fy', 'fr', 'pathLength', 'dx', 'dy', 'textLength', 'startOffset'])
const attributes = new Set(['d', 'points', 'viewBox', 'preserveAspectRatio', 'transform', 'gradientTransform', 'gradientUnits', 'spreadMethod', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'offset', 'lengthAdjust', 'rotate'])
const enums: Record<string, Set<string>> = {
  'fill-rule': new Set(['nonzero', 'evenodd']),
  'clip-rule': new Set(['nonzero', 'evenodd']),
  'stroke-linecap': new Set(['butt', 'round', 'square']),
  'stroke-linejoin': new Set(['miter', 'round', 'bevel', 'miter-clip', 'arcs']),
  // The logo is sampled and then placed in another SVG viewport. Fixed-width
  // strokes would not follow the same physical scaling as the captured outline.
  'vector-effect': new Set(['none']),
  'display': new Set(['none', 'inline', 'block']),
  'visibility': new Set(['visible', 'hidden', 'collapse']),
  'overflow': new Set(['visible', 'hidden']),
  'mask-type': new Set(['luminance', 'alpha']),
  'isolation': new Set(['auto', 'isolate']),
  'mix-blend-mode': new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']),
  'text-anchor': new Set(['start', 'middle', 'end']),
  'font-style': new Set(['normal', 'italic', 'oblique']),
  'font-weight': new Set(['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900']),
  'shape-rendering': new Set(['auto', 'optimizeSpeed', 'crispEdges', 'geometricPrecision']),
  'color-interpolation': new Set(['auto', 'sRGB', 'linearRGB'])
}
const paintProperties = new Set(['fill', 'stroke'])
const colorProperties = new Set(['color', 'stop-color'])
const numericProperties = new Set(['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'font-size', 'letter-spacing', 'word-spacing'])
const refProperties = new Set(['clip-path', 'mask'])
const presentation = new Set([...paintProperties, ...colorProperties, ...numericProperties, ...refProperties, ...Object.keys(enums), 'stroke-dasharray', 'font-family', 'paint-order', 'enable-background'])

function finiteNumbers(value: string): number[] {
  const tokens = value.trim().split(/[\s,]+/)
  if (!tokens.length || tokens.some((token) => !numberPattern.test(token) || !Number.isFinite(Number(token)))) return invalid()
  return tokens.map(Number)
}

function lengthList(value: string): boolean {
  return value.trim().split(/[\s,]+/).every((token) => {
    const match = token.match(/^([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?)(%|px|pt|pc|mm|cm|in|em|ex)?$/)
    return !!match && Number.isFinite(Number(match[1]))
  })
}

function color(value: string): boolean {
  // A deliberately bounded color grammar: no variables, escapes or other functions.
  return /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\))$/i.test(value)
}

function localUrl(value: string): string | null {
  const match = value.match(/^url\(\s*(['"]?)(#[a-zA-Z0-9_.:-]+)\1\s*\)$/)
  return match ? match[2]!.slice(1) : null
}

function presentationValue(property: string, raw: string): string {
  const value = raw.trim()
  if (!value || /[\\@{};]/.test(value)) return invalid()
  if (paintProperties.has(property)) {
    if (localUrl(value)) return `url(#${localUrl(value)})`
    if (value === 'none' || color(value)) return value
  } else if (colorProperties.has(property)) {
    if (color(value)) return value
  } else if (refProperties.has(property)) {
    if (localUrl(value)) return `url(#${localUrl(value)})`
    if (value === 'none') return value
  } else if (numericProperties.has(property)) {
    if (lengthList(value) && !/[\s,]/.test(value)) return value
  } else if (property === 'stroke-dasharray') {
    if (value === 'none' || lengthList(value)) return value
  } else if (property === 'font-family') {
    if (/^[a-zA-Z0-9\s,'"_-]+$/.test(value)) return value
  } else if (property === 'paint-order') {
    if (value === 'normal' || /^(fill|stroke|markers)(\s+(fill|stroke|markers)){0,2}$/.test(value)) return value
  } else if (property === 'enable-background') {
    if (value === 'accumulate' || value === 'new' || (value.startsWith('new ') && finiteNumbers(value.slice(4)).length === 4)) return value
  } else if (enums[property]?.has(value)) return value
  return invalid()
}

interface Declaration { property: string; value: string; important: boolean }
type Specificity = [number, number, number, number]
interface Winner extends Declaration { specificity: Specificity; order: number }

/** CSS is restricted to simple static presentation rules, then resolved into attributes. */
function cssSource(raw: string): string {
  // CSS escapes and at-rules are unnecessary for ordinary exported class names.
  // Reject them before CSSOM, which otherwise silently discards some @imports.
  if (/[\\@]/.test(raw)) return invalid()
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2)
      if (end < 0) return invalid()
      out += ' '
      i = end + 1
    } else out += raw[i]
  }
  return out
}

function declarations(raw: string): Declaration[] {
  const source = cssSource(raw)
  if (/[{}]/.test(source)) return invalid()
  const out: Declaration[] = []
  for (const piece of source.split(';')) {
    if (!piece.trim()) continue
    const colon = piece.indexOf(':')
    if (colon < 1) return invalid()
    const property = piece.slice(0, colon).trim().toLowerCase()
    if (!presentation.has(property)) return invalid()
    const tail = piece.slice(colon + 1).trim()
    const important = /\s*!important\s*$/i.test(tail)
    const value = presentationValue(property, important ? tail.replace(/\s*!important\s*$/i, '') : tail)
    // Browser parsing verifies the declaration boundary too; only the validated
    // value is serialized. Obsolete Illustrator enable-background is inert here.
    const style = document.createElement('span').style
    if (property !== 'enable-background') {
      style.setProperty(property, value)
      if (!style.getPropertyValue(property)) return invalid()
    }
    out.push({ property, value, important })
  }
  return out
}

function selectorSpecificity(selector: string): Specificity {
  // No pseudo-classes, attributes, combinators or escaped selectors. These would
  // require a broader CSS cascade than a portable logo needs.
  if (!/^(?:\*|[a-zA-Z][\w-]*)?(?:[.#][a-zA-Z_][\w-]*)*$/.test(selector) || !selector) return invalid()
  return [0, (selector.match(/#/g) ?? []).length, (selector.match(/\./g) ?? []).length, /^[a-zA-Z]/.test(selector) ? 1 : 0]
}

function resolveStyles(root: Element): void {
  const winners = new Map<Element, Map<string, Winner>>()
  let order = 0
  const apply = (element: Element, rules: Declaration[], specificity: Specificity) => {
    const values = winners.get(element) ?? new Map<string, Winner>()
    winners.set(element, values)
    for (const rule of rules) {
      const candidate: Winner = { ...rule, specificity, order: order++ }
      const old = values.get(rule.property)
      let comparison = old ? Number(candidate.important) - Number(old.important) : 1
      if (old && comparison === 0) {
        for (let i = 0; i < specificity.length && comparison === 0; i++) comparison = specificity[i]! - old.specificity[i]!
        if (comparison === 0) comparison = candidate.order - old.order
      }
      if (comparison > 0) values.set(rule.property, candidate)
    }
  }
  for (const sheet of [...root.querySelectorAll('style')]) {
    for (const attribute of [...sheet.attributes]) {
      if (!['type', 'id'].includes(attribute.name) || (attribute.name === 'type' && attribute.value !== 'text/css')) return invalid()
    }
    const css = cssSource(sheet.textContent ?? '')
    let cursor = 0
    while (cursor < css.length) {
      if (!css.slice(cursor).trim()) break
      const start = css.indexOf('{', cursor)
      const end = css.indexOf('}', start + 1)
      if (start < cursor || end < 0) return invalid()
      const selectors = css.slice(cursor, start).trim().split(',').map((s) => s.trim())
      const rules = declarations(css.slice(start + 1, end))
      for (const selector of selectors) {
        const specificity = selectorSpecificity(selector)
        for (const element of [root, ...root.querySelectorAll('*')]) {
          if (element.matches(selector)) apply(element, rules, specificity)
        }
      }
      cursor = end + 1
    }
    sheet.remove()
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element.hasAttribute('style')) apply(element, declarations(element.getAttribute('style')!), [1, 0, 0, 0])
    element.removeAttribute('style')
    element.removeAttribute('class')
    const cssOnly: string[] = []
    for (const winner of winners.get(element)?.values() ?? []) {
      // These two CSS properties have no equivalent SVG presentation attribute.
      if (winner.property === 'isolation' || winner.property === 'mix-blend-mode') cssOnly.push(`${winner.property}:${winner.value}`)
      else element.setAttribute(winner.property, winner.value)
    }
    if (cssOnly.length) element.setAttribute('style', cssOnly.join(';'))
  }
}

function checkAttribute(name: string, value: string): void {
  if (presentation.has(name)) { presentationValue(name, value); return }
  if (geometry.has(name)) { if (!lengthList(value)) return invalid(); return }
  if (!attributes.has(name)) return invalid()
  if (name === 'viewBox') { if (finiteNumbers(value).length !== 4) return invalid(); return }
  if (name === 'd') { if (!value.trim() || /[^MmZzLlHhVvCcSsQqTtAa\d.eE+\-,\s]/.test(value)) return invalid(); return }
  if (name === 'points' || name === 'rotate') { finiteNumbers(value); return }
  if (name === 'offset') { if (!lengthList(value) || /[\s,]/.test(value)) return invalid(); return }
  if (name === 'transform' || name === 'gradientTransform') {
    let rest = value.trim()
    const arities: Record<string, number[]> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] }
    while (rest) {
      const match = rest.match(/^(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)\s*,?\s*/)
      if (!match || !arities[match[1]!]!.includes(finiteNumbers(match[2]!).length)) return invalid()
      rest = rest.slice(match[0].length)
    }
    return
  }
  if (name === 'preserveAspectRatio' && /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value)) return
  if (['gradientUnits', 'clipPathUnits', 'maskUnits', 'maskContentUnits'].includes(name) && ['userSpaceOnUse', 'objectBoundingBox'].includes(value)) return
  if (name === 'spreadMethod' && ['pad', 'reflect', 'repeat'].includes(value)) return
  if (name === 'lengthAdjust' && ['spacing', 'spacingAndGlyphs'].includes(value)) return
  return invalid()
}

function checkReferences(root: Element): void {
  const ids = new Map<string, Element>()
  const all = [root, ...root.querySelectorAll('*')]
  for (const element of all) {
    const id = element.getAttribute('id')
    if (id) { if (ids.has(id)) return invalid(); ids.set(id, element) }
  }
  const references = new Map<Element, Element[]>()
  for (const element of all) {
    for (const attribute of [...element.attributes]) {
      const id = attribute.name === 'href' ? attribute.value.slice(1) : localUrl(attribute.value)
      if (!id) continue
      const target = ids.get(id)
      if (!target) return invalid()
      const type = target.localName
      if ((paintProperties.has(attribute.name) || ['linearGradient', 'radialGradient'].includes(element.localName)) && !['linearGradient', 'radialGradient'].includes(type)) return invalid()
      if (attribute.name === 'clip-path' && type !== 'clipPath') return invalid()
      if (attribute.name === 'mask' && type !== 'mask') return invalid()
      if (element.localName === 'use' && attribute.name === 'href' && !graphics.has(type)) return invalid()
      references.set(element, [...(references.get(element) ?? []), target])
    }
  }
  const visiting = new Set<Element>()
  const totals = new Map<Element, number>()
  const inspect = (element: Element, depth: number): number => {
    if (depth > 64 || visiting.has(element)) return invalid()
    const known = totals.get(element)
    if (known !== undefined) return known
    visiting.add(element)
    let count = 1
    for (const child of [...element.children, ...(references.get(element) ?? [])]) {
      count += inspect(child, depth + 1)
      if (count > 20_000) return invalid()
    }
    visiting.delete(element)
    totals.set(element, count)
    return count
  }
  inspect(root, 0)
}

function attributeNamespace(element: Element, attribute: Attr): string | null {
  if (attribute.namespaceURI || !attribute.name.includes(':')) return attribute.namespaceURI
  const prefix = attribute.name.split(':')[0]!
  if (prefix === 'xml') return XML_NS
  // Some XML DOM implementations expose the prefixed name without Attr.namespaceURI.
  for (let current: Element | null = element; current; current = current.parentElement) {
    const namespace = current.getAttribute(`xmlns:${prefix}`)
    if (namespace) return namespace
  }
  return invalid()
}

export function parseStickerSheetBranding(svg: string, name: string): StickerSheetBranding {
  try {
    if (typeof svg !== 'string' || !svg.trim() || new TextEncoder().encode(svg).byteLength > MAX_BYTES) return invalid()
    // Legacy Illustrator exports include this public DTD. Remove that exact known
    // declaration without resolving it; custom DTDs/entities remain unsupported.
    const source = svg.replace(/<!DOCTYPE\s+svg\s+PUBLIC\s+["']-\/\/W3C\/\/DTD SVG 1\.1\/\/EN["']\s+["']https?:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd["']\s*>/i, '')
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) return invalid()
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
    const input = parsed.documentElement
    if (!input || input.localName !== 'svg' || (input.namespaceURI && input.namespaceURI !== SVG_NS) || parsed.querySelector('parsererror')) return invalid()
    if ([...parsed.childNodes].some((node) => node.nodeType === 7)) return invalid()
    const box = input.getAttribute('viewBox')
    const dimensions = box ? finiteNumbers(box) : [0, 0, ...['width', 'height'].map((key) => {
      const value = input.getAttribute(key)?.trim() ?? ''
      const match = value.match(/^([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?)(?:px)?$/)
      return match ? Number(match[1]) : NaN
    })]
    if (dimensions.length !== 4 || dimensions.some((value) => !Number.isFinite(value)) || dimensions[2]! <= 0 || dimensions[3]! <= 0) return invalid()
    const aspectRatio = dimensions[2]! / dimensions[3]!
    if (aspectRatio < 0.02 || aspectRatio > 50) return invalid()
    // Build detached SVG elements. Nothing from the upload is mounted in the app.
    const output = document
    let count = 0
    const copy = (from: Element, depth: number): Element | null => {
      if (++count > 5000 || depth > 64 || from.namespaceURI !== input.namespaceURI) return invalid()
      if (from.localName === 'metadata') return null
      if (!elements.has(from.localName) && from.localName !== 'style') return invalid()
      const to = output.createElementNS(SVG_NS, from.localName)
      for (const attribute of [...from.attributes]) {
        const { name: key, value } = attribute
        const localName = key.includes(':') ? key.split(':').at(-1)! : attribute.localName
        const namespaceURI = attributeNamespace(from, attribute)
        if (/^on/i.test(localName) || (namespaceURI === XML_NS && localName === 'base')) return invalid()
        if (key === 'xmlns' || key.startsWith('xmlns:') || key.startsWith('data-') || key.startsWith('aria-') || ['version', 'baseProfile', 'role'].includes(key)) continue
        if (namespaceURI === XML_NS && localName === 'space') {
          if (!['default', 'preserve'].includes(value)) return invalid()
          to.setAttributeNS(XML_NS, 'xml:space', value)
          continue
        }
        if (namespaceURI && namespaceURI !== XLINK_NS) continue // editor-only attributes
        if (localName === 'href') {
          if (!['use', 'linearGradient', 'radialGradient'].includes(from.localName) || !value.startsWith('#') || !idPattern.test(value.slice(1))) return invalid()
          to.setAttribute('href', value)
          continue
        }
        if (namespaceURI) return invalid()
        if (key === 'id') { if (!idPattern.test(value)) return invalid() }
        else if (!['class', 'style'].includes(key) && !(from.localName === 'style' && key === 'type')) checkAttribute(key, value)
        to.setAttribute(key, presentation.has(key) ? presentationValue(key, value) : value)
      }
      for (const child of [...from.childNodes]) {
        if (child.nodeType === 1) {
          const clean = copy(child as Element, depth + 1)
          if (clean) to.appendChild(clean)
        } else if (child.nodeType === 3 || child.nodeType === 4) to.appendChild(output.createTextNode(child.textContent ?? ''))
        else if (child.nodeType !== 8) return invalid()
      }
      return to
    }
    const root = copy(input, 0)!
    resolveStyles(root)
    root.setAttribute('xmlns', SVG_NS)
    root.setAttribute('viewBox', dimensions.join(' '))
    root.setAttribute('width', String(dimensions[2]))
    root.setAttribute('height', String(dimensions[3]))
    checkReferences(root)
    return { name: typeof name === 'string' && name.trim() ? name.trim() : 'branding.svg', svg: new XMLSerializer().serializeToString(root), aspectRatio }
  } catch (cause) {
    throw new Error('invalidBranding', { cause })
  }
}

export function parseStoredStickerSheetBranding(raw: string | null): StickerSheetBranding | null {
  if (!raw) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const stored = data as Record<string, unknown>
    if (typeof stored.svg !== 'string' || typeof stored.name !== 'string') return null
    return parseStickerSheetBranding(stored.svg, stored.name)
  } catch {
    return null
  }
}
