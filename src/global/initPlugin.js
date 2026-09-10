const {
  utools,
  existsSync,
  readFileSync,
  writeFileSync,
  watch,
  crypto,
  listener,
  clipboard,
  nativeImage,
  time
} = window.exports
import { copy, paste, createFile, getNativeId, cleanupAliasStateForDeletedItem, isAliasPasting } from '../utils'
import setting, { SETTING_UPDATED_EVENT } from './readSetting'
import { initWindowManager, setPluginWindowSize } from './windowManager'
import { generateThumbnail, shouldGenerateThumbnail } from './imageUtils'
import { createClipboardRepository } from '../storage/clipboardRepository'
import { JSON_DB_SCHEMA_VERSION, shouldMigrateJsonDb } from '../storage/jsonMigration'
import { createSQLiteClipboardRepository } from '../storage/sqliteClipboardRepository'
import { updateStorageRuntimeStatus } from '../storage/storageRuntimeStatus'
import { registerPluginEnterHandler } from './pluginEnterHandlers'
import { isQuickPasteEnterAction, registerQuickPasteRuntime } from './quickPasteRuntime'

// 忽略 ResizeObserver 噪声错误，避免 dev overlay 反复弹出
const RESIZE_OBSERVER_ERROR_PATTERNS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications'
]

const getResizeObserverErrorMessage = (event) => {
  return [
    event?.message,
    event?.error?.message,
    event?.reason?.message,
    typeof event?.reason === 'string' ? event.reason : '',
    typeof event === 'string' ? event : ''
  ]
    .filter(Boolean)
    .join(' | ')
}

const isResizeObserverError = (event) => {
  const msg = getResizeObserverErrorMessage(event)
  return RESIZE_OBSERVER_ERROR_PATTERNS.some((pattern) => msg.includes(pattern))
}

// 捕获阶段也拦截，避免 overlay 先处理
window.addEventListener('error', (event) => {
  if (isResizeObserverError(event)) {
    event.preventDefault()
    event.stopImmediatePropagation()
    // 静默 console.error 输出
    if (event.error && console.error) {
      const originalConsoleError = console.error
      console.error = () => {}
      setTimeout(() => {
        console.error = originalConsoleError
      }, 0)
    }
  }
}, true)

window.addEventListener('unhandledrejection', (event) => {
  if (isResizeObserverError(event)) {
    event.preventDefault()
    event.stopImmediatePropagation?.()
  }
}, true)

window.onerror = function(message, source, lineno, colno, error) {
  if (isResizeObserverError({ message, error })) {
    return true
  }
  return false
}

// 额外拦截 console.error 中的 ResizeObserver 错误
if (typeof console !== 'undefined') {
  const originalConsoleError = console.error
  console.error = (...args) => {
    const errorMsg = args
      .map((arg) => {
        if (typeof arg === 'string') return arg
        return arg?.message || ''
      })
      .filter(Boolean)
      .join(' | ')
    if (RESIZE_OBSERVER_ERROR_PATTERNS.some((pattern) => errorMsg.includes(pattern))) {
      return // 静默处理
    }
    originalConsoleError.apply(console, args)
  }
}

