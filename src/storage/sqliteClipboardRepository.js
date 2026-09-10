import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { buildSearchIndex } from './searchIndex.js'
import { BlobStore } from './blobStore.js'
import { ShortcutKeybindingRepository } from './shortcutKeybindingRepository.js'
import { CommandMacroRepository } from './commandMacroRepository.js'

const SCHEMA_VERSION = 1
const ITEM_ALIAS_STORAGE_KEY = 'item.alias.map'
const META_JSON_MIGRATION_COMPLETE = 'json_migration_complete'
const META_JSON_MIGRATION_SOURCE = 'json_migration_source'
const META_JSON_MIGRATION_FINGERPRINT = 'json_migration_fingerprint'
const META_JSON_MIGRATION_HISTORY = 'json_migration_history'
const TAB_CACHE_LIMIT = 30

// 与 Main.vue filterItemsByRange 的 JS 回退链一一对应：
//   普通页  item.updateTime  || item.collectTime || item.createTime || 0
//   收藏页  item.collectTime || item.updateTime  || item.createTime || 0
const EFFECTIVE_UPDATE_TIME =
  'COALESCE(NULLIF(update_time,0), NULLIF(collect_time,0), NULLIF(create_time,0), 0)'
const EFFECTIVE_COLLECT_TIME =
  'COALESCE(NULLIF(collect_time,0), NULLIF(update_time,0), NULLIF(create_time,0), 0)'

// 保留策略（maxsize / maxage）由 initPlugin 注入，存储层不反向依赖 global/readSetting
const RETENTION_THROTTLE_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// updateItem 快路径可直写的列。三者都不参与 buildSearchIndex，
// 因此可以跳过 upsertFts；一旦此表新增字段，必须先确认它不进搜索索引。
const FAST_UPDATE_COLUMNS = {
  updateTime: 'update_time',
  sourceApp: 'source_app',
  sourceWindowTitle: 'source_window_title'
}

const asArray = (value) => (Array.isArray(value) ? value : [])
const now = () => Date.now()

const getAliasMap = () => {
  try {
    const map = utools?.dbStorage?.getItem?.(ITEM_ALIAS_STORAGE_KEY)
    return map && typeof map === 'object' ? map : {}
  } catch (_) {
    return {}
  }
}

const parseJson = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch (_) {
    return fallback
  }
}

const rowToItem = (row) => ({
  id: row.id,
  type: row.type,
  data: row.data || '',
  locked: row.locked === 1,
  collected: row.collected === 1,
  createTime: row.create_time || 0,
  updateTime: row.update_time || 0,
  collectTime: row.collect_time || 0,
  tags: parseJson(row.tags_json, []),
  remark: row.remark || '',
  alias: row.alias || '',
  thumbnail: row.thumbnail || '',
  originPaths: parseJson(row.origin_paths_json, []),
  sourcePaths: parseJson(row.source_paths_json, []),
  fromFileSource: row.from_file_source === 1,
  hasSourceInfo: row.has_source_info === 1,
  sourceApp: row.source_app || '',
  sourceWindowTitle: row.source_window_title || '',
  dataPath: row.data_path || ''
})

// 返回 { params, releasedPath }：releasedPath 是本次写入后应删除的旧 blob。
// 注意 $data_path 直接取 prepared.dataPath，不再回退到 dbItem.dataPath ——
// 那个回退会在「内容由外置缩回内联」时把旧路径捡回来，留下孤儿文件与失真指针。
// 未 hydrate 行的指针保全已由 blobStore.prepareForDb 显式处理。
const itemToParams = (item, collected = false, blobStore = null) => {
  const ts = now()
  const prepared = blobStore?.prepareForDb(item) || {
    dbItem: item,
    dataPath: item.dataPath || '',
    dataInline: item.data || '',
    releasedPath: ''
  }
  const dbItem = prepared.dbItem
  const params = {
    $id: dbItem.id,
    $type: dbItem.type || 'text',
    $data: prepared.dataInline || dbItem.data || '',
    $data_path: prepared.dataPath || '',
    $locked: dbItem.locked === true ? 1 : 0,
    $collected: collected ? 1 : 0,
    $create_time: dbItem.createTime || ts,
    $update_time: dbItem.updateTime || ts,
    $collect_time: dbItem.collectTime || 0,
    $tags_json: JSON.stringify(asArray(dbItem.tags)),
    $remark: typeof dbItem.remark === 'string' ? dbItem.remark : '',
    $alias: typeof dbItem.alias === 'string' ? dbItem.alias : '',
    $thumbnail: typeof dbItem.thumbnail === 'string' ? dbItem.thumbnail : '',
    $origin_paths_json: JSON.stringify(asArray(dbItem.originPaths)),
    $source_paths_json: JSON.stringify(asArray(dbItem.sourcePaths)),
    $from_file_source: dbItem.fromFileSource === true ? 1 : 0,
    $has_source_info: dbItem.hasSourceInfo === true ? 1 : 0,
    $source_app: dbItem.sourceApp || '',
    $source_window_title: dbItem.sourceWindowTitle || '',
    $search_text: buildSearchIndex(item, getAliasMap())
  }
  return { params, releasedPath: prepared.releasedPath || '' }
}

