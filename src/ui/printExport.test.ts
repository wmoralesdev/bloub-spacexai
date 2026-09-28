import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportPrintPdf, printExportErrorKey, PrintExportError } from './printExport'

afterEach(() => vi.unstubAllGlobals())

describe('CMYK print client', () => {
  it('sends vector artwork and exact millimetres, returning only a PDF', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('%PDF-1.7\nCMYK', { headers: { 'Content-Type': 'application/pdf' } }))
    vi.stubGlobal('fetch', fetcher)
    const pdf = await exportPrintPdf('<svg/>', 139.7, 107.95)
    expect(await pdf.text()).toBe('%PDF-1.7\nCMYK')
    expect(fetcher).toHaveBeenCalledWith('/api/print-export', expect.objectContaining({ method: 'POST', body: JSON.stringify({ svg: '<svg/>', widthMm: 139.7, heightMm: 107.95 }) }))
  })

  it.each([[404, 'unavailable'], [503, 'unavailable'], [409, 'busy'], [400, 'invalid'], [413, 'invalid'], [500, 'failed']])('reports service status %s as %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: status as number })))
    await expect(exportPrintPdf('<svg/>', 100, 100)).rejects.toEqual(new PrintExportError(code as 'failed'))
  })

  it('rejects a frontend fallback and malformed PDF instead of saving them as CMYK', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('broken', { headers: { 'Content-Type': 'application/pdf' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(exportPrintPdf('<svg/>', 100, 100)).rejects.toEqual(new PrintExportError('unavailable'))
    await expect(exportPrintPdf('<svg/>', 100, 100)).rejects.toEqual(new PrintExportError('failed'))
  })

  it('rejects invalid dimensions before connecting to the service', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    for (const size of [NaN, 0, -10, Infinity, 1001]) await expect(exportPrintPdf('<svg/>', size, 100)).rejects.toEqual(new PrintExportError('invalid'))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves cancellation and gives unavailable-service errors a useful message key', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetcher)
    await expect(exportPrintPdf('<svg/>', 100, 100, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(exportPrintPdf('<svg/>', 100, 100)).rejects.toEqual(new PrintExportError('unavailable'))
    expect(printExportErrorKey(new PrintExportError('busy'))).toBe('printExport.busy')
  })
})
