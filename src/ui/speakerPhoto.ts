/** Keep uploaded cutouts portable across reloads without exhausting localStorage. */
export function encodeSpeakerPhoto(image: HTMLImageElement): string {
  const longest = Math.max(image.naturalWidth, image.naturalHeight)
  if (!longest || !image.naturalWidth || !image.naturalHeight) throw new Error('Empty portrait')
  const canvas = document.createElement('canvas')
  let size = Math.min(1200, longest)
  while (size >= Math.min(320, longest)) {
    canvas.width = Math.max(1, Math.round(image.naturalWidth * size / longest))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * size / longest))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    // A transparent canvas preserves the cutout's alpha in WebP (or PNG fallback).
    const source = canvas.toDataURL('image/webp', 0.9)
    if (/^data:image\/(webp|png);base64,/.test(source) && source.length <= 1_800_000) return source
    size = Math.floor(size * 0.75)
  }
  throw new Error('Portrait is too large to save locally')
}
