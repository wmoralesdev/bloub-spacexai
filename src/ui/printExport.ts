import type { Cle } from '@/i18n'

type PrintErrorCode = 'unavailable' | 'busy' | 'failed' | 'invalid'

export class PrintExportError extends Error {
  constructor(readonly code: PrintErrorCode) { super(code) }
}

export function printExportErrorKey(error: unknown): Cle {
  const code = error instanceof PrintExportError ? error.code : 'failed'
  return `printExport.${code}`
}

/** Convert the exact vector artwork to a physical CMYK PDF on the local service. */
export async function exportPrintPdf(svg: string, widthMm: number, heightMm: number, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  if (!svg.trim() || ![widthMm, heightMm].every((value) => Number.isFinite(value) && value > 0 && value <= 1000)) {
    throw new PrintExportError('invalid')
  }
  const timeout = AbortSignal.timeout(120_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/print-export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ svg, widthMm, heightMm }), signal: requestSignal
    })
    if (!response.ok) {
      if (response.status === 409) throw new PrintExportError('busy')
      if ([404, 502, 503, 504].includes(response.status)) throw new PrintExportError('unavailable')
      throw new PrintExportError([400, 413, 415].includes(response.status) ? 'invalid' : 'failed')
    }
    // A frontend-only server may return index.html with status 200 for API routes.
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) throw new PrintExportError('unavailable')
    const pdf = await response.blob()
    signal?.throwIfAborted()
    if (await pdf.slice(0, 5).text() !== '%PDF-') throw new PrintExportError('failed')
    return pdf
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof PrintExportError) throw error
    throw new PrintExportError(timeout.aborted ? 'failed' : 'unavailable')
  }
}
