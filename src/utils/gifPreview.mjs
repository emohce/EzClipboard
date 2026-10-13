import { getImageFileGroup } from './imagePresentation.mjs'

// GIF89a block layout: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
export const GIF_MAX_BYTES = 50 * 1024 * 1024

export const isGifDataUrl = (value) =>
  typeof value === 'string' && /^data:image\/gif(?:;[^,]*)?;base64,/i.test(value)

export function getGifFilePath(item) {
  if (item?.type !== 'file' || typeof item.data !== 'string') return ''
  try {
    const files = JSON.parse(item.data)
    return Array.isArray(files) && files.length === 1 && files[0]?.isFile !== false &&
      /\.gif$/i.test(files[0]?.path || '') ? files[0].path : ''
  } catch (_) {
    return ''
  }
}

export const isGifItem = (item) => getImageFileGroup(item).some((file) => /\.gif$/i.test(file.path)) ||
  (item?.type === 'image' && (isGifDataUrl(item.data) || isGifDataUrl(item.thumbnail) || /\.gif$/i.test(item.data || '')))

export async function loadGifListThumbnail(item, runtime = {}) {
  if (!isGifItem(item)) return ''
  if (isGifDataUrl(item.thumbnail)) return getGifFirstFrameSrc(item.thumbnail)
  if (isGifDataUrl(item.data)) return getGifFirstFrameSrc(item.data)
  const path = getImageFileGroup(item)[0]?.path || item.data
  try {
    if (typeof runtime.readBinaryPreviewFile === 'function') {
      const result = await runtime.readBinaryPreviewFile(path, { maxBytes: GIF_MAX_BYTES })
      if (!result?.ok || result.truncated) return ''
      return getGifFirstFrameSrc(gifDataUrl(runtime.Buffer.from(result.data)))
    }
    return getGifFirstFrameSrc(readGifFile([{ path }], runtime))
  } catch (_) {
    return ''
  }
}

// Keep the logical canvas, palettes and control extensions, but end after image 1.
// No raster decoding or canvas timing is involved, so the result is always frame 1.
export function gifFirstFrameEnd(bytes) {
  if (!bytes || bytes.length < 13 || bytes.length > GIF_MAX_BYTES) return 0
  const header = String.fromCharCode(...bytes.subarray(0, 6))
  if (header !== 'GIF87a' && header !== 'GIF89a') return 0
  let offset = 13 + ((bytes[10] & 0x80) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0)
  const skipSubBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++]
      if (!size) return true
      offset += size
      if (offset > bytes.length) return false
    }
    return false
  }
  while (offset < bytes.length) {
    const kind = bytes[offset++]
    if (kind === 0x21) {
      if (offset >= bytes.length) return 0
      offset++ // Extension label; its payload is a sequence of sub-blocks.
      if (!skipSubBlocks()) return 0
    } else if (kind === 0x2c) {
      if (offset + 9 > bytes.length) return 0
      const packed = bytes[offset + 8]
      offset += 9 + ((packed & 0x80) ? 3 * (2 ** ((packed & 7) + 1)) : 0)
      if (offset >= bytes.length) return 0
      offset++ // LZW minimum code size.
      return skipSubBlocks() ? offset : 0
    } else {
      return 0
    }
  }
  return 0
}

export function getGifFirstFrameSrc(dataUrl) {
  if (!isGifDataUrl(dataUrl)) return dataUrl
  try {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const end = gifFirstFrameEnd(bytes)
    return end ? `data:image/gif;base64,${btoa(binary.slice(0, end) + ';')}` : ''
  } catch (_) {
    return ''
  }
}

const gifDataUrl = (buffer) => gifFirstFrameEnd(buffer)
  ? `data:image/gif;base64,${buffer.toString('base64')}`
  : ''

// Only a single GIF becomes an image. Mixed/multiple files retain file semantics.
export function readGifFile(files, { readFileSync, statSync }) {
  if (files?.length !== 1 || files[0].isFile === false || !/\.gif$/i.test(files[0].path || '')) return ''
  try {
    const stat = statSync(files[0].path)
    if (!stat.isFile() || stat.size > GIF_MAX_BYTES) return ''
    return gifDataUrl(readFileSync(files[0].path))
  } catch (_) {
    return ''
  }
}

export function readClipboardGif(clipboard) {
  try {
    const formats = clipboard.availableFormats?.() || []
    for (const format of formats.filter((value) => /^(image\/gif|com\.compuserve\.gif|public\.gif|gif)$/i.test(value))) {
      try {
        const data = gifDataUrl(clipboard.readBuffer(format))
        if (data) return data
      } catch (_) { /* Try another advertised GIF representation. */ }
    }
  } catch (_) { /* Let the existing text/static-image reader handle the clipboard. */ }
  return ''
}
