import { getImageFileGroup } from './imagePresentation.mjs'

export const CAPTURE_MAX_BYTES = 50 * 1024 * 1024

// Container cache URLs can stop being accessible to the host after the pasteboard changes.
// Keep file semantics; only replace the dependency on this external cache.
export function isWeWorkCacheImage(file) {
  return typeof file?.path === 'string' &&
    /\/Containers\/com\.tencent\.WeWorkMac\/Data\/.*\/Caches\/Images\//.test(file.path) &&
    getImageFileGroup({ type: 'file', data: [file] }).length === 1
}

export function captureClipboardFiles(files, runtime) {
  let remaining = CAPTURE_MAX_BYTES
  return files.map((file) => {
    if (!isWeWorkCacheImage(file)) return file
    let stage = '读取原文件'
    try {
      let bytes
      try {
        const stat = runtime.statSync(file.path)
        if (!stat.isFile() || stat.size <= 0 || stat.size > remaining) throw new Error('capture-size')
        bytes = runtime.readFileSync(file.path)
        if (bytes.length !== stat.size) throw new Error('capture-changed')
      } catch (error) {
        // WeWork also publishes TIFF pixels. They remain available during capture even
        // when the external file is not readable. Never flatten GIFs or guess group members.
        if (error.message === 'capture-size' || files.length !== 1 || !/\.png$/i.test(file.path)) throw error
        stage = '读取剪贴板图片'
        const formats = runtime.clipboard?.availableFormats?.() || []
        if (formats.some((format) => /gif|apng/i.test(format)) ||
            !formats.some((format) => /png|tiff|bitmap|image\//i.test(format))) throw error
        const image = runtime.clipboard.readImage()
        if (!image || image.isEmpty()) throw new Error('empty-image')
        bytes = image.toPNG()
      }
      if (!bytes?.length || bytes.length > remaining) throw new Error('capture-size')
      remaining -= bytes.length
      stage = '保存图片副本'
      const digest = runtime.crypto.createHash('sha256').update(bytes).digest('hex')
      const name = file.path.split('/').pop()
      const sep = runtime.sep
      const dir = [runtime.utools.getPath('userData'), 'utools-clipboard-manager',
        'original-material', 'captured-files', digest].join(sep)
      const target = dir + sep + name
      runtime.mkdirSync(dir, { recursive: true })
      // Content-addressed paths make repeated captures stable and preserve original bytes/GIF frames.
      if (!runtime.existsSync(target) || !runtime.readFileSync(target).equals(bytes)) {
        runtime.writeFileSync(target, bytes)
      }
      return { ...file, path: target }
    } catch (error) {
      // A failed snapshot must never remove a member from a multi-file clipboard record.
      const code = /^[A-Z][A-Z0-9_]+$/.test(error?.code || '') ? error.code :
        ['capture-size', 'capture-changed', 'empty-image'].includes(error?.message) ? error.message : 'unavailable'
      runtime.utools.showNotification?.(`企业微信图片：${stage}失败（${code}），历史记录仍依赖原文件`)
      return file
    }
  })
}
