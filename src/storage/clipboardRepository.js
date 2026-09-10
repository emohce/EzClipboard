import { buildSearchIndex, normalizeAliasMapEntry, queryClipboardItems } from './searchIndex.js'

const ITEM_ALIAS_STORAGE_KEY = 'item.alias.map'

const EMPTY_QUERY = {
  items: [],
  total: 0,
  cursor: 0,
  nextCursor: null
}

const getAliasMap = () => {
  try {
    const map = utools?.dbStorage?.getItem?.(ITEM_ALIAS_STORAGE_KEY)
    return map && typeof map === 'object' ? map : {}
  } catch (_) {
    return {}
  }
}

const asArray = (value) => (Array.isArray(value) ? value : [])

const createAliasSignature = (aliasMap = {}) =>
  Object.keys(aliasMap)
    .sort()
    .map((key) => {
      const entry = normalizeAliasMapEntry(aliasMap[key])
      return `${key}:${entry.value}:${entry.cleared ? 'cleared' : 'active'}`
    })
    .join('|')

export class ClipboardRepository {
  constructor(legacyDb) {
    this.legacyDb = legacyDb
    this.aliasMap = {}
    this.aliasSignature = ''
    this.collectIdSet = new Set()
    this.searchIndexMap = new Map()
    this.mutationVersion = Date.now()
    this.refreshDerivedIndexes()
  }

  init() {
    this.refreshDerivedIndexes()
    return true
  }

  refreshDerivedIndexes(options = {}) {
    const { rebuildSearch = true } = options
    const nextAliasMap = getAliasMap()
    const nextAliasSignature = createAliasSignature(nextAliasMap)
    const aliasChanged = nextAliasSignature !== this.aliasSignature
    this.aliasMap = nextAliasMap
    this.aliasSignature = nextAliasSignature
    this.collectIdSet = new Set(this.getCollects().map((item) => item.id))
    if (rebuildSearch || aliasChanged) this.rebuildSearchIndex()
  }

  rebuildSearchIndex() {
    const next = new Map()
    for (const item of [...this.getData(), ...this.getCollects()]) {
      if (item?.id) next.set(item.id, buildSearchIndex(item, this.aliasMap))
    }
    this.searchIndexMap = next
  }

  bumpVersion() {
    this.mutationVersion = Date.now()
    return this.mutationVersion
  }

  getVersion() {
    return this.mutationVersion
  }

  get dataBase() {
    return this.legacyDb?.dataBase || {
      data: [],
      collects: [],
      collectData: [],
      tags: [],
      tagUsage: {}
    }
  }

  set dataBase(nextDataBase) {
    if (this.legacyDb) {
      this.legacyDb.dataBase = nextDataBase
      this.bumpVersion()
      this.refreshDerivedIndexes()
    }
  }

  getData() {
    return asArray(this.dataBase.data)
  }

  getCollects() {
    return typeof this.legacyDb?.getCollects === 'function'
      ? asArray(this.legacyDb.getCollects())
      : asArray(this.dataBase.collectData)
  }

  getCollectsByTag(tag) {
    if (!tag || tag === '*全部*') return this.getCollects()
    return this.getCollects().filter((item) => Array.isArray(item.tags) && item.tags.includes(tag))
  }

  query(options = {}) {
    if (!this.legacyDb) return EMPTY_QUERY
    globalThis.performance?.mark?.('ezclipboard:repository-query:start')
    this.refreshDerivedIndexes({ rebuildSearch: false })
    const result = queryClipboardItems({
      items: this.getData(),
      collectItems: this.getCollects(),
      collectIds: this.collectIdSet,
      aliasMap: this.aliasMap,
      searchIndexMap: this.searchIndexMap,
      ...options
    })
    globalThis.performance?.mark?.('ezclipboard:repository-query:end')
    globalThis.performance?.measure?.(
      'ezclipboard:repository-query',
      'ezclipboard:repository-query:start',
      'ezclipboard:repository-query:end'
    )
    return result
  }

