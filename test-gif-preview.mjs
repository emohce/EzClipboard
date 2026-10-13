import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { GIF_MAX_BYTES, getGifFirstFrameSrc, gifFirstFrameEnd, isGifDataUrl, readClipboardGif, readGifFile } from './src/utils/gifPreview.mjs'

// Two 2x2 frames: red then blue; includes loop/comment/GCE extensions and a local palette.
const bytes = Buffer.from('R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh/gdmaXh0dXJlACH5BAAKAAAALAAAAAACAAIAAAgGAAEIBBAQACH5BAEKAAEALAAAAAACAAIAgQAA/wAAAAAAAAAAAAgGAAEIBBAQADs=', 'base64')
const original = `data:image/gif;base64,${bytes.toString('base64')}`
const firstFrame = getGifFirstFrameSrc(original)
const firstBytes = Buffer.from(firstFrame.split(',')[1], 'base64')
assert.ok(firstBytes.length < bytes.length)
assert.equal(firstBytes.at(-1), 0x3b)
assert.deepEqual(firstBytes.subarray(0, -1), bytes.subarray(0, gifFirstFrameEnd(bytes)))
assert.equal(getGifFirstFrameSrc(firstFrame), firstFrame)
assert.equal(getGifFirstFrameSrc('data:image/png;base64,test'), 'data:image/png;base64,test')
assert.equal(getGifFirstFrameSrc('data:image/gif;base64,invalid!'), '')
assert.equal(isGifDataUrl('data:IMAGE/GIF;base64,eA=='), true)
for (let length = 0; length < firstBytes.length - 1; length++) {
  assert.equal(gifFirstFrameEnd(firstBytes.subarray(0, length)), 0, `truncated at ${length}`)
}
// Local color table in the first frame, with no global palette.
const header = Buffer.from(firstBytes.subarray(0, 13))
header[10] &= 0x7f
const descriptor = Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x81])
const localGif = Buffer.concat([header, descriptor, bytes.subarray(13, 25), Buffer.from([8, 6, 0, 1, 8, 4, 16, 16, 0, 0x3b])])
assert.equal(gifFirstFrameEnd(localGif), localGif.length - 1)

let fileReads = 0
const deps = {
  statSync: () => ({ isFile: () => true, size: bytes.length }),
  readFileSync: () => { fileReads++; return bytes }
}
const files = [{ path: '/fixtures/动图.GIF', isFile: true }]
assert.equal(readGifFile(files, deps), original)
assert.equal(readGifFile([...files, { path: '/fixtures/readme.txt' }], deps), '')
assert.equal(readGifFile([{ path: '/fixtures/static.png' }], deps), '')
assert.equal(readGifFile(files, { ...deps, statSync: () => ({ isFile: () => true, size: GIF_MAX_BYTES + 1 }) }), '')
assert.equal(fileReads, 1)
assert.equal(readGifFile(files, { ...deps, readFileSync: () => { throw Error('missing') } }), '')
assert.equal(readGifFile(files, { ...deps, readFileSync: () => Buffer.from('not gif') }), '')
const clipboard = {
  availableFormats: () => ['image/gif', 'com.compuserve.gif', 'image/png'],
  readBuffer: (format) => { if (format === 'image/gif') throw Error('unavailable'); return bytes },
  readText: () => 'image label',
  readImage: () => { throw Error('GIF must not pass through nativeImage') }
}
assert.equal(readClipboardGif(clipboard), original)
assert.equal(readClipboardGif({ availableFormats: () => ['image/png'] }), '')

// Exercise the actual capture entry: file classification and GIF-before-text precedence.
const source = fs.readFileSync('src/global/initPlugin.js', 'utf8')
const captureSource = source.slice(source.indexOf('  const pbpaste = () => {'), source.indexOf('  // 根据当前设备id'))
const context = {
  console: { log() {}, warn() {} }, readGifFile, getGifFirstFrameSrc, readClipboardGif,
  window: { exports: { ...deps, sep: '/' } }, clipboard,
  utools: { getCopyedFiles: () => files, getPath: () => '/tmp' },
  readClipboardSourcePaths: () => []
}
const capture = vm.runInNewContext(`${captureSource}; pbpaste`, context)
let item = capture()
assert.equal(item.type, 'image')
assert.equal(item.data, original)
assert.equal(item.thumbnail, firstFrame)
assert.equal(item.originPaths[0], files[0].path)
context.utools.getCopyedFiles = () => [...files, { path: '/fixtures/readme.txt' }]
assert.equal(capture().type, 'file')
context.utools.getCopyedFiles = () => null
assert.equal(capture().data, original)
context.clipboard = { availableFormats: () => [], readText: () => 'plain text' }
assert.equal(capture().type, 'text')
let imageReads = 0
context.clipboard = {
  availableFormats: () => ['image/png'], readText: () => '',
  readImage: () => { imageReads++; return { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,png' } }
}
assert.equal(capture().data, 'data:image/png;base64,png')
assert.equal(imageReads, 1)

// Capture must leave the source GIF clipboard untouched (no static restore loop).
const restoreSource = source.slice(source.indexOf('  const restoreClipboard = (item) => {'), source.indexOf('  const handleClipboardChange ='))
const restore = vm.runInNewContext(`${restoreSource}; restoreClipboard`, { isGifDataUrl })
assert.doesNotThrow(() => restore({ type: 'image', data: original }))

// Both normal and silent paste must preserve the original GIF bytes via file APIs.
const writes = [], copied = [], pasted = [], staticCopies = []
globalThis.window = { exports: {
  Buffer, sep: '/', existsSync: () => false, mkdirSync() {},
  writeFileSync: (path, buffer) => writes.push({ path, buffer }),
  utools: {
    getPath: () => '/fake-user-data', copyFile: (paths) => copied.push(paths),
    copyImage: (data) => staticCopies.push(data), hideMainWindow() {},
    hideMainWindowPasteFile: (path) => { pasted.push(path); return true }
  }
} }
const { copy, copyOnly, copyAndPasteAndExit } = await import('./src/utils/index.js')
item = { ...item, id: 'gif-fixture' }
copy(item, false)
copyOnly(item)
assert.equal(copyAndPasteAndExit(item, { useHideMainWindowPaste: true }), true)
assert.equal(copied.length, 2)
assert.equal(pasted.length, 1)
assert.equal(staticCopies.length, 0)
assert.equal(writes.length, 3)
for (const write of writes) {
  assert.ok(write.path.endsWith('.gif'))
  assert.deepEqual(write.buffer, bytes)
}
copyOnly({ type: 'image', data: 'data:image/png;base64,cG5n' })
assert.equal(staticCopies.length, 1)
console.log('GIF capture, first-frame extraction, classification and copy/paste checks passed')
