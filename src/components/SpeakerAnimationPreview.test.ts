// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { langue } from '@/i18n'
import { createSpeakerDraft } from '@/ui/speaker'
import { createSpeakerAnimationSnapshot } from '@/ui/speakerAnimation'
import type { SpeakerAnimationSnapshot } from '@/shared/speakerAnimation'
import SpeakerAnimationPreview from './SpeakerAnimationPreview.vue'

vi.mock('@hyperframes/player', () => ({}))
vi.mock('gsap/dist/gsap.min.js?raw', () => ({ default: 'window.__localGSAP = true;' }))
vi.mock('@hyperframes/core/runtime?raw', () => ({ default: 'window.__localRuntime = true;' }))
vi.mock('@/ui/speakerAnimation', () => ({ createSpeakerAnimationSnapshot: vi.fn() }))

class FakePlayer extends HTMLElement {
  play = vi.fn()
  pause = vi.fn()
}
if (!customElements.get('hyperframes-player')) customElements.define('hyperframes-player', FakePlayer)

const snapshot = (): SpeakerAnimationSnapshot => ({
  width: 800, height: 600,
  background: 'data:image/png;base64,AA==', foreground: 'data:image/png;base64,AQ==', bots: []
})
let app: App | undefined
let host: HTMLDivElement
let intersection: (entries: Partial<IntersectionObserverEntry>[]) => void
let motionChange: () => void
let motion: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }
let disconnect: ReturnType<typeof vi.fn>
let inputs: { draft: ReturnType<typeof createSpeakerDraft>; width: number; active: boolean }

async function flush() {
  await vi.dynamicImportSettled()
  for (let count = 0; count < 8; count++) { await Promise.resolve(); await nextTick() }
}

async function mount(reduced = false) {
  motion.matches = reduced
  host = document.createElement('div')
  document.body.append(host)
  inputs = reactive({ draft: createSpeakerDraft(), width: 800, active: true })
  const assets = { portrait: new Image(), bots: [] }
  app = createApp({ render: () => h(SpeakerAnimationPreview, { ...inputs, assets, label: 'Animated card' }) })
  app.mount(host)
  await flush()
}
function player() { return host.querySelector('hyperframes-player')! as FakePlayer }
async function ready() { player().dispatchEvent(new Event('ready')); await flush() }

beforeEach(() => {
  vi.useFakeTimers()
  langue.value = 'en'
  vi.mocked(createSpeakerAnimationSnapshot).mockReset().mockResolvedValue(snapshot())
  motion = {
    matches: false,
    addEventListener: vi.fn((_event: string, callback: () => void) => { motionChange = callback }),
    removeEventListener: vi.fn()
  }
  vi.stubGlobal('matchMedia', vi.fn(() => motion))
  disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersection) { intersection = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  host?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('speaker animation preview lifecycle', () => {
  it('embeds locally bundled GSAP and runtime after the timeline, then starts on ready', async () => {
    await mount()
    const markup = player().getAttribute('srcdoc')!
    expect(markup).toContain('window.__localGSAP = true;')
    expect(markup).toContain('window.__localRuntime = true;')
    expect(markup.indexOf('window.__localRuntime')).toBeGreaterThan(markup.indexOf('window.__timelines ='))
    expect(markup).not.toMatch(/<script[^>]+src=/)
    expect(player().hasAttribute('loop')).toBe(true)
    expect(player().play).not.toHaveBeenCalled()
    await ready()
    expect(player().play).toHaveBeenCalled()
    expect(host.querySelector('[aria-busy]')!.getAttribute('aria-busy')).toBe('false')
  })

  it('pauses when Speakers, its viewport or the document is hidden and resumes when visible', async () => {
    await mount()
    await ready()
    const instance = player()
    for (const hide of [
      () => { inputs.active = false },
      () => { intersection([{ isIntersecting: false }]) },
      () => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) }
    ]) {
      instance.pause.mockClear()
      hide()
      await flush()
      expect(instance.pause).toHaveBeenCalled()
      instance.play.mockClear()
      inputs.active = true
      intersection([{ isIntersecting: true }])
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      await flush()
      expect(instance.play).toHaveBeenCalled()
    }
  })

  it('starts paused with reduced motion, allows explicit play, and responds to preference changes', async () => {
    await mount(true)
    await ready()
    expect(player().play).not.toHaveBeenCalled()
    const button = host.querySelector<HTMLButtonElement>('button[aria-label]')!
    button.click()
    await flush()
    expect(player().play).toHaveBeenCalled()
    player().pause.mockClear()
    motionChange()
    await flush()
    expect(player().pause).toHaveBeenCalled()
  })

  it('pauses the previous composition during a failed rebuild and allows retry', async () => {
    await mount()
    await ready()
    const previous = player()
    vi.mocked(createSpeakerAnimationSnapshot).mockRejectedValueOnce(new Error('Canvas unavailable'))
    inputs.draft.name = 'New speaker'
    await flush()
    expect(previous.pause).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(180)
    await flush()
    expect(host.querySelector('[role="status"]')).not.toBeNull()
    const retry = host.querySelector<HTMLButtonElement>('button')!
    expect(retry.textContent?.trim()).toBe('Try again')
    retry.click()
    await flush()
    expect(player()).not.toBe(previous)
    await ready()
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(player().play).toHaveBeenCalled()
  })

  it('ignores outdated snapshots and late ready events when a newer draft wins', async () => {
    await mount()
    await ready()
    const previous = player()
    let resolve!: (value: SpeakerAnimationSnapshot) => void
    vi.mocked(createSpeakerAnimationSnapshot).mockImplementationOnce(() => new Promise((yes) => { resolve = yes }))
    inputs.draft.name = 'First revision'
    await flush()
    await vi.advanceTimersByTimeAsync(180)
    await flush()
    inputs.width = 960
    await flush()
    previous.play.mockClear()
    previous.dispatchEvent(new Event('ready'))
    expect(previous.play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(180)
    await flush()
    const latest = player()
    resolve({ ...snapshot(), width: 123 })
    await flush()
    expect(player()).toBe(latest)
    expect(latest.getAttribute('width')).toBe('800')
  })

  it('reports missing ready events and cleans observers, timers and playback on unmount', async () => {
    await mount()
    const instance = player()
    await vi.advanceTimersByTimeAsync(15_000)
    await flush()
    expect(host.querySelector('button')!.textContent?.trim()).toBe('Try again')
    expect(instance.pause).toHaveBeenCalled()
    app!.unmount()
    app = undefined
    expect(disconnect).toHaveBeenCalled()
    expect(motion.removeEventListener).toHaveBeenCalledWith('change', motionChange)
    expect(vi.getTimerCount()).toBe(0)
  })
})