  getById(id) {
    if (!id) return null
    return (
      this.getData().find((item) => item.id === id) ||
      this.getCollects().find((item) => item.id === id) ||
      null
    )
  }

  addItem(item) {
    const result = this.legacyDb?.addItem?.(item)
    this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  updateItem(id, patch = {}) {
    const item = this.getById(id)
    if (!item) return false
    Object.assign(item, patch)
    if (typeof this.legacyDb?.queuePersist === 'function') {
      this.legacyDb.queuePersist()
    } else if (typeof this.legacyDb?.updateDataBaseLocal === 'function') {
      this.legacyDb.updateDataBaseLocal()
    }
    this.bumpVersion()
    this.refreshDerivedIndexes()
    return true
  }

  removeItem(id, options = {}) {
    const result =
      this.legacyDb?.removeItemViaId?.(id, options) ??
      this.legacyDb?.removeItem?.(id, options.force)
    if (result) this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  removeItemViaId(id, options = {}) {
    return this.removeItem(id, options)
  }

  removeItems(ids = [], options = {}) {
    const result = this.legacyDb?.removeItemsViaIds?.(ids, options)
    if (result) {
      if (result.removed > 0) this.bumpVersion()
      this.refreshDerivedIndexes()
      return result
    }
    let removed = 0
    let skippedLocked = 0
    for (const id of ids) {
      const item = this.getById(id)
      const ok = this.legacyDb?.removeItemViaId?.(id, options)
      if (ok) removed++
      else if (item?.locked) skippedLocked++
    }
    if (removed > 0) this.bumpVersion()
    this.refreshDerivedIndexes()
    return { removed, skippedLocked, skippedCollected: 0, missing: 0 }
  }

  // JSON 回退路径的 maxsize / maxage 清理仍由 legacy DB 内的原实现负责
  //（maxsize 在 DB.addItem、maxage 在 DB.init），此处显式 no-op 以统一调用点。
  setRetentionPolicy() {
    return { maxsize: null, maxage: null }
  }

  enforceRetention() {
    return { removed: 0, removedIds: [] }
  }

  // 与 SQLite 主路径同名同签名，保证 Main.vue 的清空链路在降级态行为一致。
  // 该 facade 的 dataBase 是全量（非 30 条截断），因此可直接在 JS 侧筛选。
  removeByRange(options = {}) {
    const { tab = 'all', since = null, force = false, onProgress = null } = options
    const effectiveTime = (item) => item.updateTime || item.collectTime || item.createTime || 0
    let rows = asArray(this.dataBase?.data).filter((item) => !this.isCollected(item.id))
    if (tab && !['all', 'collect'].includes(tab)) {
      rows = rows.filter((item) => item.type === tab)
    }
    if (since != null) {
      rows = rows.filter((item) => effectiveTime(item) >= since)
    }
    const skippedLocked = force ? 0 : rows.filter((item) => item.locked === true).length
    const targets = force ? rows : rows.filter((item) => item.locked !== true)
    const removedIds = targets.map((item) => item.id)
    const result = this.removeItems(removedIds, { force })
    onProgress?.({ current: removedIds.length, total: removedIds.length })
    return {
      removed: result?.removed || 0,
      removedIds,
      skippedLocked,
      candidates: rows.length
    }
  }

  removeCollectsByRange(options = {}) {
    const { collectTag = '*全部*', since = null, force = false, onProgress = null } = options
    const effectiveTime = (item) => item.collectTime || item.updateTime || item.createTime || 0
    let rows = asArray(
      collectTag && collectTag !== '*全部*' ? this.getCollectsByTag(collectTag) : this.getCollects()
    )
    if (since != null) {
      rows = rows.filter((item) => effectiveTime(item) >= since)
    }
    const skippedLocked = force ? 0 : rows.filter((item) => item.locked === true).length
    const targets = force ? rows : rows.filter((item) => item.locked !== true)
    const removedIds = targets.map((item) => item.id)
    const result = this.removeCollects(removedIds, false)
    onProgress?.({ current: removedIds.length, total: removedIds.length })
    return {
      removed: result?.removed || 0,
      removedIds,
      skippedLocked,
      candidates: rows.length
    }
  }

  setCollect(id, collected) {
    const result = collected
      ? this.legacyDb?.addCollect?.(id)
      : this.legacyDb?.removeCollect?.(id)
    if (result !== false) this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  addCollect(id, log) {
    const result = this.legacyDb?.addCollect?.(id, log)
    if (result !== false) this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  removeCollect(id, log) {
    const result = this.legacyDb?.removeCollect?.(id, log)
    if (result !== false) this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  removeCollects(ids = [], log = false, options = {}) {
    const result = this.legacyDb?.removeCollects?.(ids, log, options)
    if (result) {
      if (result.removed > 0) this.bumpVersion()
      this.refreshDerivedIndexes()
      return result
    }
    let removed = 0
    ids.forEach((id) => {
      if (this.legacyDb?.removeCollect?.(id, log) !== false) removed++
    })
    if (removed > 0) this.bumpVersion()
    this.refreshDerivedIndexes()
    return { removed }
  }

  isCollected(id) {
    if (!id) return false
    if (this.collectIdSet.has(id)) return true
    return Boolean(this.legacyDb?.isCollected?.(id))
  }

  setLock(ids, locked) {
    if (!Array.isArray(ids)) {
      return this.setLockOne(ids, locked)
    }
    const list = Array.isArray(ids) ? ids : [ids]
    const result = this.legacyDb?.setLocks?.(list, locked)
    if (result) this.bumpVersion()
    this.refreshDerivedIndexes({ rebuildSearch: false })
    return result
  }

  setLocks(ids, locked, skipFileWrite) {
    const result = this.legacyDb?.setLocks?.(ids, locked, skipFileWrite)
    if (result) this.bumpVersion()
    this.refreshDerivedIndexes({ rebuildSearch: false })
    return result
  }

  setLockOne(id, locked, skipFileWrite) {
    const result = this.legacyDb?.setLock?.(id, locked, skipFileWrite)
    if (result) this.bumpVersion()
    this.refreshDerivedIndexes({ rebuildSearch: false })
    return result
  }

  setLockCompat(id, locked, skipFileWrite) {
    return this.setLockOne(id, locked, skipFileWrite)
  }

  setLockItem(id, locked, skipFileWrite) {
    return this.setLockOne(id, locked, skipFileWrite)
  }

  isLocked(id) {
    return Boolean(this.legacyDb?.isLocked?.(id))
  }

  queuePersist() {
    return this.legacyDb?.queuePersist?.()
  }

  updateDataBase() {
    return this.legacyDb?.updateDataBase?.()
  }

  updateDataBaseLocal(dataBase, options) {
    return this.legacyDb?.updateDataBaseLocal?.(dataBase, options)
  }

  getTags() {
    return typeof this.legacyDb?.getTags === 'function' ? this.legacyDb.getTags() : asArray(this.dataBase.tags)
  }

  getTagUsage() {
    return typeof this.legacyDb?.getTagUsage === 'function'
      ? this.legacyDb.getTagUsage()
      : this.dataBase.tagUsage || {}
  }

  updateItemTags(id, tags) {
    const result = this.legacyDb?.updateItemTags?.(id, tags)
    if (result) this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  updateItemRemark(id, remark) {
    const result = this.legacyDb?.updateItemRemark?.(id, remark)
    if (result) this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  updateItemData(id, data) {
    const result = this.legacyDb?.updateItemData?.(id, data)
    if (result) this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  filterDataBaseViaId(id) {
    return this.legacyDb?.filterDataBaseViaId?.(id) || []
  }

  updateItemViaId(id) {
    const result = this.legacyDb?.updateItemViaId?.(id)
    if (result) this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  emptyDataBase() {
    const result = this.legacyDb?.emptyDataBase?.()
    this.bumpVersion()
    this.refreshDerivedIndexes()
    return result
  }

  compact() {
    return true
  }

  migrateFromJson() {
    return true
  }
}

export const createClipboardRepository = (legacyDb) => new ClipboardRepository(legacyDb)
