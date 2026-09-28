// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { gsap } from 'gsap'
import { BotEngine } from '../bot/engine'
import { EXPRESSION_BY_ID } from '../bot/expressions'
import {
  createSpeakerComposition,
  SPEAKER_ANIMATION_DURATION,
  SPEAKER_ANIMATION_FLOAT_RATIO,
  type SpeakerAnimationSnapshot
} from './speakerAnimation'

const snapshot = (): SpeakerAnimationSnapshot => ({
  width: 800, height: 600,
  background: 'data:image/png;base64,AA==', foreground: 'data:image/png;base64,AQ==',
  bots: Array.from({ length: 5 }, (_, index) => {
    const neutral = new BotEngine(100, 'idle', null, EXPRESSION_BY_ID.get('neutre')!).sample(0)
    return {
      x: 100 + index * 120, y: 550, size: [100, 55, 200, 400, 1][index]!, angle: index * 10,
      color: ['#ffffff', '#5bd7cb', '#f28eb6', '#537cf4', '#ffa632'][index]!,
      bodyPath: neutral.bodyPath, viewBox: '-125 -125 250 250', eyes: neutral.eyes
    }
  })
})

function composition(value = snapshot()) {
  const doc = new DOMParser().parseFromString(createSpeakerComposition(value, ''), 'text/html')
  const runtime = {} as { __timelines: Record<string, gsap.core.Timeline> }
  const code = doc.querySelectorAll('script')[1]!.textContent!
  new Function('gsap', 'document', 'window', code)(gsap, doc, runtime)
  return { doc, timeline: runtime.__timelines['speaker-card']! }
}

function motionTransforms(doc: Document | Element) {
  return Array.from(doc.querySelectorAll('[data-float], [data-gaze], [data-blink]'), (element) => element.getAttribute('transform'))
}

function translation(element: Element): [number, number] {
  return element.getAttribute('transform')!.match(/-?[\d.]+/g)!.map(Number) as [number, number]
}

function lid(element: Element) {
  return Number(/scale\(1 ([\d.]+)\)/.exec(element.getAttribute('transform')!)![1])
}

const timelines: gsap.core.Timeline[] = []
afterEach(() => timelines.splice(0).forEach((timeline) => timeline.kill()))

