// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseStickerSheetBranding, parseStoredStickerSheetBranding } from './stickerSheetBranding'

const wrap = (body = '<path d="M0 0H100V40H0Z"/>', attributes = 'viewBox="0 0 100 40"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`
const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml')

describe('portable uploaded SVG branding', () => {
  it('keeps vector paths and physical proportions, with a trimmed or default name', () => {
    const result = parseStickerSheetBranding(wrap(), '  Our logo.svg  ')
    const svg = parse(result.svg)
    expect(result).toMatchObject({ name: 'Our logo.svg', aspectRatio: 2.5 })
    expect(svg.documentElement.getAttribute('viewBox')).toBe('0 0 100 40')
    expect(svg.documentElement.getAttribute('width')).toBe('100')
    expect(svg.documentElement.getAttribute('height')).toBe('40')
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M0 0H100V40H0Z')
    expect(parseStickerSheetBranding(wrap(), ' ').name).toBe('branding.svg')
  })

  it('creates a viewBox from unitless or px dimensions and accepts unnamespaced SVG', () => {
    const result = parseStickerSheetBranding('<svg width="120px" height="30"><rect width="120" height="30"/></svg>', 'logo.svg')
    expect(result.aspectRatio).toBe(4)
    expect(parse(result.svg).documentElement.getAttribute('viewBox')).toBe('0 0 120 30')
    expect(parse(result.svg).documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg')
  })

  it('preserves Figma gradients, clipping, masking and local use references', () => {
    const result = parseStickerSheetBranding(wrap(`
      <defs>
        <linearGradient id="paint0"><stop stop-color="#ff9900"/><stop offset="1" stop-color="#ff00ff"/></linearGradient>
        <linearGradient id="paint1" href="#paint0" gradientTransform="rotate(30)"/>
        <clipPath id="clip0"><rect width="100" height="40" rx="4"/></clipPath>
        <mask id="mask0" maskUnits="userSpaceOnUse"><rect width="100" height="40" fill="white"/></mask>
        <path id="logo" d="M0 0H100V40H0Z"/>
      </defs>
      <g clip-path="url('#clip0')" mask="url(#mask0)"><use href="#logo" fill="url(#paint1)" transform="translate(2 0) scale(.9)"/></g>
    `), 'figma.svg')
    const svg = parse(result.svg)
    expect(svg.querySelectorAll('linearGradient')).toHaveLength(2)
    expect(svg.querySelector('g')?.getAttribute('clip-path')).toBe('url(#clip0)')
    expect(svg.querySelector('use')?.getAttribute('href')).toBe('#logo')
    expect(svg.querySelector('use')?.getAttribute('fill')).toBe('url(#paint1)')
    expect(svg.querySelector('use')?.getAttribute('transform')).toBe('translate(2 0) scale(.9)')
    expect(svg.querySelectorAll('style, script, image, foreignObject')).toHaveLength(0)
  })

  it('resolves Illustrator classes and inline presentation styles without leaking CSS', () => {
    const result = parseStickerSheetBranding(wrap(`
      <style type="text/css">
        .cls-1 { fill: #123456; stroke-width: 2px; }
        path.cls-1 { fill: #abcdef; }
        #wordmark { fill: #008800 !important; }
        .cls-2, .cls-3 { fill-rule: evenodd; opacity: .8; }
      </style>
      <path id="wordmark" class="cls-1 cls-2" style="fill: #ff0000; stroke: #000;" d="M0 0H10V10Z"/>
      <path class="cls-1" d="M20 0H30V10Z"/>
    `), 'illustrator.svg')
    const svg = parse(result.svg)
    const first = svg.querySelector('#wordmark')!
    expect(first.getAttribute('fill')).toBe('#008800')
    expect(first.getAttribute('stroke')).toBe('#000')
    expect(first.getAttribute('stroke-width')).toBe('2px')
    expect(first.getAttribute('fill-rule')).toBe('evenodd')
    expect(first.getAttribute('opacity')).toBe('.8')
    expect(svg.querySelectorAll('path')[1]?.getAttribute('fill')).toBe('#abcdef')
    expect(svg.querySelectorAll('style, [style], [class]')).toHaveLength(0)
  })

  it('strips editor metadata and comments and normalizes xlink references', () => {
    const source = `<?xml version="1.0" encoding="utf-8"?>
      <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:editor="https://editor.example" viewBox="0 0 100 40" editor:version="2" style="enable-background: new 0 0 100 40;">
        <metadata><editor:settings>Private editor state</editor:settings></metadata>
        <!-- private comment -->
        <defs><path id="mark" d="M0 0H100V40Z"/></defs><use xlink:href="#mark"/>
      </svg>`
    const result = parseStickerSheetBranding(source, 'logo.svg')
    expect(result.svg).not.toMatch(/DOCTYPE|metadata|Private|private|editor|xlink/)
    expect(parse(result.svg).querySelector('use')?.getAttribute('href')).toBe('#mark')
  })

  it('retains validated blend/isolation styles that have no SVG attribute equivalent', () => {
    const result = parseStickerSheetBranding(wrap('<g style="isolation:isolate"><path style="mix-blend-mode:multiply;fill:#ff0000" d="M0 0H100V40Z"/></g>'), 'blended.svg')
    const svg = parse(result.svg)
    expect(svg.querySelector('g')?.getAttribute('style')).toBe('isolation:isolate')
    expect(svg.querySelector('path')?.getAttribute('style')).toBe('mix-blend-mode:multiply')
    expect(svg.querySelector('path')?.getAttribute('fill')).toBe('#ff0000')
  })

  it.each([
    '<path d="M0 0H100V40Z" stroke="#000" vector-effect="non-scaling-stroke"/>',
    '<path d="M0 0H100V40Z" style="stroke:#000;vector-effect:non-scaling-stroke"/>',
    '<style>.mark {vector-effect:non-scaling-stroke}</style><path class="mark" d="M0 0H100V40Z"/>'
  ])('rejects non-scaling strokes that cannot share the cut contour scale: %s', (body) => {
    expect(() => parseStickerSheetBranding(wrap(body), 'fixed-stroke.svg')).toThrow('invalidBranding')
  })

  it('preserves normal scaling strokes with explicit vector-effect none', () => {
    const result = parseStickerSheetBranding(wrap('<path d="M0 0H100V40Z" style="stroke:#000;stroke-width:2;vector-effect:none"/>'), 'normal-stroke.svg')
    const path = parse(result.svg).querySelector('path')!
    expect(path.getAttribute('vector-effect')).toBe('none')
    expect(path.getAttribute('stroke')).toBe('#000')
    expect(path.getAttribute('stroke-width')).toBe('2')
  })

  it.each([
    '', '<svg><path></svg>', '<svg/><svg/>', '<html/>', '<svg/>',
    wrap('', 'viewBox="0 0 0 40"'), wrap('', 'viewBox="0 0 NaN 40"'),
    wrap('', 'viewBox="0 0 1e999 40"'), wrap('', 'viewBox="0 0 1 100"'),
    wrap('', 'width="100%" height="40%"'), wrap('', 'width="10cm" height="4cm"')
  ])('rejects malformed or unmeasurable SVG %s', (svg) => {
    expect(() => parseStickerSheetBranding(svg, 'bad.svg')).toThrow('invalidBranding')
  })

  it.each([
    '<script>alert(1)</script>',
    '<text x="0" y="20" font-family="Arial">Live text must be outlined</text>',
    '<tspan>Live text</tspan>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject>',
    '<image href="data:image/png;base64,abc"/>',
    '<image href="https://example.test/image.png"/>',
    '<path d="M0 0H1V1Z" onload="alert(1)"/>',
    '<animate attributeName="fill" values="red;blue"/>',
    '<use href="https://example.test/logo.svg#logo"/>',
    '<use href="javascript:alert(1)"/>',
    '<path d="M0 0H1V1Z" fill="url(https://example.test/paint.svg#a)"/>',
    '<path d="M0 0H1V1Z" style="fill:url(data:image/svg+xml;base64,abc)"/>',
    '<style>@import url(https://example.test/style.css);</style>',
    '<style>.a { fill: red; animation: spin 2s; }</style><path class="a" d="M0 0H1V1Z"/>',
    '<style>@media screen {.a { fill: red; }}</style>',
    '<style>.a {fill: u\\72l(https://example.test/a);}</style>',
    '<style>.a:hover {fill: red;}</style>',
    '<path d="M0 0H1V1Z" style="background-image: url(https://example.test/a)"/>',
    '<path d="M0 0H1V1Z" style="fill: var(--outside-color)"/>',
    '<a href="https://example.test"><path d="M0 0H1V1Z"/></a>',
    '<g xml:base="https://example.test/"><use href="#logo"/></g>',
    '<defs><path id="duplicate" d="M0 0H1V1Z"/><path id="duplicate" d="M0 0H1V1Z"/></defs>',
    '<use href="#missing"/>',
    '<g id="recursive"><use href="#recursive"/></g>',
    '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>'
  ])('rejects active, external or unresolved content: %s', (body) => {
    expect(() => parseStickerSheetBranding(wrap(body), 'bad.svg')).toThrow('invalidBranding')
  })

  it('rejects custom entities and XML stylesheet instructions', () => {
    expect(() => parseStickerSheetBranding('<!DOCTYPE svg [<!ENTITY attack SYSTEM "file:///etc/passwd">]>' + wrap('<text>&attack;</text>'), 'bad.svg')).toThrow('invalidBranding')
    expect(() => parseStickerSheetBranding('<?xml-stylesheet href="https://example.test/style.css"?>' + wrap(), 'bad.svg')).toThrow('invalidBranding')
  })

  it('bounds upload size in UTF-8 bytes, not JavaScript characters', () => {
    const oversized = wrap(`<title>${'ñ'.repeat(132_000)}</title>`)
    expect(oversized.length).toBeLessThan(256 * 1024)
    expect(() => parseStickerSheetBranding(oversized, 'large.svg')).toThrow('invalidBranding')
  })

  it('re-sanitizes persisted markup and recomputes its aspect ratio', () => {
    const result = parseStoredStickerSheetBranding(JSON.stringify({ name: ' Brand ', svg: wrap(), aspectRatio: 999 }))
    expect(result).toMatchObject({ name: 'Brand', aspectRatio: 2.5 })
    expect(parseStoredStickerSheetBranding(JSON.stringify(result))).toEqual(result)
    expect(parseStoredStickerSheetBranding(JSON.stringify({ name: 'bad', svg: wrap('<script>alert(1)</script>') }))).toBeNull()
    for (const raw of [null, '', '{', 'null', '[]', '{}', '{"svg":5,"name":"brand"}']) expect(parseStoredStickerSheetBranding(raw)).toBeNull()
  })
})
