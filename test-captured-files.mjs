import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { captureClipboardFiles, CAPTURE_MAX_BYTES } from './src/utils/capturedFiles.mjs'
import { imageFileUrl, getClipboardDisplayType, inlineContainerImageSrc } from './src/utils/imagePresentation.mjs'
import { readGifFile } from './src/utils/gifPreview.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ezclip-capture-'))
try {
  const sourceDir = path.join(root, 'Containers/com.tencent.WeWorkMac/Data/Documents/Profiles/test/Caches/Images')
  fs.mkdirSync(sourceDir, { recursive: true })
  const sourcePath = path.join(sourceDir, '图片 #1%.png')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
  fs.writeFileSync(sourcePath, png)
  const file = { name: path.basename(sourcePath), path: sourcePath, isFile: true, isDirectory: false }
  const notifications = []
  const runtime = { ...fs, crypto, sep: path.sep, Buffer, utools: {
    getPath: () => path.join(root, 'user-data'),
    showNotification: (message) => notifications.push(message)
  } }
  const captured = captureClipboardFiles([file], runtime)
  assert.notEqual(captured[0].path, sourcePath)
  assert.equal(captured[0].name, file.name)
  assert.equal(file.path, sourcePath)
  assert.deepEqual(fs.readFileSync(captured[0].path), png)
  assert.match(inlineContainerImageSrc(sourcePath, runtime), /^data:image\/png;base64,/)
  assert.deepEqual(captureClipboardFiles([file], runtime), captured)
  const normal = { ...file, path: '/ordinary/picture.png' }
  const document = { path: '/ordinary/a.txt', isFile: true }
  assert.equal(captureClipboardFiles([normal], runtime)[0], normal)
  const mixed = captureClipboardFiles([file, document], runtime)
  assert.equal(mixed.length, 2)
  assert.equal(mixed[1], document)
  assert.equal(getClipboardDisplayType({ type: 'file', data: mixed }), 'file')
  assert.equal(captureClipboardFiles([file], { ...runtime, statSync: () => ({ isFile: () => true, size: CAPTURE_MAX_BYTES + 1 }) })[0], file)
  assert.equal(captureClipboardFiles([file], { ...runtime, writeFileSync: () => { throw Error('disk full') }, existsSync: () => false })[0], file)
  assert.equal(notifications.length, 2)

  // Reproduce a host that advertises a file URL but denies filesystem access.
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
  let imageReads = 0
  const clipboardRuntime = { ...runtime,
    statSync: () => { throw denied },
    readFileSync: (target) => target === sourcePath ? (() => { throw denied })() : fs.readFileSync(target),
    clipboard: {
      availableFormats: () => ['public.file-url', 'public.tiff', 'WWKPrivatePBDataReportKey'],
      readImage: () => { imageReads++; return { isEmpty: () => false, toPNG: () => png } }
    }
  }
  assert.deepEqual(captureClipboardFiles([file], clipboardRuntime), captured)
  assert.equal(imageReads, 1)
  assert.deepEqual(captureClipboardFiles([file, document], clipboardRuntime), [file, document])
  const gif = { ...file, path: file.path.replace(/png$/, 'gif') }
  assert.equal(captureClipboardFiles([gif], clipboardRuntime)[0], gif)
  assert.equal(imageReads, 1, 'groups and GIF must not consume a single static bitmap')
  const emptyRuntime = { ...clipboardRuntime, clipboard: {
    availableFormats: () => ['public.tiff'],
    readImage: () => ({ isEmpty: () => true })
  } }
  assert.equal(captureClipboardFiles([file], emptyRuntime)[0], file)
  assert.match(notifications.at(-1), /读取剪贴板图片失败（empty-image）/)
  const fullRuntime = { ...clipboardRuntime, existsSync: () => false,
    writeFileSync: () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }) }
  }
  assert.equal(captureClipboardFiles([file], fullRuntime)[0], file)
  assert.match(notifications.at(-1), /保存图片副本失败（ENOSPC）/)

  // stat can fail while the bytes are still readable. Do not ask the clipboard.
  let clipboardHits = 0
  const statFailReadOk = { ...runtime,
    statSync: () => { throw denied },
    clipboard: {
      availableFormats: () => { clipboardHits += 1; return [] },
      readImage: () => { clipboardHits += 1; return { isEmpty: () => false, toPNG: () => png } }
    }
  }
  const viaRead = captureClipboardFiles([file], statFailReadOk)[0]
  assert.notEqual(viaRead.path, sourcePath)
  assert.equal(clipboardHits, 0)
  assert.deepEqual(fs.readFileSync(viaRead.path), png)

  // Enterprise WeChat advertises a GIF flavor beside the real PNG/TIFF.
  const gifFlavor = { ...runtime,
    statSync: () => { throw denied },
    readFileSync: (target) => target === sourcePath ? (() => { throw denied })() : fs.readFileSync(target),
    clipboard: {
      availableFormats: () => ['public.file-url', 'image/gif', 'public.tiff'],
      readImage: () => ({ isEmpty: () => false, toPNG: () => png })
    }
  }
  const fromGifFlavor = captureClipboardFiles([file], gifFlavor)[0]
  assert.notEqual(fromGifFlavor.path, sourcePath)
  assert.deepEqual(fs.readFileSync(fromGifFlavor.path), png)

  const nativeOnly = {
    statSync: () => { throw denied },
    readFileSync: () => { throw denied },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=' })
    }
  }
  const nativePath = sourcePath.replace(/\.png$/, '.native.png')
  assert.equal(inlineContainerImageSrc(nativePath, nativeOnly), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(inlineContainerImageSrc('/ordinary/picture.png', nativeOnly), '')

  // WeChat stores the copied image in a container temp file and then deletes it.
  const wechatDir = path.join(root, 'Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/demo/temp/RWTemp/2026-10')
  fs.mkdirSync(wechatDir, { recursive: true })
  const wechatPath = path.join(wechatDir, '6d899c14a219b250aa9360b504f96c96.jpg')
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  fs.writeFileSync(wechatPath, jpeg)
  const wechatFile = { name: path.basename(wechatPath), path: wechatPath, isFile: true, isDirectory: false }
  const wechatCopy = captureClipboardFiles([wechatFile], runtime)[0]
  assert.notEqual(wechatCopy.path, wechatPath)
  assert.equal(wechatCopy.name, wechatFile.name)
  assert.deepEqual(fs.readFileSync(wechatCopy.path), jpeg)
  assert.match(inlineContainerImageSrc(wechatPath, runtime), /^data:image\/jpeg;base64,/)
  assert.match(inlineContainerImageSrc(wechatCopy.path, runtime), /^data:image\/jpeg;base64,/)
  fs.unlinkSync(wechatPath)
  assert.equal(fs.existsSync(wechatPath), false)
  assert.deepEqual(fs.readFileSync(wechatCopy.path), jpeg)
  assert.match(inlineContainerImageSrc(wechatCopy.path, runtime), /^data:image\/jpeg;base64,/)

  const deniedJpeg = Object.assign(new Error('denied'), { code: 'EACCES' })
  const jpegClipboard = { ...runtime,
    statSync: () => { throw deniedJpeg },
    readFileSync: (target) => {
      if (target === wechatPath) throw deniedJpeg
      return fs.readFileSync(target)
    },
    clipboard: {
      availableFormats: () => ['public.file-url', 'public.jpeg'],
      readBuffer: (format) => format === 'public.jpeg' ? jpeg : null,
      readImage: () => { throw new Error('pixels must not replace an original jpeg buffer') }
    }
  }
  const jpegFallback = captureClipboardFiles([wechatFile], jpegClipboard)[0]
  assert.notEqual(jpegFallback.path, wechatPath)
  assert.equal(jpegFallback.name, wechatFile.name)
  assert.deepEqual(fs.readFileSync(jpegFallback.path), jpeg)

  const tiffClipboard = { ...runtime,
    statSync: () => { throw deniedJpeg },
    readFileSync: (target) => {
      if (target === wechatPath) throw deniedJpeg
      return fs.readFileSync(target)
    },
    clipboard: {
      availableFormats: () => ['public.file-url', 'public.tiff'],
      readImage: () => ({ isEmpty: () => false, toPNG: () => png })
    }
  }
  const tiffFallback = captureClipboardFiles([wechatFile], tiffClipboard)[0]
  assert.equal(tiffFallback.name.endsWith('.png'), true)
  assert.deepEqual(fs.readFileSync(tiffFallback.path), png)
  assert.equal(inlineContainerImageSrc('/ordinary/picture.png', runtime), '')

  // Exercise the real capture entry rather than reproducing its field mapping.
  const source = fs.readFileSync('src/global/initPlugin.js', 'utf8')
  const captureSource = source.slice(source.indexOf('  const pbpaste = () => {'), source.indexOf('  // 根据当前设备id'))
  const capture = vm.runInNewContext(`${captureSource}; pbpaste`, {
    console: { log() {} }, captureClipboardFiles, readGifFile,
    window: { exports: runtime },
    utools: { getCopyedFiles: () => [file], getPath: () => '/plugin-temp' }
  })
  const item = capture()
  assert.equal(item.type, 'file')
  assert.equal(item.originPaths[0], sourcePath)
  assert.equal(item.sourcePaths[0], sourcePath)
  assert.equal(JSON.parse(item.data)[0].path, captured[0].path)
  assert.equal(getClipboardDisplayType(item), 'image')
  fs.unlinkSync(sourcePath)
  assert.equal(fs.existsSync(sourcePath), false) // The previous path-only record now fails.
  assert.deepEqual(fs.readFileSync(fileURLToPath(imageFileUrl(captured[0].path))), png)
  assert.equal(captureClipboardFiles([file], runtime)[0], file)

  // Existing copy, copy-only and silent paste consume the persisted snapshot path.
  const copied = [], pasted = []
  runtime.utools.copyFile = (paths) => copied.push(paths)
  runtime.utools.hideMainWindow = () => {}
  runtime.utools.hideMainWindowPasteFile = (p) => { pasted.push(p); return true }
  globalThis.window = { exports: runtime }
  const { copy, copyOnly, copyAndPasteAndExit } = await import('./src/utils/index.js')
  copy(item, false)
  copyOnly(item)
  assert.equal(copyAndPasteAndExit(item, { useHideMainWindowPaste: true }), true)
  assert.deepEqual(copied, [[captured[0].path], [captured[0].path]])
  assert.deepEqual(pasted, [captured[0].path])
  for (const p of [...copied.flat(), ...pasted]) assert.deepEqual(fs.readFileSync(p), png)
  console.log('Capture independence, file semantics, source metadata, mixed groups, failures, limits and copy/paste passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
