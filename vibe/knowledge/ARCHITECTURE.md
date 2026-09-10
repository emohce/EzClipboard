# EzClipboard 系统架构详档

> 版本: 2026-06-09 (性能重写版)  
> 范围: 全量核心业务逻辑与代码结构  
> **2026-09-09 核验校正**：本文档部分内容已与代码脱节。已修正「搜索」「长列表」两行；第 3 章「虚拟列表渲染层」与 7.2 组件表仍描述了不存在的组件与 `useVirtualizer` 用法，待随巨石拆分一并重写。逐条差异见 [审计报告](../specs/260909/2133-full-code-audit/report.md)。

---

## 目录

1. [项目概览](#1-项目概览)
2. [存储层架构](#2-存储层架构)
3. [虚拟列表渲染层](#3-虚拟列表渲染层)
4. [快捷键系统](#4-快捷键系统)
5. [组件体系](#5-组件体系)
6. [关键业务流程](#6-关键业务流程)
7. [文件索引](#7-文件索引)

---

## 1. 项目概览

### 1.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Vue 3 + Vite | Composition API, 单文件组件 |
| UI | Element Plus | 对话框、输入框、按钮等 |
| 存储 | SQLite (sql.js) | WASM 版本，本地文件持久化 |
| 搜索 | `search_text` 冗余列 + LIKE 子串匹配 | 代码保留 FTS5 分支，但打包的 sql.js wasm 未编译 FTS5，`ftsEnabled` 恒 false |
| 长列表 | 游标分页 + 全量 `v-for` | **未实现窗口化虚拟滚动**；`@tanstack/vue-virtual` 在 src 下零引用，`virtualizer` 传入 null |
| 运行环境 | uTools 插件 | 主进程 + 渲染进程架构 |

### 1.2 目录结构

```
/Users/gdkmjd/work/czz/EzClipboard/
├── plugin.json              # uTools 插件配置
├── preload.js               # 预加载脚本（Node 能力暴露）
├── listener.js              # 剪贴板监听进程
├── src/
│   ├── App.vue              # 根组件
│   ├── main.js              # 入口
│   ├── views/               # 页面级组件
│   │   ├── Main.vue         # 主界面（列表 + 搜索 + 标签）
│   │   └── Setting.vue      # 设置页
│   ├── cpns/                # 通用组件
│   │   ├── ClipItemList.vue # 虚拟列表容器（核心）
│   │   ├── ClipItemRow.vue  # 单项渲染
│   │   ├── ClipDrawerMenu.vue # 操作抽屉
│   │   ├── ClipSwitch.vue   # Tab 切换器
│   │   ├── HotkeyProvider.vue # 快捷键事件监听
│   │   └── ...
│   ├── global/              # 全局模块
│   │   ├── initPlugin.js    # 插件初始化（存储挂载）
│   │   ├── hotkey*.js       # 快捷键体系（7 个文件）
│   │   ├── readSetting.js   # 配置读写
│   │   └── ...
│   ├── storage/             # 存储层
│   │   ├── clipboardRepository.js      # Repository Facade
│   │   ├── sqliteClipboardRepository.js # SQLite 实现
│   │   ├── jsonMigration.js            # JSON 数据迁移
│   │   ├── searchIndex.js              # 搜索索引构建
│   │   └── blobStore.js                # 大对象存储
│   └── utils/               # 工具函数
└── dist/                    # 构建产物（uTools 加载）
```

---

## 2. 存储层架构

### 2.1 架构层级

```
业务代码 (Main.vue, ClipItemList.vue, etc.)
    ↓ 调用
Repository Facade (clipboardRepository.js)
    ↓ 委托
SQLite Implementation (sqliteClipboardRepository.js)
    ↓ 执行
SQL.js WASM → 本地 SQLite 文件
```

### 2.2 核心类说明

#### ClipboardRepository (`src/storage/clipboardRepository.js`)

**职责**: Repository Facade，为业务层提供统一接口，屏蔽底层存储细节。

**关键方法**:

```javascript
// 查询接口（支持分页、过滤、搜索）
query(options: {
  tab?: string,        // 'all' | 'collect' | 'tag'
  tag?: string,        // 标签过滤
  search?: string,     // 搜索关键词
  lockFilter?: string, // 'all' | 'locked'
  cursor?: number,     // 分页游标
  limit?: number       // 每页条数
}) => { items, total, cursor, nextCursor }

// 数据操作
addItem(item)          // 添加剪贴板项
updateItem(id, patch)  // 更新属性（收藏、锁定、标签等）
removeItem(id)         // 删除单项
removeItems(ids)       // 批量删除

// 收藏相关
collectItem(id)        // 收藏
uncollectItem(id)      // 取消收藏
toggleCollect(id)      // 切换收藏状态

// 别名管理
updateAlias(id, alias) // 更新别名

// 标签管理
updateTags(id, tags)   // 更新标签列表
```

**向后兼容机制**:
- 保留 `dataBase` getter/setter，结构兼容旧 JSON 格式
- 内部委托给 `legacyDb`（即 SQLiteRepository 实例）
- `getData()`, `getCollects()` 等方法提供统一访问

#### SQLiteClipboardRepository (`src/storage/sqliteClipboardRepository.js`)

**职责**: SQLite 存储的具体实现，包含 SQL 执行、FTS 索引、迁移检测。

**核心状态**:

```javascript
{
  db: SQL.Database,           // sql.js 数据库实例
  dbPath: string,             // SQLite 文件路径
  blobStore: BlobStore,       // 大对象存储（图片/文件）
  collectIdSet: Set,          // 收藏 ID 缓存
  tabCache: Map,              // Tab 查询缓存
  dataBase: object            // 兼容层数据结构
}
```

**关键方法**:

```javascript
// 初始化
async init()               // 加载 SQL.js，打开/创建数据库
ensureSchema()             // 确保表结构存在

// 查询
query({ tab, tag, search, lockFilter, cursor, limit })
                         // 构建 SQL，执行分页查询
ftsSearch(query)           // FTS5 全文搜索

// 写入
addItem(item)              // INSERT，更新 FTS 索引
updateItem(id, changes)    // UPDATE，记录变更
removeItem(id)             // DELETE，清理资源
removeItems(ids)           // 批量 DELETE（事务）

// 收藏
toggleCollect(id)          // 切换收藏状态，更新 collect_time

// 迁移检测
checkMigrationNeeded()     // 检测是否需要从 JSON 迁移
importFromLegacy(jsonDb)   // 导入旧数据，记录 fingerprint
```

**数据模型**:

```sql
-- 主表
CREATE TABLE clipboard_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- 'text' | 'image' | 'file' | 'html'
  data TEXT,                       -- 内容（文本/base64/JSON 路径）
  data_path TEXT,                  -- 大对象文件路径
  locked INTEGER DEFAULT 0,
  collected INTEGER DEFAULT 0,
  create_time INTEGER,
  update_time INTEGER,
  collect_time INTEGER,
  tags_json TEXT,                  -- JSON 数组
  remark TEXT,
  alias TEXT,
  thumbnail TEXT,                  -- 缩略图 base64
  origin_paths_json TEXT,          -- 原始路径
  source_paths_json TEXT,          -- 来源路径
  from_file_source INTEGER,
  has_source_info INTEGER,
  source_app TEXT,
  source_window_title TEXT,
  search_text TEXT                 -- FTS 索引文本
);

-- FTS5 虚拟表
CREATE VIRTUAL TABLE clipboard_items_fts USING fts5(
  search_text,
  content='clipboard_items',
  content_rowid='rowid'
);
```

### 2.3 迁移机制 (`src/storage/jsonMigration.js`)

**触发条件**:
- 启动时检测 `schemaVersion`
- 新安装或旧版本 (< SCHEMA_VERSION) 时触发

**流程**:
1. 检查旧 JSON 数据存在性
2. 创建备份 `.backup.{timestamp}`
3. 导入到 SQLite（批量事务）
4. 记录 `fingerprint`（防止重复导入）
5. 标记迁移完成

**回退机制**:
- SQLite 初始化失败时自动降级到 JSON 模式
- 保留 `storageRuntimeStatus` 供设置页查看

---

## 3. 虚拟列表渲染层

### 3.1 技术选型

- **库**: `@tanstack/vue-virtual` v3.13.12
- **容器**: `ClipItemList.vue` - 固定高度项列表
- **测量**: 垂直列表，每项固定高度 (estimatedHeight ≈ 68px)

### 3.2 核心实现 (`src/cpns/ClipItemList.vue`)

#### Virtualizer 配置

```javascript
import { useVirtualizer } from '@tanstack/vue-virtual'

const virtualizer = useVirtualizer({
  count: computed(() => props.showList.length),
  getScrollElement: () => parentRef.value,
  estimateSize: () => estimatedItemHeight.value,  // ~68px
  overscan: 5,  // 可视区域外预渲染 5 项
})

// 转换后的渲染列表
const virtualItems = computed(() => virtualizer.value.getVirtualItems())
```

#### 分页加载策略

```javascript
// 初始加载
onTabChange -> loadInitial({ limit: 50 })

// 滚动触底加载
handleScrollToBottom -> loadMore({ cursor, limit: 30 })
                         -> append 到 showList
                         -> virtualizer.notify()

// 搜索过滤
applyFilter -> reset offset
            -> query({ search, cursor: 0 })
            -> showList = items
            -> scrollToIndex(0)  // 重置到顶部
```

#### 键盘导航同步

```javascript
// 导航后必须同步滚动
const syncScrollToActive = () => {
  const index = activeIndex.value
  virtualizer.value.scrollToIndex(index, { align: 'center' })
}

// 绑定到导航功能
registerFeature('list-nav-up', () => {
  if (activeIndex.value > 0) {
    activeIndex.value--
    syncScrollToActive()  // 关键！确保可见
    return true
  }
  return false
})
```

### 3.3 响应式优化

```javascript
// showList 使用 shallowRef 避免深层响应式开销
const showList = shallowRef([])

// 仅关键字段响应式（选中、锁定状态）
const itemState = reactive(new Map())

// 收藏/锁定操作即时更新
const toggleLock = (item) => {
  const index = showList.value.findIndex(i => i.id === item.id)
  if (index !== -1) {
    showList.value[index].locked = !item.locked  // 直接修改，不依赖重新查询
    showList.value = [...showList.value]  // 触发 shallowRef 更新
  }
}
```

---

## 4. 快捷键系统

### 4.1 架构层级

```
keydown 事件
    ↓
HotkeyProvider.vue (全局监听)
    ↓
hotkeyRegistry.dispatch(e)
    ↓
  1. 检查 isComposing (IME 保护)
  2. 检查对话框拦截
  3. 计算 compact shortcutId (c-a-1)
  4. 获取当前层 (getCurrentLayer)
  5. 查找绑定 (findBinding)
    ↓
执行 feature handler
    ↓
返回 handled (true = 阻止默认行为)
```

### 4.2 分层体系 (`src/global/hotkeyLayers.js`)

| 层级 | 标识 | 激活时机 | 特殊处理 |
|------|------|----------|----------|
| main | 默认 | 主界面 | 搜索态特殊处理 |
| search | 搜索框聚焦 | 展开搜索 | Enter 遵循过滤结果 |
| drawer | 抽屉打开 | 右键/Space 打开 | Esc/← 关闭 |
| setting | 设置页 | 进入设置 | **Del/Backspace 放行** |
| clear-dialog | 清除对话框 | 打开清除 | 数字键选范围 |
| clip-drawer | 剪贴板抽屉 | - | ↑↓ 导航子项 |
| full-data-overlay | 全文预览 | 查看全文 | 滚轮/方向键滚动 |
| tag-search | 标签搜索 | 打开标签搜索 | - |
| tag-edit | 标签编辑 | 编辑标签 | - |

### 4.3 绑定定义 (`src/global/hotkeyBindings.js`)

当前存储与匹配使用 compact shortcutId，语义见 [../specs/260613-SettingUiModify/260614-shortcut-compact-semantics.md](../specs/260613-SettingUiModify/260614-shortcut-compact-semantics.md)。旧式 `ctrl+shift+Delete`、`Enter`、`ArrowLeft` 只作为兼容输入进入归一化，不再作为默认声明或新写入值。

```javascript
export const HOTKEY_BINDINGS = [
  // 格式: { layer, shortcutId, state?, features: [] }
  
  // 设置页（排除 del/backspace）
  { layer: "setting", shortcutId: "up", features: ["setting-scroll-up"] },
  { layer: "setting", shortcutId: "down", features: ["setting-scroll-down"] },
  // ... 无 del/backspace 绑定
  
  // 主界面列表导航
  { layer: "main", shortcutId: "up", features: ["list-nav-up"] },
  { layer: "main", shortcutId: "down", features: ["list-nav-down"] },
  { layer: "main", shortcutId: "pageup", features: ["list-page-up"] },
  { layer: "main", shortcutId: "pagedown", features: ["list-page-down"] },
  
  // 搜索态特殊绑定
  { layer: "main", state: "search", shortcutId: "c-del", features: ["search-delete-normal"] },
  { layer: "main", state: "search", shortcutId: "c-s-del", features: ["search-delete-force"] },
  { layer: "main", state: "search", shortcutId: "cr", features: ["list-enter"] },
  
  // 抽屉子项选择
  { layer: "main", shortcutId: "c-a-1", features: ["list-drawer-sub-1"] },
  // ... c-a-2~9
]
```

### 4.4 注册中心 (`src/global/hotkeyRegistry.js`)

**核心方法**:

```javascript
// 注册功能处理器
registerFeature('list-nav-up', (e, ctx) => {
  // e: KeyboardEvent
  // ctx: { layer, state }
  // return: true | false | { handled, preventDefault, ... }
})

// 分发事件
dispatch(e) -> boolean

// 层状态管理（通过 hotkeyLayers）
setMainState('search')  // 搜索态
activateLayer('setting')  // 激活层
deactivateLayer('setting')  // 退出层
```

**分发流程**:

1. **检查重复按键** - ignoreRepeat 配置，但方向键/Page 键允许重复
2. **IME 保护** - `e.isComposing` 时直接返回
3. **对话框拦截** - `.el-overlay .el-message-box` 存在时拦截
4. **设置页保护** - setting 层 + (`del`/`backspace`) 时直接返回
5. **计算 shortcutId** - 如 `c-a-1`
6. **层优先级** - [currentLayer, main]
7. **查找绑定** - 匹配 layer + state + shortcutId
8. **执行 feature** - 按顺序执行绑定的 features，直到有返回 true

---

## 5. 组件体系

### 5.1 页面组件

#### Main.vue (`src/views/Main.vue`)

**职责**: 主界面容器，协调搜索、列表、Tab 切换。

**关键状态**:

```javascript
// Tab 状态
const activeTab = ref('all')  // 'all' | 'collect' | 'file' | 'image' | 'text'
const collectSubTab = ref('*全部*')  // 收藏子标签

// 搜索状态
const isSearchPanelExpand = ref(false)
const filterText = ref('')
const lockFilter = ref('all')  // 'all' | 'locked'

// 列表状态（每个 Tab 独立）
const queryStates = {
  all: { lastQueryId: 0, offset: 0, hasMore: true },
  collect: { ... },
  // ...
}

// 虚拟列表引用
const clipItemListRef = ref(null)
```

**关键方法**:

```javascript
// Tab 切换
toggleNav(tabType) -> switchActiveTab(tabType)
                   -> 恢复/初始化 queryState
                   -> 调用 loadInitial()

// 加载数据
loadInitial() -> 获取 queryState -> query({ limit: 50 })
              -> showList = items
              -> scrollToTop()

loadMore() -> 获取 cursor -> query({ cursor, limit: 30 })
           -> append items
           -> notify virtualizer

// 搜索处理
applyFilter() -> 重新 query({ search, cursor: 0 })
              -> showList = items
              -> scrollToIndex(0)  // 重置滚动位置
```

#### Setting.vue (`src/views/Setting.vue`)

**职责**: 设置页，快捷键展示与修改、存储状态查看。

**关键逻辑**:

```javascript
// 进入设置页
onMounted -> activateLayer('setting')
          -> registerFeature('setting-scroll-up', ...)
          // 注意：不注册 Del/Backspace，保留输入框默认行为

// 快捷键树展示
buildHotkeyTree(bindings) -> 分组展示层/功能/快捷键
```

### 5.2 列表组件

#### ClipItemList.vue (`src/cpns/ClipItemList.vue`)

**职责**: 虚拟列表容器，处理键盘导航、抽屉、预览。

**关键引用**:

```javascript
// DOM 引用
const listContainerRef = ref(null)      // 列表容器
const listRef = ref(null)               // 虚拟列表元素

// Virtualizer
const virtualizer = useVirtualizer({...})

// 状态
const activeIndex = ref(0)              // 当前高亮索引
const selectItemList = ref([])          // 多选列表
const drawerShow = ref(false)           // 抽屉显示

// 预览
const textPreview = ref({ show: false, item: null, x: 0, y: 0 })
```

**关键方法**:

```javascript
// 导航
handleNavUp()    -> activeIndex-- -> scrollToIndex()
handleNavDown()  -> activeIndex++ -> scrollToIndex()
                 -> 触底触发 loadMore

// 多选
handleSpace()    -> toggleSelect(showList[activeIndex])
handleEscape()   -> clearSelect() + closeDrawer

// 删除处理
handleDelete()   -> 获取 itemsToDelete
                 -> getDeleteAnchorMeta()  // 计算锚点
                 -> emit('onItemsDelete')    // 批量删除
                 -> setDeleteAnchor()       // 恢复锚点

// 抽屉
handleOpenDrawer()   -> 计算 drawerItems（根据当前项类型）
                     -> drawerShow = true
                     -> 注册 drawer 层
handleDrawerSelect() -> 执行对应功能
                     -> closeDrawer()
```

#### ClipItemRow.vue (`src/cpns/ClipItemRow.vue`)

**职责**: 单项渲染，纯展示组件。

**Props**:

```javascript
{
  item: Object,           // 剪贴板项数据
  index: Number,          // 列表索引
  isActive: Boolean,      // 是否高亮
  isSelected: Boolean,    // 是否多选选中
  isCollected: Boolean,   // 是否收藏
  isLocked: Boolean,      // 是否锁定
  showTags: Boolean,      // 是否显示标签
  tags: Array             // 标签列表
}
```

### 5.3 抽屉组件

#### ClipDrawerMenu.vue (`src/cpns/ClipDrawerMenu.vue`)

**职责**: 操作抽屉，展示当前项可用的操作。

**Features**:

```javascript
// 通用操作
copy, copyAndPaste, collect, lock, delete, forceDelete, viewFull

// 文件特有
openFolder, saveByAlias

// 抽屉快捷键
Ctrl+Alt+1~9 -> 执行对应索引的操作
```

### 5.4 快捷键组件

#### HotkeyProvider.vue (`src/cpns/HotkeyProvider.vue`)

**职责**: 全局快捷键事件监听，无渲染内容（`<slot />`）。

```javascript
onMounted -> document.addEventListener('keydown', dispatch, true)
onUnmounted -> removeEventListener
```

#### HotkeyTreeView.vue (`src/cpns/HotkeyTreeView.vue`)

**职责**: 设置页快捷键树形展示。

---

## 6. 关键业务流程

### 6.1 剪贴板监听与存储

```
系统剪贴板变化
    ↓
listener.js (独立进程) 监听
    ↓
utools.onPluginReady -> 初始化 listener
    ↓
收到新内容
    ↓
preload.js -> 通知渲染进程
    ↓
App.vue 监听 -> 调用 window.db.addItem(item)
    ↓
SQLiteClipboardRepository.addItem()
    - INSERT 到 clipboard_items
    - 更新 FTS 索引
    - 触发 mutationVersion++
    ↓
通知界面刷新（若当前在 'all' Tab）
```

### 6.2 列表加载与渲染

```
用户打开插件 / 切换 Tab
    ↓
Main.vue switchActiveTab()
    ↓
loadInitial({ limit: 50 })
    ↓
window.db.query({ tab, cursor: 0, limit: 50 })
    ↓
SQLiteRepository.query() -> SQL SELECT ... LIMIT 50
    ↓
返回 items -> showList = items
    ↓
ClipItemList.vue virtualizer 渲染前 50 项
    ↓
用户滚动到底部
    ↓
触发 loadMore()
    ↓
query({ cursor: 50, limit: 30 })
    ↓
append items -> showList.push(...items)
    ↓
virtualizer.notify() 更新总数量
    ↓
渲染新增项
```

### 6.3 搜索过滤

```
用户输入关键词
    ↓
debounce 300ms
    ↓
Main.vue applyFilter()
    ↓
query({ search: keyword, cursor: 0, limit: 50 })
    ↓
SQLiteRepository 使用 FTS5 搜索
    SELECT * FROM clipboard_items_fts
    WHERE search_text MATCH keyword
    ↓
返回匹配项
    ↓
showList = items
scrollToIndex(0)  // 关键：重置到顶部
    ↓
virtualizer 重新计算可见范围
```

### 6.4 删除与锚点恢复

```
用户按 Delete / 选择删除
    ↓
ClipItemList.vue handleDelete()
    ↓
确定 itemsToDelete（单选/多选）
    ↓
getDeleteAnchorMeta(itemsToDelete) -> 计算删除后锚点
    - 优先保留邻近未删除项
    - 边界处理
    ↓
emit('onItemsDelete', itemsToDelete, { anchorIndex })
    ↓
Main.vue -> window.db.removeItems(ids)
    ↓
SQLite DELETE ... WHERE id IN (...)
    ↓
返回后 -> setDeleteAnchor(calculatedAnchor)
    ↓
virtualizer.scrollToIndex(newActiveIndex)
    ↓
高亮项恢复，列表位置正确
```

### 6.5 收藏操作

```
用户按 F2 / 选择收藏
    ↓
判断当前是否已收藏
    ↓
已收藏 -> 打开标签编辑对话框
    未收藏 -> 直接收藏 + 标签编辑
    ↓
toggleCollect() -> UPDATE collected = 1, collect_time = now
    ↓
即时更新 showList[itemIndex].collected = true
    ↓
图标状态即时切换（不等待重新查询）
```

---

## 7. 文件索引

### 7.1 视图 (views/)

| 文件 | 行数 | 职责 | 关键导出 |
|------|------|------|----------|
| Main.vue | ~2100 | 主界面，协调搜索、Tab、列表 | toggleNav, loadMore, applyFilter |
| Setting.vue | ~1000 | 设置页，快捷键、存储状态 | activateLayer('setting') |

### 7.2 组件 (cpns/)

| 文件 | 行数 | 职责 | 关键导出 |
|------|------|------|----------|
| ClipItemList.vue | ~2900 | 虚拟列表、键盘导航、抽屉 | useVirtualizer, registerFeature |
| ClipItemRow.vue | ~400 | 单项渲染 | Props: item, isActive, isCollected |
| ClipDrawerMenu.vue | ~300 | 操作抽屉 | Props: items, position |
| ClipSwitch.vue | ~400 | Tab 切换器 | toggleNav, tabs |
| HotkeyProvider.vue | ~23 | 全局快捷键监听 | dispatch |
| HotkeyTreeView.vue | ~144 | 快捷键树展示 | buildHotkeyTree |
| ClipAliasEdit.vue | ~200 | 别名编辑对话框 | - |
| ClipTagEdit.vue | ~200 | 标签编辑对话框 | - |
| ClipTextPreview.vue | ~100 | 文本预览浮层 | - |
| ClipImagePreview.vue | ~200 | 图片预览浮层 | - |
| ClipFullDataOverlay.vue | ~300 | 全文/全图查看 | - |
| ClipCleanDialog.vue | ~400 | 清除记录对话框 | - |
| ClipTagSearch.vue | ~200 | 标签搜索对话框 | - |

### 7.3 全局模块 (global/)

| 文件 | 行数 | 职责 | 关键导出 |
|------|------|------|----------|
| initPlugin.js | ~400 | 插件初始化，挂载 window.db | initPlugin(), checkFirstRun() |
| hotkeyRegistry.js | ~258 | 快捷键注册与分发 | registerFeature(), dispatch() |
| hotkeyBindings.js | ~348 | 快捷键绑定定义 | HOTKEY_BINDINGS, getEffectiveBindings() |
| hotkeyLayers.js | ~46 | 层状态管理 | activateLayer(), getCurrentLayer() |
| hotkeyLabels.js | ~145 | 层/功能标签 | LAYER_LABELS, FEATURE_LABELS |
| hotkeyGraph.js | ~157 | 快捷键树构建 | buildHotkeyTree() |
| shortcutKey.js | ~100 | 快捷键解析与格式化 | eventToShortcutId(), formatShortcut() |
| readSetting.js | ~200 | 配置读写 | saveSetting(), syncSetting() |

### 7.4 存储层 (storage/)

| 文件 | 行数 | 职责 | 关键导出 |
|------|------|------|----------|
| clipboardRepository.js | ~343 | Repository Facade | ClipboardRepository |
| sqliteClipboardRepository.js | ~787 | SQLite 实现 | SQLiteClipboardRepository |
| jsonMigration.js | ~200 | JSON 迁移 | checkMigrationNeeded(), importFromLegacy() |
| searchIndex.js | ~150 | 搜索索引构建 | buildSearchIndex(), queryClipboardItems() |
| blobStore.js | ~150 | 大对象存储 | BlobStore |
| storageRuntimeStatus.js | ~100 | 存储状态事件 | STORAGE_STATUS_EVENT |

---

## 附录：关键常量

```javascript
// 分页配置
const INITIAL_LOAD_LIMIT = 50
const LOAD_MORE_LIMIT = 30
const TAB_CACHE_LIMIT = 30

// 虚拟列表
const OVERSCAN_COUNT = 5
const ESTIMATED_ITEM_HEIGHT = 68  // px

// 存储
const SCHEMA_VERSION = 1
const ITEM_ALIAS_STORAGE_KEY = 'item.alias.map'
const META_JSON_MIGRATION_COMPLETE = 'json_migration_complete'

// 快捷键层
const LAYERS = ['main', 'search', 'drawer', 'setting', 'clear-dialog', 
                'clip-drawer', 'full-data-overlay', 'tag-search', 'tag-edit']
```

---

> 本文档最后更新: 2026-06-09  
> 配套记忆: EzClipboard 核心业务逻辑约束（存储层、虚拟列表、快捷键）
