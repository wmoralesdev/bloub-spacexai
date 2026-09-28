import { BOT_CARD_PRINT_SIZE_MM, botCardFilename, normalizeBotCardUrl, validBotCardPrintSize, type BotCard, type BotCardFormat, type BotCardPrintOptions } from './botCard'
import { exportBotCard } from './botCardRender'
import { zipBlob, type ZipEntry } from './zip'

/** Les deux faces de chaque carte, dans l'ordre de la collection au clic. */
export async function exportBotCardsZip(
  cards: readonly BotCard[],
  format: BotCardFormat,
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal,
  printOptions: BotCardPrintOptions = { sizeMm: BOT_CARD_PRINT_SIZE_MM }
): Promise<Blob> {
  const snapshot = cards.map((card) => ({ ...card }))
  const printSnapshot = { ...printOptions }
  signal?.throwIfAborted()
  if (format === 'pdf' && !validBotCardPrintSize(printSnapshot.sizeMm)) throw new RangeError('Invalid card print size')
  if (!snapshot.length) throw new Error('No bot cards to export')
  if (snapshot.some((card) => !card.name.trim() || !normalizeBotCardUrl(card.url))) {
    throw new Error('Every bot card needs a name and a valid bot URL')
  }

  const entries: ZipEntry[] = []
  const total = snapshot.length * 2
  onProgress?.(0, total)
  for (const [index, card] of snapshot.entries()) {
    const prefix = String(index + 1).padStart(2, '0')
    const basename = botCardFilename(card, 'svg').slice(0, -4)
    for (const side of ['front', 'back'] as const) {
      signal?.throwIfAborted()
      const blob = format === 'pdf'
        ? await exportBotCard(card, format, side, printSnapshot, signal)
        : await exportBotCard(card, format, side)
      signal?.throwIfAborted()
      const data = new Uint8Array(await blob.arrayBuffer())
      signal?.throwIfAborted()
      // Le numero distingue aussi les cartes dupliquees ou aux noms equivalents.
      entries.push({ name: `${prefix}-${basename}-${side}${format === 'pdf' ? '-cmyk' : ''}.${format}`, data })
      onProgress?.(entries.length, total)
      // Un seul rendu a la fois ; laisser l'interface afficher sa progression.
      if (entries.length < total) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  signal?.throwIfAborted()
  return zipBlob(entries)
}
