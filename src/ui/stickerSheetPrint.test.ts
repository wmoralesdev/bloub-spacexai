// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStickerSheetLayout, DEFAULT_STICKER_SHEET_SETTINGS } from './stickerSheet'
import { stickerSheetPrintZip, type StickerSheetRender } from './stickerSheetRender'
import { exportPrintPdf } from './printExport'

vi.mock('./printExport', () => ({ exportPrintPdf: vi.fn() }))
const sheet = (): StickerSheetRender => ({
  art: '<svg width="139.7mm" height="107.95mm"><path fill="red" d="M10 10h20v20Z"/></svg>',
  cut: '<svg width="139.7mm" height="107.95mm"><path stroke="#ff00a8" stroke-width="0.1" d="M10 10h20v20Z"/></svg>',
  overlay: '',
  layout: createStickerSheetLayout({ ...DEFAULT_STICKER_SHEET_SETTINGS, widthMm: 139.7, heightMm: 107.95 }, 1)
})

async function entries(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const result: Record<string, string> = {}
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const start = offset + 30 + nameLength + view.getUint16(offset + 28, true)
    result[new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength))] = new TextDecoder().decode(bytes.subarray(start, start + size))
    offset = start + size
  }
  return result
}

beforeEach(() => vi.mocked(exportPrintPdf).mockReset().mockResolvedValue(new Blob(['%PDF-1.7 CMYK'], { type: 'application/pdf' })))

describe('sticker print bundle', () => {
  it('converts artwork at exact physical dimensions and retains unmodified vector cut lines', async () => {
    const original = sheet()
    const zip = await stickerSheetPrintZip(original)
    expect(exportPrintPdf).toHaveBeenCalledWith(original.art, 139.7, 107.95, undefined)
    expect(await entries(zip)).toEqual({ 'arte-cmyk.pdf': '%PDF-1.7 CMYK', 'troquel.svg': original.cut })
  })

  it.each(['brandingOutOfBounds', 'brandingOverlaps'] as const)('rejects %s before converting anything', async (key) => {
    await expect(stickerSheetPrintZip({ ...sheet(), [key]: true })).rejects.toThrow('incompleteSheet')
    expect(exportPrintPdf).not.toHaveBeenCalled()
  })

  it('snapshots cut lines and respects cancellation while conversion is pending', async () => {
    let resolve!: (blob: Blob) => void
    vi.mocked(exportPrintPdf).mockReturnValueOnce(new Promise((yes) => { resolve = yes }))
    const original = sheet()
    const oldCut = original.cut
    const pending = stickerSheetPrintZip(original)
    original.cut = 'new cut lines'
    resolve(new Blob(['%PDF-1.7 CMYK']))
    expect((await entries(await pending))['troquel.svg']).toBe(oldCut)
    const controller = new AbortController()
    controller.abort()
    await expect(stickerSheetPrintZip(sheet(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
