import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getClipboardDisplayType, getImageFileGroup, imageFileUrl } from './src/utils/imagePresentation.mjs'
import { isGifItem, loadGifListThumbnail } from './src/utils/gifPreview.mjs'
import { queryClipboardItems } from './src/storage/searchIndex.js'
import { ClipboardRepository } from './src/storage/clipboardRepository.js'
import { matchSearchableItemType } from './src/global/quickPasteSelection.js'

const fileItem = (id, paths, extra = {}) => ({ id, type: 'file', data: JSON.stringify(paths.map(path => ({ path, isFile: true }))), updateTime: 1000, ...extra })
const single = fileItem('gif', ['/pictures/first.GIF'])
const group = fileItem('group', ['/pictures/one.png', '/pictures/two.gif'])
const mixed = fileItem('mixed', ['/pictures/one.png', '/docs/readme.txt'])
const folder = { ...single, id: 'folder', data: '[{"path":"/pictures/folder.gif","isFile":false}]' }
const malformed = { ...single, id: 'malformed', data: '[{"path":"/pictures/one.png"},null]' }
const items = [single, group, mixed, folder, malformed, fileItem('doc', ['/docs/readme.txt'])]
for (const item of items) {
  const expected = ['gif', 'group'].includes(item.id) ? 'image' : 'file'
  assert.equal(getClipboardDisplayType(item), expected)
  assert.equal(matchSearchableItemType(item, '', expected), true)
  assert.equal(matchSearchableItemType(item, '', expected === 'image' ? 'file' : 'image'), false)
}
assert.equal(getImageFileGroup(group).length, 2)
assert.equal(isGifItem(group), true)
assert.equal(imageFileUrl('/pictures/图 #1%.png'), 'file:///pictures/%E5%9B%BE%20%231%25.png')
assert.equal(imageFileUrl('C:\\pics\\图.png'), 'file:///C:/pics/%E5%9B%BE.png')
assert.equal(imageFileUrl('\\\\server\\share\\one.png'), 'file://server/share/one.png')
assert.equal(await loadGifListThumbnail(single, { readBinaryPreviewFile: async () => ({ ok: false, error: 'missing' }) }), '')
assert.deepEqual(queryClipboardItems({ items, tab: 'image' }).items.map(i => i.id), ['gif', 'group'])
assert.deepEqual(queryClipboardItems({ items, tab: 'file' }).items.map(i => i.id), ['mixed', 'folder', 'malformed', 'doc'])

globalThis.utools = { dbStorage: { getItem: () => ({}), setItem() {} } }
const legacy = new ClipboardRepository({ dataBase: { data: items, collectData: [], collects: [] } })
let removed = []
legacy.removeItems = ids => { removed = ids; return { removed: ids.length } }
legacy.removeByRange({ tab: 'file' })
assert.deepEqual(removed, ['mixed', 'folder', 'malformed', 'doc'])
legacy.removeByRange({ tab: 'image' })
assert.deepEqual(removed, ['gif', 'group'])

const root = process.cwd()
const generated = path.join(root, 'src/storage/__generated-image-classification.mjs')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ezclip-image-category-'))
const deps = { ...fs, sep: path.sep }
globalThis.window = { exports: deps }
let repo
try {
  let source = fs.readFileSync('src/storage/sqliteClipboardRepository.js', 'utf8')
  source = source.replace("import initSqlJs from 'sql.js'", `import initSqlJs from '${pathToFileURL(path.join(root, 'node_modules/sql.js/dist/sql-wasm.js')).href}'`)
    .replace("import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'", `const sqlWasmUrl = ${JSON.stringify(path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'))}`)
  fs.writeFileSync(generated, source)
  const { SQLiteClipboardRepository } = await import(pathToFileURL(generated).href)
  repo = new SQLiteClipboardRepository({ dbPath: path.join(temp, 'clipboard.sqlite'), legacyDb: null, deps })
  await repo.init()
  for (const item of items) repo.addItem(item)
  for (let index = 0; index < 45; index++) repo.addItem(fileItem(`png-${index}`, [`/pictures/${index}.PNG`], { updateTime: 2000 + index }))
  repo.addItem(fileItem('locked', ['/pictures/locked.webp'], { locked: true }))
  repo.addItem(fileItem('collected', ['/pictures/collected.jpg']))
  repo.addCollect('collected')
  repo.flush()
  const allImages = []
  let cursor = 0
  do {
    const page = repo.query({ tab: 'image', cursor, limit: 7 })
    allImages.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== null)
  assert.equal(allImages.length, 48)
  assert.equal(new Set(allImages.map(i => i.id)).size, 48)
  assert.ok(allImages.every(i => getClipboardDisplayType(i) === 'image'))
  assert.ok(allImages.every(i => i.type === 'file'), 'stored payload type stays file')
  assert.equal(repo.query({ tab: 'image', keyword: 'first.gif' }).items[0].id, 'gif')
  assert.deepEqual(repo.query({ tab: 'file', keyword: 'first.gif' }).items, [])
  assert.equal(repo.query({ tab: 'collect' }).items[0].id, 'collected')
  const clearedFiles = repo.removeByRange({ tab: 'file' })
  assert.deepEqual(new Set(clearedFiles.removedIds), new Set(['mixed', 'folder', 'malformed', 'doc']))
  assert.equal(repo.getById('gif').data, single.data)
  const clearedImages = repo.removeByRange({ tab: 'image' })
  assert.equal(clearedImages.removed, 47)
  assert.equal(clearedImages.skippedLocked, 1)
  assert.ok(repo.getById('locked'))
  assert.ok(repo.getById('collected'))
  console.log('Image category parity, pagination, search, pin matching, group integrity and clear-range checks passed')
} finally {
  if (repo?.persistTimer) clearTimeout(repo.persistTimer)
  repo?.db?.close()
  fs.rmSync(generated, { force: true })
  fs.rmSync(temp, { recursive: true, force: true })
}