describe('speaker Hyperframes composition', () => {
  it('registers one paused finite timeline with the layer order and dimensions', () => {
    const { doc, timeline } = composition()
    timelines.push(timeline)
    expect(timeline.duration()).toBe(SPEAKER_ANIMATION_DURATION)
    expect(timeline.paused()).toBe(true)
    expect(timeline.repeat()).toBe(0)
    const root = doc.querySelector('[data-composition-id="speaker-card"]')!
    expect(root.getAttribute('data-duration')).toBe('6')
    expect(root.getAttribute('data-width')).toBe('800')
    expect(root.getAttribute('data-height')).toBe('600')
    expect(Array.from(root.children, (layer) => layer.getAttribute('data-layer'))).toEqual(['background', 'bots', 'foreground'])
    expect(doc.querySelectorAll('[data-body]')).toHaveLength(5)
    expect(doc.querySelectorAll('script[src]')).toHaveLength(0)
    expect(doc.querySelector('[data-expression]')).toBeNull()
  })

  it('seeks reproducibly in either direction, closing the loop with the same resting pose and velocity', () => {
    const { doc, timeline } = composition()
    timelines.push(timeline)
    const sample = (time: number) => {
      timeline.seek(time)
      return motionTransforms(doc)
    }
    const start = sample(0)
    expect(sample(0.01)).toEqual(start)
    const middle = sample(2.67)
    expect(middle).not.toEqual(start)
    expect(sample(6)).toEqual(start)
    expect(sample(5.99)).toEqual(start)
    expect(sample(2.67)).toEqual(middle)
    sample(1.15)
    expect(sample(2.67)).toEqual(middle)
    expect(sample(0)).toEqual(start)
    // Renderer seeks suppress callbacks, so motion cannot depend on onUpdate.
    for (const time of [3.31, 1.21, 5.01, 4.22, 0.91]) {
      const expected = sample(time)
      sample(6)
      expect(sample(time)).toEqual(expected)
      sample(0)
      expect(sample(time)).toEqual(expected)
    }
  })

  it('preserves every neutral eye path, body silhouette, angle, size, color and raster layer across two loops', () => {
    const { doc, timeline } = composition()
    timelines.push(timeline)
    const still = () => Array.from(doc.querySelectorAll('[data-body], [data-body-mask], [data-bot], [data-rotation], [data-eye], img, rect, svg'), (element) =>
      [element.tagName, element.getAttribute('d'), element.getAttribute('transform'), element.getAttribute('src'), element.getAttribute('fill'), element.getAttribute('width'), element.getAttribute('height'), element.getAttribute('opacity')])
    const initial = still()
    for (let frame = 0; frame <= 720; frame++) {
      timeline.seek((frame % 360) / 60)
      expect(still()).toEqual(initial)
    }
  })

  it('bounds floating to 0.3 percent of bot size and eye glances to tiny offsets', () => {
    const value = snapshot()
    const { doc, timeline } = composition(value)
    timelines.push(timeline)
    const bots = Array.from(doc.querySelectorAll('[data-bot]'))
    const peakFloat = bots.map(() => 0)
    const peakGaze = bots.map(() => 0)
    for (let frame = 0; frame <= 720; frame++) {
      timeline.seek(frame / 120)
      bots.forEach((bot, index) => {
        const [x, y] = translation(bot.querySelector('[data-float]')!)
        expect(x).toBe(0)
        expect(Math.abs(y)).toBeLessThanOrEqual(value.bots[index]!.size * SPEAKER_ANIMATION_FLOAT_RATIO + 0.0001)
        peakFloat[index] = Math.max(peakFloat[index]!, Math.abs(y))
        const [gx, gy] = translation(bot.querySelector('[data-gaze]')!)
        expect(Math.abs(gx)).toBeLessThanOrEqual(1.6)
        expect(Math.abs(gy)).toBeLessThanOrEqual(0.4)
        peakGaze[index] = Math.max(peakGaze[index]!, Math.abs(gx))
      })
    }
    peakFloat.forEach((amount) => expect(amount).toBeGreaterThan(0))
    peakGaze.forEach((amount) => expect(amount).toBeGreaterThan(0))
    // Floating precedes rotation so it moves vertically in output coordinates.
    for (const bot of bots) expect(bot.querySelector('[data-float] > [data-rotation]')).not.toBeNull()
  })

  it('gives every bot a different gaze, float and blink rhythm, with overlapping natural motion', () => {
    const { doc, timeline } = composition()
    timelines.push(timeline)
    const bots = Array.from(doc.querySelectorAll('[data-bot]'))
    const signatures = bots.map(() => [] as string[])
    const blinkStarts = bots.map(() => [] as number[])
    let previousBlinks = bots.map(() => false)
    let overlaps = false
    for (let frame = 0; frame <= 720; frame++) {
      timeline.seek(frame / 120)
      const blinking = bots.map((bot) => lid(bot.querySelector('[data-blink]')!) < 0.2)
      blinking.forEach((closed, index) => {
        if (closed && !previousBlinks[index]) blinkStarts[index]!.push(frame)
      })
      previousBlinks = blinking
      bots.forEach((bot, index) => signatures[index]!.push(motionTransforms(bot).join('|')))
      if (bots.filter((bot) => translation(bot.querySelector('[data-gaze]')!).some((offset) => offset !== 0)).length > 1) overlaps = true
    }
    expect(overlaps).toBe(true)
    expect(new Set(signatures.map((signature) => signature.join(';'))).size).toBe(5)
    expect(new Set(blinkStarts.map((times) => times.join(','))).size).toBe(5)
    for (const times of blinkStarts) expect(times).toHaveLength(2)
  })

  it('renders identical geometry when the first seek starts midway through the loop', () => {
    const reference = composition()
    timelines.push(reference.timeline)
    for (const time of [0.96, 1.99, 2.87, 3.75, 4.29, 5.07]) {
      const fresh = composition()
      timelines.push(fresh.timeline)
      reference.timeline.seek(time)
      fresh.timeline.seek(time)
      expect(motionTransforms(fresh.doc)).toEqual(motionTransforms(reference.doc))
      fresh.timeline.seek(0)
      reference.timeline.seek(0)
      expect(motionTransforms(fresh.doc)).toEqual(motionTransforms(reference.doc))
    }
  })

  it('adds an optional local preview runtime after the complete timeline', () => {
    const doc = new DOMParser().parseFromString(createSpeakerComposition(snapshot(), 'window.gsap = {};', 'window.__localRuntime = true;'), 'text/html')
    const scripts = Array.from(doc.querySelectorAll('script'))
    expect(scripts).toHaveLength(3)
    expect(scripts[1]!.textContent).toContain('window.__timelines =')
    expect(scripts[2]!.textContent).toBe('window.__localRuntime = true;')
    expect(doc.querySelector('script[src]')).toBeNull()
  })

  it('preserves six seconds with no visible bots', () => {
    const { doc, timeline } = composition({ ...snapshot(), bots: [] })
    timelines.push(timeline)
    expect(timeline.duration()).toBe(6)
    expect(doc.querySelectorAll('[data-bot]')).toHaveLength(0)
    timeline.seek(6)
    timeline.seek(0)
    expect(timeline.time()).toBe(0)
  })

  it('escapes untrusted attribute content and closing script text without creating executable markup', () => {
    const value = snapshot()
    const attack = '\"><script>alert(1)</script><path onload="alert(2)'
    value.bots[0]!.bodyPath = attack
    value.bots[0]!.eyes[0]!.d = attack
    value.background = attack
    const doc = new DOMParser().parseFromString(createSpeakerComposition(value, 'const text = "</script><script>unexpected()";'), 'text/html')
    expect(doc.querySelectorAll('script')).toHaveLength(2)
    expect(doc.querySelector('[onload]')).toBeNull()
    expect(doc.querySelector('[data-body]')!.getAttribute('d')).toBe(attack)
    expect(doc.querySelector('[data-eye]')!.getAttribute('d')).toBe(attack)
    expect(doc.querySelector('[data-layer="background"]')!.getAttribute('src')).toBe(attack)
    expect(doc.querySelector('script')!.textContent).toContain('<\\/script>')
  })
})