export class SQLiteClipboardRepository {
  constructor({ dbPath, legacyDb, legacyJsonPath, createLegacyDb, deps = window.exports }) {
    this.dbPath = dbPath.endsWith('.sqlite') ? dbPath : `${dbPath}.sqlite`
    // legacyDb 只有真正执行 JSON 迁移时才需要。已迁移的稳态启动完全不碰它，
    // 因此改为惰性工厂：省掉整份旧 JSON 的 readFileSync + parse、O(n·m) 收藏清理、
    // 逐张缩略图解码、每次冷启动一份全量备份复制，以及一个常驻的 fs.watch。
    // 仍兼容直接传入实例的用法（测试与旧调用方）。
    this.legacyDb = legacyDb || null
    this.createLegacyDb = typeof createLegacyDb === 'function' ? createLegacyDb : null
    this.legacyJsonPath = legacyJsonPath || legacyDb?.path || ''
    this.deps = deps
    this.db = null
    this.blobStore = new BlobStore({
      rootDir: `${this.dbPath}.assets`,
      deps
    })
    this.shortcutKeybindings = null
    this.commandMacros = null
    this.mutationVersion = Date.now()
    this.persistTimer = null
    this.ftsEnabled = false
    this.retention = { maxsize: null, maxage: null }
    this.lastRetentionAt = 0
    this.collectIdSet = new Set()
    this.tabCache = new Map()
    this.dataBase = {
      data: [],
      collects: [],
      collectData: [],
      tags: [],
      tagUsage: {},
      schemaVersion: SCHEMA_VERSION,
      createTime: Date.now(),
      updateTime: Date.now()
    }
  }

  ensureLegacyDb() {
    if (this.legacyDb) return this.legacyDb
    if (!this.createLegacyDb) return null
    this.legacyDb = this.createLegacyDb()
    return this.legacyDb
  }

  getJsonSourceFingerprint() {
    // 只需路径字符串，不触发 legacyDb 的构建
    const path = this.legacyJsonPath || this.legacyDb?.path || ''
    if (!path) return ''
    try {
      if (!this.deps.existsSync(path)) return `missing:${path}`
      const raw = this.deps.readFileSync(path)
      const stat = typeof this.deps.statSync === 'function' ? this.deps.statSync(path) : null
      const hash = this.deps.crypto?.createHash
        ? this.deps.crypto.createHash('sha1').update(raw).digest('hex')
        : String(raw.length)
      const mtime = stat?.mtimeMs ? Math.floor(stat.mtimeMs) : 0
      return `${path}|${raw.length}|${mtime}|${hash}`
    } catch (_) {
      return `unreadable:${path}`
    }
  }

  async init(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
    onProgress({ progress: 12, stepText: '加载 SQLite 引擎' })
    if (this.deps.existsSync(this.dbPath)) {
      onProgress({ progress: 24, stepText: '读取 SQLite 文件' })
      const bytes = this.deps.readFileSync(this.dbPath)
      this.db = new SQL.Database(bytes)
      onProgress({ progress: 36, stepText: '检查 SQLite 表结构' })
      this.ensureSchema()
      this.initShortcutKeybindings()
      this.initCommandMacros()
      if (!this.isJsonMigrationComplete()) {
        if (this.hasMigratedCurrentJsonSource()) {
          onProgress({ progress: 82, stepText: '确认 JSON 已迁移' })
          this.markJsonMigrationComplete()
          this.persistNow()
        } else if (this.getItemCount() > 0) {
          onProgress({ progress: 82, stepText: '确认现有 SQLite 数据' })
          this.markJsonMigrationComplete()
          this.persistNow()
        } else {
          onProgress({ progress: 48, stepText: '导入旧 JSON 数据' })
          this.migrateFromLegacyJson()
          onProgress({ progress: 82, stepText: '写入迁移标记' })
          this.persistNow()
        }
      }
    } else {
      onProgress({ progress: 24, stepText: '创建 SQLite 文件' })
      this.db = new SQL.Database()
      onProgress({ progress: 36, stepText: '创建 SQLite 表结构' })
      this.ensureSchema()
      this.initShortcutKeybindings()
      this.initCommandMacros()
      onProgress({ progress: 48, stepText: '导入旧 JSON 数据' })
      this.migrateFromLegacyJson()
      onProgress({ progress: 82, stepText: '写入迁移标记' })
      this.persistNow()
    }
    onProgress({ progress: 92, stepText: '刷新运行缓存' })
    this.refreshCache({ rebuildTabs: true })
    onProgress({ progress: 100, stepText: 'SQLite 存储已就绪' })
    return true
  }

