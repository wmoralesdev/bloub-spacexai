import { describe, expect, it } from 'vitest'
import { BOT_CARD_QR_QUIET_ZONE, botCardQrSvg, createBotCardQr } from './botCardQr'

const BOT_URL = 'https://x.ai/bot/k0-KTE52S_yByrmgrzniJ'

describe('bot card QR codes', () => {
  it('encodes each bot URL into its own deterministic symbol', async () => {
    const first = await createBotCardQr(BOT_URL)
    const again = await createBotCardQr(` ${BOT_URL} `)
    const second = await createBotCardQr('https://x.ai/bot/another-bot')
    expect(first.url).toBe(BOT_URL)
    expect(again).toEqual(first)
    expect(second.modules).not.toEqual(first.modules)
    expect(first.count).toBeGreaterThanOrEqual(21)
    expect((first.count - 21) % 4).toBe(0)
    expect(first.modules).toHaveLength(first.count)
    expect(first.modules.every((row) => row.length === first.count)).toBe(true)
  })

  it('canonicalizes non-ASCII URLs before byte encoding and rejects unsafe destinations', async () => {
    const qr = await createBotCardQr('https://x.ai/bot/café')
    expect(qr.url).toBe('https://x.ai/bot/caf%C3%A9')
    for (const url of ['', 'not a URL', 'javascript:alert(1)', 'https://user:secret@x.ai/bot/test']) {
      await expect(createBotCardQr(url)).rejects.toThrow('valid bot URL')
    }
  })

  it('renders black vector modules without a backing and preserves the clear quiet zone', async () => {
    for (const url of [BOT_URL, `https://x.ai/${'a'.repeat(1187)}`]) {
      const qr = await createBotCardQr(url)
      const markup = botCardQrSvg(qr, { x: 700, y: 24, size: 270 })
      expect(markup).toContain('viewBox="0 0 540 540"')
      expect(markup).toContain('shape-rendering="crispEdges"')
      expect(markup).toContain('fill="#000000"')
      expect(markup).not.toContain('<rect')
      expect(markup).not.toMatch(/<(image|foreignObject|animate|script)\b/)
      const runs = [...markup.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)]
      const modulePixels = Number(runs[0]![4])
      const quiet = BOT_CARD_QR_QUIET_ZONE * modulePixels
      let darkModules = 0
      for (const run of runs) {
        const [x, y, width, height] = run.slice(1).map(Number) as [number, number, number, number]
        expect(height).toBe(modulePixels)
        expect(x).toBeGreaterThanOrEqual(quiet)
        expect(y).toBeGreaterThanOrEqual(quiet)
        expect(x + width).toBeLessThanOrEqual(540 - quiet)
        expect(y + height).toBeLessThanOrEqual(540 - quiet)
        darkModules += width / modulePixels
      }
      expect(modulePixels).toBeGreaterThanOrEqual(2)
      expect(darkModules).toBe(qr.modules.flat().filter(Boolean).length)
    }
  })
})