export default async function initPlugin() {
  console.log('[initPlugin] 开始初始化插件')
  
  // 初始化窗口管理器
  initWindowManager()
  
  // 模块级变量：防止重复启动轮询模式
  let hasFallbackToPolling = false
  let isEventListenerRegistered = false // 防止重复注册事件监听器
  let pollingStarted = false
  
  // 防抖写磁盘定时器
  let dbWriteTimer = null
  const flushPendingDbToDisk = () => {
    if (dbWriteTimer) {
      clearTimeout(dbWriteTimer)
      dbWriteTimer = null
    }
    if (db) {
      db.updateDataBaseLocal(undefined, { immediate: true })
    }
  }
  const debouncedWriteLocal = () => {
    if (dbWriteTimer) clearTimeout(dbWriteTimer)
    dbWriteTimer = setTimeout(() => {
      dbWriteTimer = null
      if (db) {
        db.updateDataBaseLocal(undefined, { immediate: true })
      }
    }, 300)
  }
  
  class DB {
    constructor(path) {
      const d = new Date()
      this.path = path
      this.dataBase = {}
      this.createTime = d.getTime()
      this.updateTime = d.getTime()
      this.defaultDB = {
        data: [], // 普通历史记录
        collects: [], // 收藏的项目ID数组
        collectData: [], // 收藏的完整项目数据（单独存储，不可删除）
        tags: [], // 所有使用过的标签
        tagUsage: {}, // 标签使用统计 {tagName: count}
        schemaVersion: JSON_DB_SCHEMA_VERSION,
        createTime: this.createTime,
        updateTime: this.updateTime
      }
    }
    backupBeforeMigration() {
      try {
        if (!existsSync(this.path)) return null
        const backupPath = `${this.path}.schema-v${JSON_DB_SCHEMA_VERSION}.backup.${Date.now()}`
        const raw = readFileSync(this.path)
        writeFileSync(backupPath, raw)
        console.log('[DB.migration] 已备份旧 JSON 数据:', backupPath)
        return backupPath
      } catch (err) {
        console.warn('[DB.migration] 备份旧 JSON 数据失败:', err)
        return null
      }
    }
    init() {
      console.log('[DB.init] 初始化数据库, 路径:', this.path)
      const isExist = existsSync(this.path)
      console.log('[DB.init] 数据库文件是否存在:', isExist)
      if (isExist) {
        const data = readFileSync(this.path, {
          encoding: 'utf8'
        })
        try {
          // 读取磁盘记录到内存
          const dataBase = JSON.parse(data)
          this.dataBase = dataBase
          const needsMigration = shouldMigrateJsonDb(this.dataBase)
          if (needsMigration) {
            const backupPath = this.backupBeforeMigration()
            this.dataBase.lastMigrationBackupPath = backupPath
            this.dataBase.lastMigrationAt = Date.now()
          }
          if (!Array.isArray(this.dataBase.data)) {
            this.dataBase.data = []
          }
          
          // 数据迁移：如果collects字段不存在，从旧的item.collect迁移
          if (!this.dataBase.collects) {
            this.dataBase.collects = []
            // 从旧数据中提取收藏的ID
            const itemsToCollect = this.dataBase.data.filter(item => item.collect)
            if (itemsToCollect.length > 0) {
              console.log('[DB.init] 迁移收藏数据, 数量:', itemsToCollect.length)
              itemsToCollect.forEach(item => {
                if (!this.dataBase.collects.includes(item.id)) {
                  this.dataBase.collects.push(item.id)
                }
                delete item.collect
              })
            }
          }
          
          // 数据迁移：为收藏数据补充 tags 和 remarks 字段
          if (this.dataBase.collectData && this.dataBase.collectData.length > 0) {
            let tagsAddedCount = 0
            this.dataBase.collectData.forEach(item => {
              if (!item.tags) {
                item.tags = []
                tagsAddedCount++
              }
              if (!item.remark) {
                item.remark = ''
              }
            })
            console.log('[DB.init] 为已有收藏数据补充tags和remarks字段, 数量:', tagsAddedCount)
          }
          
          if (this.dataBase.collects.length > 0) {
            console.log('[DB.init] 发现收藏数据, 数量:', this.dataBase.collects.length)
            const missingCollectData = this.dataBase.collects.filter(id => 
              !this.dataBase.collectData?.find(item => item.id === id)
            )
            if (missingCollectData.length > 0) {
              console.log('[DB.init] 发现缺失的收藏数据, 数量:', missingCollectData.length)
              missingCollectData.forEach(id => {
                const item = this.dataBase.data.find(item => item.id === id)
                if (item) {
                  this.dataBase.collectData.push({ ...item })
                  console.log('[DB.init] 补充收藏数据:', id)
                }
              })
              this.updateDataBaseLocal()
            }
          }
          
          // 确保collects和collectData字段存在
          if (!Array.isArray(this.dataBase.collects)) {
            this.dataBase.collects = []
          }
          if (!Array.isArray(this.dataBase.collectData)) {
            this.dataBase.collectData = []
          }
          
          // 确保tags和tagUsage字段存在
          if (!Array.isArray(this.dataBase.tags)) {
            this.dataBase.tags = []
          }
          if (!this.dataBase.tagUsage || typeof this.dataBase.tagUsage !== 'object') {
            this.dataBase.tagUsage = {}
          }
          
          // 为已有收藏数据补充collectTime、tags和remarks字段（如果没有）
          if (this.dataBase.collectData && this.dataBase.collectData.length > 0) {
            let addedCount = 0
            let tagsAddedCount = 0
            this.dataBase.collectData.forEach((item) => {
              if (!item.collectTime) {
                item.collectTime = item.updateTime || item.createTime || new Date().getTime()
                addedCount++
              }
              // 为已有收藏数据添加tags和remarks字段
              if (!Array.isArray(item.tags)) {
                item.tags = []
                tagsAddedCount++
              }
              if (typeof item.remark !== 'string') {
                item.remark = ''
              }
            })
            if (addedCount > 0) {
              console.log('[DB.init] 为已有收藏数据补充collectTime字段, 数量:', addedCount)
            }
            if (tagsAddedCount > 0) {
              console.log('[DB.init] 为已有收藏数据补充tags和remarks字段, 数量:', tagsAddedCount)
            }
            if (addedCount > 0 || tagsAddedCount > 0) {
              this.updateDataBaseLocal()
            }
          }
          
          // 为现有数据补充 locked 字段，默认 false
          const normalizeLockedField = (items = []) => {
            items.forEach((item) => {
              if (typeof item.locked !== 'boolean') item.locked = false
            })
          }
          normalizeLockedField(this.dataBase.data)
          normalizeLockedField(this.dataBase.collectData)

          // 为 file 类型补充 originPaths（原始文件路径）
          const normalizeOriginPaths = (items = []) => {
            items.forEach((item) => {
              if (item?.type !== 'file') return
              if (!Array.isArray(item.originPaths)) {
                try {
                  const fl = JSON.parse(item.data)
                  item.originPaths = Array.isArray(fl) ? fl.map((f) => f.path).filter(Boolean) : []
                } catch (e) {
                  item.originPaths = []
                }
              }
            })
          }
          normalizeOriginPaths(this.dataBase.data)
          normalizeOriginPaths(this.dataBase.collectData)

          // 当设置了最长保存时间时，将超过该时间的普通数据删除（收藏数据不受影响）；maxage 为 null 时不按时间删除
          const collectIds = new Set(this.dataBase.collects) // 收藏的ID集合
          if (setting.database.maxage != null) {
            const now = new Date().getTime()
            const deleteTime = now - setting.database.maxage * 24 * 60 * 60 * 1000
            this.dataBase.data = this.dataBase.data?.filter(
              (item) => item.updateTime > deleteTime && !collectIds.has(item.id)
            )
          }
          
          // 清理collects和collectData中已不存在的项目ID
          const collectDataIds = new Set(this.dataBase.collectData.map((item) => item.id))
          this.dataBase.collects = this.dataBase.collects.filter((id) => collectDataIds.has(id))
          // 清理collectData中不在collects中的项目
          this.dataBase.collectData = this.dataBase.collectData.filter((item) => 
            this.dataBase.collects.includes(item.id)
          )
          
          // 数据迁移：为图片生成缩略图（异步，不阻塞初始化）
          this.migrateImageThumbnails()

          this.dataBase.schemaVersion = JSON_DB_SCHEMA_VERSION
          
          this.updateDataBaseLocal()
          this.watchDataBaseUpdate()
          console.log('[DB.init] 数据库加载成功, 记录数:', this.dataBase.data?.length || 0, '收藏数:', this.dataBase.collects.length)
        } catch (err) {
          console.error('[DB.init] 读取数据库出错:', err)
          utools.showNotification('读取剪切板出错: ' + err)
          return
        }
        return
      }
      console.log('[DB.init] 数据库文件不存在, 创建新数据库')
      this.dataBase = this.defaultDB
      this.updateDataBaseLocal(undefined, { immediate: true })
    }
    watchDataBaseUpdate() {
      watch(this.path, (eventType, filename) => {
        if (eventType === 'change') {
          // 更新内存中的数据
          const data = readFileSync(this.path, {
            encoding: 'utf8'
          })
          try {
            const dataBase = JSON.parse(data)
            this.dataBase = dataBase
            window.db.dataBase = dataBase // 更新内存中数据
            listener.emit('view-change') // 触发视图更新
          } catch (err) {
            utools.showNotification('读取剪切板出错: ' + err)
            return
          }
        }
      })
    }
    updateDataBase() {
      // 更新内存数据
      this.dataBase.updateTime = new Date().getTime()
    }
    queuePersist() {
      this.updateDataBase()
      debouncedWriteLocal()
      return true
    }
    updateDataBaseLocal(dataBase, options = {}) {
      const { immediate = false } = options
      if (immediate) {
        // 立即写入磁盘（用于关键操作）
        writeFileSync(this.path, JSON.stringify(dataBase || this.dataBase), (err) => {
          if (err) {
            utools.showNotification('写入剪切板出错: ' + err)
            return
          }
        })
      } else {
        // 默认使用防抖写入
        this.updateDataBase()
        debouncedWriteLocal()
      }
    }
    addItem(cItem) {
      console.log('[DB.addItem] 添加新记录, 类型:', cItem.type, 'ID:', cItem.id, '数据长度:', cItem.data?.length || 0)
      
      // 对文本类型进行空内容检查（仅判断，不修改原数据）
      if (cItem.type === 'text' && (!cItem.data || cItem.data.trim() === '')) {
        console.log('[DB.addItem] 跳过空文本内容')
        return
      }
      
      this.dataBase.data.unshift({ ...cItem, locked: false })
      this.updateDataBase()
      
      // 异步为图片生成缩略图
      if (cItem.type === 'image' && shouldGenerateThumbnail(cItem.data)) {
        const addedItem = this.dataBase.data[0]
        generateThumbnail(cItem.data)
          .then(thumbnail => {
            addedItem.thumbnail = thumbnail
            this.updateDataBaseLocal()
            console.log('[DB.addItem] 缩略图生成完成')
          })
          .catch(err => {
            console.error('[DB.addItem] 缩略图生成失败:', err)
          })
      }
      
      // 只有在设置了最大条数限制时才进行清理
      if (setting.database.maxsize !== null) {
        const exceedCount = this.dataBase.data.length - setting.database.maxsize
        if (exceedCount > 0) {
          // 达到条数限制 在收藏条数限制内遍历非收藏历史并删除
          // 所有被移除的 item都存入tempList
          const collectIds = new Set(this.dataBase.collects || [])
          const tmpList = []
          for (let i = 0; i < exceedCount; i++) {
            const item = this.dataBase.data.pop()
            tmpList.push(item)
          }
          // 收藏内容 重新入栈
          tmpList.forEach((item) => {
            if (collectIds.has(item.id)) {
              this.dataBase.data.push(item)
            }
          })
        }
      }
      this.updateDataBaseLocal()
    }
    emptyDataBase() {
      this.dataBase.data = []
      this.dataBase.collects = []
      this.dataBase.collectData = []
      window.db.dataBase.data = []
      window.db.dataBase.collects = []
      window.db.dataBase.collectData = []
      this.updateDataBaseLocal()
      listener.emit('view-change')
    }
    filterDataBaseViaId(id) {
      return this.dataBase.data.filter((item) => item.id === id)
    }
    updateItemViaId(id) {
      console.log('[DB.updateItemViaId] 查找记录, ID:', id)
      for (const item of this.dataBase.data) {
        if (item.id === id) {
          console.log('[DB.updateItemViaId] 找到记录, 更新updateTime')
          item.updateTime = new Date().getTime()
          this.sortDataBaseViaTime()
          return true
        }
      }
      console.log('[DB.updateItemViaId] 记录不存在')
      return false
    }
    sortDataBaseViaTime() {
      this.dataBase.data = this.dataBase.data.sort((a, b) => {
        return b.updateTime - a.updateTime
      })
      this.updateDataBaseLocal()
    }
    removeItemViaId(id, options = {}) {
      const { force = false } = options
      console.log('[DB.removeItemViaId] 开始删除项目, ID:', id, 'force:', force)
      const isCollected = this.isCollected(id)
      
      // 如果项目已收藏，不允许删除（收藏数据单独存储，不可删除）
      if (isCollected && !force) {
        console.log('[DB.removeItemViaId] 项目已收藏，不允许删除。请先取消收藏后再删除')
        return false
      }
      
      // 只删除普通历史记录
      for (const item of this.dataBase.data) {
        if (item.id === id) {
          if (item.locked && !force) {
            console.log('[DB.removeItemViaId] 项目已锁定，跳过删除')
            return false
          }
          const index = this.dataBase.data.indexOf(item)
          this.dataBase.data.splice(index, 1)
          console.log('[DB.removeItemViaId] 已从data数组删除，索引:', index)
          this.updateDataBaseLocal()
          try {
            cleanupAliasStateForDeletedItem(id)
          } catch (e) {}
          console.log('[DB.removeItemViaId] 删除完成，数据总数:', this.dataBase.data.length, '收藏数:', this.dataBase.collects?.length || 0)
          return true
        }
      }
      console.log('[DB.removeItemViaId] 未找到项目, ID:', id)
      return false
    }
    removeItemsViaIds(ids = [], options = {}) {
      const { force = false, immediate = false } = options
      const idSet = new Set((Array.isArray(ids) ? ids : []).filter(Boolean))
      if (!idSet.size) {
        return { removed: 0, skippedLocked: 0, skippedCollected: 0, missing: 0 }
      }
      const collectIds = new Set(this.dataBase.collects || [])
      let removed = 0
      let skippedLocked = 0
      let skippedCollected = 0
      const foundIds = new Set()
      const nextData = []

      for (const item of this.dataBase.data || []) {
        if (!idSet.has(item.id)) {
          nextData.push(item)
          continue
        }
        foundIds.add(item.id)
        if (collectIds.has(item.id) && !force) {
          skippedCollected++
          nextData.push(item)
          continue
        }
        if (item.locked && !force) {
          skippedLocked++
          nextData.push(item)
          continue
        }
        removed++
        try {
          cleanupAliasStateForDeletedItem(item.id)
        } catch (e) {}
      }

      this.dataBase.data = nextData
      if (removed > 0) {
        this.updateDataBaseLocal(undefined, { immediate })
      }
      return {
        removed,
        skippedLocked,
        skippedCollected,
        missing: Math.max(0, idSet.size - foundIds.size)
      }
    }
    setLock(itemId, locked = true, skipFileWrite = false) {
      const target =
        this.dataBase.data.find((item) => item.id === itemId) ||
        this.dataBase.collectData.find((item) => item.id === itemId)
      if (!target) return false
      target.locked = locked
      if (skipFileWrite) this.updateDataBase()
      else this.queuePersist()
      return true
    }
    setLocks(itemIds = [], locked = true, skipFileWrite = false) {
      const idSet = new Set((Array.isArray(itemIds) ? itemIds : []).filter(Boolean))
      if (!idSet.size) return false
      let changed = false
      const updateItems = (items = []) => {
        items.forEach((item) => {
          if (!idSet.has(item.id) || item.locked === locked) return
          item.locked = locked
          changed = true
        })
      }
      updateItems(this.dataBase.data)
      updateItems(this.dataBase.collectData)
      if (!changed) return false
      if (skipFileWrite) this.updateDataBase()
      else this.queuePersist()
      return true
    }
    isLocked(itemId) {
      const target =
        this.dataBase.data.find((item) => item.id === itemId) ||
        this.dataBase.collectData.find((item) => item.id === itemId)
      return target?.locked === true
    }
    // 添加收藏
    addCollect(itemId, log = true) {
      if (log) {
        console.log('[DB.addCollect] 开始添加收藏, ID:', itemId)
      }
      if (!this.dataBase.collects) {
        this.dataBase.collects = []
      }
      if (!this.dataBase.collectData) {
        this.dataBase.collectData = []
      }
      
      // 如果已经收藏，直接返回
      if (this.dataBase.collects.includes(itemId)) {
        if (log) {
          console.log('[DB.addCollect] 项目已在收藏列表中, ID:', itemId)
        }
        return false
      }
      
      // 从普通历史记录中查找项目
      let itemToCollect = null
      for (const item of this.dataBase.data) {
        if (item.id === itemId) {
          itemToCollect = { ...item } // 深拷贝
          // 从普通历史记录中移除（收藏数据单独存储）
          const index = this.dataBase.data.indexOf(item)
          this.dataBase.data.splice(index, 1)
          console.log('[DB.addCollect] 已从普通历史记录移除, 索引:', index)
          break
        }
      }
      
      // 如果普通历史记录中没有，尝试从收藏数据中查找（可能已经收藏过）
      if (!itemToCollect) {
        for (const item of this.dataBase.collectData) {
          if (item.id === itemId) {
            itemToCollect = { ...item } // 深拷贝
            break
          }
        }
      }
      
      // 如果找到了项目，添加到收藏数据
      if (itemToCollect) {
        // 添加收藏时间
        itemToCollect.collectTime = new Date().getTime()
        // 初始化标签与备注字段
        if (!Array.isArray(itemToCollect.tags)) {
          itemToCollect.tags = []
        }
        if (typeof itemToCollect.remark !== 'string') {
          itemToCollect.remark = ''
        }
        this.dataBase.collects.push(itemId)
        // 保持最新收藏在最前（避免 getCollects 每次排序）
        this.dataBase.collectData.unshift(itemToCollect)
        if (log) {
          console.log('[DB.addCollect] 已添加到收藏列表, 当前收藏数:', this.dataBase.collects.length)
        }
        this.updateDataBaseLocal()
        return true
      } else {
        if (log) {
          console.log('[DB.addCollect] 未找到要收藏的项目, ID:', itemId)
        }
        return false
      }
    }
    // 移除收藏（取消收藏时，将收藏数据还原为普通历史记录）
    removeCollect(itemId, log = true) {
      if (log) {
        console.log('[DB.removeCollect] 开始移除收藏, ID:', itemId)
      }
      if (!this.dataBase.collects) {
        this.dataBase.collects = []
      }
      if (!this.dataBase.collectData) {
        this.dataBase.collectData = []
      }
      
      const collectIndex = this.dataBase.collects.indexOf(itemId)
      if (collectIndex === -1) {
        if (log) {
          console.log('[DB.removeCollect] 收藏列表中未找到该项目, ID:', itemId)
        }
        return false
      }
      
      // 从收藏列表中移除ID
      this.dataBase.collects.splice(collectIndex, 1)
      
      // 从收藏数据中查找并移除，同时还原到普通历史记录
      let itemToRestore = null
      for (let i = 0; i < this.dataBase.collectData.length; i++) {
        if (this.dataBase.collectData[i].id === itemId) {
          itemToRestore = { ...this.dataBase.collectData[i] } // 深拷贝
          // 更新时间为当前时间（相当于重新复制）
          itemToRestore.updateTime = new Date().getTime()
          this.dataBase.collectData.splice(i, 1)
          break
        }
      }
      
      // 将收藏数据还原为普通历史记录（添加到最前面，相当于重新复制）
      if (itemToRestore) {
        this.dataBase.data.unshift(itemToRestore)
        if (log) {
          console.log('[DB.removeCollect] 已从收藏列表移除并还原为普通历史记录, 剩余收藏数:', this.dataBase.collects.length)
        }
      } else {
        if (log) {
          console.log('[DB.removeCollect] 已从收藏列表移除，但未找到收藏数据, 剩余收藏数:', this.dataBase.collects.length)
        }
      }
      
      this.updateDataBaseLocal()
      return true
    }
    removeCollects(itemIds = [], log = false, options = {}) {
      const { immediate = false } = options
      const idSet = new Set((Array.isArray(itemIds) ? itemIds : []).filter(Boolean))
      if (!idSet.size) return { removed: 0 }
      if (!Array.isArray(this.dataBase.collects)) this.dataBase.collects = []
      if (!Array.isArray(this.dataBase.collectData)) this.dataBase.collectData = []

      const now = Date.now()
      const nextCollects = []
      const nextCollectData = []
      const restoreItems = []
      let removed = 0

      this.dataBase.collects.forEach((id) => {
        if (!idSet.has(id)) nextCollects.push(id)
      })

      this.dataBase.collectData.forEach((item) => {
        if (!idSet.has(item.id)) {
          nextCollectData.push(item)
          return
        }
        const restored = { ...item, updateTime: now }
        restoreItems.push(restored)
        removed++
      })

      if (!removed) return { removed: 0 }
      this.dataBase.collects = nextCollects
      this.dataBase.collectData = nextCollectData
      this.dataBase.data.unshift(...restoreItems)
      this.updateDataBaseLocal(undefined, { immediate })
      if (log) console.log('[DB.removeCollects] 批量移除收藏, 数量:', removed)
      return { removed }
    }
    // 检查是否已收藏
    isCollected(itemId) {
      if (!this.dataBase.collects) {
        return false
      }
      return this.dataBase.collects.includes(itemId)
    }
    // 获取所有收藏的项目（从collectData中获取，按收藏时间倒序）
    getCollects() {
      if (!this.dataBase.collectData) {
        return []
      }
      return [...this.dataBase.collectData]
    }

    // 标签管理方法
    // 获取所有标签
    getTags() {
      if (!Array.isArray(this.dataBase.tags)) {
        this.dataBase.tags = []
      }
      return [...this.dataBase.tags]
    }

    // 获取标签使用统计
    getTagUsage() {
      if (!this.dataBase.tagUsage || typeof this.dataBase.tagUsage !== 'object') {
        this.dataBase.tagUsage = {}
      }
      return { ...this.dataBase.tagUsage }
    }

    // 添加标签到全局标签列表
    addGlobalTag(tagName) {
      if (!tagName || typeof tagName !== 'string') return false
      
      tagName = tagName.trim()
      if (!tagName) return false
      
      if (!Array.isArray(this.dataBase.tags)) {
        this.dataBase.tags = []
      }
      
      // 避免重复标签
      if (!this.dataBase.tags.includes(tagName)) {
        this.dataBase.tags.push(tagName)
        console.log('[DB.addGlobalTag] 添加新标签:', tagName)
      }
      
      // 更新使用统计
      if (!this.dataBase.tagUsage || typeof this.dataBase.tagUsage !== 'object') {
        this.dataBase.tagUsage = {}
      }
      this.dataBase.tagUsage[tagName] = (this.dataBase.tagUsage[tagName] || 0) + 1
      
      return true
    }

    // 从全局标签列表移除标签
    removeGlobalTag(tagName) {
      if (!tagName || typeof tagName !== 'string') return false
      
      tagName = tagName.trim()
      if (!tagName) return false
      
      if (!Array.isArray(this.dataBase.tags)) {
        return false
      }
      
      const index = this.dataBase.tags.indexOf(tagName)
      if (index === -1) return false
      
      this.dataBase.tags.splice(index, 1)
      
      // 清理使用统计
      if (this.dataBase.tagUsage && typeof this.dataBase.tagUsage === 'object') {
        delete this.dataBase.tagUsage[tagName]
      }
      
      console.log('[DB.removeGlobalTag] 移除标签:', tagName)
      return true
    }

    // 更新收藏项目的标签
    updateItemTags(itemId, tags) {
      if (!Array.isArray(tags)) {
        console.error('[DB.updateItemTags] tags必须是数组')
        return false
      }
      
      // 查找收藏项目
      const collectItem = this.dataBase.collectData.find(item => item.id === itemId)
      if (!collectItem) {
        console.error('[DB.updateItemTags] 未找到收藏项目:', itemId)
        return false
      }
      
      // 获取旧标签
      const oldTags = Array.isArray(collectItem.tags) ? [...collectItem.tags] : []
      
      // 更新标签
      collectItem.tags = [...new Set(tags.map(tag => String(tag).trim()).filter(tag => tag))]
      
      // 更新全局标签统计
      oldTags.forEach(tag => {
        if (this.dataBase.tagUsage && typeof this.dataBase.tagUsage === 'object') {
          this.dataBase.tagUsage[tag] = Math.max((this.dataBase.tagUsage[tag] || 0) - 1, 0)
        }
      })
      
      collectItem.tags.forEach(tag => {
        this.addGlobalTag(tag)
      })
      
      // 清理未使用的标签
      this.cleanupUnusedTags()
      
      this.updateDataBaseLocal()
      console.log('[DB.updateItemTags] 更新项目标签:', itemId, collectItem.tags)
      return true
    }

    // 更新收藏项目的备注
    updateItemRemark(itemId, remark) {
      if (typeof remark !== 'string') {
        console.error('[DB.updateItemRemark] remark必须是字符串')
        return false
      }
      
      // 查找收藏项目
      const collectItem = this.dataBase.collectData.find(item => item.id === itemId)
      if (!collectItem) {
        console.error('[DB.updateItemRemark] 未找到收藏项目:', itemId)
        return false
      }
      
      collectItem.remark = remark
      this.updateDataBaseLocal()
      console.log('[DB.updateItemRemark] 更新项目备注:', itemId)
      return true
    }

    // 更新收藏项目的原始内容（仅 text 类型）
    updateItemData(itemId, data) {
      if (typeof data !== 'string') {
        console.error('[DB.updateItemData] data必须是字符串')
        return false
      }
      const collectItem = this.dataBase.collectData.find(item => item.id === itemId)
      if (!collectItem) {
        console.error('[DB.updateItemData] 未找到收藏项目:', itemId)
        return false
      }
      if (collectItem.type !== 'text') {
        console.error('[DB.updateItemData] 仅支持 text 类型')
        return false
      }
      collectItem.data = data
      collectItem.updateTime = new Date().getTime()
      this.updateDataBaseLocal()
      return true
    }

    // 根据标签获取收藏项目
    getCollectsByTag(tagName) {
      if (!tagName || typeof tagName !== 'string') return []
      
      tagName = tagName.trim()
      if (!tagName) return []
      
      if (!Array.isArray(this.dataBase.collectData)) {
        return []
      }
      
      return this.dataBase.collectData.filter(item => 
        Array.isArray(item.tags) && item.tags.includes(tagName)
      )
    }

    // 清理未使用的标签
    cleanupUnusedTags() {
      if (!Array.isArray(this.dataBase.tags) || !Array.isArray(this.dataBase.collectData)) {
        return
      }
      
      // 统计实际使用的标签
      const usedTags = new Set()
      this.dataBase.collectData.forEach(item => {
        if (Array.isArray(item.tags)) {
          item.tags.forEach(tag => usedTags.add(tag))
        }
      })
      
      // 移除未使用的标签
      const unusedTags = this.dataBase.tags.filter(tag => !usedTags.has(tag))
      unusedTags.forEach(tag => {
        this.removeGlobalTag(tag)
      })
      
      if (unusedTags.length > 0) {
        console.log('[DB.cleanupUnusedTags] 清理未使用标签:', unusedTags)
      }
    }

    // 获取标签自动补全建议
    getTagSuggestions(query) {
      if (!query || typeof query !== 'string') return []
      
      query = query.toLowerCase().trim()
      if (!query) return []
      
      const tags = this.getTags()
      const usage = this.getTagUsage()
      
      return tags
        .filter(tag => tag.toLowerCase().includes(query))
        .sort((a, b) => (usage[b] || 0) - (usage[a] || 0)) // 按使用频率排序
        .slice(0, 10) // 限制建议数量
    }
    
    // 异步为现有图片生成缩略图
    migrateImageThumbnails() {
      const imagesWithoutThumbnail = this.dataBase.data.filter(
        item => item.type === 'image' && item.data && !item.thumbnail && shouldGenerateThumbnail(item.data)
      )
      
      if (imagesWithoutThumbnail.length === 0) {
        console.log('[DB.migrateImageThumbnails] 没有需要生成缩略图的图片')
        return
      }
      
      console.log('[DB.migrateImageThumbnails] 开始为', imagesWithoutThumbnail.length, '张图片生成缩略图')
      
      let processed = 0
      const total = imagesWithoutThumbnail.length
      
      // 分批处理，避免阻塞主线程
      const processBatch = async (startIndex) => {
        const batchSize = 5
        const endIndex = Math.min(startIndex + batchSize, total)
        
        for (let i = startIndex; i < endIndex; i++) {
          const item = imagesWithoutThumbnail[i]
          try {
            const thumbnail = await generateThumbnail(item.data)
            item.thumbnail = thumbnail
            processed++
            console.log(`[DB.migrateImageThumbnails] 进度: ${processed}/${total}`)
          } catch (err) {
            console.error('[DB.migrateImageThumbnails] 缩略图生成失败:', err)
          }
        }
        
        // 让出主线程
        await new Promise(resolve => setTimeout(resolve, 10))
        
        if (endIndex < total) {
          processBatch(endIndex)
        } else {
          console.log('[DB.migrateImageThumbnails] 所有缩略图生成完成，保存数据库')
          this.updateDataBaseLocal()
        }
      }
      
      // 开始处理
      processBatch(0)
    }
  }

  const normalizeFilePath = (rawPath = '') => {
    let path = String(rawPath).trim()
    if (!path) return ''
    if (path.startsWith('file://')) {
      path = decodeURIComponent(path.replace(/^file:\/+/, '/'))
      if (/^\/[A-Za-z]:\//.test(path)) {
        path = path.slice(1)
      }
    }
    if (!utools.isMacOs()) {
      path = path.replace(/\//g, '\\')
    }
    return path
  }

  const collectUriListPaths = (text = '') => {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => normalizeFilePath(line))
      .filter(Boolean)
  }

  const readClipboardSourcePaths = () => {
    const paths = []
    const addPath = (p) => {
      if (p && !paths.includes(p)) paths.push(p)
    }
    const addPaths = (list = []) => list.forEach(addPath)
    const formats = typeof clipboard.availableFormats === 'function' ? clipboard.availableFormats() : []

    const tryReadText = (format) => {
      try {
        const text = clipboard.readText(format)
        if (text) addPaths(collectUriListPaths(text))
      } catch (e) {
        return
      }
    }

    const tryReadBuffer = (format) => {
      try {
        const buf = clipboard.readBuffer(format)
        if (!buf || !buf.length) return
        const text = buf.toString('ucs2')
        const list = text.split('\u0000').filter(Boolean).map((p) => normalizeFilePath(p))
        addPaths(list)
      } catch (e) {
        return
      }
    }

    if (formats.includes('text/uri-list')) {
      tryReadText('text/uri-list')
    }
    if (formats.includes('public.file-url')) {
      tryReadText('public.file-url')
    }
    if (formats.includes('FileNameW')) {
      tryReadBuffer('FileNameW')
    }
    if (!paths.length && formats.includes('FileName')) {
      tryReadBuffer('FileName')
    }

    return paths
  }

  const readActiveWindowInfo = () => {
    if (typeof utools?.shellExec !== 'function') {
      return { sourceApp: '', sourceWindowTitle: '' }
    }
    try {
      if (utools.isMacOs()) {
        const appResult = utools.shellExec('osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\'')
        const titleResult = utools.shellExec('osascript -e \'tell application "System Events" to get title of front window of (first application process whose frontmost is true)\'')
        const sourceApp = (typeof appResult === 'string' ? appResult : appResult?.stdout || appResult?.output || '').trim()
        const sourceWindowTitle = (typeof titleResult === 'string' ? titleResult : titleResult?.stdout || titleResult?.output || '').trim()
        return { sourceApp, sourceWindowTitle }
      }
      const psCommand = [
        'powershell',
        '-NoProfile',
        '-Command',
        '"Add-Type @\'',
        'using System;',
        'using System.Runtime.InteropServices;',
        'using System.Text;',
        'public class Win32 {',
        '  [DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow();',
        '  [DllImport(\\"user32.dll\\", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);',
        '}',
        '\'@; ',
        '$hwnd = [Win32]::GetForegroundWindow();',
        '$sb = New-Object System.Text.StringBuilder 1024;',
        '[Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null;',
        '$sb.ToString()"'
      ].join(' ')
      const titleResult = utools.shellExec(psCommand)
      const sourceWindowTitle = (typeof titleResult === 'string' ? titleResult : titleResult?.stdout || titleResult?.output || '').trim()
      return { sourceApp: '', sourceWindowTitle }
    } catch (e) {
      return { sourceApp: '', sourceWindowTitle: '' }
    }
  }

  const enrichSourceWindowInfoLater = (item) => {
    if (!item?.hasSourceInfo || item.sourceApp || item.sourceWindowTitle) return
    setTimeout(() => {
      try {
        const info = readActiveWindowInfo()
        if (!info.sourceApp && !info.sourceWindowTitle) return
        Object.assign(item, info)
        if (item.id) {
          db.updateItem?.(item.id, info)
        }
      } catch (e) {}
    }, 0)
  }

  const pbpaste = () => {
    console.log('[pbpaste] 开始读取剪贴板内容')
    // file
    const files = utools.getCopyedFiles() // null | Array
    console.log('[pbpaste] 检查文件:', files ? `找到 ${files.length} 个文件` : '无文件')
    if (files && files.length > 0) {
      const sep = window.exports.sep
      const tempDir = utools.getPath('temp') + sep + 'utools-clipboard-manager'
      const norm = (p) => (p || '').replace(/\\/g, sep)
      const allFromPluginTemp = files.every((f) => norm(f.path).startsWith(norm(tempDir)))
      if (!allFromPluginTemp) {
        const originPaths = files.map((f) => f.path).filter(Boolean)
        const hasSourceInfo = originPaths.length > 0
        const result = {
          type: 'file',
          data: JSON.stringify(files),
          originPaths,
          sourcePaths: originPaths,
          fromFileSource: hasSourceInfo,
          hasSourceInfo
        }
        console.log('[pbpaste] 返回文件类型, 数据长度:', result.data.length)
        return result
      }
      console.log('[pbpaste] 剪贴板文件均来自插件临时目录，跳过 file 类型，继续检查 text/image')
    }
    const sourcePaths = readClipboardSourcePaths()
    const hasSourceInfo = sourcePaths.length > 0
    // text
    const text = clipboard.readText()
    console.log('[pbpaste] 检查文本:', text ? `长度 ${text.length}` : '无文本')
    if (text && text.trim()) {
      const result = {
        type: 'text',
        data: text,
        fromFileSource: hasSourceInfo,
        hasSourceInfo
      }
      if (hasSourceInfo) {
        result.sourcePaths = sourcePaths
      }
      return result
    }
    // image
    const formats = typeof clipboard.availableFormats === 'function' ? clipboard.availableFormats() : []
    const hasImageFormat = formats.some((format) => /^image\//i.test(format) || /png|jpeg|bitmap/i.test(format))
    if (!hasImageFormat) {
      return undefined
    }
    globalThis.performance?.mark?.('ezclipboard:clipboard-image-read:start')
    const image = clipboard.readImage() // 大图卡顿来源，已延后到确认存在图片格式后
    const isEmpty = image.isEmpty()
    if (!isEmpty) {
      const data = image.toDataURL()
      globalThis.performance?.mark?.('ezclipboard:clipboard-image-read:end')
      const result = {
        type: 'image',
        data: data,
        fromFileSource: hasSourceInfo,
        hasSourceInfo
      }
      if (hasSourceInfo) {
        result.sourcePaths = sourcePaths
      }
      return result
    }
    return undefined
  }

  // 根据当前设备id读取不同路径 若为旧版本则迁移数据
  const nativeId = getNativeId()
  console.log('[initPlugin] nativeId:', nativeId)
  const dbPath = setting.database.path[nativeId] || setting.database.path
  console.log('[initPlugin] 数据库路径:', dbPath)
  
  const jsonDbExists = window.exports.existsSync(dbPath)
  const sqlitePath = dbPath.endsWith('.sqlite') ? dbPath : `${dbPath}.sqlite`
  const assetDir = `${sqlitePath}.assets`
  updateStorageRuntimeStatus({
    mode: 'unknown',
    migrationStatus: 'checking',
    noticeUnread: false,
    progress: 5,
    stepText: '检查存储文件',
    sqlitePath,
    jsonPath: dbPath,
    assetDir,
    errorMessage: ''
  })
  console.log('[initPlugin] 存储检查: (JSON文件存在:', jsonDbExists, ')')

  console.log('[initPlugin] 使用 JSON 文件')
  const legacyDb = new DB(dbPath)
  legacyDb.init()
  let db
  const bindStorageRuntime = (nextDb) => {
    db = nextDb
    window.db = db
    window.remove = (item, options = {}) => db.removeItemViaId(item.id, options)
    window.setLock = (id, locked, skipFileWrite) => db.setLock(id, locked, skipFileWrite)
    window.setLocks = (ids, locked, skipFileWrite) => db.setLocks(ids, locked, skipFileWrite)
    window.queuePersistDb = () => db.queuePersist()
    window.isLocked = (id) => db.isLocked(id)
    window.dispatchEvent?.(new CustomEvent('ezclipboard:storage-runtime-replaced', { detail: db }))
  }
  const createSqliteWithRetry = async ({ manual = false } = {}) => {
    const delays = [0, 200, 500]
    let lastError = null
    let importedLegacy = false
    for (let index = 0; index < delays.length; index++) {
      if (delays[index] > 0) {
        await new Promise((resolve) => setTimeout(resolve, delays[index]))
      }
      try {
        updateStorageRuntimeStatus({
          mode: db ? utools.dbStorage.getItem('storageMode') || 'unknown' : 'unknown',
          migrationStatus: 'checking',
          progress: 8,
          stepText: `${manual ? '手动重试' : '初始化'} SQLite（第 ${index + 1} 次）`,
          sqlitePath,
          jsonPath: dbPath,
          assetDir,
          errorMessage: ''
        })
        const nextDb = await createSQLiteClipboardRepository({
          dbPath,
          legacyDb,
          onProgress: ({ progress, stepText }) => {
            if (String(stepText || '').includes('导入旧 JSON')) importedLegacy = true
            updateStorageRuntimeStatus({
              mode: 'sqlite',
              migrationStatus: importedLegacy ? 'migrating' : 'checking',
              progress,
              stepText,
              sqlitePath,
              jsonPath: dbPath,
              assetDir,
              errorMessage: ''
            })
          }
        })
        utools.dbStorage.setItem('storageMode', 'sqlite')
        updateStorageRuntimeStatus({
          mode: 'sqlite',
          migrationStatus: importedLegacy ? 'migrated' : 'already-migrated',
          noticeUnread: importedLegacy || manual,
          progress: 100,
          stepText: importedLegacy ? '已迁移并应用 SQLite' : 'SQLite 存储已就绪',
          sqlitePath,
          jsonPath: dbPath,
          assetDir,
          errorMessage: ''
        })
        return nextDb
      } catch (err) {
        lastError = err
        console.warn('[initPlugin] SQLite 初始化失败:', err)
        updateStorageRuntimeStatus({
          mode: db ? utools.dbStorage.getItem('storageMode') || 'unknown' : 'unknown',
          migrationStatus: 'checking',
          progress: Math.min(90, 20 + index * 25),
          stepText: `SQLite 初始化失败，准备重试（第 ${index + 1} 次）`,
          sqlitePath,
          jsonPath: dbPath,
          assetDir,
          errorMessage: err?.message || String(err)
        })
      }
    }
    throw lastError || new Error('SQLite 初始化失败')
  }
  try {
    db = await createSqliteWithRetry()
    utools.dbStorage.setItem('storageMode', 'sqlite')
    console.log('[initPlugin] SQLite 存储初始化完成')
  } catch (err) {
    console.warn('[initPlugin] SQLite 初始化重试失败，回退 JSON facade:', err)
    db = createClipboardRepository(legacyDb)
    db.init()
    utools.dbStorage.setItem('storageMode', 'json-fallback')
    updateStorageRuntimeStatus({
      mode: 'json-fallback',
      migrationStatus: 'failed',
      noticeUnread: true,
      progress: 100,
      stepText: 'SQLite 迁移失败，已临时使用 JSON 降级模式',
      sqlitePath,
      jsonPath: dbPath,
      assetDir,
      errorMessage: err?.message || String(err)
    })
  }

  const remove = (item, options = {}) => db.removeItemViaId(item.id, options)
  window.retryStorageMigration = async () => {
    const nextDb = await createSqliteWithRetry({ manual: true })
    bindStorageRuntime(nextDb)
    return true
  }

  const focus = (isBlur = false) => {
    const searchEl = document.querySelector('.clip-search')
    const inputEl = document.querySelector('.clip-search-input')
    if (searchEl && searchEl.style.display !== 'none') {
      return isBlur ? inputEl?.blur() : inputEl?.focus()
    }
    const mainEl = document.querySelector('.main')
    if (!isBlur && mainEl) {
      return mainEl.focus()
    }
    return undefined
  }
  // 列表滚动发生在 .clip-item-scroll 内（document 不再滚动），这里必须取真实滚动容器，document 仅作兜底。
  const getListScrollElement = () =>
    document.querySelector('.clip-item-scroll') || document.scrollingElement
  const toTop = () => {
    const el = getListScrollElement()
    if (el) el.scrollTop = 0
  }
  const toBottom = () => {
    const el = getListScrollElement()
    if (el) el.scrollTop = el.scrollHeight
  }

  // 防止剪贴板写回循环的标志
  let isRestoringClipboard = false
  let lastRestoredItemId = null
  let lastRestoredItemHash = null
  let restoreCount = 0
  const LINE_JOIN_SUPPRESS_CLIPBOARD_RECORD_KEY = '__ezClipboardLineJoinSuppressRecord'
  const RESTORE_GUARD_TIMEOUT = 500 // 增加到 500ms 防护窗口
  const MAX_RESTORE_COUNT = 3 // 最大连续恢复次数，超过则暂停

  /** 将刚入库的内容写回剪贴板，避免常驻时复制后剪贴板被清空、无法在其他应用粘贴 */
  const restoreClipboard = (item) => {
    if (!item || !item.type) return
    if (isRestoringClipboard) {
      console.log('[restoreClipboard] 正在恢复中，跳过防止循环')
      return
    }
    
    // 检查连续恢复次数，防止无限循环
    if (restoreCount >= MAX_RESTORE_COUNT) {
      console.warn('[restoreClipboard] 达到最大恢复次数，暂停恢复以防止循环')
      setTimeout(() => { restoreCount = 0 }, 2000) // 2秒后重置计数
      return
    }
    
    try {
      isRestoringClipboard = true
      lastRestoredItemId = item.id
      // 计算内容哈希用于后续比较
      lastRestoredItemHash = crypto.createHash('md5').update(item.data + item.type).digest('hex')
      restoreCount++
      
      if (item.type === 'text' && typeof item.data === 'string') {
        clipboard.writeText(item.data)
      } else if (item.type === 'image' && item.data && typeof nativeImage?.createFromDataURL === 'function') {
        const img = nativeImage.createFromDataURL(item.data)
        if (img && !img.isEmpty()) {
          clipboard.writeImage(img)
        }
      }
      // file 类型写回依赖系统格式，暂不处理
    } catch (e) {
      console.warn('[restoreClipboard] 写回剪贴板失败', e)
    } finally {
      // 延迟重置标志，防止竞态条件
      setTimeout(() => {
        isRestoringClipboard = false
        lastRestoredItemId = null
        lastRestoredItemHash = null
        // 只有在没有连续恢复时才重置计数
        if (restoreCount < MAX_RESTORE_COUNT) {
          restoreCount = 0
        }
      }, RESTORE_GUARD_TIMEOUT)
    }
  }

  const handleClipboardChange = (item = pbpaste()) => {

    // 防止循环：如果正在恢复剪贴板，跳过处理
    if (isRestoringClipboard) {
      return
    }

    // 防止别名粘贴时重复记录
    if (isAliasPasting) {
      console.log('[handleClipboardChange] 跳过别名粘贴触发的剪贴板记录')
      return
    }

    if (!item) {
      return
    }

    const lineJoinSuppressRecord = window?.[LINE_JOIN_SUPPRESS_CLIPBOARD_RECORD_KEY]
    if (lineJoinSuppressRecord?.expiresAt && Date.now() > lineJoinSuppressRecord.expiresAt) {
      delete window[LINE_JOIN_SUPPRESS_CLIPBOARD_RECORD_KEY]
    } else if (
      lineJoinSuppressRecord &&
      item.type === 'text' &&
      typeof item.data === 'string' &&
      item.data === lineJoinSuppressRecord.data
    ) {
      delete window[LINE_JOIN_SUPPRESS_CLIPBOARD_RECORD_KEY]
      console.log('[handleClipboardChange] 跳过行处理粘贴触发的剪贴板记录')
      return
    }

    // 计算项目ID
    const itemId = crypto.createHash('md5').update(item.data).digest('hex')
    item.id = itemId
    enrichSourceWindowInfoLater(item)

    // 额外防护：如果是刚恢复的项目，跳过处理
    if (lastRestoredItemId === itemId) {
      return
    }

    // 计算内容哈希进行比较
    const currentHash = crypto.createHash('md5').update(item.data + item.type).digest('hex')
    if (lastRestoredItemHash === currentHash) {
      return
    }

    if (db.updateItemViaId(itemId)) {
      // 在库中 由 updateItemViaId 更新 updateTime
      restoreClipboard(item)
      return
    }
    // 不在库中 由 addItem 添加
    item.createTime = new Date().getTime()
    item.updateTime = new Date().getTime()
    item.locked = false
    const addRet = db.addItem(item)
    if (addRet && typeof addRet.then === 'function') {
      addRet.catch((e) => console.warn('[clipboard] addItem failed', e))
    }
    restoreClipboard(item)
  }

  const addCommonListener = () => {
    if (pollingStarted) {
      console.log('[addCommonListener] 轮询模式已在运行，跳过重复启动')
      return
    }
    pollingStarted = true
    console.log('[addCommonListener] 启动轮询模式监听')
    let prev = db.dataBase.data[0] || {}
    console.log('[addCommonListener] 初始prev ID:', prev.id || '无')
    let loopCount = 0
    function loop() {
      loopCount++
      time.sleep(300).then(loop)
      const item = pbpaste()
      if (!item) {
        return
      }
      item.id = crypto.createHash('md5').update(item.data).digest('hex')
      if (item && prev.id != item.id) {
        // 剪切板元素 与最近一次复制内容不同
        prev = item
        handleClipboardChange(item)
      }
    }
    loop()
  }

  const registerClipEvent = (listener) => {
    if (isEventListenerRegistered) {
      console.log('[registerClipEvent] 事件监听器已注册，跳过重复注册')
      return
    }
    
    console.log('[registerClipEvent] 注册剪贴板事件监听器')
    isEventListenerRegistered = true
    
    const exitHandler = () => {
      console.error('[registerClipEvent] 监听器异常退出')
      if (!hasFallbackToPolling) {
        hasFallbackToPolling = true
        console.log('[registerClipEvent] 降级到轮询模式')
        utools.showNotification('剪贴板监听程序不可用，已切换到轮询模式')
        addCommonListener()
      }
    }
    const errorHandler = (error) => {
      console.error('[registerClipEvent] 监听器错误:', error)
      if (!hasFallbackToPolling) {
        hasFallbackToPolling = true
        console.log('[registerClipEvent] 降级到轮询模式')
        addCommonListener()
      }
    }
    listener
      .on('change', () => {
        // 防止循环：如果正在恢复剪贴板，跳过处理
        if (isRestoringClipboard) {
          return
        }
        handleClipboardChange()
      })
      .on('close', () => {
        console.log('[registerClipEvent] 收到 close 事件')
        exitHandler()
      })
      .on('exit', () => {
        console.log('[registerClipEvent] 收到 exit 事件')
        exitHandler()
      })
      .on('error', (error) => {
        errorHandler(error)
      })
    
    console.log('[registerClipEvent] 事件监听器注册完成')
  }

  // 首次启动插件 即开启监听
  // 如果监听程序异常退出 则会在errorHandler中开启常规监听
  console.log('[initPlugin] 准备启动监听器')
  // 先注册事件监听器，再启动监听程序，确保事件能被捕获
  registerClipEvent(listener)
  console.log('[initPlugin] 调用 listener.startListening, 路径:', setting.database.path[nativeId])
  // 延迟启动，确保事件监听器已完全注册
  setTimeout(() => {
    listener.startListening(setting.database.path[nativeId])
    console.log('[initPlugin] 监听器启动完成, 状态:', listener.listening)
    // 如果监听器启动失败（listening仍为false），延迟检查并降级
    if (!listener.listening && !hasFallbackToPolling) {
      setTimeout(() => {
        if (!listener.listening && !hasFallbackToPolling) {
          console.log('[initPlugin] 监听器启动失败，延迟降级到轮询模式')
          hasFallbackToPolling = true
          addCommonListener()
        }
      }, 500)
    }
  }, 100)

  registerPluginEnterHandler((action) => {
    console.log('[onPluginEnter] 插件进入事件触发')
    if (isQuickPasteEnterAction(action)) {
      console.log('[onPluginEnter] 快捷粘贴静默入口，跳过常规窗口处理')
      return
    }
    
    // 重新设置窗口大小（确保每次打开插件时都恢复到合适的大小）
    setPluginWindowSize()
    
    // 如果轮询模式已启动，不再尝试启动原生监听器
    if (pollingStarted) {
      console.log('[onPluginEnter] 轮询模式已运行，跳过监听器启动')
    } else if (!listener.listening) {
      // 进入插件后 如果监听已关闭 则重新开启监听
      console.log('[onPluginEnter] 监听器未运行, 重新启动')
      registerClipEvent(listener)
      setTimeout(() => {
        listener.startListening(setting.database.path[nativeId])
        console.log('[onPluginEnter] 监听器重新启动, 状态:', listener.listening)
        // 如果启动失败，延迟检查并降级
        if (!listener.listening && !hasFallbackToPolling) {
          setTimeout(() => {
            if (!listener.listening && !hasFallbackToPolling) {
              console.log('[onPluginEnter] 监听器重新启动失败，延迟降级到轮询模式')
              hasFallbackToPolling = true
              addCommonListener()
            }
          }, 500)
        }
      }, 100)
    } else {
      console.log('[onPluginEnter] 监听器正在运行')
    }
    toTop()
    // 将焦点移到主内容区，使上下键能被热键层识别；并让当前选中项滚动到视图中
    setTimeout(() => {
      const mainEl = document.querySelector('.main')
      if (mainEl) {
        mainEl.focus()
      }
      document.querySelector('.clip-item.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, 80)
  })
  
  console.log('[initPlugin] 插件初始化完成')

  window.db = db
  // 注入 maxsize / maxage：存储层不反向依赖 readSetting，由此处推送并在设置变更时同步。
  // 仅对 SQLite 主路径生效；JSON 回退路径的清理仍在 legacy DB 内按原实现执行。
  const applyRetentionPolicy = () => {
    db.setRetentionPolicy?.({
      maxsize: setting?.database?.maxsize ?? null,
      maxage: setting?.database?.maxage ?? null
    })
  }
  applyRetentionPolicy()
  window.addEventListener(SETTING_UPDATED_EVENT, applyRetentionPolicy)
  registerQuickPasteRuntime()
  const onWindowMayHide = () => {
    if (document.visibilityState === 'hidden') {
      flushPendingDbToDisk()
    }
  }
  document.addEventListener('visibilitychange', onWindowMayHide)
  window.addEventListener('pagehide', flushPendingDbToDisk)
  window.copy = copy
  window.paste = paste
  window.remove = remove
  window.setLock = (id, locked, skipFileWrite) => db.setLock(id, locked, skipFileWrite)
  window.setLocks = (ids, locked, skipFileWrite) => db.setLocks(ids, locked, skipFileWrite)
  window.queuePersistDb = () => db.queuePersist()
  window.isLocked = (id) => db.isLocked(id)
  window.createFile = createFile
  window.focus = focus
  window.toTop = toTop
  window.toBottom = toBottom
  window.listener = listener
}
