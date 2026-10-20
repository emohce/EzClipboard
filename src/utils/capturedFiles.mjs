import { getImageFileGroup } from './imagePresentation.mjs'

export const CAPTURE_MAX_BYTES = 50 * 1024 * 1024

const RASTER_EXT = /\.(png|jpe?g|webp|bmp|tiff?)$/i

function isSingleImageFile(file) {
  return getImageFileGroup({ type: 'file', data: [file] }).length === 1
}

// WeWork keeps the decoded PNG in an app cache. WeChat puts the copied image in a
// temp file under its container and deletes that file. Both stop being usable as the
// only copy of a history record.
export function isWeWorkCacheImage(file) {
  return typeof file?.path === 'string' &&
    /\/Containers\/com\.tencent\.WeWorkMac\/Data\/.*\/Caches\/Images\//.test(file.path) &&
    isSingleImageFile(file)
}

export function isEphemeralChatImage(file) {
  if (isWeWorkCacheImage(file)) return true
  return typeof file?.path === 'string' &&
    /\/Containers\/com\.tencent\.xinWeChat\/Data\//.test(file.path) &&
    isSingleImageFile(file)
}

function baseName(filePath) {
  return String(filePath || '').split(/[/\\]/).pop() || 'image'
}

function withExt(name, ext) {
  const stem = name.includes('.') ? name.replace(/\.[^.]+$/, '') : name
  return `${stem}.${ext}`
}

function readOriginalBytes(file, runtime, remaining) {
  // A broken stat must not skip a readable file. Size is enforced on the bytes we keep.
  let declared = null
  try {
    const stat = runtime.statSync(file.path)
    if (!stat?.isFile?.() || stat.size <= 0 || stat.size > remaining) throw new Error('capture-size')
    declared = stat.size
  } catch (error) {
    if (error?.message === 'capture-size') throw error
  }
  const bytes = runtime.readFileSync(file.path)
  if (!bytes?.length || bytes.length > remaining) throw new Error('capture-size')
  if (declared != null && bytes.length !== declared) throw new Error('capture-changed')
  return bytes
}

function sameBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false
  if (typeof left.equals === 'function') {
    try { return left.equals(right) } catch (_) {}
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function readClipboardRaster(runtime) {
  const clipboard = runtime.clipboard
  if (!clipboard) return null
  const formats = clipboard.availableFormats?.() || []
  // A companion GIF flavor is not the file. Only a .gif path is refused by the caller.
  if (typeof clipboard.readBuffer === 'function') {
    const direct = [[/png/, 'png'], [/jpe?g/, 'jpg']]
    for (const [pattern, ext] of direct) {
      const format = formats.find((item) => pattern.test(String(item).toLowerCase()))
      if (!format) continue
      try {
        const bytes = clipboard.readBuffer(format)
        if (bytes?.length) return { bytes, ext }
      } catch (_) {}
    }
  }
  const image = clipboard.readImage?.()
  if (!image || image.isEmpty?.()) throw new Error('empty-image')
  const bytes = image.toPNG?.()
  if (!bytes?.length) throw new Error('empty-image')
  return { bytes, ext: 'png' }
}

export function captureClipboardFiles(files, runtime) {
  let remaining = CAPTURE_MAX_BYTES
  return files.map((file) => {
    if (!isEphemeralChatImage(file)) return file
    let stage = '读取原文件'
    try {
      let bytes
      let ext = null
      try {
        bytes = readOriginalBytes(file, runtime, remaining)
      } catch (error) {
        // Pixels stay on the pasteboard after the temp file is gone or unreadable.
        // Never flatten a GIF or invent bytes for one member of a group.
        if (error.message === 'capture-size' || files.length !== 1 || !RASTER_EXT.test(file.path)) throw error
        stage = '读取剪贴板图片'
        const raster = readClipboardRaster(runtime)
        if (!raster?.bytes?.length) throw error
        bytes = raster.bytes
        ext = raster.ext
      }
      if (!bytes?.length || bytes.length > remaining) throw new Error('capture-size')
      remaining -= bytes.length
      stage = '保存图片副本'
      const digest = runtime.crypto.createHash('sha256').update(bytes).digest('hex')
      const name = ext ? withExt(baseName(file.path), ext) : baseName(file.path)
      const sep = runtime.sep || '/'
      const dir = [runtime.utools.getPath('userData'), 'utools-clipboard-manager',
        'original-material', 'captured-files', digest].join(sep)
      const target = dir + sep + name
      runtime.mkdirSync(dir, { recursive: true })
      if (!runtime.existsSync(target) || !sameBytes(runtime.readFileSync(target), bytes)) {
        runtime.writeFileSync(target, bytes)
      }
      return { ...file, name, path: target }
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]+$/.test(error?.code || '') ? error.code :
        ['capture-size', 'capture-changed', 'empty-image'].includes(error?.message) ? error.message : 'unavailable'
      runtime.utools.showNotification?.(`聊天图片：${stage}失败（${code}），历史记录仍依赖原文件`)
      return file
    }
  })
}
