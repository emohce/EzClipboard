// 回归测试：
//  A. 保留策略 maxsize / maxage 在 SQLite 主路径生效，且收藏与锁定项一律豁免。
//     修复前 SQLite 仓库完全没有该实现（只存在于 legacy JSON DB），设置页配了不生效。
//  B. updateItem 快路径：patch 仅含 updateTime / sourceApp / sourceWindowTitle 时直写列，
//     不重读整行、不重写 blob、不重建 search_text，但必须仍刷新 dataBase 缓存。
//     最大风险是「误判含 data 的 patch」导致 data 与 data_path 不一致，故重点校验外置 payload。

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
const generatedPath = path.join(storageDir, '__generated-sqliteRepo.retention.mjs')

const DAY = 24 * 60 * 60 * 1000

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

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ezclip-retention-'))
  let repo = null
  try {
    const deps = makeDeps()
    globalThis.window.exports = deps
    const { SQLiteClipboardRepository } = await loadRepositoryModule()
    repo = new SQLiteClipboardRepository({ dbPath: path.join(tmpDir, 'clipboard'), legacyDb: null, deps })
    await repo.init()
    const now = Date.now()

    // ---------- A. 保留策略 ----------
    assert.deepEqual(repo.setRetentionPolicy({ maxsize: null, maxage: null }), { maxsize: null, maxage: null })
    assert.deepEqual(repo.setRetentionPolicy({ maxsize: 0, maxage: -1 }), { maxsize: null, maxage: null },
      '非正值应归一为「不限制」，不能误删全部数据')

    // maxage：30 条 40 天前的旧项，其中 5 条锁定、5 条收藏
    for (let i = 0; i < 30; i++) {
      const id = `old-${String(i).padStart(3, '0')}`
      repo.addItem({ id, type: 'text', data: `old ${i}`, createTime: now - 40 * DAY, updateTime: now - 40 * DAY })
      if (i < 5) repo.setLock(id, true)
      if (i >= 5 && i < 10) repo.addCollect(id)
    }
    // 5 条新项，不应被 maxage 清理
    for (let i = 0; i < 5; i++) {
      repo.addItem({ id: `new-${i}`, type: 'text', data: `new ${i}`, createTime: now, updateTime: now })
    }

    repo.setRetentionPolicy({ maxage: 7, maxsize: null })
    const aged = repo.enforceRetention({ force: true, now })
    assert.equal(aged.removed, 20, '应删除 20 条旧项（30 - 5 锁定 - 5 收藏）')
    for (let i = 0; i < 5; i++) {
      assert.ok(repo.getById(`old-${String(i).padStart(3, '0')}`), `锁定的旧项 old-00${i} 必须豁免`)
    }
    for (let i = 5; i < 10; i++) {
      assert.ok(repo.getById(`old-${String(i).padStart(3, '0')}`), `收藏的旧项 old-00${i} 必须豁免`)
    }
    for (let i = 0; i < 5; i++) {
      assert.ok(repo.getById(`new-${i}`), `新项 new-${i} 不得被 maxage 清理`)
    }

    // maxsize：当前非收藏项 = 5 锁定 + 5 新 = 10；限 6 条应删掉 4 条最旧的未锁定项
    assert.equal(repo.countItems('collected = 0'), 10, '前置：非收藏项应为 10 条')
    repo.setRetentionPolicy({ maxage: null, maxsize: 6 })
    const sized = repo.enforceRetention({ force: true, now })
    assert.equal(sized.removed, 4, '应删除 4 条最旧的未锁定项')
    assert.equal(repo.countItems('collected = 0 AND locked = 1'), 5, '锁定项一条都不能少')
    assert.equal(repo.countItems('collected = 1'), 5, '收藏项不受 maxsize 影响')

    // 节流：紧接着再调用（非 force）不应重复执行
    repo.setRetentionPolicy({ maxsize: 1, maxage: null })
    const throttled = repo.enforceRetention({ now })
    assert.equal(throttled.throttled, true, '一分钟内的第二次调用应被节流')
    assert.equal(throttled.removed, 0)

    // 策略为空时直接返回，不做任何扫描
    repo.setRetentionPolicy({ maxsize: null, maxage: null })
    assert.equal(repo.enforceRetention({ force: true, now }).removed, 0, '未配置时不得删除任何数据')

    // ---------- B. updateItem 快路径 ----------
    // 大文本会被 blobStore 外置（阈值 16KB），是「data / data_path 不一致」风险最高的场景
    const bigText = 'X'.repeat(32 * 1024)
    repo.addItem({ id: 'big-1', type: 'text', data: bigText, createTime: now, updateTime: now })
    const beforeRow = repo.selectRangeRows("id = 'big-1'", {})[0]
    assert.ok(beforeRow.data_path, '前置：大文本应已外置到 data_path')

    const bumped = repo.updateItem('big-1', { updateTime: now + 1000 })
    assert.equal(bumped, true, '快路径应返回 true')
    const afterRow = repo.selectRangeRows("id = 'big-1'", {})[0]
    assert.equal(afterRow.data_path, beforeRow.data_path, 'data_path 不得改变')
    assert.equal(repo.getById('big-1').data, bigText, 'hydrate 后内容必须完好')
    assert.equal(repo.getById('big-1').updateTime, now + 1000, 'updateTime 必须已更新')

    // 快路径必须刷新缓存：dataBase.data 是主界面数据源，否则重复复制不置顶
    assert.equal(repo.dataBase.data[0]?.id, 'big-1', '刷新缓存后该项应排在最前')

    // sourceApp / sourceWindowTitle 也走快路径
    assert.equal(repo.updateItem('big-1', { sourceApp: 'Finder', sourceWindowTitle: 'Docs' }), true)
    const enriched = repo.getById('big-1')
    assert.equal(enriched.sourceApp, 'Finder')
    assert.equal(enriched.sourceWindowTitle, 'Docs')
    assert.equal(enriched.data, bigText, '写来源信息不得破坏外置内容')

    // 含 data 的 patch 必须走慢路径：内容确实被改写，且读回正确
    assert.equal(repo.updateItem('big-1', { data: 'small now' }), true)
    const shrunk = repo.selectRangeRows("id = 'big-1'", {})[0]
    assert.equal(repo.getById('big-1').data, 'small now', '慢路径改写后必须读回新内容')
    // 由外置缩回内联：data_path 必须清空，旧 blob 文件必须被释放（否则遗留孤儿文件）
    assert.equal(shrunk.data_path, '', '缩回内联后 data_path 必须清空')
    assert.equal(fs.existsSync(beforeRow.data_path), false, '旧 blob 文件必须已被删除')

    // 快路径对不存在的 id 必须返回 false（保持原契约）
    assert.equal(repo.updateItem('missing-id', { updateTime: now }), false, '不存在的 id 应返回 false')

    // 收藏态不得被快路径改变
    repo.addItem({ id: 'col-fast', type: 'text', data: 'c', createTime: now, updateTime: now })
    repo.addCollect('col-fast')
    repo.updateItem('col-fast', { updateTime: now + 5000 })
    assert.equal(repo.getById('col-fast').collected, true, '快路径不得取消收藏')

    // ---------- C. 未 hydrate 的外置行写回保护 ----------
    // hydrateItem 在 blob 缺失/读取失败时返回 data='' + dataPath 原样。
    // 此时写回既不能清空指针（内容永久丢失），也不能按空内容重写 blob（覆盖掉好文件）。
    const bigText2 = 'Y'.repeat(32 * 1024)
    repo.addItem({ id: 'big-2', type: 'text', data: bigText2, createTime: now, updateTime: now })
    const row2 = repo.selectRangeRows("id = 'big-2'", {})[0]
    assert.ok(row2.data_path, '前置：应已外置')

    // 直接用未 hydrate 的形态写回（模拟 blob 读不到时的 getById 返回值）
    repo.upsertItemRaw({ ...repo.getById('big-2'), data: '', dataPath: row2.data_path, tags: ['t1'] }, false)
    const row2After = repo.selectRangeRows("id = 'big-2'", {})[0]
    assert.equal(row2After.data_path, row2.data_path, '未 hydrate 行写回后指针必须保留')
    assert.equal(fs.readFileSync(row2.data_path, 'utf8'), bigText2, 'blob 文件内容不得被空内容覆盖')
    assert.equal(repo.getById('big-2').data, bigText2, '内容必须仍可读回')

    // 图片同理：type=image 恒外置，未 hydrate 时不得用空内容重写
    const imgData = 'data:image/png;base64,' + 'Z'.repeat(4096)
    repo.addItem({ id: 'img-1', type: 'image', data: imgData, createTime: now, updateTime: now })
    const imgRow = repo.selectRangeRows("id = 'img-1'", {})[0]
    assert.ok(imgRow.data_path, '前置：图片应已外置')
    repo.upsertItemRaw({ id: 'img-1', type: 'image', data: '', dataPath: imgRow.data_path }, false)
    assert.equal(fs.readFileSync(imgRow.data_path, 'utf8'), imgData, '图片 blob 不得被空内容覆盖')

    console.log('retention & fast-update tests passed')
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
