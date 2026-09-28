import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBotCard, type BotCard } from './botCard'
import { exportBotCard } from './botCardRender'
import { exportBotCardsZip } from './botCardBatch'

vi.mock('./botCardRender', () => ({ exportBotCard: vi.fn() }))

const card = (overrides: Partial<BotCard> = {}): BotCard => ({
  ...createBotCard(), name: 'Grok Bot', eventName: 'Grok Bot\nSan Salvador Meetup',
  url: 'https://example.com/bot', ...overrides
})

async function readEntries(blob: Blob) {
  const buffer = await blob.arrayBuffer()
  const view = new DataView(buffer)
  const decoder = new TextDecoder()
  const entries: { name: string; content: string }[] = []
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const dataOffset = offset + 30 + nameLength + extraLength
    entries.push({
      name: decoder.decode(buffer.slice(offset + 30, offset + 30 + nameLength)),
      content: decoder.decode(buffer.slice(dataOffset, dataOffset + size))
    })
    offset = dataOffset + size
  }
  return entries
}

beforeEach(() => {
  vi.mocked(exportBotCard).mockReset().mockImplementation(async (item, format, side) =>
    new Blob([JSON.stringify({ ...item, format, side })])
  )
})

describe('bot card collection ZIP', () => {
  it.each(['png', 'svg'] as const)('includes both sides of every card in %s, preserving duplicate names and multiline titles', async (format) => {
    const cards = [card(), card({ id: 'card2', url: 'https://example.com/another', bodyColor: '#112233' })]
    const progress = vi.fn()
    const blob = await exportBotCardsZip(cards, format, progress)
    expect(blob.type).toBe('application/zip')
    const entries = await readEntries(blob)
    expect(entries.map((entry) => entry.name)).toEqual([
      `01-bot-card-grok-bot-front.${format}`, `01-bot-card-grok-bot-back.${format}`,
      `02-bot-card-grok-bot-front.${format}`, `02-bot-card-grok-bot-back.${format}`
    ])
    expect(entries.map((entry) => JSON.parse(entry.content))).toEqual(
      cards.flatMap((item) => ['front', 'back'].map((side) => ({ ...item, format, side })))
    )
    expect(progress.mock.calls).toEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]])
  })

  it('captures the entire collection before rendering and renders sequentially', async () => {
    const cards = [card(), card({ id: 'card2', name: 'Second' })]
    const expected = cards.map((item) => ({ ...item }))
    let finish!: (value: Blob) => void
    vi.mocked(exportBotCard).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = exportBotCardsZip(cards, 'svg')
    expect(exportBotCard).toHaveBeenCalledTimes(1)
    cards[0]!.eventName = 'Changed after clicking'
    cards[1]!.name = 'Renamed'
    cards[1]!.url = 'https://example.com/new'
    cards.splice(0, cards.length)
    finish(new Blob(['first']))
    const entries = await readEntries(await pending)
    expect(entries).toHaveLength(4)
    expect(exportBotCard).toHaveBeenNthCalledWith(2, expected[0], 'svg', 'back')
    expect(exportBotCard).toHaveBeenNthCalledWith(3, expected[1], 'svg', 'front')
    expect(entries[2]!.name).toBe('02-bot-card-second-front.svg')
  })

  it('exports both PDF faces with CMYK filenames and one captured physical size', async () => {
    const cards = [card(), card({ id: 'card2', name: 'Second' })]
    const options = { sizeMm: 120 }
    const signal = new AbortController().signal
    const progress = (completed: number) => { if (completed === 1) options.sizeMm = 200 }
    const entries = await readEntries(await exportBotCardsZip(cards, 'pdf', progress, signal, options))
    expect(entries.map((entry) => entry.name)).toEqual([
      '01-bot-card-grok-bot-front-cmyk.pdf', '01-bot-card-grok-bot-back-cmyk.pdf',
      '02-bot-card-second-front-cmyk.pdf', '02-bot-card-second-back-cmyk.pdf'
    ])
    expect(vi.mocked(exportBotCard).mock.calls.map((call) => [call[3], call[4]]))
      .toEqual(Array.from({ length: 4 }, () => [{ sizeMm: 120 }, signal]))
  })

  it('rejects invalid PDF sizes before generating any face', async () => {
    await expect(exportBotCardsZip([card()], 'pdf', undefined, undefined, { sizeMm: 0 }))
      .rejects.toThrow('print size')
    expect(exportBotCard).not.toHaveBeenCalled()
  })

  it('validates the whole collection before rendering and never silently skips incomplete cards', async () => {
    for (const cards of [[], [card(), card({ name: ' ' })], [card(), card({ url: '' })], [card(), card({ url: 'javascript:alert(1)' })]]) {
      await expect(exportBotCardsZip(cards, 'svg')).rejects.toThrow()
    }
    expect(exportBotCard).not.toHaveBeenCalled()
  })

  it('rejects a failed render instead of returning a partial archive and can be retried', async () => {
    vi.mocked(exportBotCard).mockResolvedValueOnce(new Blob(['front'])).mockRejectedValueOnce(new Error('Render failed'))
    await expect(exportBotCardsZip([card()], 'png')).rejects.toThrow('Render failed')
    expect(await readEntries(await exportBotCardsZip([card()], 'png'))).toHaveLength(2)
  })

  it('stops rendering when aborted without completing an archive', async () => {
    const controller = new AbortController()
    const progress = (completed: number) => { if (completed === 1) controller.abort() }
    await expect(exportBotCardsZip([card(), card()], 'png', progress, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(exportBotCard).toHaveBeenCalledTimes(1)
  })
})
