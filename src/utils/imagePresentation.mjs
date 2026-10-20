import { classifyFilePreview } from './filePreview.mjs'

// A group stays one record: only all-image groups move to the image category.
export function getImageFileGroup(item) {
  if (item?.type !== 'file') return []
  try {
    const files = typeof item.data === 'string' ? JSON.parse(item.data) : item.data
    return Array.isArray(files) && files.length && files.every((file) => file?.isFile !== false &&
      typeof file?.path === 'string' && classifyFilePreview(file.path) === 'image') ? files : []
  } catch (_) {
    return []
  }
}

export const getClipboardDisplayType = (item) => getImageFileGroup(item).length ? 'image' : item?.type

export function imageFileUrl(path = '') {
  if (!path) return ''
  if (/^file:\/\//i.test(path)) return path
  const normalized = path.replace(/\\/g, '/')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')
  return normalized.startsWith('//') ? `file:${encoded}` : `file:///${encoded.replace(/^\/+/, '')}`
}

const INLINE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024
const inlinePreviewCache = new Map()

export function shouldInlineImagePreview(path = '') {
  const normalized = String(path || '').replace(/\\/g, '/')
  return /\/Containers\/com\.tencent\.(?:WeWorkMac|xinWeChat)\//.test(normalized) ||
    /\/original-material\/captured-files\//.test(normalized)
}

function byteAt(bytes, index) {
  if (!bytes || index < 0 || index >= bytes.length) return -1
  if (typeof bytes.readUInt8 === 'function') {
    try { return bytes.readUInt8(index) } catch (_) {}
  }
  const value = bytes[index]
  return typeof value === 'number' ? value : -1
}

function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 2) return ''
  if (bytes.length >= 8 && byteAt(bytes, 0) === 0x89 && byteAt(bytes, 1) === 0x50 &&
    byteAt(bytes, 2) === 0x4e && byteAt(bytes, 3) === 0x47) return 'image/png'
  if (byteAt(bytes, 0) === 0xff && byteAt(bytes, 1) === 0xd8 && byteAt(bytes, 2) === 0xff) return 'image/jpeg'
  if (byteAt(bytes, 0) === 0x47 && byteAt(bytes, 1) === 0x49 && byteAt(bytes, 2) === 0x46) return 'image/gif'
  if (bytes.length >= 12 && byteAt(bytes, 0) === 0x52 && byteAt(bytes, 1) === 0x49 &&
    byteAt(bytes, 2) === 0x46 && byteAt(bytes, 3) === 0x46 && byteAt(bytes, 8) === 0x57 &&
    byteAt(bytes, 9) === 0x45 && byteAt(bytes, 10) === 0x42 && byteAt(bytes, 11) === 0x50) return 'image/webp'
  if (byteAt(bytes, 0) === 0x42 && byteAt(bytes, 1) === 0x4d) return 'image/bmp'
  return ''
}

function mimeFromExtension(path) {
  const name = String(path || '')
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (/\.gif$/i.test(name)) return 'image/gif'
  if (/\.webp$/i.test(name)) return 'image/webp'
  if (/\.bmp$/i.test(name)) return 'image/bmp'
  return ''
}

function bytesToDataUrl(bytes, mime, runtime) {
  if (!mime || !bytes?.length) return ''
  const BufferImpl = runtime.Buffer || globalThis.Buffer
  if (!BufferImpl?.from) return ''
  try {
    return `data:${mime};base64,${BufferImpl.from(bytes).toString('base64')}`
  } catch (_) {
    return ''
  }
}

function nativeImageDataUrl(path, runtime) {
  try {
    const image = runtime.nativeImage?.createFromPath?.(path)
    if (!image || image.isEmpty?.()) return ''
    const url = image.toDataURL?.()
    return typeof url === 'string' && url.startsWith('data:image/') && url.includes('base64,') ? url : ''
  } catch (_) {
    return ''
  }
}

// Container files are often unreadable through file://, and WeChat deletes its temp file.
// Read bytes in-process and preview a data URL. A miss stays cached so a dead path is not
// reread on every list paint; a new capture uses a new path.
export function inlineContainerImageSrc(path, runtime = {}) {
  if (!shouldInlineImagePreview(path)) return ''
  if (inlinePreviewCache.has(path)) return inlinePreviewCache.get(path)
  const remember = (src) => {
    if (inlinePreviewCache.size > 12) inlinePreviewCache.delete(inlinePreviewCache.keys().next().value)
    inlinePreviewCache.set(path, src)
    return src
  }
  try {
    let bytes = null
    try {
      const stat = runtime.statSync?.(path)
      if (stat && (!stat.isFile?.() || stat.size <= 0 || stat.size > INLINE_PREVIEW_MAX_BYTES)) return remember('')
      bytes = runtime.readFileSync?.(path)
    } catch (_) {
      bytes = null
    }
    if (bytes?.length && bytes.length <= INLINE_PREVIEW_MAX_BYTES) {
      const url = bytesToDataUrl(bytes, sniffImageMime(bytes) || mimeFromExtension(path), runtime)
      if (url) return remember(url)
    }
    // file:// from the plugin page cannot paint another app's container file.
    // nativeImage is the same encoder already used for ordinary screenshot records.
    const nativeUrl = nativeImageDataUrl(path, runtime)
    return remember(nativeUrl)
  } catch (_) {
    return remember('')
  }
}
