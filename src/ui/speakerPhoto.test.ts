// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeSpeakerPhoto } from './speakerPhoto'

afterEach(() => vi.restoreAllMocks())

describe('persistent speaker photos', () => {
  it('bounds large photos without stretching or adding an opaque background', () => {
    const drawImage = vi.fn()
    const fillRect = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, fillRect } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,YQ==')
    const photo = { naturalWidth: 2400, naturalHeight: 3600 } as HTMLImageElement
    expect(encodeSpeakerPhoto(photo)).toBe('data:image/webp;base64,YQ==')
    expect(drawImage).toHaveBeenCalledWith(photo, 0, 0, 800, 1200)
    expect(fillRect).not.toHaveBeenCalled()
  })

  it('keeps small images at their original resolution and shrinks over-budget encodings', () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValueOnce('data:image/webp;base64,' + 'A'.repeat(1_800_000))
      .mockReturnValue('data:image/png;base64,YQ==')
    const photo = { naturalWidth: 800, naturalHeight: 600 } as HTMLImageElement
    expect(encodeSpeakerPhoto(photo)).toBe('data:image/png;base64,YQ==')
    expect(drawImage).toHaveBeenNthCalledWith(1, photo, 0, 0, 800, 600)
    expect(drawImage).toHaveBeenNthCalledWith(2, photo, 0, 0, 600, 450)
  })

  it('rejects unavailable encoders and empty images', () => {
    expect(() => encodeSpeakerPhoto({ naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement)).toThrow('Empty')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(() => encodeSpeakerPhoto({ naturalWidth: 20, naturalHeight: 20 } as HTMLImageElement)).toThrow('Canvas')
  })
})
