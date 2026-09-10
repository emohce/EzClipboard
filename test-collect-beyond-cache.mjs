// 回归测试：收藏判定必须覆盖全部收藏项，而不是 TAB_CACHE_LIMIT(30) 条运行缓存。
//
// 修复前的缺陷链（静默、不可逆的数据丢失）：
//   refreshCache 只取最新 30 条收藏 -> collectIdSet 只含这 30 个 id
//   -> isCollected(第 31 条以后) 恒为 false
//   -> updateItem 把 collected 写回 0（收藏被静默取消）
//   -> removeItems 的收藏保护被跳过（条目被真删）
//
// 该模块用 Vite 专属语法（sql.js wasm ?url 后缀）导入，node 无法直接加载，
// 因此沿用仓库既有做法（scripts/test-theme-runtime.mjs）：读源码、改写导入、经 data: URL 载入。

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

const TAB_CACHE_LIMIT = 30
const TOTAL_COLLECTS = TAB_CACHE_LIMIT + 10

// 把源文件改写成 node 可直接加载的临时模块，放在 src/storage 下，
// 这样相对导入不必改写，报错栈也指向真实行号。
const generatedPath = path.join(storageDir, '__generated-sqliteRepo.test.mjs')

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

function makeDeps() {
  return {
    sep: path.sep,
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    mkdirSync: fs.mkdirSync,
    statSync: fs.statSync,
    rmSync: fs.rmSync,
    unlinkSync: fs.unlinkSync,
    crypto: globalThis.__nodeCrypto
  }
}

async function main() {
  globalThis.__nodeCrypto = await import('node:crypto')
  globalThis.utools = { dbStorage: { getItem: () => ({}), setItem: () => {} } }
  globalThis.window = globalThis.window || {}

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ezclip-collect-'))
  let repo = null
  try {
    const deps = makeDeps()
    globalThis.window.exports = deps

    const { SQLiteClipboardRepository } = await loadRepositoryModule()
    repo = new SQLiteClipboardRepository({
      dbPath: path.join(tmpDir, 'clipboard'),
      legacyDb: null,
      deps
    })
    await repo.init()

    // 收藏 TOTAL_COLLECTS 条，collect_time 递增，所以最早的一批会被挤出 30 条缓存。
    const collectedIds = []
    for (let i = 0; i < TOTAL_COLLECTS; i++) {
      const id = `collect-${String(i).padStart(3, '0')}`
      collectedIds.push(id)
      repo.addItem({ id, type: 'text', data: `collected item ${i}`, createTime: 1000 + i, updateTime: 1000 + i })
      repo.addCollect(id)
    }
    // 另加一条普通历史项作为对照
    repo.addItem({ id: 'plain-1', type: 'text', data: 'plain', createTime: 1, updateTime: 1 })

    const oldest = collectedIds[0]           // 最早收藏 -> 必然在 30 条缓存之外
    const newest = collectedIds.at(-1)       // 最新收藏 -> 在缓存内

    // 前置条件：确认它确实落在运行缓存之外，否则本测试等于没测到目标场景
    assert.equal(repo.dataBase.collectData.length, TAB_CACHE_LIMIT,
      `运行缓存应仍为 ${TAB_CACHE_LIMIT} 条（本测试依赖该截断存在）`)
    assert.ok(!repo.dataBase.collects.includes(oldest),
      '最早的收藏项应当已被挤出 30 条运行缓存')

    // 1) isCollected 必须覆盖全量收藏
    assert.equal(repo.isCollected(newest), true, '缓存内的收藏项应判定为已收藏')
    assert.equal(repo.isCollected(oldest), true,
      '缓存外的收藏项也必须判定为已收藏（修复前此处为 false）')
    assert.equal(repo.isCollected('plain-1'), false, '未收藏项不得被判定为已收藏')

    // 2) rowToItem 必须带出 collected 字段
    assert.equal(repo.getById(oldest).collected, true, 'getById 必须返回 collected=true')
    assert.equal(repo.getById('plain-1').collected, false, 'getById 必须返回 collected=false')

    // 3) updateItem 不得静默取消收藏（修复前：缓存外收藏项被写回 collected=0）
    repo.updateItem(oldest, { updateTime: Date.now() })
    assert.equal(repo.isCollected(oldest), true,
      'updateItem 后缓存外的收藏项仍必须是收藏态（修复前会被静默取消收藏）')
    assert.equal(repo.getById(oldest).collected, true, 'updateItem 后 collected 列必须仍为 1')

    // 4) removeItems 的收藏保护必须对缓存外的收藏项同样生效
    const res = repo.removeItems([oldest], { force: false })
    assert.equal(res.removed, 0, '未加 force 时不得删除收藏项（修复前会被真删）')
    assert.equal(res.skippedCollected, 1, '应记为「因收藏而跳过」1 条')
    assert.ok(repo.getById(oldest), '收藏项必须仍然存在')

    // 5) force 仍可删除，语义不变
    const forced = repo.removeItems([oldest], { force: true })
    assert.equal(forced.removed, 1, 'force 删除语义不得改变')
    assert.equal(repo.getById(oldest), null, 'force 删除后条目应已不存在')

    console.log(`collect-beyond-cache tests passed (${TOTAL_COLLECTS} collects, cache limit ${TAB_CACHE_LIMIT})`)
  } finally {
    // 取消 queuePersist 的 120ms 落盘定时器，否则它会在临时目录删除后触发 ENOENT
    if (repo?.persistTimer) clearTimeout(repo.persistTimer)
    await rm(tmpDir, { recursive: true, force: true })
    await rm(generatedPath, { force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
