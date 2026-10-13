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