  ensureSchema() {
    this.db.run(`
      PRAGMA user_version = ${SCHEMA_VERSION};
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT,
        data_path TEXT NOT NULL DEFAULT '',
        locked INTEGER NOT NULL DEFAULT 0,
        collected INTEGER NOT NULL DEFAULT 0,
        create_time INTEGER NOT NULL,
        update_time INTEGER NOT NULL,
        collect_time INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT NOT NULL DEFAULT '[]',
        remark TEXT NOT NULL DEFAULT '',
        alias TEXT NOT NULL DEFAULT '',
        thumbnail TEXT NOT NULL DEFAULT '',
        origin_paths_json TEXT NOT NULL DEFAULT '[]',
        source_paths_json TEXT NOT NULL DEFAULT '[]',
        from_file_source INTEGER NOT NULL DEFAULT 0,
        has_source_info INTEGER NOT NULL DEFAULT 0,
        source_app TEXT NOT NULL DEFAULT '',
        source_window_title TEXT NOT NULL DEFAULT '',
        search_text TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_items_tab_time ON items(type, collected, update_time DESC);
      CREATE INDEX IF NOT EXISTS idx_items_collect_time ON items(collected, collect_time DESC);
      CREATE INDEX IF NOT EXISTS idx_items_locked ON items(locked);
      CREATE INDEX IF NOT EXISTS idx_items_collected_time ON items(collected, update_time DESC);
      CREATE INDEX IF NOT EXISTS idx_items_type_locked_time ON items(type, locked, collected, update_time DESC);
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)
    this.ensureColumn('items', 'data_path', "TEXT NOT NULL DEFAULT ''")
    try {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
          id UNINDEXED,
          search_text
        );
      `)
      this.ftsEnabled = true
      this.rebuildFts()
    } catch (err) {
      console.warn('[SQLiteClipboardRepository] FTS5 不可用，回退 LIKE 搜索:', err)
      this.ftsEnabled = false
    }
  }

  initShortcutKeybindings() {
    try {
      this.shortcutKeybindings = new ShortcutKeybindingRepository(this.db)
      this.shortcutKeybindings.ensureSchema()
      this.shortcutKeybindings.seedDefaultSnapshots({ write: true })
      const setting = typeof utools !== 'undefined' ? utools?.dbStorage?.getItem?.('setting') : null
      this.shortcutKeybindings.migrateOverridesFromSetting(setting?.hotkeyOverrides || {}, { write: true })
      this.persistNow()
      return true
    } catch (err) {
      console.warn('[SQLiteClipboardRepository] 快捷键 SQLite 初始化失败，继续使用 setting fallback:', err)
      this.shortcutKeybindings = null
      return false
    }
  }

  initCommandMacros() {
    try {
      this.commandMacros = new CommandMacroRepository(this.db)
      this.commandMacros.ensureSchema()
      this.persistNow()
      return true
    } catch (err) {
      console.warn('[SQLiteClipboardRepository] 组合命令 SQLite 初始化失败，继续禁用 macro 持久化:', err)
      this.commandMacros = null
      return false
    }
  }

  getMeta(key) {
    const stmt = this.db.prepare('SELECT value FROM meta WHERE key = $key')
    try {
      stmt.bind({ $key: key })
      if (!stmt.step()) return ''
      return String(stmt.getAsObject().value || '')
    } finally {
      stmt.free()
    }
  }

  setMeta(key, value) {
    this.db.run('INSERT OR REPLACE INTO meta(key, value) VALUES ($key, $value)', {
      $key: key,
      $value: String(value)
    })
  }

  isJsonMigrationComplete() {
    return this.getMeta(META_JSON_MIGRATION_COMPLETE) === '1'
  }

  getItemCount() {
    const stmt = this.db.prepare('SELECT COUNT(*) AS total FROM items')
    try {
      stmt.step()
      return Number(stmt.getAsObject().total || 0)
    } finally {
      stmt.free()
    }
  }

  markJsonMigrationComplete() {
    const fingerprint = this.getJsonSourceFingerprint()
    const history = this.getMigratedJsonHistory()
    if (fingerprint && !history.includes(fingerprint)) {
      history.push(fingerprint)
    }
    this.setMeta(META_JSON_MIGRATION_COMPLETE, '1')
    this.setMeta(META_JSON_MIGRATION_SOURCE, this.legacyJsonPath || this.legacyDb?.path || '')
    this.setMeta(META_JSON_MIGRATION_FINGERPRINT, fingerprint)
    this.setMeta(META_JSON_MIGRATION_HISTORY, JSON.stringify(history))
  }

  getMigratedJsonHistory() {
    return parseJson(this.getMeta(META_JSON_MIGRATION_HISTORY), [])
  }

  hasMigratedCurrentJsonSource() {
    const fingerprint = this.getJsonSourceFingerprint()
    if (!fingerprint) return false
    if (this.getMeta(META_JSON_MIGRATION_FINGERPRINT) === fingerprint) return true
    return this.getMigratedJsonHistory().includes(fingerprint)
  }

  ensureColumn(table, column, definition) {
    const rows = this.db.exec(`PRAGMA table_info(${table})`)
    const values = rows?.[0]?.values || []
    const exists = values.some((row) => row[1] === column)
    if (!exists) {
      this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  runInTransaction(fn) {
    this.db.run('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.run('COMMIT')
      this.bumpVersion()
      this.queuePersist()
      return result
    } catch (err) {
      try {
        this.db.run('ROLLBACK')
      } catch (_) {}
      this.refreshCache()
      throw err
    }
  }

  bumpVersion() {
    this.mutationVersion = Date.now()
    return this.mutationVersion
  }

  getVersion() {
    return this.mutationVersion
  }

  persistNow() {
    const bytes = this.db.export()
    const BufferCtor = this.deps?.Buffer || globalThis.Buffer
    const payload = BufferCtor?.from ? BufferCtor.from(bytes) : bytes
    this.deps.writeFileSync(this.dbPath, payload)
  }

  queuePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistNow()
    }, 120)
    return true
  }

  updateDataBaseLocal(_dataBase, options = {}) {
    if (options.immediate) this.flush()
    else this.queuePersist()
    return true
  }

  flush() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.persistNow()
  }

  migrateFromLegacyJson() {
    // 唯一真正需要旧 JSON 内容的地方，在此按需构建
    const legacy = this.ensureLegacyDb()
    const data = asArray(legacy?.dataBase?.data)
    const collects = asArray(legacy?.dataBase?.collectData)
    this.db.run('BEGIN IMMEDIATE')
    try {
      data.forEach((item) => this.upsertItemRaw(item, false))
      collects.forEach((item) => this.upsertItemRaw(item, true))
      this.setMeta('migrated_from_json_at', Date.now())
      this.markJsonMigrationComplete()
      this.db.run('COMMIT')
    } catch (err) {
      this.db.run('ROLLBACK')
      throw err
    }
  }

  upsertItemRaw(item, collected = false) {
    if (!item?.id) return false
    const { params, releasedPath } = itemToParams(item, collected, this.blobStore)
    this.db.run(
      `INSERT INTO items (
        id, type, data, data_path, locked, collected, create_time, update_time, collect_time,
        tags_json, remark, alias, thumbnail, origin_paths_json, source_paths_json,
        from_file_source, has_source_info, source_app, source_window_title, search_text
      ) VALUES (
        $id, $type, $data, $data_path, $locked, $collected, $create_time, $update_time, $collect_time,
        $tags_json, $remark, $alias, $thumbnail, $origin_paths_json, $source_paths_json,
        $from_file_source, $has_source_info, $source_app, $source_window_title, $search_text
      )
      ON CONFLICT(id) DO UPDATE SET
        type=excluded.type,
        data=excluded.data,
        data_path=excluded.data_path,
        locked=excluded.locked,
        collected=excluded.collected,
        create_time=excluded.create_time,
        update_time=excluded.update_time,
        collect_time=excluded.collect_time,
        tags_json=excluded.tags_json,
        remark=excluded.remark,
        alias=excluded.alias,
        thumbnail=excluded.thumbnail,
        origin_paths_json=excluded.origin_paths_json,
        source_paths_json=excluded.source_paths_json,
        from_file_source=excluded.from_file_source,
        has_source_info=excluded.has_source_info,
        source_app=excluded.source_app,
        source_window_title=excluded.source_window_title,
        search_text=excluded.search_text`,
      params
    )
    this.upsertFts(params.$id, params.$search_text)
    // 写库成功后再释放旧 blob，避免写失败时内容已被删除
    if (releasedPath) this.blobStore.releasePath(releasedPath)
    return true
  }

  upsertFts(id, searchText) {
    if (!this.ftsEnabled) return
    this.db.run('DELETE FROM items_fts WHERE id = $id', { $id: id })
    this.db.run('INSERT INTO items_fts(id, search_text) VALUES ($id, $search_text)', {
      $id: id,
      $search_text: searchText || ''
    })
  }

  deleteFts(id) {
    if (!this.ftsEnabled) return
    this.db.run('DELETE FROM items_fts WHERE id = $id', { $id: id })
  }

  rebuildFts() {
    if (!this.ftsEnabled) return
    this.db.run('DELETE FROM items_fts')
    const stmt = this.db.prepare('SELECT id, search_text FROM items')
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject()
        this.db.run('INSERT INTO items_fts(id, search_text) VALUES ($id, $search_text)', {
          $id: row.id,
          $search_text: row.search_text || ''
        })
      }
    } finally {
      stmt.free()
    }
  }

  selectItems(where = '1=1', params = {}, orderBy = 'update_time DESC', limit = null) {
    const limitSql = limit ? ` LIMIT ${Number(limit)}` : ''
    const stmt = this.db.prepare(`SELECT * FROM items WHERE ${where} ORDER BY ${orderBy}${limitSql}`)
    try {
      stmt.bind(params)
      const rows = []
      while (stmt.step()) rows.push(rowToItem(stmt.getAsObject()))
      return rows
    } finally {
      stmt.free()
    }
  }

  makeIdParams(ids = []) {
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))]
    const params = {}
    const placeholders = uniqueIds.map((id, index) => {
      const key = `$id${index}`
      params[key] = id
      return key
    })
    return { uniqueIds, params, placeholders }
  }

  refreshCache(options = {}) {
    const { rebuildTabs = false } = options
    const data = this.selectItems('collected = 0', {}, 'update_time DESC', TAB_CACHE_LIMIT)
    const collectData = this.selectItems('collected = 1', {}, 'collect_time DESC, update_time DESC', TAB_CACHE_LIMIT)
    const tags = new Set()
    const tagUsage = {}
    this.selectTagRows().forEach((item) => {
      asArray(item.tags).forEach((tag) => {
        tags.add(tag)
        tagUsage[tag] = (tagUsage[tag] || 0) + 1
      })
    })
    if (rebuildTabs) {
      this.rebuildTabCache()
    } else {
      this.tabCache.clear()
    }
    this.dataBase = {
      data,
      collects: collectData.map((item) => item.id),
      collectData,
      tags: [...tags],
      tagUsage,
      schemaVersion: SCHEMA_VERSION,
      createTime: this.dataBase.createTime || Date.now(),
      updateTime: Date.now()
    }
    this.collectIdSet = new Set(this.selectCollectedIds())
  }

  // 收藏判定必须覆盖全部收藏项：dataBase.collects 受 TAB_CACHE_LIMIT 截断，
  // 直接用它会让第 TAB_CACHE_LIMIT+1 条以后的收藏被误判为未收藏（静默取消收藏 / 绕过删除保护）。
  selectCollectedIds() {
    const stmt = this.db.prepare('SELECT id FROM items WHERE collected = 1')
    try {
      const ids = []
      while (stmt.step()) ids.push(stmt.getAsObject().id)
      return ids
    } finally {
      stmt.free()
    }
  }

  selectTagRows() {
    const stmt = this.db.prepare('SELECT tags_json FROM items WHERE collected = 1')
    try {
      const rows = []
      while (stmt.step()) {
        rows.push({ tags: parseJson(stmt.getAsObject().tags_json, []) })
      }
      return rows
    } finally {
      stmt.free()
    }
  }

  rebuildTabCache() {
    ;['all', 'text', 'image', 'file', 'collect'].forEach((tab) => {
      this.tabCache.set(tab, this.querySql({
        tab,
        cursor: 0,
        limit: TAB_CACHE_LIMIT
      }))
    })
  }

  query(options = {}) {
    const hasCollectTag = options.collectTag && options.collectTag !== '*全部*'
    const cacheKey = options.keyword || options.lockFilter === 'locked' || hasCollectTag
      ? ''
      : options.tab || 'all'
    const cursor = Math.max(0, Number(options.cursor) || 0)
    const limit = Math.max(1, Number(options.limit) || 30)
    const cached = cacheKey ? this.tabCache.get(cacheKey) : null
    if (cached && cursor === 0 && limit <= cached.items.length) {
      return {
        items: cached.items.slice(0, limit),
        total: cached.total,
        cursor: 0,
        nextCursor: limit < cached.total ? limit : null
      }
    }
    return this.querySql(options)
  }

  querySql(options = {}) {
    const {
      tab = 'all',
      keyword = '',
      lockFilter = 'all',
      collectTag = '*全部*',
      cursor = 0,
      limit = 30
    } = options
    const where = []
    const params = {}
    const offset = Math.max(0, Number(cursor) || 0)
    const pageSize = Math.max(1, Number(limit) || 30)

    if (tab === 'collect') where.push('collected = 1')
    else where.push('collected = 0')
    if (tab && !['all', 'collect'].includes(tab)) {
      where.push('type = $type')
      params.$type = tab
    }
    if (lockFilter === 'locked') where.push('locked = 1')
    if (tab === 'collect' && collectTag && collectTag !== '*全部*') {
      where.push('tags_json LIKE $tag')
      params.$tag = `%"${collectTag.replaceAll('"', '""')}"%`
    }
    const parts = String(keyword || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    const safeFtsToken = (part) => /^[\p{L}\p{N}_]+$/u.test(part)
    const useFts = this.ftsEnabled && parts.length > 0 && parts.every(safeFtsToken)

    const whereSql = where.length ? where.join(' AND ') : '1=1'
    const orderBy = tab === 'collect' ? 'collect_time DESC, update_time DESC' : 'update_time DESC'
    let countSql = `SELECT COUNT(*) AS total FROM items WHERE ${whereSql}`
    let pageSql = `SELECT * FROM items WHERE ${whereSql} ORDER BY ${orderBy} LIMIT $limit OFFSET $offset`
    if (useFts) {
      params.$match = parts.map((part) => `"${part.replaceAll('"', '""')}"`).join(' AND ')
      countSql = `SELECT COUNT(*) AS total FROM items i JOIN items_fts f ON f.id = i.id WHERE ${whereSql.replaceAll('items.', 'i.')} AND f.search_text MATCH $match`
      pageSql = `SELECT i.* FROM items i JOIN items_fts f ON f.id = i.id WHERE ${whereSql.replaceAll('items.', 'i.')} AND f.search_text MATCH $match ORDER BY i.${orderBy.replaceAll(', ', ', i.')} LIMIT $limit OFFSET $offset`
    } else {
      parts.forEach((part, index) => {
        where.push(`search_text LIKE $kw${index}`)
        params[`$kw${index}`] = `%${part}%`
      })
      const likeWhereSql = where.length ? where.join(' AND ') : '1=1'
      countSql = `SELECT COUNT(*) AS total FROM items WHERE ${likeWhereSql}`
      pageSql = `SELECT * FROM items WHERE ${likeWhereSql} ORDER BY ${orderBy} LIMIT $limit OFFSET $offset`
    }
    const needsExactTotal = parts.length > 0 || lockFilter === 'locked' || (tab === 'collect' && collectTag && collectTag !== '*全部*')
    const fastPageSql = pageSql.replace('LIMIT $limit OFFSET $offset', 'LIMIT $fast_limit OFFSET $offset')
    const pageStmt = this.db.prepare(needsExactTotal ? pageSql : fastPageSql)
    const countStmt = needsExactTotal ? this.db.prepare(countSql) : null
    try {
      let total = null
      if (countStmt) {
        countStmt.bind(params)
        countStmt.step()
        total = countStmt.getAsObject().total || 0
      }
      pageStmt.bind(needsExactTotal
        ? { ...params, $limit: pageSize, $offset: offset }
        : { ...params, $fast_limit: pageSize + 1, $offset: offset })
      const items = []
      while (pageStmt.step()) items.push(this.blobStore.hydrateItem(rowToItem(pageStmt.getAsObject())))
      const hasMore = needsExactTotal ? offset + items.length < total : items.length > pageSize
      const pageItems = needsExactTotal ? items : items.slice(0, pageSize)
      const approxTotal = needsExactTotal ? total : offset + pageItems.length + (hasMore ? 1 : 0)
      return {
        items: pageItems,
        total: approxTotal,
        cursor: offset,
        nextCursor: hasMore ? offset + pageItems.length : null
      }
    } finally {
      countStmt?.free()
      pageStmt.free()
    }
  }

  getById(id) {
    const item = this.selectItems('id = $id', { $id: id })[0] || null
    return this.blobStore.hydrateItem(item)
  }

  addItem(item) {
    const result = this.runInTransaction(() => {
      const existing = this.getById(item.id)
      const next = existing
        ? { ...existing, updateTime: Date.now() }
        : { ...item, locked: item.locked === true, createTime: item.createTime || Date.now(), updateTime: item.updateTime || Date.now() }
      this.upsertItemRaw(next, existing ? existing.collected === true : false)
      this.refreshCache()
      return true
    })
    // 必须在事务外：enforceRetention 自带 runInTransaction，嵌套 BEGIN 会失败
    this.enforceRetention()
    return result
  }

  updateItem(id, patch = {}) {
    const keys = Object.keys(patch)
    // 快路径：patch 仅含白名单列时直写，不 getById、不进 blobStore、不重建 search_text。
    // 重复复制一张 5MB 截图原本要付「全量读 blob -> 原样写回 -> 整库 export」。
    // refreshCache 必须保留：dataBase.data 是主界面数据源，跳过会导致重复复制不置顶、列表不刷新。
    if (keys.length > 0 && keys.every((key) => key in FAST_UPDATE_COLUMNS)) {
      return this.runInTransaction(() => {
        const assignments = []
        const params = { $id: id }
        keys.forEach((key, index) => {
          assignments.push(`${FAST_UPDATE_COLUMNS[key]} = $v${index}`)
          params[`$v${index}`] =
            key === 'updateTime' ? Number(patch[key]) || Date.now() : String(patch[key] ?? '')
        })
        this.db.run(`UPDATE items SET ${assignments.join(', ')} WHERE id = $id`, params)
        if (this.db.getRowsModified() === 0) return false
        this.refreshCache()
        return true
      })
    }
    return this.runInTransaction(() => {
      const item = this.getById(id)
      if (!item) return false
      this.upsertItemRaw({ ...item, ...patch, updateTime: patch.updateTime || item.updateTime }, item.collected === true)
      this.refreshCache()
      return true
    })
  }

  removeItemViaId(id, options = {}) {
    return this.removeItem(id, options)
  }

  removeItem(id, options = {}) {
    const result = this.removeItems([id], options)
    return result.removed > 0
  }

  removeItems(ids = [], options = {}) {
    const { force = false } = options
    return this.runInTransaction(() => {
      const { uniqueIds, params, placeholders } = this.makeIdParams(ids)
      const idSet = new Set(uniqueIds)
      let removed = 0
      let skippedLocked = 0
      let skippedCollected = 0
      if (!uniqueIds.length) {
        return { removed, skippedLocked, skippedCollected, missing: 0 }
      }
      const items = this.selectItems(`id IN (${placeholders.join(',')})`, params)
      const removableIds = []
      items.forEach((item) => {
        if (item.locked && !force) {
          skippedLocked++
          return
        }
        if (item.collected === true && !force) {
          skippedCollected++
          return
        }
        this.blobStore.removeForItem(item)
        removableIds.push(item.id)
        removed++
      })
      if (removableIds.length) {
        const deleteParams = this.makeIdParams(removableIds)
        const inSql = deleteParams.placeholders.join(',')
        this.db.run(`DELETE FROM items WHERE id IN (${inSql})`, deleteParams.params)
        if (this.ftsEnabled) {
          this.db.run(`DELETE FROM items_fts WHERE id IN (${inSql})`, deleteParams.params)
        }
      }
      this.refreshCache()
      return { removed, skippedLocked, skippedCollected, missing: Math.max(0, idSet.size - items.length) }
    })
  }

  // 只取清理判定必需的三列，避免把整库行读进内存
  selectRangeRows(whereSql, params = {}) {
    const stmt = this.db.prepare(`SELECT id, locked, data_path FROM items WHERE ${whereSql}`)
    try {
      stmt.bind(params)
      const rows = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      return rows
    } finally {
      stmt.free()
    }
  }

  // 按 Tab + 时间范围直接在库内清理，不受 TAB_CACHE_LIMIT 运行缓存限制。
  // 豁免判定一律走 SQL 列（collected = 0 / locked = 0），不使用 isCollected。
  // 返回真实 id 列表：调用方要用它同步可见列表、置顶与置顶组缓存，只回计数会让界面与库脱节。
  removeByRange(options = {}) {
    const { tab = 'all', since = null, force = false, batchSize = 200, onProgress = null } = options
    const where = ['collected = 0']
    const params = {}
    if (tab && !['all', 'collect'].includes(tab)) {
      where.push('type = $type')
      params.$type = tab
    }
    if (since != null) {
      where.push(`${EFFECTIVE_UPDATE_TIME} >= $since`)
      params.$since = Number(since) || 0
    }
    const rows = this.selectRangeRows(where.join(' AND '), params)
    const skippedLocked = force ? 0 : rows.filter((row) => row.locked === 1).length
    const targets = force ? rows : rows.filter((row) => row.locked !== 1)
    const removedIds = this.deleteRowsInBatches(targets, { batchSize, onProgress })
    this.refreshCache()
    return { removed: removedIds.length, removedIds, skippedLocked, candidates: rows.length }
  }

  // 分批提交：单个大事务会阻塞 UI；queuePersist 有 120ms 去抖，多批仍只落盘一次。
  // 复用既有清理链路：blob 资产 -> items -> items_fts，缺一即产生孤儿资产或脏索引。
  // 不在此处 refreshCache，由调用方在全部批次结束后统一刷新一次。
  deleteRowsInBatches(rows = [], options = {}) {
    const { batchSize = 200, onProgress = null } = options
    const removedIds = []
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize)
      this.runInTransaction(() => {
        const { params: idParams, placeholders } = this.makeIdParams(batch.map((row) => row.id))
        const inSql = placeholders.join(',')
        batch.forEach((row) => this.blobStore.removeForItem({ dataPath: row.data_path }))
        this.db.run(`DELETE FROM items WHERE id IN (${inSql})`, idParams)
        if (this.ftsEnabled) {
          this.db.run(`DELETE FROM items_fts WHERE id IN (${inSql})`, idParams)
        }
        return true
      })
      batch.forEach((row) => removedIds.push(row.id))
      onProgress?.({ current: removedIds.length, total: rows.length })
    }
    return removedIds
  }

  countItems(whereSql = '1=1', params = {}) {
    const stmt = this.db.prepare(`SELECT COUNT(*) AS total FROM items WHERE ${whereSql}`)
    try {
      stmt.bind(params)
      stmt.step()
      return stmt.getAsObject().total || 0
    } finally {
      stmt.free()
    }
  }

  selectOldestRows(whereSql, limit) {
    const stmt = this.db.prepare(
      `SELECT id, locked, data_path FROM items WHERE ${whereSql} ORDER BY ${EFFECTIVE_UPDATE_TIME} ASC LIMIT ${Number(limit)}`
    )
    try {
      const rows = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      return rows
    } finally {
      stmt.free()
    }
  }

  // 由 initPlugin 注入 setting.database.{maxsize,maxage}，避免存储层依赖 global/readSetting
  setRetentionPolicy(policy = {}) {
    const size = Number(policy.maxsize)
    const age = Number(policy.maxage)
    this.retention = {
      maxsize: Number.isFinite(size) && size > 0 ? Math.floor(size) : null,
      maxage: Number.isFinite(age) && age > 0 ? age : null
    }
    return this.retention
  }

  // maxsize / maxage 清理。收藏与锁定项一律豁免，判定走 SQL 列而非 isCollected。
  // 只在写入路径（addItem）触发并做节流；不在 init 中调用——那时 refreshCache 尚未建缓存，
  // 且会把删除耗时算进启动时间。
  enforceRetention(options = {}) {
    const { force = false, now = Date.now() } = options
    const { maxsize, maxage } = this.retention
    if (maxsize == null && maxage == null) return { removed: 0, removedIds: [] }
    if (!force && now - this.lastRetentionAt < RETENTION_THROTTLE_MS) {
      return { removed: 0, removedIds: [], throttled: true }
    }
    this.lastRetentionAt = now
    const removedIds = []
    if (maxage != null) {
      const stale = this.selectRangeRows(
        `collected = 0 AND locked = 0 AND ${EFFECTIVE_UPDATE_TIME} < $cutoff`,
        { $cutoff: now - maxage * DAY_MS }
      )
      removedIds.push(...this.deleteRowsInBatches(stale))
    }
    if (maxsize != null) {
      // 总数含锁定项（与旧 JSON 实现口径一致），但只删未锁定的最旧项
      const exceed = this.countItems('collected = 0') - maxsize
      if (exceed > 0) {
        const oldest = this.selectOldestRows('collected = 0 AND locked = 0', exceed)
        removedIds.push(...this.deleteRowsInBatches(oldest))
      }
    }
    if (removedIds.length) this.refreshCache()
    return { removed: removedIds.length, removedIds }
  }

  // 收藏页「清空」的语义是取消收藏而非删除，因此走 UPDATE collected = 0，
  // 条目回落到历史列表。写成 DELETE 即为数据丢失级的行为变更。
  removeCollectsByRange(options = {}) {
    const { collectTag = '*全部*', since = null, force = false, batchSize = 200, onProgress = null } = options
    const where = ['collected = 1']
    const params = {}
    if (collectTag && collectTag !== '*全部*') {
      where.push('tags_json LIKE $tag')
      params.$tag = `%"${String(collectTag).replaceAll('"', '""')}"%`
    }
    if (since != null) {
      where.push(`${EFFECTIVE_COLLECT_TIME} >= $since`)
      params.$since = Number(since) || 0
    }
    const rows = this.selectRangeRows(where.join(' AND '), params)
    const skippedLocked = force ? 0 : rows.filter((row) => row.locked === 1).length
    const targets = force ? rows : rows.filter((row) => row.locked !== 1)
    const removedIds = []
    for (let offset = 0; offset < targets.length; offset += batchSize) {
      const batch = targets.slice(offset, offset + batchSize)
      this.runInTransaction(() => {
        const { params: idParams, placeholders } = this.makeIdParams(batch.map((row) => row.id))
        this.db.run(
          `UPDATE items SET collected = 0, update_time = $time WHERE id IN (${placeholders.join(',')})`,
          { ...idParams, $time: Date.now() }
        )
        return true
      })
      batch.forEach((row) => removedIds.push(row.id))
      onProgress?.({ current: removedIds.length, total: targets.length })
    }
    this.refreshCache()
    return { removed: removedIds.length, removedIds, skippedLocked, candidates: rows.length }
  }

  setLock(id, locked) {
    return this.setLocks([id], locked)
  }

  setLocks(ids = [], locked = true) {
    return this.runInTransaction(() => {
      const { uniqueIds, params, placeholders } = this.makeIdParams(ids)
      if (!uniqueIds.length) return false
      this.db.run(`UPDATE items SET locked = $locked WHERE id IN (${placeholders.join(',')})`, {
        ...params,
        $locked: locked ? 1 : 0
      })
      this.refreshCache()
      return true
    })
  }

  addCollect(id) {
    return this.runInTransaction(() => {
      this.db.run('UPDATE items SET collected = 1, collect_time = $time WHERE id = $id', {
        $id: id,
        $time: Date.now()
      })
      this.refreshCache()
      return true
    })
  }

  removeCollect(id) {
    const result = this.removeCollects([id])
    return result.removed > 0
  }

  removeCollects(ids = []) {
    return this.runInTransaction(() => {
      const { uniqueIds, params, placeholders } = this.makeIdParams(ids)
      if (!uniqueIds.length) return { removed: 0 }
      this.db.run(
        `UPDATE items SET collected = 0, update_time = $time WHERE id IN (${placeholders.join(',')})`,
        {
          ...params,
          $time: Date.now()
        }
      )
      this.refreshCache()
      return { removed: uniqueIds.length }
    })
  }

  isCollected(id) {
    return this.collectIdSet.has(id)
  }

  isLocked(id) {
    return this.getById(id)?.locked === true
  }

  getCollects() {
    return this.dataBase.collectData
  }

  getCollectsByTag(tag) {
    if (!tag || tag === '*全部*') return this.getCollects()
    return this.dataBase.collectData.filter((item) => asArray(item.tags).includes(tag))
  }

  getTags() {
    return this.dataBase.tags
  }

  getTagUsage() {
    return this.dataBase.tagUsage
  }

  updateItemTags(id, tags) {
    return this.updateItem(id, { tags })
  }

  updateItemRemark(id, remark) {
    return this.updateItem(id, { remark })
  }

  updateItemData(id, data) {
    return this.updateItem(id, { data })
  }

  filterDataBaseViaId(id) {
    const item = this.getById(id)
    return item ? [item] : []
  }

  updateItemViaId(id) {
    return this.updateItem(id, { updateTime: Date.now() })
  }

  emptyDataBase() {
    return this.runInTransaction(() => {
      this.db.run('DELETE FROM items')
      this.refreshCache()
      return true
    })
  }
}

export const createSQLiteClipboardRepository = async (options) => {
  const repo = new SQLiteClipboardRepository(options)
  await repo.init(options)
  return repo
}
