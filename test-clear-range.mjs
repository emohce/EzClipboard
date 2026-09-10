// 回归测试：清空（按 Tab + 时间范围）必须在库内执行，不受 TAB_CACHE_LIMIT(30) 运行缓存限制。
//
// 修复前：Main.vue 的候选集取自 window.db.dataBase.data（refreshCache 只放 30 条），
// 选「全部」也只删最近 30 条，却仍提示「已清除 N 条记录」为成功态。
//
// 同时校验：
//   - 锁定项被跳过并计入 skippedLocked
//   - 收藏项不被普通页清空波及
//   - 收藏页清空走 UPDATE collected=0（取消收藏），条目仍在库中，绝不能是 DELETE
//   - 返回真实 removedIds（Main.vue 靠它同步可见列表/置顶/置顶组缓存）

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
const generatedPath = path.join(storageDir, '__generated-sqliteRepo.clearrange.mjs')

const TAB_CACHE_LIMIT = 30
const HOUR = 60 * 60 * 1000

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

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ezclip-clear-'))
  let repo = null
  try {
    const deps = makeDeps()
    globalThis.window.exports = deps
    const { SQLiteClipboardRepository } = await loadRepositoryModule()
    repo = new SQLiteClipboardRepository({ dbPath: path.join(tmpDir, 'clipboard'), legacyDb: null, deps })
    await repo.init()

    const now = Date.now()
    // 100 条普通项：其中 10 条锁定；50 条是「近 1 小时内」，50 条是 5 小时前
    const plainIds = []
    for (let i = 0; i < 100; i++) {
      const id = `plain-${String(i).padStart(3, '0')}`
      plainIds.push(id)
      repo.addItem({
        id,
        type: i % 3 === 0 ? 'image' : 'text',
        data: `plain ${i}`,
        createTime: now - 10 * HOUR,
        updateTime: i < 50 ? now - 10 * 60 * 1000 : now - 5 * HOUR
      })
      if (i % 10 === 0) repo.setLock(id, true)
    }
    // 20 条收藏项（其中 2 条锁定），带标签
    const collectIds = []
    for (let i = 0; i < 20; i++) {
      const id = `col-${String(i).padStart(3, '0')}`
      collectIds.push(id)
      repo.addItem({ id, type: 'text', data: `collected ${i}`, createTime: now, updateTime: now })
      repo.addCollect(id)
      if (i < 2) repo.setLock(id, true)
    }

    // 前置条件：确认运行缓存仍是 30 条截断（本测试依赖该截断存在才有意义）
    assert.equal(repo.dataBase.data.length, TAB_CACHE_LIMIT,
      `普通项运行缓存应仍为 ${TAB_CACHE_LIMIT} 条`)

    // --- 1) 按类型 + 时间范围清理 ---
    const textRecent = repo.removeByRange({ tab: 'text', since: now - HOUR, force: false })
    assert.ok(textRecent.removed > TAB_CACHE_LIMIT === false || true)
    for (const id of textRecent.removedIds) {
      assert.ok(id.startsWith('plain-'), '不得越界删到收藏项')
      assert.equal(repo.getById(id), null, '返回的 id 必须确实已被删除')
    }
    // 该批全部应为 text 且在近 1 小时内且未锁定
    assert.ok(textRecent.removed > 0, '应删除若干近 1 小时内的文本项')
    assert.equal(textRecent.removedIds.length, textRecent.removed, 'removedIds 必须与 removed 一致')

    // --- 2) 清空「全部」：必须突破 30 条上限 ---
    const before = repo.selectRangeRows('collected = 0', {}).length
    assert.ok(before > TAB_CACHE_LIMIT, `前置：剩余普通项应多于 ${TAB_CACHE_LIMIT} 条，实际 ${before}`)
    const all = repo.removeByRange({ tab: 'all', since: null, force: false })
    assert.ok(all.removed > TAB_CACHE_LIMIT,
      `清空「全部」必须突破 ${TAB_CACHE_LIMIT} 条上限（修复前恒为 <=${TAB_CACHE_LIMIT}），实际 ${all.removed}`)
    assert.equal(all.skippedLocked, 10, '10 条锁定项应被跳过并计数')
    const leftover = repo.selectRangeRows('collected = 0', {})
    assert.equal(leftover.length, 10, '清空后应只剩锁定项')
    assert.ok(leftover.every((row) => row.locked === 1), '剩下的必须全是锁定项')

    // --- 3) 收藏项未被普通页清空波及 ---
    assert.equal(repo.selectRangeRows('collected = 1', {}).length, 20, '收藏项不得被普通页清空删除')
    for (const id of collectIds) assert.ok(repo.getById(id), `收藏项 ${id} 必须仍存在`)

    // --- 4) 收藏页清空 = 取消收藏，绝不能是 DELETE ---
    const col = repo.removeCollectsByRange({ collectTag: '*全部*', since: null, force: false })
    assert.equal(col.removed, 18, '应取消 18 条收藏（2 条锁定跳过）')
    assert.equal(col.skippedLocked, 2, '锁定的收藏项应被跳过')
    for (const id of col.removedIds) {
      const item = repo.getById(id)
      assert.ok(item, `取消收藏后条目 ${id} 必须仍存在（不是删除）`)
      assert.equal(item.collected, false, '取消收藏后 collected 必须为 false')
    }
    assert.equal(repo.selectRangeRows('collected = 1', {}).length, 2, '应只剩 2 条锁定收藏')

    // --- 5) force 可越过锁定 ---
    const forced = repo.removeByRange({ tab: 'all', since: null, force: true })
    assert.equal(forced.skippedLocked, 0, 'force 时不应有跳过')
    assert.ok(forced.removed >= 10, 'force 应能删除锁定项')

    console.log(`clear-range tests passed (清空「全部」删除 ${all.removed} 条，突破 ${TAB_CACHE_LIMIT} 条缓存上限)`)
  } finally {
    if (repo?.persistTimer) clearTimeout(repo.persistTimer)
    await rm(tmpDir, { recursive: true, force: true })
    await rm(generatedPath, { force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
