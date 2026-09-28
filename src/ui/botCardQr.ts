import { BOT_CARD_SIZE, normalizeBotCardUrl } from './botCard'

export const BOT_CARD_QR_QUIET_ZONE = 4

export interface BotCardQr {
  url: string
  count: number
  modules: boolean[][]
}

export interface BotCardQrPlacement { x: number; y: number; size: number }

const qrCache = new Map<string, Promise<BotCardQr>>()

/** Le code et ses donnees restent locaux ; la librairie arrive au premier verso. */
export async function createBotCardQr(value: string): Promise<BotCardQr> {
  const url = normalizeBotCardUrl(value)
  if (!url) throw new Error('A valid bot URL is required to export the back')
  const cached = qrCache.get(url)
  if (cached) return cached
  const pending = (async () => {
    const { default: qrcode } = await import('qrcode-generator')
    const qr = qrcode(0, 'M')
    qr.addData(url, 'Byte')
    qr.make()
    const count = qr.getModuleCount()
    return {
      url,
      count,
      modules: Array.from({ length: count }, (_, row) =>
        Array.from({ length: count }, (_, col) => qr.isDark(row, col))
      )
    }
  })()
  if (qrCache.size >= 32) qrCache.delete(qrCache.keys().next().value!)
  qrCache.set(url, pending)
  try {
    return await pending
  } catch (error) {
    qrCache.delete(url)
    throw error
  }
}

/** Modules noirs entiers au format PNG, avec quatre modules de marge transparente. */
export function botCardQrSvg(qr: BotCardQr, placement: BotCardQrPlacement): string {
  const scale = BOT_CARD_SIZE / 1000
  const pixels = Math.round(placement.size * scale)
  const total = qr.count + BOT_CARD_QR_QUIET_ZONE * 2
  const modulePixels = Math.floor(pixels / total)
  if (modulePixels < 1) throw new Error('Bot card QR code does not fit')
  const margin = Math.floor((pixels - total * modulePixels) / 2)
  const offset = margin + BOT_CARD_QR_QUIET_ZONE * modulePixels
  const path: string[] = []
  for (let row = 0; row < qr.count; row++) {
    for (let col = 0; col < qr.count;) {
      if (!qr.modules[row]![col]) {
        col++
        continue
      }
      const start = col
      while (col < qr.count && qr.modules[row]![col]) col++
      const width = (col - start) * modulePixels
      path.push(`M${offset + start * modulePixels} ${offset + row * modulePixels}h${width}v${modulePixels}h-${width}z`)
    }
  }
  const x = Math.round(placement.x * scale) / scale
  const y = Math.round(placement.y * scale) / scale
  return `<svg data-bot-card-qr="true" xmlns="http://www.w3.org/2000/svg" x="${x}" y="${y}" width="${pixels / scale}" height="${pixels / scale}" viewBox="0 0 ${pixels} ${pixels}" shape-rendering="crispEdges"><path d="${path.join('')}" fill="#000000"/></svg>`
}
