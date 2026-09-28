// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { langue } from '@/i18n'
import type { StickerSheetBranding } from '@/ui/stickerSheetBranding'
import StickerBrandingUpload from './StickerBrandingUpload.vue'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0H100V50H0Z" fill="#00aabb"/></svg>'
const branding = ref<StickerSheetBranding | null>(null)
let app: App
let host: HTMLDivElement
async function flush() { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick() }
function button(label: string) { return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)! }
async function upload(text: Promise<string>, name = 'logo.svg', size = 100) {
  const input = host.querySelector('input')!
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name, size, text: () => text }] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}
beforeEach(() => {
  langue.value = 'en'
  branding.value = null
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(StickerBrandingUpload, {
    modelValue: branding.value,
    'onUpdate:modelValue': (value) => { branding.value = value }
  }) })
  app.mount(host)
})
afterEach(() => { app.unmount(); host.remove(); vi.restoreAllMocks() })

describe('SVG branding upload', () => {
  it('shows a local logo preview and removes the optional branding', async () => {
    await upload(Promise.resolve(SVG))
    expect(branding.value?.name).toBe('logo.svg')
    expect(branding.value?.aspectRatio).toBe(2)
    expect(host.querySelector('img')?.getAttribute('src')).toContain('data:image/svg+xml')
    button('Remove branding').click()
    await flush()
    expect(branding.value).toBeNull()
    expect(host.querySelector('img')).toBeNull()
  })

  it('preserves the previous logo when an invalid replacement is selected', async () => {
    await upload(Promise.resolve(SVG))
    const old = branding.value
    await upload(Promise.resolve('<svg><script>alert(1)</script></svg>'), 'bad.svg')
    expect(branding.value).toEqual(old)
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    await upload(Promise.resolve(SVG), 'large.svg', 256 * 1024 + 1)
    expect(branding.value).toEqual(old)
  })

  it('discards an older read when a replacement finishes first or is removed', async () => {
    let resolve!: (value: string) => void
    await upload(new Promise<string>((yes) => { resolve = yes }), 'slow.svg')
    await upload(Promise.resolve(SVG), 'latest.svg')
    resolve(SVG)
    await flush()
    expect(branding.value?.name).toBe('latest.svg')
    await upload(new Promise<string>((yes) => { resolve = yes }), 'removed.svg')
    button('Remove branding').click()
    resolve(SVG)
    await flush()
    expect(branding.value).toBeNull()
  })
})
