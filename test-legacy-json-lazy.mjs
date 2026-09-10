// 回归测试：旧 JSON 存储必须惰性加载。
//
// 修复前 initPlugin 每次冷启动都无条件 `new DB(dbPath); legacyDb.init()`，
// 即使早已迁移到 SQLite——白付一次整份旧 JSON 的 readFileSync + parse、
// O(n·m) 收藏清理、逐张缩略图解码、一份全量备份复制，以及一个常驻 fs.watch。
//
// 覆盖三种启动形态：
//   1. 全新安装（无 SQLite、无 JSON）      -> 迁移分支会构建 legacyDb（用于生成空库）
//   2. 首次迁移（无 SQLite、有 JSON）      -> 必须构建 legacyDb 并导入数据
//   3. 已迁移的稳态启动（有 SQLite）        -> 一次都不能构建 legacyDb

import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const storageDir = path.join(repoRoot, 'src', 'storage')
const wasmPath = path.join(repoRoot, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
const sqlJsEntry = pathToFileURL(path.join(repoRoot, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js')).href
const generatedPath = path.join(storageDir, '__generated-sqliteRepo.lazy.mjs')

async function loadRepositoryModule() {
  let source = await readFile(path.join(storageDir, 'sqliteClipboardRepository.js'), 'utf8')
  source = source
    .replace("import initSqlJs from 'sql.js'", `import initSqlJs from '${sqlJsEntry}'`)
    .replace(
      "import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'",
      `const sqlWasmUrl = ${JSON.stringify(wasmPath)}`
    )
  fs.writeFileSync(generatedPath, source, 'utf8')
  return import(`${pathToFileURL(generatedPath).href}?t=${process.pid}`)
}

const makeDeps = () => ({
  sep: path.sep,
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  statSync: fs.statSync,
  rmSync: fs.rmSync,
  unlinkSync: fs.unlinkSync,
  crypto: globalThis.__nodeCrypto
})

async function main() {
  globalThis.__nodeCrypto = await import('node:crypto')
  globalThis.utools = { dbStorage: { getItem: () => ({}), setItem: () => {} } }
  globalThis.window = globalThis.window || {}

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ezclip-lazy-'))
  const repos = []
  try {
    const deps = makeDeps()
    globalThis.window.exports = deps
    const { SQLiteClipboardRepository } = await loadRepositoryModule()

    const jsonPath = path.join(tmpDir, 'clipboard')
    // 计数式的假 legacyDb 工厂：只要被调用就说明发生了旧 JSON 加载
    let factoryCalls = 0
    const makeFactory = (dataBase) => () => {
      factoryCalls++
      return { path: jsonPath, dataBase }
    }

    // ---- 场景 2：首次迁移（有 JSON 内容）----
    fs.writeFileSync(jsonPath, JSON.stringify({ data: [], collects: [], collectData: [] }), 'utf8')
    const legacyPayload = {
      data: [{ id: 'j-1', type: 'text', data: 'from json', createTime: 1, updateTime: 1 }],
      collects: ['j-2'],
      collectData: [{ id: 'j-2', type: 'text', data: 'collected json', createTime: 2, updateTime: 2 }]
    }
    factoryCalls = 0
    const migrating = new SQLiteClipboardRepository({
      dbPath: jsonPath,
      legacyJsonPath: jsonPath,
      createLegacyDb: makeFactory(legacyPayload),
      deps
    })
    repos.push(migrating)
    await migrating.init()
    assert.equal(factoryCalls, 1, '首次迁移必须构建一次 legacyDb')
    assert.ok(migrating.getById('j-1'), '普通项应已导入')
    assert.equal(migrating.getById('j-2')?.collected, true, '收藏项应已导入且保持收藏态')
    migrating.flush()

    // ---- 场景 3：已迁移的稳态启动（SQLite 已存在）----
    factoryCalls = 0
    const steady = new SQLiteClipboardRepository({
      dbPath: jsonPath,
      legacyJsonPath: jsonPath,
      createLegacyDb: makeFactory(legacyPayload),
      deps
    })
    repos.push(steady)
    await steady.init()
    assert.equal(factoryCalls, 0,
      '已迁移的稳态启动一次都不得构建 legacyDb（修复前每次冷启动都会构建）')
    assert.ok(steady.getById('j-1'), '稳态启动仍应读得到已迁移的数据')
    assert.equal(steady.getById('j-2')?.collected, true, '收藏态必须保持')
    steady.flush()

    // ---- 场景 1：全新安装（无 SQLite、无 JSON）----
    const freshDir = await mkdtemp(path.join(os.tmpdir(), 'ezclip-fresh-'))
    const freshPath = path.join(freshDir, 'clipboard')
    factoryCalls = 0
    const fresh = new SQLiteClipboardRepository({
      dbPath: freshPath,
      legacyJsonPath: freshPath,
      createLegacyDb: makeFactory({ data: [], collects: [], collectData: [] }),
      deps
    })
    repos.push(fresh)
    await fresh.init()
    assert.equal(factoryCalls, 1, '全新安装走迁移分支，仍会构建一次 legacyDb')
    assert.equal(fresh.countItems('1=1'), 0, '全新安装应为空库')
    fresh.flush()
    await rm(freshDir, { recursive: true, force: true })

    // ---- 兼容：直接传入 legacyDb 实例的旧用法仍可用 ----
    const directDir = await mkdtemp(path.join(os.tmpdir(), 'ezclip-direct-'))
    const directPath = path.join(directDir, 'clipboard')
    const direct = new SQLiteClipboardRepository({
      dbPath: directPath,
      legacyDb: { path: directPath, dataBase: { data: [{ id: 'd-1', type: 'text', data: 'direct', createTime: 1, updateTime: 1 }], collectData: [] } },
      deps
    })
    repos.push(direct)
    await direct.init()
    assert.ok(direct.getById('d-1'), '直接传实例的旧用法必须仍然可用')
    assert.equal(direct.legacyJsonPath, directPath, 'legacyJsonPath 应能从实例的 path 推导')
    direct.flush()
    await rm(directDir, { recursive: true, force: true })

    console.log('legacy-json lazy tests passed')
  } finally {
    repos.forEach((r) => { if (r?.persistTimer) clearTimeout(r.persistTimer) })
    await rm(tmpDir, { recursive: true, force: true })
    await rm(generatedPath, { force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
