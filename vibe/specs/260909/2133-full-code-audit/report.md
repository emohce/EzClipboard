# EzClipboard 全量代码核验报告

日期: 2026-09-09
范围: `src/` 全量 30.7k 行 + `scripts/` + 构建配置 + 文档树
方法: 8 子系统并行测绘 → 三目标交叉分析（需求贴合 / 架构精简 / 操作提速）→ 逐条对抗式验证 → 合成
统计: 原始发现 34 条 → 对抗验证确认 **25 条**，驳回 9 条
基线: 工作区含未提交改动（任务 `260909/2054-list-up-nav-scroll-anchor`），本报告行号以该工作区状态为准

---

## 摘要

EzClipboard 的核心链路（SQLite 存储、快捷键命令系统、剪贴板监听）是可用且经过设计的，但存在一类系统性问题：README/docs 中至少 6 条能力承诺（收藏持久化、FTS5 全文索引、maxsize/maxage 清理、按范围清空、虚拟列表、来源信息）在出货产物中不成立，其中「收藏第 31 条后被静默取消/误删」属于不可逆的用户数据丢失。架构上最实质的问题不是文件太大，而是 `TAB_CACHE_LIMIT = 30` 的内存快照被 UI 层当作全量数据集使用（Main.vue 13 处直读 `window.db.dataBase`），它同时是数据丢失、清空失效、星标缺失三个可见缺陷的共同根因。性能侧最大的两块是首屏 CSS 1.078MB（其中 92% 是同一份 index.less 的 9 次重复）与每次重复复制触发的「全量读 blob → 原样写回 → 整库 export」放大，均有低风险修法。可立即执行的高性价比动作有 12 项（含一个 6 行的 Esc 逃逸 bug 与一个 3 行的组件注册遗漏），巨石拆分（Setting.vue 5607 行、Main.vue 2588 行）收益真实但应排在数据正确性与文档对齐之后。另需注意：审计中「首屏全程白屏」「搜索无防抖导致 30 次同步读盘」「跟滚路径每次按键 60~90 次强制样式计算」三项已排除，不要按它们立项。

---

# 一、功能需求贴合度

## 结论

不贴合项分两类：**A 类 = 文档承诺但实现不成立**（6 条，其中 1 条造成数据丢失），**B 类 = 实现已完成但用户拿不到**（3 条）。A 类必须「要么补实现、要么改文档」，不能继续两头挂着。

## A 类：承诺落空

| # | 承诺 | 实际 | 关键位置 |
|---|---|---|---|
| A1 | README.md:8 / docs/用户简明说明.md:9「收藏独立存储并持久化，可锁定避免误删」 | 收藏判定只覆盖最新 30 条，第 31 条以后的收藏被**静默取消并可被真删** | `src/storage/sqliteClipboardRepository.js:14`(TAB_CACHE_LIMIT=30)、`:494`、`:518`、`:764`、`:651`、`:661`、`:694` |
| A2 | README.md:11「SQLite + FTS5 全文索引」；vibe/knowledge/ARCHITECTURE.md:29/128/153/196/650 | 出货 wasm 未编译 FTS5（实测 `no such module: fts5`），`ftsEnabled` 恒 false，搜索永远走 LIKE 全表 | `src/storage/sqliteClipboardRepository.js:216-229`、`:590`、`:602-606` |
| A3 | README.md:52「maxsize 控制最大条数、maxage 控制最长天数」 | 清理逻辑只存在于 legacy `class DB` 内，SQLite 仓库零实现；设置页配了不生效 | `src/global/initPlugin.js:300-307`、`:407-427`；`src/storage/sqliteClipboardRepository.js:645-655`（addItem 无任何清理） |
| A4 | README.md:33/45「按时间范围清除当前标签页」六档范围 | 候选集取自 30 条快照，选「全部」也只删 30 条，且提示「已清除 30 条记录」为成功态 | `src/views/Main.vue:1007-1008`、`:972-981`、`:984-985`、`:1117-1124` |
| A5 | README.md:12 / docs/用户简明说明.md:14「虚拟列表/虚拟滚动」 | `@tanstack/vue-virtual` 在 src 下零引用，列表是全量 `v-for`；`useVirtualListScroll` 传入 `virtualizer: null` | `src/cpns/ClipItemList.vue:16-17`、`:1544-1551`；`src/hooks/useVirtualListScroll.js:19-21`；`vite.config.js:32`（死分支） |
| A6 | README.md:9/54「读取前台窗口标题存入 sourceApp/sourceWindowTitle」 | 依赖 `utools.shellExec`（真实宿主不提供），且两字段零 UI 消费；每次复制还多付一次 `db.updateItem` | `src/global/initPlugin.js:1065-1113`、`:1431` |

**A1 是唯一的数据安全级问题**，且有一处放大器：`rowToItem`(`src/storage/sqliteClipboardRepository.js:36-55`) **根本没有映射 `collected` 字段**，导致 `src/cpns/ClipItemList.vue:329-333` 的 `typeof item.collected === 'boolean'` 快通道永不命中，星标只能回落到 30 条上限的 `collectedIds`。补上这一个字段是 A1、A4 与星标显示三处的共同前提。

> 注意：修 A1 时**不能**照「用 `existing.collected` / `item.collected`」的直觉改，在补 `rowToItem` 之前这两个值恒为 `undefined`，会把「30 条失真」升级成「100% 全丢」。顺序必须是：先补字段 → 再改判定。

## B 类：实现完成但不可达

| # | 现象 | 位置 |
|---|---|---|
| B1 | 「快捷键配置管理」的本机/公共运行源选择器渲染成两段裸文本：`el-radio-group`/`el-radio-button` 既未全局注册也未局部导入，v-model 不生效，「应用」按钮永远写回初始值 | `src/views/Setting.vue:966-969`；`src/global/registerElement.js:21-59`（17 个组件，无 Radio）；PROJECT_STATUS.md:42 记为已完成 |
| B2 | 操作抽屉的拖拽手势是激活的，但 `emit('reorder')` 无人接收，顺序永不落盘，关掉重开即复原 | `src/cpns/ClipDrawerMenu.vue:44/:101-109`；`src/cpns/ClipItemList.vue:217-225`（无 `@reorder`）、`:1443-1447`（死函数） |
| B3 | `list.navigate.left` 已注册 handler 与中文标签，但 `hotkeyBindings.js` 144 条 features 中无一指向它，设置页因此不生成该行；只能绕道组合命令使用 | `src/global/commandDefaults.js:80`；`src/cpns/ClipItemList.vue:2340-2343/:2742`；`src/global/hotkeyLabels.js:101` |

B3 还暴露一处语义打架：handler 实为「上一项」(`setKeyboardActiveIndex(activeIndex - 1)`)，标签写「左移/上一页」，description 写 `Move selection left` —— 三处不一致，先定语义再决定补键位还是判废。

## 建议

1. **先修 A1**（P0）：`rowToItem` 补 `collected` → `isCollected` 改直查 SQL → `:651/:661/:694` 三处改用行上字段。UI 侧几乎零改动即自动正确。
2. **A2/A5/A6 一律先改文档**（P0，零运行时风险）。A2 不要贸然切 FTS：实测 fts4/fts3 可用而 fts5 不可用，但 fts4 simple 分词下 `MATCH '好世'` 匹配不到 `你好世界`，而现状 LIKE `%好世%` 能命中 —— **没有 CJK bigram 分词方案就不要切**。同时把 `ftsEnabled` 真值上报到 `src/storage/storageRuntimeStatus.js`（目前无该字段），让降级不再无声。
3. **A3/A4 属同一类**（清理与批删都要下沉到仓库层，P1），必须复用现有清理链路（`blobStore.removeForItem` `:698`、`DELETE FROM items_fts` `:706-708`、`refreshCache` `:710`），豁免判定用 SQL 列 `collected=0 AND locked=0`，**不要**用 `isCollected`。
4. **B1 立即修**（P0，3 行注册 + 3 个 theme-chalk CSS：`el-radio.css`/`el-radio-group.css`/`el-radio-button.css`，缺一个就是无边框半成品）。
5. **B2 二选一**：接落盘则必须以 `operations` 全量为基准并 `.filter(row => row.orderable !== false)`（否则会把 `orderable:false` 的 `edit-alias` 写进 `drawer.order`，并让图片项拖一次挤乱所有文本操作）；或直接删掉拖拽手势，认定设置页为唯一入口。
6. **B3 先定语义**再动手。若判废删除，注意存量组合命令引用该 commandId 会走 `commandMacro.js:231-260` 的 `missing-handler` 失败分支 —— 这不是「无运行时影响」。

---

# 二、架构精简

## 结论

真正的架构问题不是「文件太大」，而是**分层被绕过**：`TAB_CACHE_LIMIT = 30` 的内存快照在 UI 层被当成全量数据集。巨石文件（Setting.vue 5607 / ClipItemList.vue 3350 / Main.vue 2588 / FileRichPreview.vue 1362）是阅读成本问题，可以慢慢拆；30 条快照是正确性问题，必须先收口。另有约 1650 行零引用死码可直接删。

## S1（最高优先）30 条快照当全量数据集 —— 分层违规

`src/storage/sqliteClipboardRepository.js:493-494` 用 `TAB_CACHE_LIMIT`(`:14`) 各取 30 条写入 `dataBase.data` / `dataBase.collectData`；而 JSON facade `src/storage/clipboardRepository.js:76-101` 的同名字段返回**全量**。同名不同义，消费者全部按全量语义写。

`src/views/Main.vue` 13 处直读：`:437`、`:438`、`:772`、`:773`、`:978`、`:1154`、`:1512`、`:1523`、`:1908`、`:1917`、`:1924`、`:1928`、`:1939`；另有 `src/global/quickPasteRuntime.js:150-151`。

**但只有 4 个消费者会产生可见后果，改这 4 处即可，不要为「收敛 13 处」而收敛**：

| 消费者 | 后果 | 位置 |
|---|---|---|
| `getItemsByTab` → 两个清空函数 | 清空最多删 30 条却报成功 | `Main.vue:972-981` → `:1007`、`:1042` |
| `collectedIds` | 第 31 条以后收藏无星标 | `Main.vue:1415-1419` |
| `isCollected` 过滤 | 第 31 条以后收藏绕过删除保护，被静默真删 | `Main.vue:1656-1662`、`:1719-1720` |
| star 标签过滤分支 | 「按标签搜收藏」只搜最近 30 条 | `Main.vue:928-948` |

**已排除的误判**：`updateShowList`(`Main.vue:901-909`) 在 `window.db.query` 可用时走 SQL 分页，正常浏览与滚动分页**没有** 30 条截断；`getAllKnownItems`(`:768-782`) 与 `quickPasteRuntime.js:150-151` 都有 `getItemById` 兜底，不是数据丢失点；`:1512/:1523/:1908/…` 的 `list.value = dataBase.data` 只是随后被 `updateShowList` 覆盖的临时种子。

## S2 死码删除（约 1650 行，零构建图影响）

分三批：

- **批 1**（465 行）：`src/global/hotkeyGraph.js`(157)、`src/cpns/HotkeyTreeView.vue`(143)、`HotkeyTreeViewLayer.vue`(147)、`HotkeyTreeViewShortcut.vue`(215)、`src/cpns/ClipFloatBtn.vue`(16)、`src/cpns/ClipWordBreak.vue`(27)。连带删 `src/global/hotkeyLabels.js:49/:134/:144` 三条 `*-range-summary`（仅被 HotkeyTreeViewShortcut.vue:77/80/83 消费）。同步 `vibe/knowledge/ARCHITECTURE.md:475/:725/:743`。
- **批 2**（746 行）：`src/global/utoolsDB.js`(529) + `src/global/dbMigration.js`(217)，实现的是已废弃的 JSON→uTools DB 迁移线，与当前 JSON→SQLite 主线（`src/storage/jsonMigration.js`）无关。前置核对 `vibe/knowledge/technical-details.md:16`（**不是** ARCHITECTURE.md:753，那是 jsonMigration）。
- **批 3**（约 230 行）：`src/cpns/ClipItemList.vue:883-1085` 外置预览整块（`externalPreviewWindow` 恒 null，`openExternalPreview` 零调用，`:1022/:1026/:1036` 还有乱码）+ `:1087-1100` `focusUtoolsMainWindow` + `:1102-1114` `closeExternalPreview`（恒 no-op）+ `:826/:837` 两处调用点。

**死配置**：`src/views/Setting.vue:2908` payload 里的 `operation.drawerOrder`（只写不读，真相源是 dbStorage 的 `drawer.order`）；`src/views/Setting.vue:1980-1992` `getRecordShortcutConflicts`（零调用）；`package.json:12` 的 `@tanstack/vue-virtual` 与 `vite.config.js:32-34` 的死分支。
> **不要删** `Setting.vue:1749` 的 drawerOrder —— 那是 `buildContextMenuActionRows` 的活入参，删了设置页右键顺序预览立即失序。
> **不要现在删** `syncWithUTools`：`src/global/readSetting.js:64-65` 只做类型兜底，存量已持久化 `true` 的用户仍会走 `shortcutStore.js:239/:375` 两条分支，直接删会静默切换其快捷键 override 读取路径。需先跑一版无条件置 false 的迁移。

## S3 CSS：index.less 被打进产物 9 份

`src/style/index.less:1-12` 定义 `.import()` mixin，在 `:66`（light）与 `:121`（dark）各展开一次；另有 8 个 SFC 在 scoped 块内 `@import "../style"`：`ClipItemRow.vue:343`、`ClipOperate.vue:44`、`ClipFullData.vue:146`、`ClipSwitch.vue:106`、`ClipSearch.vue:191`、`ClipItemList.vue:3021`、`FileList.vue:28`、`Main.vue:2343`。加上 `src/main.js:7` 的全局副本共 9 份。

量化（已实测对账，非估算）：单份编译 110,876 B × 9 = 997,884 B，占 `dist/assets/index-*.css` 1,078,099 B 的 **92.6%**；按规则切分，带 data-v 的 scoped 副本 2880 条 / 824,968 B。删除 8 处后预计降到约 190KB。

安全性有直接反证：`src/views/Setting.vue` 有 scoped style 却**没有** `@import "../style"`，而 setting.less 样式正常生效 —— 证明全局副本已足够覆盖。特异度从 `#app .foo[data-v-x]`(1,2,0) 降到 `#app .foo`(1,1,0)，全仓 id 选择器只有 index.less 里的 `#app`，该区间为空。

执行顺序：**先删 5 个零局部规则的**（ClipItemRow / ClipSearch / ClipSwitch / ClipOperate / FileList —— 这 5 个 style 块除 @import 外只剩 `</style>`，可证明安全），再逐个截图核对 3 个有局部规则的（ClipFullData / Main / ClipItemList）。

> **驳回**「把 cpns/*.less 的 Less @变量改成 var(--*) 并删掉 `:66/:121`」：`src/style/cpns/` 下有 94 处 `fade(@var, x%)`（clip-item-list.less 45 / clip-switch.less 12 / clip-search.less 9 / clip-full-data.less 8），`fade(var(--x), 7%)` 在 Less 里非法；且删掉包裹会把 cpns 规则从 (1,1,0) 降到 (0,1,0)，被 Setting.vue 的 scoped + `:deep()` 反超，级联翻转。这是独立的 L 级任务。
> `src/style/cpns/collect-block.less` 是孤儿（不在 `:3-11` 的 9 个 @import 内，产物中 `collect-block-header` 出现 0 次），但 `Main.vue:124` 在用该 class —— 说明这份样式**从未生效**，「接回」等于新增视觉，须单开带比对的改动。

## S4 巨石拆分

### Setting.vue（5607 行：template 1-1207 / script 1209-3069 / style 3071-5607）

**第 0 步与拆分无关、应独立先做**：`shortcutSyncDialogVisible`(`:1348`) 未登记进 `isSettingOverlayOpen`(`:1509-1518`) 与 `closeTopSettingOverlay`(`:2080-2105`)。已复核可复现：`keyDownHandler` 在 `:3033` 以 capture 注册，早于 Element Plus 的冒泡 esc；`:2967-2979` 在 `closeTopSettingOverlay()` 返回 false 且焦点不在输入框时直接 `emit('back')`。**结果：打开「快捷键配置管理」对话框按 Esc 会整页退出设置。约 6 行修复。**

拆分顺序（每步单独提交）：
1. 抽 `cpns/ShortcutReservationTable.vue`，消除 `:187-204` 与 `:326-343` 的整段重复（零风险纯收益）。
2. 抽 7 个 Dialog（`301-439`/`440-588`/`713-747`/`948-1007`/`1008-1052`/`1053-1129`/`1130-1203`）。
3. 抽 4 个 Panel（`:47`/`:134`/`:589`/`:750` 四个 v-show 分支）。
4. 最后抽 composable，且**每个 composable 的成员必须重新按符号定位** —— 原方案的 `useShortcutRecorder(2140-2372)` 与 `useCommandMacroDrafts(1766-1960)` 两组区间实测互相错配（`:2140` 是 `commandMacroRows`，`:1766` 是 `focusShortcutRecorder`）。

> **样式方案必须改**：不要按行号切 8 个 less 文件。scoped 作用域按组件走，template 搬走后留在 Setting.vue 的规则只会给子组件根元素带 data-v，子组件内部整片失去样式（build 通过、界面全花）。正确做法是样式随 template 迁移到各 SFC 的 scoped 块，共享 token/mixin 才抽 `setting-shared.less`。且切点要落在规则边界（实测 `.shortcut-key-cell` 横跨 3535-3537，切 3535/3536 会劈开规则）。

### Main.vue（2588 行）

**必修缺陷**：`onUnmounted`(`:2329`) 词法上位于 `onMounted`(`:1814`) 回调体内（`:2338` 闭合 onUnmounted、`:2339` 才闭合 onMounted）。目前靠 mounted 钩子执行期 currentInstance 仍有效才侥幸生效。
> **陷阱**：`keyDownCallBack` 定义在 `:1979`（onMounted 体内），直接把 onUnmounted 提到 setup 顶层会在 setup 期抛 `ReferenceError`，组件挂不起来。正解是抽 `useMainHotkeys` 时把 `keyDownCallBack` 与 `document.addEventListener`(`:2012`)/`removeEventListener` 成对放进 composable 自管生命周期。

**死码**：`maybePrefetchNextPage`(`:1494-1500`) 唯一调用点 `:1504` 的条件 `typeof payload?.index === "number"` 恒假 —— `ClipItemList.vue` 四处 emit（`:1562`/`:2212`/`:2306`/`:2834`）全是裸 `emit("loadMore")`。连同 `NEXT_PAGE_PREFETCH_THRESHOLD`(`:527`) 一并删，`handleListLoadMore` 简化为直接 `loadMoreData()`。

composable 边界（已实测修正，**不要**用未经核对的区间）：`useClipQuery` = 510-634 + 691-807 + 862-970；`useClearDialog` = 635-690 + 972-1146（`getItemsByTab:972` 被 `loadMoreData:1474` 复用，留在 query 侧）；`usePinGroup` = 808-861 + 1220-1414（**不含 1196-1218**，`displayList:1206`/`currentShowList:1211` 是跨块共享 computed）；`useMergeCopy` = 391-509（`ClipItemListRef:390` 有 28 处跨块使用，留主文件按参数传入）；`useMainHotkeys` = 1967-2327；`useTabState` = 1769-1813 + 1832-1896。

### FileRichPreview.vue（1362 行）

可拆两块，二者零相互调用（已 grep 双向验证）：PDF 生命周期 `:143-152`+`:160-254`+`:690-981` → `src/hooks/usePdfPreview.js`；格式解析 `:431-663` → `src/utils/richPreviewLoaders.mjs`。拆后组件约 730-780 行（不是 500 —— style 段 272 行无拆分计划，是收益上限）。

**硬阻塞（原方案漏掉）**：`test-file-preview.mjs` 不是行为测试，`:209/:221/:260/:271/:356` 五处 `readFileSync('./src/cpns/FileRichPreview.vue')` 对源文件做正则断言。搬走 PDF 块 → `testPdfPreviewUsesLegacyBuild` / `testPdfPreviewUsesFastFirstPagePath` 立刻全红；搬走解析块 → 另外三个用例全红。**必须先改断言目标路径，再动源码。**

**去重只收窄到一个函数**：`FileRichPreview.vue:447-459` 与 `src/utils/textDocumentPreview.mjs:235-247` 的 `sanitizeHtml` 逐字相同，可安全下沉到 `src/utils/filePreview.mjs`（`sanitizePreviewHtml` 的宿主）。
> `loadMarkdown`/`loadAsciiDoc` **不是**逐字重复：两侧签名与返回结构都不同（`{type:'html'}` vs `{...createEmptyTextDocumentPreview, kind:'html'}`），只有 `new MarkdownIt({html:false,linkify:true,breaks:true})` 与 `asciidoctor.convert(..., {safe:'safe',backend:'html5',...})` 两个配置对象相同。只抽配置常量 + `renderMarkdownToHtml/renderAsciiDocToHtml` 两个纯函数，**合并整个函数会打断剪贴板文本预览的渲染分支**。

## S5 legacy JSON 兼容层惰性化

`src/global/initPlugin.js:1209-1210` 每次冷启动无条件 `new DB(dbPath); legacyDb.init()`，而已迁移的正常启动中 SQLite 仓库根本不碰它（`sqliteClipboardRepository.js:139-177`，`isJsonMigrationComplete()` 为真时整个 migrate 块跳过）。`legacyDb` 全文件只 4 处使用（`:1209`/`:1210`/`:1243`/`:1294`），仓库层 4 处中 3 处只需路径字符串（`:119`/`:300`）。

`:1192` 的 `jsonDbExists` 是死变量（只在 `:1206` 的 console.log 出现）；`:1207` 打印「使用 JSON 文件」但实际走 SQLite。

**附带发现的落盘错位**：`DB.init` `:321` 写入 `schemaVersion = 2` 后 `:322` 调 `updateDataBaseLocal()`，其 `debouncedWriteLocal`(`:117-125`) 目标是模块级 `db` —— 300ms 后 `db` 已是 SQLite 仓库，`schemaVersion` **永远回不到磁盘**，于是 `shouldMigrateJsonDb` 每次启动为真，`backupBeforeMigration`(`:145-149`) 每次冷启动整份复制一遍 JSON，备份文件名带 `Date.now()` 无限累积。且全仓 grep `unlinkSync|renameSync` 只命中 `blobStore.js:74-75`，**迁移成功后旧 JSON 从不删除**。
> **不要顺手修这个落盘错位**：修好后 DB.init 的规范化结果会真写回 JSON，改变文件 length 与 mtime，而 `getJsonSourceFingerprint`(`:118-131`) 正是 `path|length|mtime|sha1`，防抖写很可能落在 `markJsonMigrationComplete()` 之后，使已记录指纹当场失效 → 日后重新走一遍迁移，把用户已删除的旧条目整批复活。这直接踩「重复导入防护」。必须单独 commit 并先确认写序。

---

# 三、操作提速

## 一、运行时性能

| # | 问题 | 量化 | 位置 |
|---|---|---|---|
| R1 | index.less 被打进首屏 CSS 9 份 | 1,078,099 B 中 997,884 B（92.6%）是重复；删 8 处 scoped @import 后约 190KB（-82%）。file:// 加载无 gzip，是真实 CSSOM 构建量 | 见 simplify S3 |
| R2 | 重复复制触发全量 blob 读写 + 整库 export | 5MB 截图 = 5MB 同步读 + 5MB 同步写；`refreshCache` 内 `selectTagRows`(`:521-532`) 对收藏无 LIMIT 逐行 JSON.parse | `src/global/initPlugin.js:1444` → `sqliteClipboardRepository.js:806-808` → `:657-665` → `:659`(getById+hydrate) → `:661`(itemToParams→`blobStore.js:49-50` 原样写回) → `:662` → `:325-340`→`:351-356` |
| R3 | 启动 eager 读旧 JSON 全库 | `readFileSync`+`JSON.parse` 整个旧库（含全部 base64 图片）+ O(n·m) 收藏清理 + 逐张缩略图解码 + 每次启动一次全份备份复制，排在 `src/main.js:51` 的 `await initPlugin()` 内、mount 之前 | `src/global/initPlugin.js:1209-1210`；`:163-174`、`:210-215`、`:313-319` |
| R4 | 每次 keydown 重建 143 条 command-aware binding | 实测 13.6µs/次（占单键 16.6µs 的 82%），143 次对象分配 ×3 次展开；长按方向键 30 次/秒 = 每秒 4000+ 次分配 | `src/global/hotkeyRegistry.js:401` → `hotkeyBindings.js:54-56` → `commandDefaults.js:153-169` |
| R5 | when 表达式无 AST 缓存，排序比较器里重复 parse | `evaluateWhenExpression`(`whenExpression.js:127-130`) 每次 tokenize+parse；`keybindingResolver.js:14-22` 的 `whenSpecificity` 在比较器内被 O(n log n) 次重算 | 同上 |
| R6 | 降级态 300ms 轮询对剪贴板图片重做 base64 + MD5 | 原生监听程序默认缺失（仓库只有 `docs/clipboard-event-handler-win32.exe`，无 mac/linux；`scripts/utools-runtime-assets.mjs:323-334` 不拷贝任何二进制），`:241-244` 找不到即 `listening=false`，降级为 `addCommonListener`。5MB 截图每 300ms 重编码一次 ≈3.3 次/秒 | `src/global/initPlugin.js:1470-1477`、`:1160-1180`、`:1543-1556` |
| R7 | quick-paste 冷启动 flush 排在整个 Vue mount 之后 | 白付一次 442KB JS + 1.08MB CSS 的解析与首屏渲染（约 100~300ms）。执行链零 DOM 依赖，`window.db` 在 `initPlugin.js:1605` 已就绪 | `src/main.js:61`（应上移到 `:58` createApp 之前）；`quickPasteRuntime.js:352-399` |
| R8 | Setting.vue 静态 import 进首屏 chunk | 5607 行组件 + 58,680 B 独占 scoped Less 白背在入口。Setting.vue 不 `@import "../style"`，其样式可随 async chunk 干净分出 | `src/App.vue:15`；`src/views/Setting.vue:3071` |
| R9 | 设置页首开一次性建全部 117 行命令表 | `COMMAND_DEFINITIONS` 81 条 + `commandDefaults.js:106-113` 循环 36 条 = 117；四个面板全是 v-show 无一 v-if；每行约 4-5 个 ElTooltip ≈ 470~585 个实例 | `src/views/Setting.vue:47/134/589/750`、`:225`、`:1405` |
| R10 | `emptyDataBase` 漏清 `items_fts` | 目前靠启动无条件 rebuildFts 兜底；一旦把重建改条件式，孤儿行永久残留 | `sqliteClipboardRepository.js:810-816` |

**关于「每次启动全量重建 FTS 索引」**：代码事实成立（`:224-225` 无条件 `ftsEnabled=true; rebuildFts()`，`:450-465` 是 `DELETE` 全表 + 逐行 `db.run` INSERT，2N 次语句解析）。**但当前 wasm 未编译 FTS5，`:219` 建表已抛错，控制流到不了 `:225`，实际运行时开销为 0**（每次启动仅一次异常 + 一条 warn）。所以这是「未来启用 FTS 时的定时炸弹」，不是当前的性能损失 —— 不要按秒级阻塞去排优先级，但要在启用 FTS 的同一批改动里连同 R10 一起修。

**已排除，不要立项**：「首屏全程白屏」（`initPlugin.js:1195` 的 'checking' 经 `storageRuntimeStatus.js:62` 派发、`main.js:31` 补渲进度条，全程有可见进度）；「启动两次全库写盘各 100~400ms」（稳态启动为 0 次，四处 persistNow 全在迁移/建库分支内）；「660KB wasm 的 modulepreload」（dist/index.html 只预载 41KB 的 storage-sql.js）；「搜索无防抖导致单键 30 次同步 readFileSync」（`searchIndex.js:56-69` 使图片行几乎不会被关键词命中）；「跟滚路径每次按键 60~90 次强制样式计算」（`getScrollContainer` 走第一分支，逐级 `getComputedStyle` 回退路径在有数百条数据时不会进入）。

## 二、用户操作效率

| # | 问题 | 代价 | 位置 |
|---|---|---|---|
| U1 | 「清空最近 N 天/全部」每次最多删 30 条 | 清 3000 条需重复约 100 次「开对话框→选范围→确认」=300+ 次交互，每次触发一次全库 export 写盘；且每次都提示成功 | `Main.vue:1007`、`:1042`、`:1117-1124` |
| U2 | 收藏超 30 条后星标不显示、复制/编辑会静默取消收藏 | 不可逆数据丢失，无任何提示 | 见 fit A1 |
| U3 | 「快捷键配置管理」的运行源选择器不可点 | 多设备快捷键同步少一半入口 | `Setting.vue:966-969` |
| U4 | 抽屉拖拽排序不落盘 | 用户会反复重试的静默失败 | `ClipItemList.vue:217-225` |
| U5 | 「按标签搜索收藏」只搜最近 30 条 | 搜索框行为与预期不符 | `Main.vue:928-948` |
| U6 | 打开「快捷键配置管理」按 Esc 整页退出设置 | 丢失当前编辑上下文 | `Setting.vue:1348` / `:1509-1518` / `:2080-2105` / `:2967-2979` |
| U7 | 设置页首开 300~800ms 卡顿 | 见 R9 | 同上 |

## 三、修法要点（易踩坑处）

- **R2 快路径**：在 `updateItem` 内识别「patch 只含 updateTime/sourceApp/sourceWindowTitle」→ 直接 `UPDATE items SET ... WHERE id=?`，不 getById、不进 blobStore。**但必须保留 `refreshCache`**（`dataBase.data` 是主界面数据源，`Main.vue:1908/1924` 直读，`:1923` 的 800ms 轮询靠 `data[0].id` 变化触发刷新，跳过会导致「重复复制不置顶、界面不刷新」）。跳过 `upsertFts` 需加条件（`search_text` 由 `buildSearchIndex(item, getAliasMap())` 生成，依赖别名表）。必须同步 `clipboardRepository.js:322-323` 的 JSON fallback 分支。
  > 注：「整库 export 做两遍」不成立 —— `queuePersist` 有 120ms 去抖，`enrichSourceWindowInfoLater` 是 `setTimeout(0)`，必然合并成一次。真正重复两遍的是 blob 读写、upsertFts、refreshCache，且仅在文件来源场景才有第二轮（`initPlugin.js:1104` 早返回）。
- **R4/R5**：只在 `hotkeyRegistry.js:118` setBindings 内缓存 `getCommandAwareBindings` 结果即可吃掉 82% 开销，失效点唯一（`HotkeyProvider.vue:168` 是唯一调用方），零风险。后续做 shortcutId 分桶索引时必须保留三件事：`'*'` 通配绑定真实存在（`hotkeyBindings.js:110-111`）、`resolveWeight` 用的是**原始数组下标**不是桶内下标、`layer !== 'main' && !layerPriority.includes(layer)` 的过滤语义。
  > **驳回** MessageBox 布尔标志替代 `document.querySelector`：`:336-344` 的语义是「MessageBox 打开时吞掉所有按键」，标志漏更新会让 Esc 穿透到 uTools 宿主；调用点分散 17 处无法穷举；且已被 `:326-328` 的 repeat/isComposing 早退挡掉大部分高频场景。
- **R7 flush 上移**：Windows 路径仍走 `quickPasteRuntime.js:433-434` 的 120ms setTimeout，收益主要在 macOS/immediate 路径。同时应放宽 `pendingMaxAgeMs`（默认 5000，超时静默丢弃，既不粘贴也不 hideMainWindow、无提示），但**只放宽冷启动首次 flush**。
  > **驳回**「top 分支改缓存优先」：`pinTopRuntimeCache` 只由 `Main.vue:1261` 在 UI 挂载后写入，冷启动必为 null，收益为 0；且无 db 版本校验，缓存优先会在条目被取消置顶/删除后粘贴陈旧内容 —— `:294-308` 的 live 优先是刻意的正确性保证。
- **R6**：`pbpaste` 已有 `availableFormats` 短路（`:1161-1165`），剩余增量是「格式+尺寸与上次相同则跳过 toDataURL」，但同尺寸不同内容的截图会漏记，必须保留定期强制全量校验。
  > **驳回**「把 `Main.vue:1923` 的 800ms setInterval 改成 view-change 订阅」：全仓 `view-change` 只有 `initPlugin.js:348/:437` 两处 emit，SQLite 仓库写入时**完全不 emit**。删掉即主列表不再更新。必须先在 repository 写入路径补事件，再改 UI。
  > 二进制分发不是把文件放进 dist：查找路径是 `dbPath` 上级的 uTools 插件数据目录（`scripts/utools-runtime-assets.mjs:235-237`），要么首启释放+chmod 0755，要么改查找路径 —— 触碰 listener/preload 生成，须单独立项 + 实机验证。
- **R8**：改 `defineAsyncComponent` 后必须处理 `App.vue:20-27` 的 watch 在 `settingShown` 翻 true 的**同一 tick** 就 `activateLayer('setting')`，而 `Setting.vue:3030-3032` 要等 chunk 落地 —— 中间是「层已激活但无 handler」的按键黑洞。把 activateLayer 移到组件 onMounted，或配 loadingComponent 期间不激活层。
- **R9**：v-show→v-if 可行（草稿态在 setup 作用域内不会丢），但**「外面套 keep-alive」写法不成立** —— `:47/134/589/750` 是同一组件内的普通 `<div>`，keep-alive 只缓存组件实例，必须先抽出 Panel 组件。已验证 `:2729/2736/2746` 的 `activeTab='shortcut'` 后接 `focusShortcutSearch()`（内部 nextTick）在 v-if 下仍能拿到 input。
  > **驳回**把 `effectiveShortcutCommandResult`(`:1582`) 从 computed 改手动 ref：它依赖 setting/hotkeyOverrides/shortcutSyncDocument，sql.js 读只在依赖变更时触发一次并缓存，不是每次渲染；改手动会把「改完快捷键表格自动刷新」变成必须在每个写入点显式调用。`buildBindingOverrideKeyMap` 的 O(n²) 是 148×148≈2.2 万次比较，亚毫秒级，不构成可感知开销。

---

# 四、执行路线图

## P0 — 高收益低风险，可立即开工

| 优先级 | 动作 | 涉及文件 | 收益 | 成本 | 风险 | 验证方式 |
|---|---|---|---|---|---|---|
| P0-1 | `isSettingOverlayOpen` 布尔链加 `shortcutSyncDialogVisible.value \|\|`；`closeTopSettingOverlay` 按现有 if 模式补一个分支（放在 contextMenuDialogVisible 旁） | `src/views/Setting.vue:1509-1518`、`:2080-2105`（ref 定义 `:1348`） | 修掉「打开快捷键配置管理按 Esc 整页退出设置」，约 6 行 | S | 极低，纯新增分支 | uTools 实机：功能配置 → 快捷键配置管理 → Esc，应只关对话框 |
| P0-2 | `rowToItem` 补 `collected: row.collected === 1`；确认 `selectItems` 的 SELECT 列表含 collected | `src/storage/sqliteClipboardRepository.js:36-55` | 修好 `ClipItemList.vue:329-333` 的星标快通道，是 P0-3/P1-1 的前提 | S | 低（item 多一字段，星标由灰变亮属修复方向） | `node test-storage-query.js`、`node test-repository-batch.js`；实机看收藏 tab 第 31 条以后的 ⭐ |
| P0-3 | `isCollected` 改直查 SQL（保留签名）；`:651` 用 `existing.collected===true`、`:661` 用 `item.collected===true`、`:694` 用 `item.collected && !force`（复用 `:687` 已取回的行，避免 N+1） | `src/storage/sqliteClipboardRepository.js:764`、`:651`、`:661`、`:694`；`Main.vue:1415`、`:1719` | 修掉收藏超 30 条后被静默取消/误删的不可逆数据丢失 | S | 中：改变删除保护范围 → 影响 `Main.vue:1708` 删除锚点恢复链的 removed 计数 | `node test-repository-batch.js`、`node test-delete-anchor.mjs`；实机验证删除后光标位置、JSON fallback 分支（`clipboardRepository.js:232`）行为一致 |
| P0-4 | `registerElement.js` 注册 ElRadioGroup/ElRadioButton + 导入 `el-radio.css`/`el-radio-group.css`/`el-radio-button.css` 三个；顺带把 `Setting.vue:966-969` 的 `:label` 改 `:value`、文案放默认插槽（避免 2.13.1 的 useDeprecated 警告）；删 `Main.vue:256-257` 两个未使用导入 | `src/global/registerElement.js:21-59`、`src/views/Setting.vue:966-969`、`src/views/Main.vue:256-257` | 恢复 PROJECT_STATUS.md:42 里「选择公共运行源」的唯一 UI 入口 | S | 低；CSS 进 vendor-element-plus chunk，需确认不击穿 `chunkSizeWarningLimit(1900)` | `node_modules/.bin/vite build`；uTools 实机：单选可点 → 点「应用」→ 重进插件后值一致（覆盖 SQLite + dbStorage 两条链） |
| P0-5 | 删 8 处 SFC scoped `@import "../style"`（连同空壳 style 块）。**先删 5 个零局部规则的**：ClipItemRow.vue:343 / ClipSearch.vue:191 / ClipSwitch.vue:106 / ClipOperate.vue:44 / FileList.vue:28；再逐个截图核对 ClipFullData.vue:146 / Main.vue:2343 / ClipItemList.vue:3021 | 上述 8 文件 | 首屏 CSS 1,078,099 B → 约 190KB（-82%），冷启动 CSSOM 构建直接受益 | S | 中：`html .x` 对 element-plus 的相对权重下降一级，clip-search/clip-operate/setting 里针对 `.el-input/.el-select/.el-textarea/.el-tag` 的规则属高危 | `node_modules/.bin/vite build`（dist 被 gitignore，视觉回归不会报错）+ uTools 实机明暗两套主题各看一次搜索框、标签选择器、操作栏、`.clip-item-scroll` 是否仍在自身产生溢出 |
| P0-6 | 文档对齐：README.md:11 与 ARCHITECTURE.md:29/128/153/196/650 去掉 FTS5，改「LIKE 子串匹配 + search_text 冗余列」；README.md:12 与 docs/用户简明说明.md:14 的「虚拟滚动」改「分页加载：初始 15 条（换 Tab 预取 45），触底每次追加 15 条 + 全量 v-for」；README.md:9/54 的「前台窗口标题」收敛为「文件路径来源」并修正过期行号引用 | README.md、docs/用户简明说明.md、vibe/knowledge/ARCHITECTURE.md | 消除 6 条失实承诺中的 3 条，零运行时风险 | S | 无运行时风险；措辞需与 `vibe/rules/project.md:39` 的受保护行为项对齐，走 rule-change-consistency | 无需构建；文档评审 |
| P0-7 | `ftsEnabled` 真值上报到 storageRuntimeStatus，设置页可见；`:216-229` 加注释说明「当前 wasm 未编译 FTS5，路径恒不启用」 | `src/storage/storageRuntimeStatus.js`、`sqliteClipboardRepository.js:216-229` | 降级不再无声 | S | 低 | `node test-storage-runtime-status.js` |
| P0-8 | `setBindings` 内缓存 `getCommandAwareBindings(bindings)` 为模块级变量，`dispatch:401` 读缓存 | `src/global/hotkeyRegistry.js:118`、`:401` | 单键 16.6µs → 约 3µs（-82%），长按方向键每秒少 4000+ 次对象分配 | S | 低：失效点唯一（`HotkeyProvider.vue:168` 是唯一调用方），但必须确认 `:174-176` 的 focus / BINDINGS_UPDATED / MACROS_UPDATED 三条刷新链与 `:188-191` HMR 分支都经由 setBindings | `node test-shortcut-command-system.js`；实机验证「设置页改完键切回主界面立即生效」 |
| P0-9 | `flushPendingQuickPasteActions()` 从 `main.js:61` 上移到 `:58` createApp 之前；放宽冷启动首次 flush 的 `pendingMaxAgeMs`，超时丢弃时至少 `hideQuickPasteWindow()` + 提示 | `src/main.js:61`、`src/global/quickPasteRuntime.js:440/:445`、`pluginEnterHandlers.js:53-59` | 冷启动 quick-paste 少等一整个 Vue mount（约 100~300ms，macOS 路径最明显） | S | 中：paste 在 mount 前触发，`setExitingPluginFlag` 的 80ms 窗口与组件挂载重叠（`ClipItemList.vue:1088/:2955` 已有 `__isExitingPlugin` 守卫）；放宽超时会增加「已放弃的热键被补执行」概率 | uTools 实机 macOS + Windows 各验一次「冷启动热键 → 静默粘贴 → 窗口不闪现」 |
| P0-10 | 删死码批 1 + 批 2 + 批 3（约 1650 行），同步 ARCHITECTURE.md:475/:725/:743 与 technical-details.md:16 | 见 simplify S2 全部文件清单 | src 减 5.4%，grep 面显著变干净；消除「旧 JSON→uTools DB 迁移链」的误导 | S | 低（全部在 Vite 构建图外，dist 无对应 chunk）；风险在文档悬空引用 | `node_modules/.bin/vite build`、`node test-compile.js`、`node test-syntax.js`；PROJECT_STATUS 记「旧 JSON→uTools DB 迁移/回滚能力移除」 |
| P0-11 | 死配置清理：删 `Setting.vue:2908` payload 的 `drawerOrder`（**保留 `:1749`**）、删 `Setting.vue:1980-1992` 并把 `:1621-1622` 帮助文案改成与实现一致的「检测到冲突时二次确认」、`pnpm remove @tanstack/vue-virtual` + 删 `vite.config.js:32-34`、修 `ClipItemList.vue:1525` 的过时注释 | 上述位置 | 消除 3 条假语义链与 1 个死依赖 | S | 低；`Setting.vue:1749` 误删会让设置页右键顺序预览失序 | `node_modules/.bin/vite build`（确认产物无变化，dist 本就无 vendor-virtual chunk） |
| P0-12 | 抽屉拖拽二选一：(a) 删 `ClipDrawerMenu.vue:16-19` 拖拽属性 + `:44` reorder emit + `:97-109` onDrop + `ClipItemList.vue:1443-1447` 死函数；或 (b) 新增与设置页同源的落盘函数（以 `operations` 全量为基准 + `.filter(row => row.orderable !== false)`）再绑 `@reorder` | `src/cpns/ClipDrawerMenu.vue`、`src/cpns/ClipItemList.vue:217-225`、`:1443-1447` | 消除「拖完看着变了、重开就复原」的静默失败 | S | (a) 极低；(b) 中：双真相源（`Setting.vue:1738` 只在 setup 读一次 drawer.order，抽屉写入后设置页保存会用旧快照覆盖）+ 序号快捷执行 c-a-1~9 与抽屉共用菜单数据源 | uTools 实机：拖拽 → 关抽屉 → 重开 → 重启插件；并验证序号直选落到同一项 |

## P1 — 需要设计的中型重构

| 优先级 | 动作 | 涉及文件 | 收益 | 成本 | 风险 | 验证方式 |
|---|---|---|---|---|---|---|
| P1-1 | 仓库层新增 `removeByRange({tab, range, collectTag, excludeLocked})`：事务内 `SELECT id, data_path FROM items WHERE collected=0 AND (locked=0 OR $force) [AND type=?] [AND update_time>=?]`，逐条 `blobStore.removeForItem` → `DELETE items` + `DELETE items_fts` → `refreshCache`；**返回真实 id 列表**而非计数 | `src/storage/sqliteClipboardRepository.js`（参照 `:676-713`）、`src/views/Main.vue:1007`、`:1117-1124` | 「清空全部」从 O(N/30) 次交互降到 1 次，3000 条从 300+ 次点击降到一次 | M | 中高：`Main.vue:1034` 依赖 id 同步 showList/collectBlockList/pinnedMap/pinGroup（`:1292-1305`），只回计数会让可见列表与库脱节；大事务 + 一次 `db.export()` 可能阻塞 UI，需分批提交 + 进度回调 | `node test-repository-batch.js`、`node test-delete-anchor.mjs`、`node test-storage-query.js`；实机：200+ 条历史点「清空全部」验证实际删除数、锁定项被跳过、blob 无孤儿文件 |
| P1-2 | **收藏页清空必须走 UPDATE 不走 DELETE**：新增 `removeCollectsByRange`，语义仍是「取消收藏」（`:753 UPDATE items SET collected=0`） | `src/views/Main.vue:1042`、`:1070-1072`；`sqliteClipboardRepository.js:748-762` | 突破 30 条上限同时不改变语义 | S | 高（若误做成 DELETE 即数据丢失级行为变更） | 同上 + 实机确认「清空收藏」后条目仍在历史中 |
| P1-3 | maxsize/maxage 下沉到 SQLite 仓库：**保留** `initPlugin.js:300-307`/`:407-427`（前者影响迁移导入集合，后者是 json-fallback 唯一实现），只在仓库补等价实现；豁免用 SQL 列（内外都排除 locked），删除复用 `:698`/`:706-708`/`:710` 清理链路；addItem 内加阈值/节流 | `src/storage/sqliteClipboardRepository.js`、`src/global/readSetting.js:99-100/:125-126`、`src/data/setting.json:4-5` | 兑现 README.md:52；同时抑制库体积无界增长（每次复制都要付 `db.export()` 整库序列化） | M | 中：在 init 末尾删数据会改变启动耗时且此时 refreshCache 未建缓存；分期上线（先 maxage，观察一版再开 maxsize） | `node test-repository-batch.js`、`node test-json-migration.js`；实机验证收藏与锁定项不被清理 |
| P1-4 | `updateItem` 快路径：patch 只含 updateTime/sourceApp/sourceWindowTitle 时走白名单列 UPDATE，不 getById、不进 blobStore；**保留 refreshCache**；`upsertFts` 加跳过条件；同步 `clipboardRepository.js:322-323` 的 fallback | `src/storage/sqliteClipboardRepository.js:657-665`、`:806-808`；`src/storage/clipboardRepository.js:322-323` | 重复复制 5MB 截图从「5MB 读 + 5MB 写 + 整库 export」降到「一条 UPDATE + 一次 export」，热路径从几百 ms 到个位数 ms | M | 中：跳过 refreshCache → 重复复制不置顶、SQLite+轮询模式下列表不刷新；误判含 data 的 patch → data 与 data_path 不一致（存储一致性事故） | `node test-storage-query.js`、`node test-image-payload-path.js`；实机验证大图(>5MB) 与 5000+ 收藏两种极端下的耗时 |
| P1-5 | legacy JSON 惰性化：`:1209-1210` 改 `createLegacyDb()` 工厂；仓库构造参数增 `legacyJsonPath` 供 `:119`/`:300` 使用；`:382-383` 与 `:1294` 按需调用；删 `:1192` 死变量与 `:1207` 误导日志 | `src/global/initPlugin.js:1192/:1207/:1209-1210/:1243/:1294`、`src/storage/sqliteClipboardRepository.js:92/:119/:300/:382-383` | 稳态启动省掉一次全量 JSON readFileSync+parse + O(n·m) 清理 + 逐张缩略图解码 + 每次冷启动一份全量备份复制 | M | 中高：`:1294` 漏改 → SQLite 三次重试全失败时白屏；全新安装不再自动生成空 JSON（`DB.init:333-335`），需确认无外部依赖；fs.watch 副作用消失（净收益） | `node test-json-migration.js`、`node test-storage-runtime-status.js`；五场景实机：全新安装 / 仅旧 JSON 首迁 / 已迁移正常启动（应观察到无 JSON 读盘）/ 破坏 .sqlite 触发降级 / 设置页存储状态区四场景显示 |
| P1-6 | 删来源信息死码：`initPlugin.js:1065-1113` + `:1431` 调用点 | `src/global/initPlugin.js` | 每次复制少一次无谓 `db.updateItem`（整轮事务 + blob 重写 + export） | S | 低（无其它调用方；不影响 sourcePaths/fromFileSource/hasSourceInfo 三个真被消费的字段） | `node test-compile.js`；实机复制文件验证 sourcePaths 仍正确 |
| P1-7 | FileRichPreview 拆分：**先改** `test-file-preview.mjs:209/221/260/271/356` 五处 readFileSync 断言目标，再抽 PDF（`:143-152`+`:160-254`+`:690-981`）与解析（`:431-663`）；`sanitizeHtml` 下沉到 `src/utils/filePreview.mjs` | `src/cpns/FileRichPreview.vue`、`src/utils/textDocumentPreview.mjs:235-247`、`test-file-preview.mjs` | 1362 → 约 730-780 行；消除 sanitizeHtml 双份配置漂移 | M | 中：不先改断言直接 CI 全红；`getRuntimeExports()`(`:305`) 要随 PDF 块一起搬或注入，漏搬会在实机静默退回 fallback；objectURL 账本(`:215-231`)与 `releasePdfDocument(:244)` 挂 onUnmounted，搬进 hook 后须重新绑生命周期否则 blob URL 泄漏 | `node test-file-preview.mjs`、`node test-preview-layout.mjs`、`node test-preview-scroll.mjs`；实机 Shift 悬停预览 PDF/Markdown/表格各一次 |
| P1-8 | `App.vue:15` 改 `defineAsyncComponent`，并把 `activateLayer('setting')` 时机对齐组件挂载 | `src/App.vue:15`、`:20-27`；`src/views/Setting.vue:3030-3032` | 首屏 chunk 少一个 5607 行组件 + 58.6KB Less 随 async CSS 分出 | S | 中：会打开「setting 层已激活但 keydown handler 未挂载」的按键黑洞窗口 | `node_modules/.bin/vite build` 看 chunk 分裂；实机：点设置后立刻按 ↑↓/Esc |
| P1-9 | `Main.vue` onUnmounted 上提（**通过抽 useMainHotkeys 让 composable 自管 `keyDownCallBack` 与 addEventListener/removeEventListener 成对注册**）+ 删 `maybePrefetchNextPage(:1494-1500)` 与 `NEXT_PAGE_PREFETCH_THRESHOLD(:527)` | `src/views/Main.vue:1814`、`:1979`、`:2012`、`:2329-2339`、`:1494-1508`、`:527` | 消除监听器注销依赖侥幸；删两处死码 | M | 高陷阱：直接原地上提 onUnmounted 会因 `keyDownCallBack` 未定义抛 ReferenceError，组件挂不起来；提前于 `nextTick(:2327)` 注册会改变与 ClipItemList/HotkeyProvider 三个 capture 监听器的抢占关系 | `node test-shortcut-command-system.js`；实机走一遍切 tab / 搜索 / 删除 / 触底加载 / 清空对话框 / 置顶粘贴，并确认离开插件后 document 上无残留 keydown |
| P1-10 | `emptyDataBase` 补 `DELETE FROM items_fts`；`ensureSchema` 的 rebuildFts 改条件式（`sqlite_master` 存在性 + meta `fts_build_version`）；rebuildFts 内改预编译 Statement + 事务；保留手动「重建搜索索引」入口 | `src/storage/sqliteClipboardRepository.js:810-816`、`:216-229`、`:450-465` | 启用 FTS 后启动不再 O(N)；消除孤儿行只增不减 | M | 中：条件化后丢失「无条件重建」这层自愈能力，任何绕过 upsertFts 的新写路径不再自动修复 | `node test-storage-query.js`；当前 wasm 下需人工构造 fts 可用环境验证 |
| P1-11 | `list.navigate.left` 定夺：先修 label/description 三处语义打架，再决定补键位（对照 hotkeyBindings.js 全部 144 条 + `shortcutReservations.js:105` 双向查重，**不能用 `left`**）或判废删除 | `src/global/commandDefaults.js:80`、`hotkeyLabels.js:101`、`ClipItemList.vue:2340-2343/:2742` | 消除一条半成品能力 | S | 中：判废删除会让存量组合命令走 `commandMacro.js:231-260` 的 missing-handler 失败分支，须先在 macroCommandOptions 下线并给迁移/告警 | `node test-shortcut-command-system.js`；实机验证方向键导航与删除锚点未漂移 |

## P2 — 大型 / 需实机验证

| 优先级 | 动作 | 涉及文件 | 收益 | 成本 | 风险 | 验证方式 |
|---|---|---|---|---|---|---|
| P2-1 | Setting.vue 拆分：ShortcutReservationTable → 7 Dialog → 4 Panel → composable。**样式随组件迁移，不按行号切文件**；composable 成员动手前按符号重新定位 | `src/views/Setting.vue` 全文 | 5607 → 约 300 行壳；改一个页签不再触碰其余三个 | L | 高：2536 行 scoped Less 按行号切会大面积掉样式且不报错；跨块共享 ref（`:1346`/`:1399`/`:1400`/`:1405`）用值传递会静默断响应式 | 每步 `node_modules/.bin/vite build` + 实机走「改键」与「自定义功能」两条主流程；存储状态区四个 v-if 分支（`:88/:108/:118/:124`）逐一比对 |
| P2-2 | Setting 四页签 v-show → v-if（**须在 Panel 抽完之后**，keep-alive 不能包裸 div） | `src/views/Setting.vue:47/134/589/750` | 首开只建当前面板，省 470~585 个 ElTooltip 实例（300~800ms） | M | 高：`document.getElementById('database-path')`(`:2951`) 等 DOM 存在性假设断裂；权衡 —— 每次左右键切页签会重建，keep-alive 配错反而更慢 | 实机逐条走「功能页跳快捷键并聚焦搜索框」（`:2729/:2736/:2746` → `focusShortcutSearch:1966`）与 setting.scroll/tab 四个 command |
| P2-3 | 命令表虚拟化（117 行 → 可视 15~20 行） | `src/views/Setting.vue:225`、`:216`(grid 表头对齐)、`:3001`(ctrl+F 定位) | 设置页首开卡顿降一个数量级 | L | 高：虚拟化需绝对定位行，与 `shortcut-list--grid` 的 CSS grid 表头/表体对齐冲突；离屏行 DOM 消失会打断任何 querySelector 定位逻辑 | `node test-shortcut-command-system.js` + 实机搜索/定位/滚动 |
| P2-4 | Main.vue 六个 composable 拆分（按 simplify S4 已实测修正的边界，**不要用未核对的区间**） | `src/views/Main.vue` | 2588 → 约 800 行；是 P1-1 收口的落点 | L | 高：按错误边界搬会带走 `displayList:1206`/`currentShowList:1211`（被删除恢复、快捷粘贴缓存、搜索计数依赖）或 `watch(clearRange):668`；`prepareDeleteRecovery` 必须先于 `removeVisibleItemsByIds`（现状 `:1641/:1708/:1735/:2267/:2311`） | `node test-delete-anchor.mjs`；实机验证删除后高亮落点、清空对话框方向键导航 |
| P2-5 | 原生监听程序分发：首启把 `clipboard-event-handler-*` 释放到 dbPath 上级目录并 chmod 0755（或改 listener 查找路径）；补 mac/linux 二进制 | `scripts/utools-runtime-assets.mjs:229-244`、`:323-334` | 消除 300ms 轮询主路径与图片重复 base64+MD5 的常驻 CPU 占用 | L | 高：触碰 `vibe/rules/project.md:28/31` 点名的 preload/listener 生成；二进制权限、杀软拦截、路径大小写均需实测；轮询延迟变化会影响 `isRestoringClipboard` 防回环时序(`initPlugin.js:1383-1394`) | uTools 实机三平台；验证不重复记录、不漏记 |
| P2-6 | 在 repository 写入路径补 `view-change`/mutationVersion 事件，再把 `Main.vue:1923` 的 800ms setInterval 改事件订阅并补 onUnmounted 清理 | `src/storage/sqliteClipboardRepository.js`、`src/views/Main.vue:1914`、`:1923-1932` | 去掉一个永不清除的常驻定时器 | M | 高：先改 UI 会直接断掉 SQLite 模式下主列表的唯一刷新机制，并连带影响 `ClipSwitch.vue:91`、`TagSearchModal.vue:299` | 实机验证复制后列表即时刷新、跨 tab 切换、离开插件后无残留定时器 |
| P2-7 | FTS 方案定夺：若要倒排索引，当前 wasm 可直接建 fts4/fts3（零依赖、不换 wasm、不影响包体积），**但必须先有 CJK bigram/trigram 预处理** —— 实测 fts4 simple 分词下 `MATCH '好世'` 匹配不到 `你好世界`，而现状 LIKE 能命中 | `src/storage/sqliteClipboardRepository.js:219`、`:590`、`:602-606`；`scripts/perf-baseline.mjs` | 大数据量搜索从全表 LIKE 变索引匹配 | L | 高：无 CJK 分词直接切 = 中文子串搜索实打实退化；搜索框是热路径，牵动 reveal/IME 保护 | 先给 `scripts/perf-baseline.mjs` 加一条直压 `querySql` 的用例（目前只覆盖 JSON 降级路径的 `searchIndex.js`）并断言 ftsEnabled；实机对中英文混合关键词逐条对拍 |
| P2-8 | 真虚拟滚动 或 正式声明不做 | `src/cpns/ClipItemList.vue:16-17`、`:1544-1551`、`:1553-1566`、`:1714-1730`；`src/hooks/useVirtualListScroll.js:24-30`、`:242`、`:353-366` | 长列表不再全量 render + patch | L | 高：`useVirtualListScroll` 的滚动主通路是 `querySelector('.clip-item[data-index=N]')` 的真实节点 metrics，窗口化后离屏节点不存在，整条通路要重写；直接撞 `vibe/rules/project.md:39` 防误改条款 | 建议先只做低成本改良：把 `lockedRenderVersion` 从 `:17` 的 key 里拿掉、改为在 `syncShowListLockedState(:1961-1971)` 里做单条引用替换（showList 浅拷贝 + replace），消除「锁定一条导致整表卸载重建」；再评估是否需要真虚拟化 |

---

# 五、经验证不要动的地方

## 一、经验证不要动的代码（动了会退化或引入 bug）

| 位置 | 为什么不要动 |
|---|---|
| `src/global/initPlugin.js:300-307`、`:407-427` | **不是不可达死码**。`:407-427` 是 json-fallback 路径下 maxsize 的唯一实现（`clipboardRepository.js:139-140` 直接委派给 legacy `DB.addItem`）；`:300-307` 影响 JSON→SQLite 的迁移导入集合。删掉会违反 `vibe/rules/project.md:36`。 |
| `src/storage/sqliteClipboardRepository.js:202-203`（source_app / source_window_title 两列）、`:52-53`、`:83-84`、`:404-428` | 两列写在初始 CREATE TABLE 里（不像 `data_path` 走 ensureColumn），存量库已带且 `NOT NULL DEFAULT ''`。摘掉只影响新建库，导致新旧库 schema 分叉。恒空 TEXT 列留着零成本。删来源信息**只删采集侧**（`initPlugin.js:1065-1113`）。 |
| `src/storage/sqliteClipboardRepository.js:216-229`、`:436-450`（FTS 死路径） | 纯早退死码、运行时零开销。删掉会牵动 `removeItems:681` 与 `querySql:590/596-600` 的分支，且丢掉未来切 fts4/自建 wasm 的接口。保留 + 加注释即可。 |
| `src/views/Setting.vue:1749` 的 `drawerOrder` | 是 `buildContextMenuActionRows` 的**活入参**。删了设置页右键菜单顺序预览立即失序。要删的只有 `:2908` payload 里的那个。 |
| `setting.syncWithUTools`（`readSetting.js:64-65`、`shortcutStore.js:214-216/:239/:375`） | `:64-65` 只做类型兜底，**不是**强制置 false。存量已持久化 `true` 的用户两条分支仍可达，直接删会让其快捷键 override 读取路径从 UTOOLS_SYNC 静默切到 SQLite/setting，可能丢失已保存的自定义快捷键。须先跑一版无条件迁移。同时 `SHORTCUT_STORAGE_MODE_UTOOLS_SYNC` 常量仍被 `:238` 的 PUBLIC 分支使用，不可一并删。 |
| `src/views/Main.vue:515` `const showList = shallowRef([])` | 刻意的性能取舍。改成深响应会让每次 `loadMoreData` 追加都付全量 proxy 化成本，并破坏 `ClipItemList.vue:420-423/:1952-1958` 的「直接改原对象 + 手动触发」写法。 |
| `src/views/Main.vue:294-308`（quick-paste top 分支的 live 优先） | 刻意的正确性保证。`pinTopRuntimeCache` 只由 `Main.vue:1261` 单向写入、无 db 版本校验，改缓存优先会在条目被取消置顶/删除后粘贴陈旧内容；且冷启动时缓存必为 null，零收益。 |
| `src/global/hotkeyRegistry.js:336-344` 的 `document.querySelector('.el-overlay .el-message-box')` | 语义不是「Esc 关弹窗」而是「MessageBox 打开时吞掉所有按键」。改布尔标志一旦漏更新，Esc 会穿透到 uTools 宿主导致隐藏/退窗；调用点分散 17 处无法穷举。且已被 `:326-328` 的 repeat/isComposing 早退挡掉大部分场景。 |
| `src/global/hotkeyRegistry.js:328` 的 `isComposing` 早退 | 搜索框 IME 保护的一部分，任何改动不得移动它相对 `:326-344` 的位置。 |
| `src/global/hotkeyRegistry.js:367-392`（shadow 双解析器） | 有文档记载的只读对照诊断（`vibe/specs/260610-shortcuts-redesign/9YG2-….ad:32`），被 `window.__EZCLIPBOARD_HOTKEY_SHADOW__` 挡住，对性能零贡献。 |
| `src/views/Setting.vue:1582` `effectiveShortcutCommandResult` | 是 computed，sql.js 读只在依赖变更时触发一次并缓存。改成手动 ref 会把「改完快捷键表格自动刷新」变成必须在每个写入点显式调用，极易漏掉。`buildBindingOverrideKeyMap` 的 O(n²) 是 148×148 亚毫秒级，不构成开销。 |
| `src/global/initPlugin.js:117-125` `debouncedWriteLocal` 的落盘目标 | 确实错位（`schemaVersion` 永不落盘），但**不要顺手修**：修好后写回会改变 JSON 的 length/mtime，而 `getJsonSourceFingerprint(:118-131)` 正是 `path\|length\|mtime\|sha1`，防抖写可能落在 `markJsonMigrationComplete()` 之后使指纹当场失效 → 日后重走迁移，把用户已删除的条目整批复活。须单独 commit 并先确认写序。 |
| `src/style/index.less:66/:121` 的 `.import()` 双展开 | 删掉会把 cpns 规则从 (1,1,0) 降到 (0,1,0)，被 `Setting.vue:3071` 起的 scoped + `:deep()` 反超，设置页级联整体翻转。且 `src/style/cpns/` 下 94 处 `fade(@var, x%)` 无法直接改 `var(--*)`。这是独立 L 级任务，不能与删 scoped @import 同批。 |
| `src/style/cpns/collect-block.less` | 是孤儿且当前**从未生效**，「接回」等于给线上界面新增一批不存在的样式，属视觉变更不是清理。 |
| `src/main.js:7` `import './style/index.less'` | 弹窗（el-dialog teleport 到 body）依赖这条全局链（EM-2026-06-13）。异步化 Setting 时不要把它挪进 Setting.vue。 |
| `src/cpns/ClipItemList.vue:3023-3024` 与 `src/style/index.less:132-135` 的注释 | EM-2026-04-06-scroll-path：`.clip-item-scroll` 必须由确定高度链撑起，否则滚动退化到 document。改 CSS 时不得改动该元素的 height/overflow 声明。 |

## 二、`vibe/rules/project.md:39` 明列的受保护行为（改动需先证明不破坏）

搜索 reveal / IME 保护、`.clip-item-scroll` 滚动容器、删除锚点恢复、虚拟（分页）滚动、ClipSwitch 顶栏布局、`.clip-break` 占位、设置页存储状态区（`Setting.vue:88/:108/:118/:124` 四个 v-if 分支的 mode/migrationStatus/fallback 源/errorMessage 必须原样保留，`refreshStorageStatus` 的 `STORAGE_STATUS_EVENT` 订阅 `:3009` 不得改动）。

## 三、已验证成立、不要改的执行顺序约束

- `Main.vue:957-966`：`updateShowList` 内 toTop 分支的 `setActiveIndex(0)` → `syncActiveIndexVisibility(0, {edge-align/start/forceScroll})` → `window.toTop()` 顺序不得改。
- `Main.vue:2327`：`registerMainHotkeyFeatures` 必须仍在 `nextTick` 内注册。
- 删除链路：`prepareDeleteRecovery` 必须先于 `removeVisibleItemsByIds`（现状 `:1641/:1708/:1735/:2267/:2311`），否则 `ClipItemList.vue:2232-2246` 的 showList watch 拿不到 anchor，会走 `:2244` 兜底跟滚，删除后高亮跳动。
- 任何删除实现必须复用 `sqliteClipboardRepository.js:698`(blobStore.removeForItem) → `:706-708`(DELETE items_fts) → `:710`(refreshCache) 完整链路，缺一即产生孤儿资产或脏索引。
- 收藏/清空/批删的豁免判定一律用 SQL 列（`collected = 0` / `locked = 0`），**永远不要在 JS 侧回退到 `this.isCollected`**。

## 四、已排除的「问题」，不要按它们立项

- 首屏「全程白屏」——`initPlugin.js:1195` 的 'checking' 经 `storageRuntimeStatus.js:62` 派发、`main.js:31` 补渲进度条，wasm 编译/读盘/缓存重建全程有可见进度。
- 「启动两次全库写盘各 100~400ms」——稳态启动 0 次，四处 persistNow 全在迁移或建库分支内。
- 「dist/index.html modulepreload 了 660KB wasm」——实际只预载 41KB 的 storage-sql.js。
- 「搜索无防抖导致单键 30 次同步 readFileSync / 30~120ms」——`searchIndex.js:56-69` 使图片行几乎不会被关键词命中；「每条一次 dbStorage 别名读」只在星标/JSON fallback 分支，SQL 路径在 `Main.vue:905` 已返回。
- 「跟滚路径每次按键 60~90 次强制样式计算」——`getScrollContainer` 走第一分支，逐级 `getComputedStyle` 回退在有数百条数据时不会进入。
- 「quick-paste-top 被上次搜索词/锁定筛选过滤是 bug」——`vibe/knowledge/quick-paste-runtime.md:9/:58/:61` 显式规定的产品语义；且 Esc 与粘贴退出两条主路径都会经 `Main.vue:1944-1947` → `persistLastActiveContext` 自动清空 keyword。
- 「改一个快捷键要 9 步、两级提交语义不统一」——`vibe/specs/260613-SettingUiModify/260613-shortcut-multi-key-plan.md:13/51/123/141` 把「合并语义 + 仅顶栏保存」写成既定设计并已勾选验收。如确有痛点，走 spec 变更而非当作缺陷。
- `resolveItemAlias`（别名回退链两份优先级相反）——全仓无调用方，粘贴路径不经过它，是死代码不是行为不一致。
- `clearLayers` ——有 8 处测试调用，不是零调用，删除会打断验收网。

---

# 六、附录 A：确认成立的 25 条发现（逐条取证）

## A1. [fit] 收藏判定只覆盖最新 30 条：第 31 条以后的收藏会被复制/编辑静默取消，并被清空/删除真删

- 位置: `src/storage/sqliteClipboardRepository.js:764`
- 成本/风险/置信: S / low：改动集中在 3 个方法，且都有更准的现成数据源；回归面是收藏标记显示与删除保护，test-repository-batch.js 已覆盖批量删除/锁。 / high
- 取证: 逐行复核，取证基本属实，仅个别行号需微调：
- src/storage/sqliteClipboardRepository.js:14 `const TAB_CACHE_LIMIT = 30`（属实）
- :764-765 `isCollected(id) { return this.collectIdSet.has(id) }`（原文写 :764，方法起始行确为 764）
- :518 `this.collectIdSet = new Set(this.dataBase.collects)` 是 collectIdSet 唯一赋值点（另有 :104 构造函数初始化为空 Set），来源 :494 `selectItems('collected = 1', {}, 'collect_time DESC, update_time DESC', TAB_CACHE_LIMIT)`（属实）
- :651 `this.upsertItemRaw(next, existing ? this.isCollected(item.id) : false)`（属实）
- :661 `this.upsertItemRaw({ ...item, ...patch, ... }, this.isCollected(id))`（属实）
- :694 `if (this.isCollected(item.id) && !force) { skippedCollected++; return }`（原文写 :697，实际 694）
- :415 UPSERT 明写 `collected=excluded.collected`（属实，覆盖原值成立）
- 热路径确认：src/global/initPlugin.js:1444 `if (db.updateItemViaId(itemId))` → src/storage/sqliteClipboardRepository.js:806 `updateItemViaId(id) { return this.updateItem(id, { updateTime: Date.now() }) }` → :661，链路闭合
- 主存储确为 SQLite 实现：src/global/initPlugin.js:1241 createSQLiteClipboardRepository，失败才在 :1294 回退 JSON facade
- UI 侧属实：src/views/Main.vue:1415-1419 collectedIds 由 getCollects() 构造（:772 返回 dataBase.collectData，同为 30 条）→ src/cpns/ClipItemList.vue:31 / :329-337
- 补充一处原文未提的同源失真：src/views/Main.vue:1719 `list.filter((item) => !window.db.isCollected(item.id))`（清空/批量删除的前置过滤）同样吃这个 30 条快照
- 反证补充：:493/:494 之外没有任何地方向 collectIdSet 写入，addCollect(:734)/removeCollects(:753) 也只是 UPDATE 后 refreshCache，因此第 31 条以后的收藏确实不在集合里
- 影响: 直接违反 README.md:8「收藏分离：收藏独立存储并保留收藏时间，可锁定避免误删」与 docs/用户简明说明.md:9「收藏：持久化」。收藏超过 30 条后：重新复制一条老收藏、或改它的标签/备注/别名，都会静默把它踢出收藏；收藏 tab 第 31 条以后不显示 ⭐；历史清空/批量删除对这些收藏的保护完全失效——这是不可逆的用户数据丢失，且没有任何提示。
- 落地: 结论方向正确，但原提议里有一处硬伤必须先修，否则照做会把「30 条失真」升级成「100% 全丢」：

rowToItem(:36-55) 根本没有映射 `collected` 字段（SELECT * 拿到了 row.collected，但映射对象里没有它）。因此：
- addItem 改成 `existing.collected` → 恒为 undefined → 所有重复复制的条目一律写 collected=0，全部收藏被取消；
- updateItem 改成 `item.collected` → 同上；
- removeItems「用 :687 已取到行的 collected 字段」→ 原文所谓「字段现成」是错的，`item.collected` 恒为 undefined → 收藏保护完全失效，比现状更糟。

修正后的落地顺序：
1) 先在 src/storage/sqliteClipboardRepository.js:36 的 rowToItem 里补 `collected: row.collected === 1`（这是全部三处修复的前提）。注意补完后要检查所有 upsertItemRaw 调用点——它的第二参数是显式 collected，不会误读 item.collected，安全；但 blobStore.prepareForDb / itemToParams(:57) 也不会受影响。
2) isCollected 改为直接查库：`SELECT 1 FROM items WHERE id=$id AND collected=1`（保留方法签名，facade src/storage/clipboardRepository.js:232 与 ClipItemList.vue:336 的调用点不变）。
3) addItem :651 用 `existing ? existing.collected === true : false`；updateItem :661 用 `item.collected === true`（此时字段已存在）。
4) removeItems :694 用 `item.collected && !force`。
5) Main.vue:1415 的 collectedIds 与 Main.vue:1719 的 isCollected 过滤，改为读每行的 collected 字段；ClipItemList.vue:329-333 已经优先读 `item.collected`（typeof === 'boolean'），只要 rowToItem 补上字段，UI 侧几乎零改动即可自动正确——这是最省事的切入点。
6) 顺带修正原文成本描述：仓库根目录的 ./test-repository-batch.js（不在 scripts/ 下）只用 legacyDb stub 测 JSON facade 的 removeItems 转发（:19-47），对 SQLite 的收藏保护零覆盖，不能当作「已有回归网」。
- 回归面: 1) rowToItem 补 collected 会让 item 对象多一个字段，ClipItemList.vue:329-333 的 `typeof item.collected === 'boolean'` 分支会立刻从「不生效」变成「生效」——这是行为变更（收藏 tab 第 31 条以后的 ⭐ 会由灰变亮），属于修复方向但需实机确认星标/取消收藏的即时更新逻辑不打架。
2) isCollected 改查库后每次删除会多 N 次单行查询（removeItems 循环内），批量删除大集合时有 N+1 开销；建议按 :687 已取回的行字段判断，避免逐条查库。
3) 触碰 removeItems 会影响 Main.vue 的删除锚点恢复链（Main.vue:1708 prepareDeleteRecovery / removeVisibleItemsByIds / syncAfterVisibleDelete）——skippedCollected 数量变化会改变 removed 计数，进而改变锚点与虚拟列表的可见项移除，必须回归删除后光标位置。
4) vibe/rules/project.md:37 要求收藏/批量删除逻辑优先走 repository facade；本修复正是在 facade 实现内部，符合规则，但 src/storage/clipboardRepository.js:232 的 JSON fallback 分支有各自的 collectIdSet 语义，两条路径需同时验证（project.md:36 的 JSON fallback 一致性要求）。
5) 不触碰搜索 reveal/IME、.clip-item-scroll、ClipSwitch 顶栏、存储迁移，无 preload/listener/plugin.json 影响。

## A2. [fit] README 宣称的 FTS5 全文索引在出货产物里根本不存在：sql.js wasm 未编译 fts5，搜索永远降级为 LIKE 全表扫描

- 位置: `src/storage/sqliteClipboardRepository.js:219`
- 成本/风险/置信: M / medium：方案(1)换 wasm 会影响启动加载与包体积；方案(2)只是删代码改文档，风险低。两者都需要回归搜索结果集与中文关键词行为（LIKE 对中文子串反而是能匹配的，换成 FTS5 unicode61 后中文子串搜索会变成整段一个 token，需一并验证）。 / high
- 取证: 核心事实经实机执行确认成立：
- src/storage/sqliteClipboardRepository.js:216-229 try/catch 包 `CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(...)`（:219），catch 里 :227 warn + :228 `this.ftsEnabled = false`（原文写 :218-228/:227/:228，实际 try 起于 216，其余一致）
- 我在本仓库实际运行 sql.js 1.14.1：`CREATE VIRTUAL TABLE ... USING fts5(...)` 返回 `no such module: fts5`；sqlite_version 3.49.1；PRAGMA compile_options 含 `ENABLE_FTS3,ENABLE_FTS3_PARENTHESIS`，不含任何 FTS5 项 —— 这是比 strings 扫描更硬的证据
- 四个 wasm 产物 strings|grep -ci fts5 全为 0；dist/assets/sql-wasm-UFUCzYNW.wasm 659730B 与 node_modules/sql.js/dist/sql-wasm.wasm 字节数一致，同样为 0
- 运行时确实加载它：:1-2 `import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'` + :137 `initSqlJs({ locateFile: () => sqlWasmUrl })`；package.json:22 `"sql.js": "^1.14.1"`，无其他 sqlite 依赖
- 因此 :590 `const useFts = this.ftsEnabled && ...` 恒 false，:602-606 LIKE 分支是唯一路径，:608 needsExactTotal 在有关键词时为 true，确实额外跑一遍 COUNT(*)
- 文档侧：README.md:11 属实；vibe/knowledge/ARCHITECTURE.md:29 属实，另有 :128/:153/:196/:650 同样宣称 FTS5（原文漏列）

两处取证不实，需修正：
- **docs/用户简明说明.md:14 并未提到 FTS5**，原文是「性能：SQLite 底层存储 + 虚拟滚动，大数据量流畅不卡顿」。该行不构成失实承诺，应从证据链中删除。
- **「:225 每次启动无条件 rebuildFts() 的冷启动开销也白付」是错的**：:225 的 rebuildFts() 位于 try 内、紧跟 :224 `this.ftsEnabled = true`，而 :219 建表已抛错，控制流根本到不了 :225；且 rebuildFts 自身 :451 `if (!this.ftsEnabled) return` 早退。upsertFts(:437)/deleteFts(:447) 同样早退。实际浪费只有每次启动一次抛异常 + 一条 console.warn，量级可忽略——影响段这一条属于凭空加码。
- 影响: README.md:11「高性能存储：底层采用 SQLite + FTS5 全文索引，大数据量下依然流畅」、docs/用户简明说明.md:14 与 vibe/knowledge/ARCHITECTURE.md:29 的核心性能承诺整条落空。每次搜索按键都是全表 LIKE 扫描（且 :608 needsExactTotal 为真时还额外跑一遍无 LIMIT 的 COUNT(*)，等于两次全表扫描/按键）。同时 :225 每次启动无条件 rebuildFts() 的冷启动开销也白付——items_fts 表压根没建成。
- 落地: 方向（文档与实现必须对齐）成立，但方案要按实测证据收窄：

**新增的最优选项（原文未考虑）**：当前 wasm 编译了 FTS3/FTS4。我实测 `CREATE VIRTUAL TABLE ... USING fts4(...)` 与 fts3 均建表成功，只有 fts5 失败。若真想要倒排索引，把 :219 改成 fts4 即可零依赖启用，**不需要换 wasm、不影响包体积与启动加载**——这比原提议方案(1)的「自建 sql.js / 换 wa-sqlite」成本低一个数量级。但必须先解决中文：我实测 fts4 simple 分词下 `MATCH '好世'` 匹配不到 `你好世界 hello`（返回空），`MATCH '你好世界'` 才命中；而现状 LIKE '%好世%' 是能命中的。**在没有 CJK 分词（bigram/trigram 预处理 search_text）方案之前，切 FTS 会实打实地退化中文子串搜索**，不能直接切。

因此推荐顺序：
1) 先做零风险的一步：改文档。README.md:11、vibe/knowledge/ARCHITECTURE.md:29/:128/:153/:196/:650 去掉 FTS5 表述，改为「LIKE 子串匹配 + search_text 冗余列」。docs/用户简明说明.md:14 无需改动（本就没提 FTS5）。
2) 把 ftsEnabled 的真实值上报到 storageRuntimeStatus（src/storage/storageRuntimeStatus.js 目前无任何 fts 字段），让设置页可见——这条原提议是对的，且成本极低。
3) 不建议按原提议方案(2)删掉 :216-229 + :436-450 整条路径：它是纯早退死码、运行时零开销，删掉反而丢掉未来切 fts4/自建 wasm 的接口，且会牵动 removeItems :681 与 querySql :590/:596-600 的分支。保留 + 加一行注释说明「当前 wasm 未编译 FTS5，路径恒不启用」更稳。
4) 补基线用例这条成立且值得做：scripts/perf-baseline.mjs:2 只 import 了 src/storage/searchIndex.js 的 queryClipboardItems（JSON 降级路径），SQLite 的 querySql 零覆盖——建议加一条直接压 querySql 的用例，顺便把 ftsEnabled 断言进去，这样降级不会再无声。
- 回归面: 1) 若采纳「切 fts4」：中文子串搜索会从「能匹配」退化为「整段一个 token 才匹配」（已实测），这是用户可感知的功能倒退，且搜索框是 Main.vue 搜索态热路径，牵动 reveal/IME 保护与键盘导航（vibe/rules/project.md:39 明确点名保护搜索 reveal/IME）——没有 CJK 分词方案就不要动。
2) 若采纳原提议方案(1) 换 wasm：会改变 :1-2 的 wasm import 与 :137 locateFile，影响构建产物哈希、包体积与 uTools 实机的资源加载（dist/ 由 vite build 生成，plugin.json/preload.js 由 scripts/utools-runtime-assets.mjs 生成），属于高风险面，需实机验证插件冷启动。
3) 若采纳原提议方案(2) 删死码：会触及 removeItems(:681 `if (this.ftsEnabled) DELETE FROM items_fts`) 与 querySql 分支，属于 vibe/rules/project.md:28/36 点名的 src/storage/ 高风险改动，收益却接近零。
4) 纯改文档 + 上报 ftsEnabled：零运行时风险，不触碰虚拟滚动、删除锚点、ClipSwitch 顶栏、存储迁移与 JSON fallback。

## A3. [fit] 设置页的「最大历史 / 保存时间」在 SQLite 模式下完全不生效：清理逻辑只存在于已废弃的 JSON DB 类里

- 位置: `src/global/initPlugin.js:302`
- 成本/风险/置信: M / medium：涉及删除数据，必须先确认收藏与锁定的豁免条件（README.md:52 明确收藏不受影响），并补一条自动化用例；建议首次上线时先只做 maxage、观察一版再开 maxsize。 / high
- 取证: 核心结论属实，行号需微调。
- maxage 清理实际在 src/global/initPlugin.js:300-307（注释 300，`if (setting.database.maxage != null)` 在 302，filter 在 305-307），位于 legacy `class DB` 的 init 内；原文写 :302-308 基本吻合。
- maxsize 清理实际在 src/global/initPlugin.js:407-427（`if (setting.database.maxsize !== null)` 在 408，pop/回填到 425，`this.updateDataBaseLocal()` 在 427），所在方法 `addItem(cItem)` 在 :381。原文写 :408-424 略短，未覆盖收藏回填收尾。
- 运行时确为 SQLite：src/global/initPlugin.js:1287 `db = await createSqliteWithRetry()`，:1211-1220 `bindStorageRuntime` 挂 window.db；热路径 src/global/initPlugin.js:1444 `db.updateItemViaId(itemId)` / :1453 `db.addItem(item)`。
- `rg -n "maxsize|maxage" src/` 全仓命中只有 src/global/initPlugin.js:300/302/304/408/409、src/global/readSetting.js:99-100/125-126、src/views/Setting.vue:60/68/1303-1304/2901-2902、src/data/setting.json:4-5。src/storage/sqliteClipboardRepository.js 零命中；其 addItem 在 :645-655，只做 upsert + refreshCache，无任何条数/时间清理。
- 设置 UI 属实：src/views/Setting.vue:60-62（500/1000/5000/50000/无限）、:68-70（1~360 天/无限）、:2901-2902 写入 payload.database。README.md:52 的清理策略描述确实不成立。
重要修正（原取证遗漏两点）：
1) maxage 并非完全不执行：src/global/initPlugin.js:1209-1210 `const legacyDb = new DB(dbPath); legacyDb.init()` 在每次启动都跑，:305-307 会裁掉 legacy JSON 内存数据；该 legacyDb 又作为迁移源传入 createSQLiteClipboardRepository（:1243-1245）。所以 maxage 对「首次/回退时的 JSON→SQLite 导入集合」是生效的，只是对 SQLite 运行期不生效。
2) maxsize 代码并非「不可达死代码」：JSON fallback 路径 src/global/initPlugin.js:1292-1294 `db = createClipboardRepository(legacyDb)`，而 src/storage/clipboardRepository.js:139-140 `addItem(item){ const result = this.legacyDb?.addItem?.(item) }` 直接委派给 legacy DB.addItem，故 :407-427 在 json-fallback 模式下是活代码。
影响量化修正：src/data/setting.json:4-5 与 src/global/readSetting.js:99-100、:125-126 显示 maxsize/maxage 默认均为 null（且旧值 14 被强制归零为 null），因此「数据库无限增长」是默认行为，只有显式配置过的用户才踩到「配了不生效」。persistNow（src/storage/sqliteClipboardRepository.js:351-356，整库 db.export() + 覆盖写）属实，但它由 runInTransaction:331 → queuePersist:358-365 的 120ms 防抖触发，不是严格「每次复制一次」；把清理失效说成性能劣化的「根因」偏重，应表述为放大因子。
- 影响: README.md:52「清理策略：maxsize 控制最大条数（历史）；maxage 控制最长天数（收藏不受影响）」不成立。用户设了「最大 1000 条 / 保存 7 天」后数据库仍无限增长——而库体积正是本项目每次复制都要付的成本（src/storage/sqliteClipboardRepository.js:351 persistNow 每次写入都 db.export() 整库序列化 + 整文件覆盖写），所以这个失效的清理策略同时也是长期性能劣化的根因。
- 落地: 下沉到 SQLiteClipboardRepository 的方向成立，且符合 vibe/rules/project.md:37「优先走 repository facade」。但必须改三点：
1) 删除 src/global/initPlugin.js:300-307 / :407-427 这一条要撤销。这两段不是不可达代码：:407-427 是 json-fallback 唯一的 maxsize 实现（src/storage/clipboardRepository.js:139-140 委派），:300-307 影响迁移导入集合。删掉会直接违反 vibe/rules/project.md:36「必须同时确认 SQLite 主路径、JSON fallback、迁移备份」。正确做法是保留 legacy 实现、只在 SQLite 仓库补一份等价实现。
2) maxsize 的 SQL 需要修正：原提议的保留子查询 `SELECT id FROM items WHERE collected=0 ORDER BY update_time DESC LIMIT $maxsize` 不排除 locked，导致锁定行占用保留额度、进而误删更多未锁定行；且外层 `locked=0` 与内层不一致。保留集应与豁免条件同口径（内外都排除 locked，或改成对 `collected=0 AND locked=0` 的行做 offset 删除）。
3) 删除必须复用现有清理链路而非裸 DELETE：src/storage/sqliteClipboardRepository.js:698 `this.blobStore.removeForItem(item)`、:706-708 `DELETE FROM items_fts`（ftsEnabled 时）、:710 `refreshCache()` 缺一不可，否则外置载荷泄漏、FTS 索引残留、缓存不同步。
4) 豁免判定不要用 this.isCollected：src/storage/sqliteClipboardRepository.js:764-765 的 collectIdSet 来自 :518，而 :518 的 collects 来自 :494 被 TAB_CACHE_LIMIT=30（:14）截断的 collectData，超过 30 条的收藏会被误判为未收藏。清理必须用 SQL 列 `collected = 0`（原提议的 SQL 恰好是对的，务必不要在 JS 侧回退到 isCollected）。
5) 分期上线建议（先 maxage 再 maxsize）合理，保留。
- 回归面: 1) 删 legacy 两段会破坏 json-fallback 下的 maxsize 与迁移期的 maxage（vibe/rules/project.md:36 明令保护）。2) 新增删除若绕过 blobStore.removeForItem（sqliteClipboardRepository.js:698）与 items_fts 清理（:706-708），会导致 assets 残留与搜索索引脏数据，直接冲击搜索路径。3) 在 init() 末尾删数据会改变启动耗时与首屏，且此时 refreshCache 尚未建缓存，必须确保删除后再 refreshCache（:491-519），否则 window.db.dataBase.data 与库不一致，波及 Main.vue:1512/1523/1908 的 list 赋值与虚拟滚动/删除锚点。4) addItem 每次都跑一次 maxsize DELETE 会把复制热路径（initPlugin.js:1453）从单次 upsert 变成扫描+删除+persist，DB 大时反而加重每次复制的开销，应加阈值/节流。5) 任何用 isCollected 做豁免的实现都会在收藏 >30 条时误删收藏，违反 README.md:52「收藏不受影响」。6) uTools 实机侧无影响（不涉及 preload/listener/plugin.json）。

## A4. [fit] 「按时间范围清空」一次最多只删 30 条，且提示「已清除 30 条」让用户以为成功

- 位置: `src/views/Main.vue:1008`
- 成本/风险/置信: M / medium：这是批量删除路径，必须先补自动化用例覆盖锁定豁免与收藏豁免（后者依赖上面第 1 条修好的 isCollected），否则修好范围的同时会放大误删。 / high
- 取证: 核心结论属实。
- src/views/Main.vue:1007-1008 `const clearRegularTabItems = async (tabType, rangeValue) => { const candidates = filterItemsByRange(getItemsByTab(tabType), rangeValue) }` 属实。
- getItemsByTab 在 src/views/Main.vue:972-981：collect 分支 :975 `window.db.getCollects()` / :976 `getCollectsByTag(subTab)`；非收藏分支 :978 `const data = window.db.dataBase.data || []`，:979-980 再按 type 过滤。属实。
- 30 条截断属实：src/storage/sqliteClipboardRepository.js:14 `const TAB_CACHE_LIMIT = 30`；:493 `selectItems('collected = 0', {}, 'update_time DESC', TAB_CACHE_LIMIT)`、:494 collected=1 同样限 30；:509-517 把这 30 条写回 this.dataBase.data / collectData；:772-774 `getCollects(){ return this.dataBase.collectData }`；:776-779 getCollectsByTag 在同一 30 条数组上 filter。
- 「全部」不做兜底：src/views/Main.vue:310-317 RANGE_DURATION_MAP 中 `all: null`，:984-985 `const duration = RANGE_DURATION_MAP[rangeValue]; if (!duration) return [...items]` —— 返回的仍是那 30 条。
- 收藏清空同源：src/views/Main.vue:1042-1048。
- 提示文案行号修正：不是 :1113-1120，实际在 src/views/Main.vue:1117-1124，`已清除 ${removedCount} 条记录`（含锁定跳过分支）在 :1121-1124。
- README.md:33「清除对话框：按时间范围清除当前标签页」与 README.md:45 的六档范围确实与实现不符。
需修正的夸大之处：
- 「同一截断还影响 :1436 currentSearchItemCount 的收藏分支」被夸大。src/views/Main.vue:1431-1441：:1432-1433 `if (window.db?.query && !parseStarFilter(...).isStar) return currentQueryTotal.value` —— SQLite 模式下 window.db.query 存在，普通检索走真实总数，只有星标筛选态才落到 :1436 的快照 length。
- searchPlaceholder（src/views/Main.vue:1421-1425，收藏计数在 :1423）确实无条件用 getCollects().length，恒被 30 截断，这一条成立。
- 「依赖上面第 1 条修好的 isCollected」是张冠李戴：第 1 条通篇没有 isCollected。真实的 isCollected 缺陷独立存在于 src/storage/sqliteClipboardRepository.js:764-765 + :518（collectIdSet 由 30 条 collectData 派生），并已经污染 removeItems 的收藏豁免（:694 `if (this.isCollected(item.id) && !force)`）——这是一个独立发现，不应挂在第 1 条名下。
- 影响: README.md:33「清除对话框：按时间范围清除当前标签页」与 README.md:45 的 1小时/5小时/8小时/24小时/7天/全部 六档范围全部失真。用户对着几千条历史选「全部」，实际每次只删最新 30 条，还收到「已清除 30 条记录」的成功提示，只能靠反复点击来逼近目标，且完全不知道要点多少次。
- 落地: 仓库层 removeByRange 的方向成立且符合 vibe/rules/project.md:37。需补充四点落地约束：
1) 返回值必须包含被删的真实 id 列表，而不只是计数。src/views/Main.vue:1034 `removeVisibleItemsByIds(removableIds)` 依赖 id 去同步 showList / collectBlockList / pinnedMap / pinGroup（实现见 :1292-1305）；只回计数会让可见列表、置顶缓存与删除锚点与库脱节。
2) 事务内必须复用既有清理链路：blobStore.removeForItem（src/storage/sqliteClipboardRepository.js:698）、items_fts 删除（:706-708，ftsEnabled 时）、末尾 refreshCache（:710）。
3) 豁免判定用 SQL 列（locked=0 / collected=0），不要用 this.isCollected（:764-765，30 条快照，收藏 >30 会误判）。收藏页清空要走 collect_time 口径（对齐 src/views/Main.vue:1048-1050 的 preferCollectTime）。
4) 收藏分支现在走的是 window.db.removeCollects(ids, false)（src/views/Main.vue:1070-1072），语义与 removeItems 不同（取消收藏 vs 删除，参见 :753 `UPDATE items SET collected = 0`）。新 API 必须显式区分这两种语义，否则会把「清空收藏」变成「删除数据」。
5) 「顺带把 currentSearchItemCount 改用 COUNT(*)」应缩小为：只改 searchPlaceholder（:1421-1425）的收藏计数；currentSearchItemCount 的主分支已用 currentQueryTotal，不必动。
6) 大批量删除需分批提交/进度回调，否则单个 runInTransaction 内删几千条 + 一次 db.export()（:351-356）会阻塞 UI。
- 回归面: 1) 删除锚点与虚拟滚动：Main.vue:1034 / :1292-1305 依赖真实 id 集合，改成计数式批删会破坏 showList 过滤与置顶缓存同步（vibe/rules/project.md:39 明确保护删除锚点与虚拟滚动）。2) 收藏语义：误把 removeCollects（取消收藏，sqliteClipboardRepository.js:753）换成物理删除属于放大误删，风险高于原文估计。3) 锁定豁免：必须保持 force=false 时跳过 locked（:690-693）并把 skippedLocked 真实回传给 Main.vue:1117-1124 的提示，否则文案继续失真。4) 未清 items_fts / blobStore 会造成搜索索引与外置载荷残留，冲击搜索路径。5) 一次性大事务 + 整库 export 覆盖写（:351-356）可能在 uTools 实机上造成明显卡顿或写入中断；无 preload/listener/plugin.json 影响。

## A5. [fit] 「虚拟列表」是文档承诺但代码里从不存在的能力：@tanstack/vue-virtual 零引用，列表全量 v-for 渲染

- 位置: `src/cpns/ClipItemList.vue:16`
- 成本/风险/置信: L / medium：接虚拟化会牵动 ClipItemList 的导航跟滚（useVirtualListScroll.js:245 applyScrollToItemIndex）、删除锚点恢复与预览层定位，回归面较大；只改文档+卸依赖则是 low。 / high
- 取证: 逐条核对全部属实。src/cpns/ClipItemList.vue:16 `v-for="(item, index) in showList"`、:17 `:key="`${item?.id ?? index}-${lockedRenderVersion}`"`，父容器 :10-13 `<div ref="scrollParentRef" class="scroller clip-item-scroll" @scroll.passive="handleVirtualScroll">`，无任何窗口化/偏移容器。src/cpns/ClipItemList.vue:1544-1551 `useVirtualListScroll({ listRootRef, scrollParentRef, virtualizer: null, getEstimateSize..., getCount: () => props.showList.length, ... })` —— 确为 `virtualizer: null`。src/hooks/useVirtualListScroll.js:19-21 `const instance = virtualizer?.value ?? virtualizer; if (instance?.options?.count != null) return ...; return typeof getCount === 'function' ? getCount() : 0`，恒走 getCount；:359-366 的 `instance.getOffsetForIndex/scrollToOffset` 分支同样恒不命中，实际滚动落到 :242 applyManualScrollInContainer 的手写 DOM 通路。package.json:12 `"@tanstack/vue-virtual": "^3.13.12"`；vite.config.js:32 `if (id.includes('/node_modules/@tanstack/')) return 'vendor-virtual'`。全仓（排除 node_modules/dist/graphify-out）grep tanstack|useVirtualizer|vue-virtual 在 src/ 下 0 命中，只有 README.md:80、specs/001-.../plan.md:8,13、specs/003-.../plan.md:23 三处文档提及。dist/assets 实际产物无 vendor-virtual chunk（只有 vendor-*, storage-sql, preview-* 等）。文档侧 README.md:12「虚拟列表：长列表使用虚拟滚动，条目再多也不卡顿。」、docs/用户简明说明.md:14「性能：SQLite 底层存储 + 虚拟滚动，大数据量流畅不卡顿」确实存在。规模控制确由分页承担：src/views/Main.vue:510 `const GAP = 15`，:1443 loadMoreData 每次追加 15 条。补充一条原取证漏掉但很关键的事实：src/views/Main.vue:515 `const showList = shallowRef([])` —— showList 是 shallowRef，条目是原始对象不具响应性，这正是 :17 用 lockedRenderVersion 做 key 的原因（ClipItemList.vue:1961-1971 syncShowListLockedState 直接 `item.locked = locked` 后 `lockedRenderVersion.value++`）。
- 影响: README.md:12「虚拟列表：长列表使用虚拟滚动，条目再多也不卡顿」与 docs/用户简明说明.md:14「SQLite 底层存储 + 虚拟滚动，大数据量流畅不卡顿」是两条纯粹的空头承诺。实际后果是每次 activeIndex 变化（每一次上下方向键）都要重跑整表 render 并 patch N 个 ClipItemRow；:17 行 key 还拼了 lockedRenderVersion，任一次锁定切换会让所有行 key 变化、整表卸载重建。加载条数越多越卡，正好与文档承诺相反。
- 落地: 结论方向成立，但两条分支的性价比差距远大于原文所述，应明确二选一而非并列。
首选「诚实降级」：改 README.md:12 与 docs/用户简明说明.md:14 的措辞为「分页加载（每页 15 条）+ 按需追加」，同步 README.md:80 技术栈行；package.json:12 依赖与 vite.config.js:32 死分支可一并移除（vite.config.js 属 project.md 声明的高风险文件，需在提交说明里写明 dev/build/runtime 影响，实测 dist 本就无 vendor-virtual chunk，移除对产物零变化）。
不建议现在做「补齐能力」：接虚拟化不是「成本不高」。useVirtualListScroll 的实际滚动主通路是 DOM 节点查询（useVirtualListScroll.js:24-30 getActiveNode/getFallbackRowNode 用 `listRootRef.value.querySelector('.clip-item[data-index=N]')`、:242 applyManualScrollInContainer 依赖真实节点 metrics），窗口化后离屏节点不存在，这条通路会整体失效，必须重写。
另外原文「让 showList 里的 item 变成响应式对象」这条附带提议应当否决：showList 是 Main.vue:515 的 shallowRef，是刻意的性能取舍；改成深响应会让每次 loadMoreData 追加都付出全量 proxy 化成本，并影响 ClipItemList.vue:420-423 / 1952-1958 现有的「直接改原对象 + 手动触发」写法。若只想解决全表重建，正解是把 lockedRenderVersion 从 :17 的 key 里拿掉、改为在 syncShowListLockedState 里替换该条目引用（`showList` 数组浅拷贝 + 单条 replace），而不是动整体响应性模型。
- 回归面: 降级分支（改文档 + 删依赖/死分支）风险 low，只碰 README/docs/package.json/vite.config.js，不触碰运行时。
接入虚拟化分支风险 high，且直接撞上 vibe/rules/project.md 的防误改条款「不要仅因视觉偏好重排 ... `.clip-item-scroll` 滚动容器 ... 除非能证明不会破坏搜索、键盘导航、虚拟滚动、删除锚点和输入框默认行为」。具体回归面：(1) useVirtualListScroll.js:24-30 的 `.clip-item[data-index]` / `.clip-item-list-row[data-index]` 节点查询在离屏时返回 null，方向键跟滚（:353 scheduleEnsureVisible、applyScrollToItemIndex）失效；(2) ClipItemList.vue:1553-1566 handleVirtualScroll 的「触底 emit loadMore」依赖真实 scrollHeight，窗口化后总高由虚拟总高替代，需重接；(3) 删除后高亮恢复（ClipItemList.vue:1714-1730 依赖按 index 遍历 props.showList 与 DOM 锚点）；(4) 预览层（FileRichPreview / 文本预览 panelStyle）按行节点定位；(5) 改 key 策略会影响 :1961-1971 锁定态同步的可见性。

## A6. [fit] 「来源信息」既采集不到也无处可看：readActiveWindowInfo 依赖 uTools 未提供的 shellExec，且 sourceApp/sourceWindowTitle 零 UI 消费

- 位置: `src/global/initPlugin.js:1065`
- 成本/风险/置信: S / low：删除方向只动一段无消费方的代码 + 两个恒空的列；保留方向需要新的宿主能力验证。 / medium
- 取证: 采集侧核对属实：src/global/initPlugin.js:1065-1067 `const readActiveWindowInfo = () => { if (typeof utools?.shellExec !== 'function') { return { sourceApp: '', sourceWindowTitle: '' } }`；:1071-1075 macOS osascript 分支、:1077-1097 Windows PowerShell 分支（且 :1097 `return { sourceApp: '', sourceWindowTitle }` 在 Windows 分支上把 sourceApp 恒置空）；:1103-1113 enrichSourceWindowInfoLater，:1104 `if (!item?.hasSourceInfo || item.sourceApp || item.sourceWindowTitle) return`；hasSourceInfo 仅由剪贴板文件路径决定（:1129 `const hasSourceInfo = originPaths.length > 0`、:1144 `const hasSourceInfo = sourcePaths.length > 0`）；调用点 :1431 `enrichSourceWindowInfoLater(item)` 确在 handleClipboardChange 热路径。
消费侧核对属实：全仓 grep sourceApp|sourceWindowTitle|source_app|source_window_title 在 src 下仅命中 src/storage/sqliteClipboardRepository.js:52-53(rowToItem)、:83-84(itemToParams)、:202-203(CREATE TABLE)、:404/:408/:427-428(upsert)，以及 initPlugin.js 自身；无任何 .vue 读取。对照 sourcePaths 确有真实消费方（src/hooks/useClipOperate.js、src/storage/searchIndex.js）。
两处需要修正：
(1) 原取证漏了 src/global/devDbStub.js:35 `shellExec: () => ({ stdout: '', stderr: '' })` —— 开发桩里 shellExec 存在但恒返回空，所以 dev 下守卫为假、走到分支也拿不到数据，结论不变但「守卫恒真」的说法只对真实宿主成立。
(2) 「utools 无 shellExec」我无法在本仓内证伪或证实：node_modules 无 utools-api-types，仓库内除 initPlugin.js 与 devDbStub.js 外无其它 shellExec 出处。这一条属于外部宿主事实，未在本次审计中取证。
- 影响: README.md:9「来源信息：尝试读取文件路径、前台窗口标题，便于追溯来源」与 README.md:54「解析剪贴板文件路径/前台窗口标题存入 item.sourcePaths/sourceApp/sourceWindowTitle」中的「前台窗口标题」部分整条不成立——既写不进去，写进去了也没有任何界面能看到。同时 enrichSourceWindowInfoLater 在 :1431 挂在每次复制的热路径上，:1109 还会触发一次额外的 db.updateItem（一整轮事务 + blob 重写 + 整库 export），付了成本却零产出。
- 落地: 发现方向成立，但删除范围必须收窄，原提议的「删掉 items 表的两列」应当否决。
可安全执行（推荐）：
- 删除 src/global/initPlugin.js:1065-1113（readActiveWindowInfo + enrichSourceWindowInfoLater）与 :1431 的调用点；
- 修正文档措辞：README.md:9「来源信息：尝试读取文件路径、前台窗口标题...」收敛为「文件路径来源」，README.md:54 同步去掉 sourceApp/sourceWindowTitle 的表述（该行还引用了过期行号 `@src/global/initPlugin.js#488-635`，与实际 :1065-1113 不符，应一并修正）。
必须否决的部分：不要动 src/storage/sqliteClipboardRepository.js:202-203 的两列、:52-53 rowToItem、:83-84 itemToParams、:404-428 upsert 字段。理由：两列写在初始 CREATE TABLE 里（不像 :216 data_path 走 ensureColumn），用户既有库已带这两列且为 `NOT NULL DEFAULT ''`；从 CREATE TABLE 与 upsert 里摘掉只影响新建库，却让新旧库 schema 分叉，属 project.md 明列的「存储路径修改必须同时确认 SQLite 主路径、JSON fallback、迁移备份、重复导入防护」高风险面，收益（两个恒空 TEXT 列）远低于风险。恒空列留着零成本。
若选「保留需求」方向：原提议提到 preload 已注入 child_process 可扩展 —— 需更正，scripts/utools-runtime-assets.mjs:218 的 `const { execFile } = require('child_process')` 位于 listener.js 模板内（仅用于 :250/:254 启动 clipboard-event-handler-* 监听程序），preload.js 模板（:38 起）并未 require child_process，也未导出任何 exec 能力，要走这条路是新增宿主能力而非「扩展」。
- 回归面: 删除分支：readActiveWindowInfo/enrichSourceWindowInfoLater 无任何其它调用方（grep 仅 :1431 一处），删除不影响 sourcePaths / fromFileSource / hasSourceInfo 这三个真被消费的字段（hasSourceInfo 仍被 :1135/:1152/:1176 写入并存库），也不触及 preload/listener/plugin.json，对 uTools 实机行为无影响，风险 low。
若按原提议同时删列：会把改动扩散到 src/storage/sqliteClipboardRepository.js 的建表与 upsert 主路径，牵动 JSON fallback / 迁移备份 / 重复导入防护验证链，风险由 low 抬到 medium，属不必要的风险引入。

## A7. [fit] 设置页「快捷键配置管理」的本机/公共运行源选择器渲染不出来：el-radio-group / el-radio-button 未全局注册也未局部导入

- 位置: `src/views/Setting.vue:966`
- 成本/风险/置信: S / low：只是补注册，不改逻辑；需在 uTools 实机确认弹窗渲染与「应用」按钮的落库行为。 / high
- 取证: 逐条复核全部属实，行号无误。1) src/views/Setting.vue:966-969 确实是 `<el-radio-group v-model="shortcutRuntimeSourceDraft">` 内含两个 `<el-radio-button :label="SHORTCUT_RUNTIME_SOURCE_LOCAL/PUBLIC">`。2) src/global/registerElement.js:21-39 导入清单与 :41-59 components 数组共 17 个组件，无 ElRadioGroup/ElRadioButton；:1-20 的 CSS 清单也无 el-radio*.css。3) src/main.js:59 `app.use(registerElement)` 是全仓唯一的全局注册入口（grep element-plus 在 src/*.js 只命中 main.js:8/:59），vite.config.js 无 compilerOptions.isCustomElement、无 unplugin-vue-components 自动导入（grep 退出码 1），package.json 也没装自动导入插件。4) src/views/Setting.vue:1209-1212 script setup 只 `import { ElMessage, ElMessageBox } from 'element-plus'`。5) 全仓唯一 import 处是 src/views/Main.vue:256-257，而 `grep -n radio src/views/Main.vue` 在模板段零命中——script setup 的局部注册不外溢到 Setting.vue。结论：两个组件在 Setting.vue 中未解析，Vue 会按未知组件原样渲染成 `<el-radio-group>`/`<el-radio-button>` 元素，v-model 不生效，只剩「本机配置」「公共配置」两段裸文本。6) 消费点核对无误：src/views/Setting.vue:1351 定义 draft，:2623 在 setting 更新时同步，:2656-2664 applyShortcutRuntimeSource 是唯一写回点（setShortcutRuntimeSource + saveShortcutSyncSetting + 重算 hotkeyOverrides + ElMessage）。7) 影响引用的 vibe/specs/PROJECT_STATUS.md:42 原文确为「each device keeps a local profile, can choose public runtime source」。附带体检也基本属实：node_modules/element-plus/es/components/message/src/method.mjs:118 `const message = (options = {}, context) => {`，其 .name 为小写 'message'，经 registerElement.js:68-73 transferCamel 会产出 'essage'；registerElement.js:29-34 注册的 ElScrollbar/ElTag/ElDivider 在 src 模板中 `<el-scrollbar|<el-tag|<el-divider` 命中数为 0；el-tooltip 在 src 中 31 处引用而 :1-20 未导入 el-popper.css（node_modules/element-plus/theme-chalk/el-popper.css 存在）。
- 影响: vibe/specs/PROJECT_STATUS.md:42 记为已完成的里程碑「Shortcut config management：each device keeps a local profile, can choose public runtime source」中的「选择运行源」在 UI 上不可达——用户打开该弹窗只会看到两段没有交互的裸文本，旁边的「应用」按钮永远只会写回初始值。多设备快捷键同步（README.md:48 提到的 SQLite/dbStorage 优先级链）因此少了一半的用户入口。
- 落地: 确认原提议方向成立，但需补三点落地细节。(a) CSS 不止 el-radio.css：theme-chalk 下是三个文件 el-radio.css / el-radio-group.css / el-radio-button.css，只补 el-radio.css 会得到无边框无选中态的半成品，三个都要导入。(b) 组件名可安全走现有 transferCamel：radio-group2.mjs:17 name 为 'ElRadioGroup'、radio-button2.mjs:10 为 'ElRadioButton'，转换后正是 'el-radio-group'/'el-radio-button'，无需改 registerElement.js:68-73 的转换函数。(c) 本仓实际安装的是 element-plus 2.13.1（package.json 写 ^2.2.17）。2.13.1 的 radio 仍兼容 label 作值：use-radio.mjs:12-17 `actualValue = props.value 缺省时回退 props.label`，所以 Setting.vue:966-969 现有的 `:label` 绑定注册后即可正常工作，但 use-radio.mjs:36-45 的 useDeprecated 会在「处于 group 且未传 value」时打印弃用警告（3.0.0 移除）。建议同时把 :label 改为 :value 并把中文文案放进默认插槽，一次到位。删除 Main.vue:256-257 两个未使用导入是安全的（模板零命中）。ElMessage/ElMessageBox 从 components 数组移除、以及补 el-popper.css 建议拆成独立小改动，不要和本修复混在一起。
- 回归面: 极低但非零：1) 该改动只碰 src/global/registerElement.js 与 src/views/Main.vue 的 import 行，不触及 vibe/rules/project.md:39 点名保护的 ClipSwitch 顶栏、.clip-item-scroll 滚动容器、搜索 reveal/IME 保护、虚拟滚动与删除锚点，也不触及 :28/:36 的存储迁移与 JSON fallback、:37 的 repository facade 优先。2) 不改 scripts/utools-runtime-assets.mjs，plugin.json/preload.js/listener.js 与三个 feature（clipboard / quick-paste-top / quick-paste-pin-group）不受影响。3) 真正的回归面在 CSS 与打包：新增三个 theme-chalk 文件会进入 vite.config.js:14-28 的 vendor-element-plus chunk，需确认 chunkSizeWarningLimit(1900) 不被击穿；el-radio 的 --el-* 变量在暗色下依赖 el-overlay/base.css 已导入，理论上无冲突但应在明暗两套主题各看一次。4) 若顺手把 ElMessage/ElMessageBox 移出 components 数组，必须确认没有任何模板在用 `<essage>`/`<message-box>` 这类畸形标签名（实测无），否则会引入新的未解析组件。5) 必须在 uTools 实机打开设置页「快捷键配置管理」弹窗，验证单选可点、点「应用」后 ElMessage 提示与 hotkeyOverrides 生效、且重进插件后 shortcutRuntimeSourceDraft 从 Setting.vue:1351/:2623 读回的值与所选一致（涉及 SQLite shortcut repository 与 dbStorage 回退两条链，README.md:48）。

## A8. [fit] 操作抽屉的拖拽排序是断的：ClipDrawerMenu emit('reorder') 没有被父组件接收，顺序永不落盘

- 位置: `src/cpns/ClipItemList.vue:217`
- 成本/风险/置信: S / low：一行绑定；回归面是抽屉顺序的持久化，需手工验一次拖拽后重开。 / high
- 取证: 逐行核对，全部属实：src/cpns/ClipDrawerMenu.vue:44 `const emit = defineEmits(['select','close','reorder'])`；模板 :16-19 每个 drawer-item 都有 `draggable="true" @dragstart="onDragStart(idx)" @dragover.prevent @drop="onDrop(idx)"`，拖拽入口确实是激活的；:101-109 onDrop 里 :106 `localItems.value = list` 先改本地、:108 `emit('reorder', list)`。父组件 src/cpns/ClipItemList.vue:217-225 的 <ClipDrawerMenu> 只有 `@select="handleDrawerSelect"`(:223) 和 `@close="closeDrawer"`(:224)，无 @reorder。`grep -rn reorder src/` 全仓仅 3 处命中：ClipDrawerMenu.vue:44、:108，以及零命中的 handleDrawerReorder；`grep -rn handleDrawerReorder src/` 仅 src/cpns/ClipItemList.vue:1443 定义一处，无任何调用方。持久化体 :1444-1446 `drawerItems.value = list; drawerOrder.value = list.map(op=>op.id); utools.dbStorage.setItem('drawer.order', drawerOrder.value)` 确实永不执行。复原路径成立：drawerOrder 在 :1616-1619 由 `utools.dbStorage.getItem('drawer.order')` 初始化，抽屉每次打开经 :1452-1458 getDrawerFullMenuItems -> buildDrawerMenuItems(src/global/contextMenuActions.js:79-86) 用旧 drawerOrder 重排，ClipDrawerMenu.vue:57-64 的 watch(props.items, immediate) 覆盖 localItems，拖拽结果丢失。设置页那条独立路径确实是通的：src/views/Setting.vue:2757-2761 handleContextMenuActionDragEnd -> buildContextMenuDrawerOrderFromRows + `dbStorage.setItem('drawer.order', ...)`。两处 getItem 各调两次也属实（ClipItemList.vue:1617-1618、Setting.vue:1738-1739）。setting.operation.drawerOrder 只写不读也属实：`grep -rn "operation.drawerOrder" src/` 仅 Setting.vue:2908 一处写入，无读取方。
影响描述有一处失实：README.md:23 是组件清单行（“组件：src/cpns/*（列表、全文预览、搜索、操作抽屉…）”），并未宣传“抽屉可拖拽调整顺序”；全仓 README/docs 搜 “拖拽/拖动/drag” 只命中功能列表排序与组合编辑（docs/用户简明说明.md:29、docs/VersionDesc/20260331-…:533），没有任何文档承诺抽屉内拖拽排序。所以这是“UI 提供了拖拽手势但不落盘”的自相矛盾，不是“文档宣传落空”。
- 影响: README.md:23 与设置页宣传的「操作抽屉可调整顺序」对用户表现为「拖完看着变了、关掉再开就复原」——一个会主动误导、且用户会反复重试的静默失败。同时 PROJECT_STATUS.md:28 的「Right-click unification：settings-page management added」在抽屉侧只完成了一半（设置页的右键顺序弹窗走的是另一条 :2757/:2764 的独立写入路径，那条是通的）。
- 落地: 不要照搬“补一行 @reorder="handleDrawerReorder"”。现有 handleDrawerReorder(ClipItemList.vue:1443-1447) 与设置页写入的语义不等价，直接接上会写脏 drawer.order：(a) 它写的是当前 item 过滤后的菜单 id 列表（buildDrawerMenuItems 先经 filterOperate 过滤，contextMenuActions.js:81-83），对图片项拖一次会把所有纯文本操作挤到 applyContextMenuOrder 的 remaining 尾部(contextMenuActions.js:62-70)；(b) 它没有像 buildContextMenuDrawerOrderFromRows(contextMenuActions.js:126-130) 那样过滤 orderable!==false，会把强制插在索引 1 的 'edit-alias'(ALIAS_CONTEXT_MENU_ACTION, orderable:false, contextMenuActions.js:6-14/:72-77) 写进 drawer.order。两条正确路线二选一：
1) 若保留抽屉内拖拽：新增一个与设置页同源的落盘函数——以 operations.value 全量（非过滤）为基准，把被拖动 id 在旧 drawer.order 中重排后再 `.filter(row => row.orderable !== false)`，复用 contextMenuActions.js 里的构造器而不是 `list.map(op=>op.id)`，再绑 @reorder。
2) 若认定设置页是唯一管理入口（PROJECT_STATUS.md:28 的 settings-page management 已完成）：删掉 ClipDrawerMenu.vue:16-19 的 draggable/dragstart/drop、:55/:97-109 的拖拽状态与 onDrop、:44 的 'reorder' emit，以及 ClipItemList.vue:1443-1447 的死函数，让 UI 不再提供不落盘的手势。
顺带确认（与本条独立）：'drawer.order'(运行时真相源，被 ClipItemList.vue:1616、Setting.vue:1738、Setting.vue:2760/2766 读写) 与 setting.operation.drawerOrder(仅 Setting.vue:2908 写、无读) 并存，后者是死字段，应删或改为唯一真相源，别两边都留。
- 回归面: 1) 双真相源与陈旧快照：Setting.vue:1738 的 contextMenuDrawerOrder 只在组件 setup 时读一次 drawer.order；若抽屉侧开始写入，而设置页仍挂载/被缓存，用户在设置页点保存会用旧快照经 :2908 覆盖回去。2) 过滤列表落盘会静默改变设置页右键菜单顺序（buildContextMenuActionRows 用同一份 drawer.order）。3) 序号快捷执行同源：ClipItemList.vue:1452-1458 注释明确要求抽屉渲染与 c-a-1~9 序号执行共用菜单数据源，改动顺序生成逻辑必须同时验证序号直选落到同一项。4) 不触碰 vibe/rules/project.md:36-39 的存储迁移/JSON fallback/repository facade/ClipSwitch/.clip-item-scroll/搜索 reveal-IME 保护，本改动与它们无交集；但 dbStorage 写入需在 uTools 实机验一次（拖拽 -> 关抽屉 -> 重开 -> 重启插件）。5) 若选删除方向，需确认无 e2e/单测断言 drawer 拖拽（当前仓库 grep 未见）。

## A9. [fit] 命令 list.navigate.left 已注册处理器与中文标签，但没有任何默认绑定，用户在设置页既看不到也无法为它分配快捷键

- 位置: `src/global/commandDefaults.js:80`
- 成本/风险/置信: S / low：新增绑定需检查与 143 条现有默认的冲突；删除方向无运行时影响。 / high
- 取证: 四处行号全部精确：src/global/commandDefaults.js:80 `['list.navigate.left','list-nav-left','list','Move selection left']`；src/cpns/ClipItemList.vue:2742 `{ featureId: "list-nav-left", commandId: "list.navigate.left", handler: handleListNavLeftCommand }`（handler 实体在 :2340-2343，`setKeyboardActiveIndex(activeIndex.value - 1)`，语义其实是“上一项”而非“左移/上一页”，与 hotkeyLabels 文案也对不上）；src/global/hotkeyLabels.js:101 `'list-nav-left': '左移/上一页'`。`grep -n "nav-left" src/global/hotkeyBindings.js` 零命中，HOTKEY_BINDINGS 共 144 行 features（不是 143），无一指向 list-nav-left。设置页命令行确由 buildCommandShortcutProfiles 生成，src/global/commandKeybindings.js:138-166 只遍历 bindings 累积 profileMap，无 binding 即无 profile，src/global/shortcutStore.js:263/:283/:311 是唯一消费方——“设置页看不到这一行”成立。
两处需更正：
(1) 提议里“left 已被 list-full-data 占用”不实。src/global/hotkeyBindings.js:330 main 层 `left` -> `main-tab-prev`；:332 `c-left` -> `list-view-full`（feature id 也不叫 list-full-data）。而且 `left` 本身在 src/global/shortcutReservations.js:105 的 NON_CONFIGURABLE_SHORTCUT_IDS 里，isRecordableShortcutId(:77-86) 会直接拒绝录制。
(2) “无法为它分配快捷键”不完全成立：src/views/Setting.vue:1793-1799 macroCommandOptions 来自全量 COMMANDS（commandDefaults.js:115）仅按 `risk!=='data-write' && category!=='macro'` 过滤，list.navigate.left(risk 默认 'normal', category 'list') 在候选里；用户可建一个带 shortcutId 的组合命令（Setting.vue:1150-1165 步骤选择器），由 src/cpns/HotkeyProvider.vue:84/:106/:123 registerCommand + executeCommandMacroPlan 的 runRegisteredCommand 按 commandId 派发执行。所以它是“无直接快捷键行、只能绕道组合命令”，不是完全不可达。
附带结论属实：`grep -rn getRecordShortcutConflicts src/` 仅 src/views/Setting.vue:1980 定义一处，零调用；录制保存路径 applyShortcutRecord(:2263-2276) 只做非空校验 + setShortcutOverride，无命令冲突检测，录制期只有 isRecordableShortcutId 的保留键拒绝(:2178/:2221/:2363)；而 :1913-1926、:2314-2316、:2445-2447 的其它入口是弹窗确认而非“直接拒绝”，与 :1621-1622 帮助文案“冲突键录入时直接拒绝”确有出入。
- 影响: 这是一条「代码里实现了、用户完全拿不到」的能力：处理器已经写好并挂在列表层，标签也准备好了，但既没有出厂快捷键，也无法在设置页里给它录一个。docs/用户简明说明.md:22 列的是 `←` `→` 切换 Tab，README.md:41 里 `left` 是全文预览——两份文档都没提到「左移」这个动作，说明它本身可能就是设计中途遗留的半成品。
- 落地: 保持二选一的判断没问题，但两条支路都要改：
1) 若补默认绑定：不能用 `left`（shortcutReservations.js:105 保留键，且 hotkeyBindings.js:330 已给 main-tab-prev）。先确定这条命令到底要什么语义——handler(ClipItemList.vue:2340-2343) 实际等价于 list.navigate.up 的“上一项”，与 hotkeyLabels.js:101 的“左移/上一页”和 commandDefaults.js:80 的 'Move selection left' 三处描述互相打架。若语义与 list.navigate.up 重复，正确动作是删除而不是补键位；若确要保留（例如未来的网格布局左移），先修 label/description，再选一个未占用组合（对照 hotkeyBindings.js 全部 144 行 features 与 SHORTCUT_RESERVATION_RULES 双向查重）。
2) 若判废删除：必须先确认没有存量用户组合命令引用 list.navigate.left。删掉 commandDefaults.js:80 后，已保存的 macro 会在 validateCommandMacroPlanExecutable/executeCommandMacroPlan(src/global/commandMacro.js:231-260) 走 'missing-handler' 失败分支——属于运行时可见回归，不是“无运行时影响”。安全顺序：先在 macroCommandOptions 里下线该命令并给存量 macro 一个迁移/告警，再删 commandDefaults.js:80 / ClipItemList.vue:2742 与 :2340-2343 / hotkeyLabels.js:101。
3) getRecordShortcutConflicts(Setting.vue:1980) 建议单独一条处理：要么在 applyShortcutRecord(:2263) 里接上它 + confirmShortcutConflictRows(:2001)，要么删函数并同时修正 :1621-1622 的帮助文案，别只删函数留下错误文案。
- 回归面: 1) 删除方向并非零风险：存量组合命令引用该 commandId 会变成 missing-handler 失败（commandMacro.js:231-260 + HotkeyProvider.vue:106-129 的失败提示）。2) 新增绑定方向要同时通过两道闸：hotkeyBindings.js 现有 144 条 features 的键位查重，以及 shortcutReservations.js 的保留键/isShortcutAssignable(when 上下文) 校验，否则新绑定在设置页会显示但录制/覆盖时被拒。3) 该 handler 走 setKeyboardActiveIndex，直接牵动列表键盘导航与 .clip-item-scroll 虚拟滚动的 reveal/锚点行为（vibe/rules/project.md:39 明确列为防误改面），任何键位变更需在 uTools 实机验证方向键导航与删除锚点未漂移。4) 若顺手接上 getRecordShortcutConflicts，会把录制路径从“静默保存”变为“弹窗确认”，属于用户可感知行为变更，需与帮助文案一并决策。

## A10. [simplify] 整包零引用死模块可直接删除，约 1650 行

- 位置: `src/global/utoolsDB.js:1`
- 成本/风险/置信: S / low：全部为零 import 模块，构建图不含它们；唯一耦合点是 closeExternalPreview 的调用方，按批3 顺序处理即可。不触碰 ClipSwitch 顶栏、.clip-break、.clip-item-scroll、搜索 reveal/IME、设置页存储状态区。 / high
- 取证: 逐条复核，核心取证成立，行号/文件名有偏差：
(1) src/global/utoolsDB.js:12 `export class UToolsDB`；全仓（src/scripts/vibe/根 test-*）唯一外部引用是 src/global/dbMigration.js:7 `import { UToolsDB } from './utoolsDB'`，dbMigration 自身零消费者。行数 529+217 正确。
(2) src/global/hotkeyGraph.js:70 `buildHotkeyTree`、:149 `getBindingsForLayer`，src 内零 import（Setting.vue 全文 grep buildHotkeyTree/HotkeyTree/hotkeyGraph 均 0 命中，与 vibe/specs/260610-shortcuts-redesign/8YG2-...ad:37 声称的 Setting.vue:579 已不符）。157 行正确。
(3) src/cpns/HotkeyTreeView.vue:28 → HotkeyTreeViewLayer.vue，HotkeyTreeViewLayer.vue:29 → HotkeyTreeViewShortcut.vue，三者构成闭环，无外部消费者。143+147+215 正确。
(4) src/cpns/ClipFloatBtn.vue(16)、src/cpns/ClipWordBreak.vue(27)：src 内 0 命中，仅 vibe/specs/260613-SettingUiModify/260613-zz-raw-settingUiModify.md:72/:145 提及。
(5) src/cpns/ClipItemList.vue 实为 3350 行（非 3342/3334）。openExternalPreview 定义在 :893，函数体收在 :1085 `};`（不是 1086），全文件零调用点；乱码确凿：:1022 `鍏抽棴 (ESC)`、:1026、:1036。externalPreviewWindow 仅在 :883 声明、:916 赋值（openExternalPreview 内部），因此 closeExternalPreview(:1102) 在当前代码里恒为 no-op。
证伪的一处：提议里的前置条件引用错了文件——vibe/knowledge/ARCHITECTURE.md:753 是 `jsonMigration.js | ~200 | JSON 迁移`，与 dbMigration 无关。真正把 dbMigration.js 写成“live migration logic”的是 vibe/knowledge/technical-details.md:16。
- 影响: 不删：约 1650 行（src 30.7k 的 5.4%）持续污染阅读与 grep 面。utoolsDB/dbMigration 实现的是已废弃的 JSON→uTools DB 迁移路线，与当前 JSON→SQLite 主线无关，任何存储改动都会被误认为要同步这条链；hotkeyGraph 的 LAYER_ORDER/LAYER_CATEGORIES 还构成第 5 份层元数据副本。删后 src/global 从 8710 降到约 7800 行，src/cpns 少 742 行。
- 落地: 结论保留（删除成立），但按以下修正执行：
批1：除所列 6 个文件外，还需同步删 src/global/hotkeyLabels.js:49/:134/:144 三条 *-range-summary（已核实仅被 HotkeyTreeViewShortcut.vue:77/80/83 消费），并同步 vibe/knowledge/ARCHITECTURE.md:475（buildHotkeyTree 说明）、:725（HotkeyTreeView.vue 行）、:743（hotkeyGraph.js 行）——原提议漏掉了批1 的文档同步。
批2：把前置条件改为核对 vibe/knowledge/technical-details.md:16（而非 ARCHITECTURE.md:753）；backupJsonDb(dbMigration.js:12)/executeMigration(:141)/rollbackMigration(:193) 确实只存在于该文件且零调用，删除后在 PROJECT_STATUS 记“旧 JSON→uTools DB 迁移/回滚能力移除”。当前 SQLite 主线走 src/storage/jsonMigration.js，不受影响。
批3：删除范围应是 ClipItemList.vue:883-1085（含 :883 externalPreviewWindow 声明、:885-891 escapePreviewText——已核实仅被 :928 消费）+ :1087-1100 focusUtoolsMainWindow（仅被 :1108 消费）+ :1102-1114 closeExternalPreview，并同步删掉 :826、:837 两处调用（均在 stopImagePreview :813 内，删后行为完全不变，因为该函数恒 no-op）。原提议“先改 no-op 再删调用点”多此一举，且遗漏了 escapePreviewText/focusUtoolsMainWindow 两个连带孤儿。
- 回归面: 运行时回归面接近零：6 个文件 + dbMigration 链在 Vite 构建图外（dist/assets 无对应 chunk）；批3 删除的整块因 externalPreviewWindow 恒 null 而已是死路径，不触碰 .clip-item-scroll、删除锚点、虚拟/分页滚动、ClipSwitch 顶栏、搜索 reveal/IME。真实风险集中在文档面：批1 会让 ARCHITECTURE.md:475/:725/:743 与 vibe/specs/260610-shortcuts-redesign 两份 .ad 出现悬空引用，批2 会让 technical-details.md:16 的 storage 表失准，需按 rule-change-consistency 一并更新；另需注意 ClipItemList.vue:1525 的注释仍写“TanStack 虚拟滚动容器”，批3 附近改动时容易被误当作有效上下文。

## A11. [simplify] 死配置项与未使用依赖：drawerOrder 只写不读、syncWithUTools 恒 false、getRecordShortcutConflicts 零调用、@tanstack/vue-virtual 未安装即声明

- 位置: `src/views/Setting.vue:2908`
- 成本/风险/置信: S / low：四项均已验证为不可达或只写不读。唯一需要人决策的是 (3) 的两条路线选择与 (2) 的需求确认；(4) 只影响构建配置，dist 已证实无该 chunk。 / medium
- 取证: (1) drawerOrder 成立：src/views/Setting.vue:1749 写入 buildContextMenuActionRows 的入参（这是活的），:2908 写入 save payload 的 `operation.drawerOrder`（这条是死的）；真实来源确为 dbStorage `drawer.order`（Setting.vue:1738-1739 读、:2760/:2766 写；ClipItemList.vue:1616-1618 读、:1446 写）。全仓无 `setting.operation.drawerOrder` 读点，contextMenuActions.js:62/80/89 的 drawerOrder 形参一律由调用方传 dbStorage 值，与 setting 无关。
(2) syncWithUTools 部分证伪：读点不是 shortcutStore.js:215（那是定义 isShortcutUToolsSyncEnabled），实际分支有两处——shortcutStore.js:239（getEffectiveShortcutOverrides）与 :375（保存路径）。更关键：readSetting.js:64-65 是 `if (typeof ... !== 'boolean') = false` 的条件兜底，不是“强制写 false”。因此老版本已持久化 `syncWithUTools: true` 的用户，读取后仍为 true，两条分支可达，直到 Setting.vue:2914 保存或 restoreSetting.js:29 重置。“恒 false”对新装成立，对存量安装不成立。
(3) getRecordShortcutConflicts 成立：src/views/Setting.vue:1980 定义，全文件（含 template）零调用。录制路径缺冲突检测也属实：applyShortcutRecord(:2263-2276) 只 dedupeShortcutIds 后 setShortcutOverride。但“文案与实现不符”的描述需修正——现有冲突路径 :1913-1926 与 :2314-2316 走的是 confirmShortcutConflictRows(:2001)，弹的是“仍要保存这个绑定吗？”，是二次确认而非 :1622 文案所称的“直接拒绝”。
(4) @tanstack 标题失实：`ls node_modules/@tanstack/` 返回 vue-virtual，依赖已安装，不是“未安装即声明”。其余成立：src 下 useVirtualizer/tanstack 0 命中，vite.config.js:32-34 分支永不命中，dist/assets 确无 vendor-virtual chunk；ClipItemList.vue:16 是 `v-for="(item, index) in showList"` 全量渲染。
(4-补) 提议的替换文案数字错误：src/views/Main.vue:510 `const GAP = 15`，:922 初始 `baseList.slice(0, GAP)`=15，:873 换 Tab 预取 `GAP * TAB_PREFETCH_PAGES`(:526=3)=45，触底 loadMoreData(:1443) 每次 GAP=15。不存在“初始 50 / 触底 30”。
- 影响: 不删：四处死配置各自制造一条假语义链。syncWithUTools 让 shortcutStore.js:230 的四路读取看起来是四种真实模式，实际只有三条可达，直接抬高“快捷键配置到底存在哪”的理解成本；drawerOrder 造成同一份右键顺序在 setting 与 dbStorage 两处并存的错觉；@tanstack 声明还让 README.md:12 与 ARCHITECTURE.md:30/:227/:236 的“虚拟列表”承诺看起来有依赖背书，是本次审计唯一一条文档承诺的能力实际不存在。删后 shortcutStore 读路径从 4 条降到 3 条，vite manualChunks 少一个死分支，依赖树少一个包。
- 落地: (1) 照办，但只删 Setting.vue:2908 payload 里的 `drawerOrder`；:1749 必须保留（它是 buildContextMenuActionRows 的活入参，删了会破坏设置页右键顺序预览）。原提议“删 :1749 的 drawerOrder 字段”会造成回归，须改。
(2) 降级为“不要现在删”。删除前必须补一步存量数据迁移：因 readSetting.js:64-65 只做类型兜底，需先在 readSetting 里无条件置 false（或写一次性迁移）跑满一个版本，再删 shortcutStore.js:214-216 与 :239、:375 两处分支（原提议只说了一处）。注意 SHORTCUT_STORAGE_MODE_UTOOLS_SYNC 常量与 Setting.vue:1626 的“uTools 同步”标签仍被 :238 的 getShortcutRuntimeSource(PUBLIC) 分支使用，不可一并删除。
(3) 照办删 Setting.vue:1980-1992，但配套改动改为：把 :1622 文案从“冲突键录入时直接拒绝”改成与实现一致的“检测到冲突时二次确认”，并单独记一条 TODO——录制弹窗（applyShortcutRecord）尚未接入 confirmShortcutConflictRows。不要在同一次改动里把函数接进 applyShortcutRecord（那是行为变更，不属于 simplify 范畴）。
(4) `pnpm remove @tanstack/vue-virtual` + 删 vite.config.js:32-34 可做。文档改写必须用真实数字：README.md:12 与 ARCHITECTURE.md:30/:222-236 应改为“分页加载：初始 15 条（换 Tab 预取 45），触底每次追加 15 条 + 全量 v-for 渲染”，而不是提议里的“初始 50 / 触底 30”。同时修 ClipItemList.vue:1525 的过时注释（仍写 TanStack 虚拟滚动容器），并与 vibe/rules/project.md:39 里“虚拟滚动”这一受保护行为项对齐措辞。
- 回归面: (1) 若照原文删 Setting.vue:1749，设置页右键菜单顺序预览（contextMenuActionRows → contextMenuActionSummary）立即失序，是本条最大的误改风险。(2) 直接删 syncWithUTools 会让存量 true 用户的快捷键 override 读取路径从 UTOOLS_SYNC 静默切到 SQLite/setting，可能丢失其已保存的自定义快捷键——属于存储迁移面，触碰 project.md 的存储迁移与 fallback 约束。(3) 纯删死函数无运行时风险，但文案改动会影响用户对冲突行为的预期。(4) 依赖与 vite 分块无运行时影响（0 import、dist 无 chunk），风险全在文档：project.md:39 明确把“虚拟滚动”列为不可轻改的受保护行为，改 README/ARCHITECTURE 需走 rule-change-consistency，且提议给的替换数字本身错误，照抄会把一个错误换成另一个错误。不涉及 preload/listener/plugin.json features，uTools 实机行为不变。

## A12. [simplify] 8 个 SFC 的 scoped style 里 @import 整份全局样式，使 index.less 在产物中被复制 9 份，CSS 1.05MB

- 位置: `src/style/index.less:1`
- 成本/风险/置信: M / medium：纯视觉回归面，无逻辑风险，但覆盖顺序变化不会报错只会“看起来不对”。每步必须 pnpm run build + uTools 实机对照；不改任何 DOM 结构、不动 .clip-item-scroll 的高度/overflow 声明、不动 ClipSwitch 顶栏布局，因此搜索 reveal、键盘导航、删除锚点、输入框默认行为不受影响。 / high
- 取证: 全部取证核实无误，且我做了独立量化复核。

- src/main.js:7 `import './style/index.less'` 属实。
- 8 处 scoped @import 行号逐个精确：src/cpns/ClipItemRow.vue:343、src/cpns/ClipOperate.vue:44、src/cpns/ClipFullData.vue:146、src/cpns/ClipSwitch.vue:106、src/cpns/ClipSearch.vue:191、src/cpns/ClipItemList.vue:3021、src/cpns/FileList.vue:28、src/views/Main.vue:2343。八者的 style 标签均为 `<style lang="less" scoped>`（分别在上一行 :342/:43/:145/:105/:190/:3020/:27/:2342），且 @import 都是块内第一行。全仓再无第九个 SFC 有 @import（Setting.vue 无）。
- src/style/index.less:1-12 定义 .import() mixin（9 个 cpns 文件），在 :66 与 :121 各展开一次（light 的 `html, #app` 与 dark 的 `html[data-theme='dark']`），属实。
- 产物复核用的是当前 dist/assets/index-Dgv_FIiW.css（1,078,099 字节，与所述 1,077,723 同量级，只是重建后 hash 变了）。我验证过它不是陈旧产物：`setting-card-content-item` 在 src 里 grep 不到定义，是 src/style/cpns/setting.less 的 `&-content`/`&-item` 嵌套拼出来的，这正好解释 433 次 = 约 12 条源规则 × 18 份副本 ×（html/#app 两个选择器）。
- clip-item-scroll 37 次的构成我逐条数过：8 个 data-v 哈希各 4 次（light/dark × html/#app）+ ClipItemList 自己的局部规则 1 次 + 全局无 data-v 的 4 次 = 37。即 1 份全局 + 8 份 scoped，规则级实为 18 份（9 × light/dark）。
- 收益量化比提议更硬：把 CSS 按 `}` 切成 4394 条规则后，选择器以 html/#app 开头且带 data-v 的（即 scoped 副本）共 2880 条、824,968 字节 = 全文件的 76.5%。删净后残留约 253KB，提议所称"280KB 量级、约 -73%"准确。
- collect-block 孤儿属实：src/style/cpns/collect-block.less 存在（23 行，定义 .collect-block-header:3 与 .collect-block-separator:19），不在 index.less:3-11 的 .import() 清单内，`grep -c collect-block-header dist/assets/index-Dgv_FIiW.css` 为 0，而 src/views/Main.vue:124 确实在用 class="collect-block-header"。
- 影响: 不改：插件首屏要解析 1.05MB CSS，且每次新增一个组件都可能再复制一份。改后首屏 CSS 预计降到 280KB 量级（约 -73%），对 uTools 小窗口冷启动是可测收益。同时 collect-block.less 的孤儿状态说明 index.less 的 .import() 清单已是需要人工同步的隐式契约。
- 落地: 确认提议，并补三条落地细节（都会降低风险）：

1. 编译安全性已可证明，不必逐个试探：我对 8 个 style 块 @import 之后的全部内容做过 Less 变量扫描，零处使用 @var / fade() / .mixin()，因此删掉 @import 不会出现变量未定义的编译失败。
2. 顺序应改为"先删 5 个零局部规则的"。这 5 个文件的 scoped 块除 @import 外只剩一行 `</style>`：ClipItemRow.vue(343/共344行)、ClipSearch.vue(191/192)、ClipSwitch.vue(106/107)、ClipOperate.vue(44/45)、FileList.vue(28/29)。删掉后该组件的 scoped 样式表整体消失，组件内部不存在任何覆盖顺序可变的对象，是可证明安全的一批 —— 包括提议出于防误改而排到倒数第二的 ClipSwitch.vue。真正需要逐个截图核对的只有 3 个有局部规则的：ClipFullData.vue(:146 后 10 行)、Main.vue(:2343 后 245 行)、ClipItemList.vue(:3021 后 329 行)，放最后。
3. .clip-item-scroll 这一条可以直接给出"不会破坏"的证明，不必只靠截图：全局规则是 src/style/cpns/clip-item-list.less:5-10 的 `.clip-item-list .clip-item-scroll { flex:1 1 auto; min-height:0; overflow:auto }`（选择器权重 0,3,1，因 index.less 的 html/#app 包裹），ClipItemList.vue 局部规则是 :3042 附近的 `.clip-item-scroll{overflow-y:auto;overflow-x:hidden}`（0,2,0）。删 @import 前后全局都以 0,3,1 胜出，overflow 与 min-height:0 的最终计算值不变，故 EM-2026-04-06-scroll-path 记录的"滚动退化到 document"路径不会被触发（该 EM 就写在 ClipItemList.vue:3023-3024 的注释里）。

第一步（collect-block）与第三步（Less @var → CSS var）的判断也确认，但第三步要标更高成本：cpns/*.less 里 fade() 共 94 处（clip-item-list.less 45、clip-switch.less 12、clip-search.less 9、clip-full-data.less 8，其余 2-4 处不等），改 CSS var 需把每个 fade() 手工换成预计算 rgba 或改用已有的 --*-color 自定义属性，属独立任务，不应与第二步同批提交。
- 回归面: 确为纯视觉/层叠回归面，但"无逻辑风险"这个说法要收紧一点：
(1) 层叠顺序会系统性地倒向组件自身规则。产物里全局那份无 data-v 的副本位于第 4004/4394 条规则，排在所有组件 scoped 块之后；当前每个组件块内 @import 在前、局部规则在后，同权重时局部胜；删掉后全局那份权重降一个属性选择器，同权重仍是局部胜，方向一致，但"局部规则 vs 全局规则"的权重差从 -1 变 0，原本被 scoped 副本压住的局部规则会翻上来。只有 Main.vue / ClipItemList.vue / ClipFullData.vue 三个文件有局部规则，回归面就限定在这三处。
(2) 对 element-plus 的相对权重会下降。scoped 副本现在给全局规则多一个 [data-v] 属性权重，删后 `html .x`(0,1,1) 可能输给 vendor-element-plus-BvDwu9h2.css(83KB，独立文件) 里的深层选择器。clip-search.less / clip-operate.less / setting.less 里大量针对 .el-input / .el-select / .el-textarea / .el-tag 的规则属高危，必须实机看搜索框、标签选择器、操作栏。
(3) 与 vibe/rules/project.md:39 的关系：不改任何 DOM、不改 .clip-item-scroll 的 height/overflow 声明、不动 ClipSwitch 顶栏布局，搜索 reveal/IME 保护与删除锚点均不在层叠路径上；虚拟滚动依赖 .clip-item-scroll 的实测高度，但如上所证该元素计算值不变。
(4) 完全不触碰 scripts/utools-runtime-assets.mjs 生成的 plugin.json / preload.js / listener.js / time.js，无 uTools 实机行为风险；也不触碰存储迁移与 JSON fallback。
(5) 唯一"沉默失败"渠道：dist 被 .gitignore（.gitignore:3 `/dist`），每步必须 pnpm run build 后在 uTools 实机对照，否则视觉回归不会有任何报错。

## A13. [simplify] FileRichPreview.vue 1362 行：PDF 生命周期与格式解析可拆两个模块，且 Markdown/AsciiDoc/DOMPurify 三段管线与 textDocumentPreview.mjs 逐字重复

- 位置: `src/cpns/FileRichPreview.vue:447`
- 成本/风险/置信: M / low-medium：预览是低耦合子系统，且 test-file-preview.mjs 有 151 assert 覆盖分类/文本探测/清洗。(1) 需确认两侧 DOMPurify 配置确实一致（已逐行比对相同）才能合并，否则会改变某一侧的消毒白名单。不涉及键盘导航与滚动容器，Shift 悬停预览的触发链（ClipItemList.vue:1852 定时器 → runPreviewForItem）不变。 / high
- 取证: 逐行核对，核心证据成立，但有三处需修正。

【成立且逐字相同】src/cpns/FileRichPreview.vue:447-459 `async function sanitizeHtml(html)` 与 src/utils/textDocumentPreview.mjs:235-247 完全逐字相同（同为 `await import('dompurify')` + `sanitizePreviewHtml(html, (source) => DOMPurify.sanitize(source, { USE_PROFILES: { html: true }, ADD_ATTR: ['target','rel'] }))`，catch 分支同为 `return sanitizePreviewHtml(html)`）。两侧的 sanitizePreviewHtml 同源：FileRichPreview.vue:117 与 textDocumentPreview.mjs:4 都从 './filePreview.mjs' 导入。这一条是真实的逐字重复。

【夸大：loadMarkdown/loadAsciiDoc 并非“相同”】FileRichPreview.vue:518-530 loadMarkdown 与 textDocumentPreview.mjs:206-216 buildMarkdownPreview 签名与返回结构都不同：前者 `(file, sourceText)`、内部走 readTextFilePreview 读盘、返回 `{ type:'html', detectedKind, html }`；后者 `(text, detectedKind)`、返回 `{ ...createEmptyTextDocumentPreview(text), kind:'html', detectedKind, html }`。真正相同的只有 `new MarkdownIt({ html:false, linkify:true, breaks:true })` 这一行配置。AsciiDoc 同理：FileRichPreview.vue:532-549 vs textDocumentPreview.mjs:218-233，只有 `asciidoctor.convert(text, { safe:'safe', backend:'html5', attributes:{ showtitle:true } })` 相同。所以“三段管线逐字重复”应降级为“一段逐字重复（sanitizeHtml）+ 两段配置常量重复”。

【结构行号成立】template 1-105 / script 107-1088 / style 1090-1362 全部核对无误。PDF 常量 :143-152 成立；PDF runtime cache 与 objectURL 账本 :198-254（getPdfRuntimeCache 198 / revokePdfObjectUrl 215 / releaseSinglePdfObjectUrl 222 / releaseActivePdfObjectUrls 227 / cancelScheduledPdfRender 232 / releasePdfDocument 244）成立，但漏列了同属 PDF 的性能埋点 :160-196（nowMs/createPdfPerfContext/shouldDebugPdfPerf/debugPdfPerf）。PDF 渲染调度 :690-981 成立（getPdfRenderScale 690 … loadPdf 917-981）；格式解析块 :431-663 成立（getTextPreviewByteLimit 431 … loadTextDocument 663）；loadPreview 在 :983 汇合成立。

【无相互调用属实】对 :690-981 grep formatTextByFile|createPlainTextPreview|createStructuredFilePreview|loadMarkdown|loadAsciiDoc|sanitizeHtml|loadTable|loadWord|loadTextDocument|getTextPreviewByteLimit 零命中；对 :431-663 grep pdf|Pdf 零命中。两块确实解耦。

【触发链属实】src/cpns/ClipItemList.vue:1852 `hoverPreviewTimer = setTimeout(...)` → :1854 `runPreviewForItem(item)`，runPreviewForItem 定义在 :1181，FileRichPreview 在 :125 使用、:233 导入。

【assert 数】test-file-preview.mjs 实际 152 处 assert（不是 151），量级无差别。
- 影响: 不改：三段渲染管线任一处改配置（比如给 MarkdownIt 开 typographer 或调整 DOMPurify 白名单）都会静默产生两种渲染结果——文件预览与剪贴板文本预览对同一段 Markdown 给出不同 HTML。且 1362 行单文件同时扛运行时探测、同步/异步读盘、9 种格式解析、HTML 消毒、PDF 全生命周期、两套 LRU 缓存、滚动 API、性能埋点，是修改成本最高的预览入口。拆后组件预计降到约 500 行。
- 落地: 提议方向成立，但必须补两个前置条件，否则会当场打红。

(1) 去重这一步保留，且应收窄：只把 sanitizeHtml（FileRichPreview.vue:447-459 与 textDocumentPreview.mjs:235-247）这一个逐字相同的纯函数下沉，因为两侧配置已实测一致，合并不改任何一侧的消毒白名单。markdown-it / asciidoctor 那两处不要按“同一个函数”合并——两侧返回结构不同（`{type:'html'}` vs `{...createEmptyTextDocumentPreview, kind:'html'}`），只应把配置对象抽成常量（如 MARKDOWN_IT_PREVIEW_OPTIONS / ASCIIDOCTOR_PREVIEW_OPTIONS）与 `renderMarkdownToHtml(text)` / `renderAsciiDocToHtml(text)` 两个「text → sanitized html」纯函数，结构包装留在各自调用方。原提议正文里其实已写了这句约束，但标题与取证的“逐字重复”表述会误导执行者去合并整个函数，需要以正文为准。
下沉位置建议直接放进已存在的 src/utils/filePreview.mjs（sanitizePreviewHtml 的宿主），而不是新建 src/utils/richTextRender.mjs——新建会让 filePreview.mjs / textDocumentPreview.mjs / richTextRender.mjs 三者的职责边界更难说清；如果坚持新建，依赖方向 richTextRender → filePreview 必须单向，不能反向。

(2)(3) 抽 PDF 与抽解析之前，必须先改 test-file-preview.mjs。这是原提议完全漏掉的硬阻塞：该测试不是行为测试，而是对 FileRichPreview.vue 源文件做正则断言（test-file-preview.mjs:209/221/260/271/356 各自 readFileSync('./src/cpns/FileRichPreview.vue')）。一旦把 PDF 块移出组件，testPdfPreviewUsesLegacyBuild（断言 /pdfjs-dist\/es5\/build\/pdf\.js/、/isEvalSupported:\s*false/）与 testPdfPreviewUsesFastFirstPagePath（断言 /PDF_INITIAL_PAGE_COUNT\s*=\s*1/、/tryLoadPdfSharpFirstPage/、/canvas\.toBlob/、/requestIdleCallback/、/backend:\s*['"]utools-sharp['"]/）立刻全红；把解析块移出后，testDocumentPreviewUsesAsyncReadAndCache（/DOCUMENT_PREVIEW_CACHE_LIMIT/、/getCachedDocumentPreview/…）、testStructuredDocumentPreviewPathExists（/loadStructuredJson/、/import\('yaml'\)/…）、testPresentationPreviewUsesLowFidelityPptxPath（/loadPresentation/、/import\('jszip'\)/…）同样全红。正确顺序是：先把这些断言的 readFileSync 目标改成新模块路径（或改成读取组件+新模块拼接后的字符串），再动源码，每步单独提交，便于回退。

另外修正拆后体量预期：script 段 982 行，移走 143-152(10) + 160-254(95) + 431-663(233) + 690-981(292) 后剩约 350 行，加 template 105 + style 272，组件实际落在 730-780 行量级，不是“约 500 行”。style 段没有拆分计划，这一点决定了收益上限。
- 回归面: 1) 最大回归面是 test-file-preview.mjs 的源码正则断言（209/221/260/271/356 五处 readFileSync FileRichPreview.vue），必须与拆分同批修改，否则 CI/自测直接红。原风险评估把这 152 个 assert 说成“覆盖保护”，方向反了——它们是耦合，不是护栏。
2) uTools 实机面：PDF 走 preload 暴露的 renderPdfFirstPagePreview（scripts/utools-runtime-assets.mjs 内联字符串生成）与 window.exports 上的 readTextPreviewFile/readBinaryPreviewFile，组件通过 getRuntimeExports()(FileRichPreview.vue:305) 取。抽到 src/hooks/usePdfPreview.js 后 getRuntimeExports 也要一起搬或注入，漏搬会在实机上静默退回 fallback 路径（浏览器 dev 下不暴露）。preload/listener/plugin.json 本身不需要动，这一点风险为零。
3) objectURL 账本（:215-231）与 releasePdfDocument(:244) 挂在 onUnmounted 上，搬进 hook 后必须在 hook 内部重新绑定生命周期，否则切换文件/关闭预览时 blob URL 泄漏，长时间使用内存持续上涨。
4) 不触碰 vibe/rules/project.md 的任何防误改点：不涉及搜索 reveal/IME、.clip-item-scroll 滚动祖先、删除锚点、虚拟滚动、ClipSwitch 顶栏、repository facade、存储迁移与 JSON fallback。Shift 悬停触发链 ClipItemList.vue:1852→1854 不变。
5) sanitizeHtml 合并本身零风险（已逐字比对一致）；但如果执行者按标题去合并整个 loadMarkdown/buildMarkdownPreview，会改变 textDocumentPreview 返回结构，直接打断剪贴板文本预览的渲染分支——这是本条最可能被误执行的地方。

## A14. [simplify] Setting.vue 5607 行可拆为 12 组件 + 11 composable + 8 样式文件，且 4 个页签用 v-show 导致首开必渲染全部命令行

- 位置: `src/views/Setting.vue:1`
- 成本/风险/置信: L / medium：拆分本身机械，但 script setup 里大量跨块共享的 ref（hotkeyOverrides、featureRows、activeTab）需要明确归属，拆错会造成响应式断链。建议按“先抽 Dialog（自包含度最高）→ 再抽 Panel → 最后抽 composable”的顺序，每步 build + 手工走一遍改键与自定义功能两条主流程。v-show→v-if 需验证页签切换后草稿态不丢（草稿现在存在 Setting.vue 顶层 ref，keep-alive 可保）。 / high
- 取证: 结构与关键事实核对基本属实，含一个真实 bug；但样式拆分与部分 composable 归属有实质错误。

【成立】src/views/Setting.vue：template 1-1207 / script 1209-3069 / style 3071-5607（scoped Less 2536 行）全部核对无误。四页签边界与 v-show 属实：:47 `v-show="activeTab === 'basic'"`、:134 shortcut、:589 feature、:750 feature-config，四个都是 v-show，无一 v-if。七个 el-dialog 起止行逐一核对成立：301-439 / 440-588 / 713-747 / 948-1007 / 1008-1052 / 1053-1129 / 1130-1203。

【成立，行号略偏】保留按键表格重复属实，但精确范围是 :187-204 与 :326-343（<table class="shortcut-reservation-table"> 到 </table>），两段除 v-for key 前缀 `strip:` 外完全相同；原文给的 181-204 / 322-345 把外层 popover reference 也算进去了，问题本身成立。

【成立】src/App.vue:15 `import Setting from './views/Setting.vue'` 确为静态 import。但需补一句原文没说的：App.vue:6 是 `<Setting v-if="settingShown">`，所以 Setting 并不在应用首帧建树，代价是 bundle chunk 体积，不是首屏渲染时间——原文“首开设置页”措辞是对的，但“进入首屏 chunk”只影响下载/解析，不要按渲染耗时去量化。

【成立，且量化准确】src/global/commandDefaults.js:14 起字面量 81 条 + :106-113 的 `for (let i=1;i<=9;i++)` 每轮 push 4 条 = 36 条，合计 117 条，与原文完全一致。shortcutScope 默认值 :1405 `ref('all')`，filteredShortcutCommandRows(:1719) 在默认态不过滤，所以 117 行确实全量渲染。每行 el-tooltip 实测约 6 个（:246 每个 shortcutId 一个、:256/:259/:262/:270/:278 五个固定），量级成立。唯一需降调的是“600+ ElPopper 实例”：ElTooltip 的 content 是懒渲染的，未触发前不会创建 popper.js 实例，实际是约 700 个 ElTooltip 组件实例的 setup 开销，不是 700 个活跃 popper。

【真实 bug，确认成立】shortcutSyncDialogVisible 定义在 :1348，只在 :937（打开）、:949（v-model）、:1004（关闭）出现；isSettingOverlayOpen(:1509-1518) 与 closeTopSettingOverlay(:2080-2105) 的判断链里都没有它。Esc 链路已核实可复现：keyDownHandler 在 :3033 以 `document.addEventListener('keydown', keyDownHandler, true)` 捕获阶段注册，早于 Element Plus 的冒泡阶段 esc 处理；:2967-2979 逻辑为 closeTopSettingOverlay() 返回 false 且 !isEditableTarget(e.target) 时直接 `emit('back')` + preventDefault + stopPropagation。因此「快捷键配置管理」对话框打开、焦点不在输入框时按 Esc，确实会整页退出设置。这一条是本次审计中价值最高的发现，且与拆分无关，可以独立先修。

【错误：composable 行号有张冠李戴】useShortcutRecorder 声称含 2140-2372，但 :2140 是 `const commandMacroRows = computed(...)`（组合命令），:2370-2372 是组合命令取消的 ElMessage 分支；而 useCommandMacroDrafts 声称含 1766-1960，但 :1766 是 `function focusShortcutRecorder()`（录制器）。这两组区间明显交叉错配，按原文直接切会把两个 composable 的成员搞反。useFeatureOperations 2492-2573 抽查合理（:2492 customDialogVisible 等自定义功能对话框状态）。其余区间未逐一验证，需执行前全部重核。

【错误：样式切点落在规则中间】声称的 3072-3535 / 3536-3883 分界，实测 `.shortcut-key-cell { display: inline-flex; }` 横跨 3535-3537，切在 3535/3536 会把一条规则劈开。3883/3884 处（`.when-edit-dialog` 起始）倒是干净边界。
- 影响: 不改：单文件 5607 行是全仓最大阅读单元，任何设置项改动都要在 1207 行模板 + 1860 行脚本 + 2536 行样式里定位；四页签 v-show 使首开设置页一次性建树全部命令行（COMMAND_DEFINITIONS 81 条 + 9×4 循环生成 36 条 = 117 行 × 每行 6 个 el-tooltip ≈ 600+ 个 ElPopper 实例）。拆后主文件预计降到约 300 行壳，且改一个页签不再触碰其余三个。
- 落地: 结论：拆分方向成立，但必须改三处，并调整执行顺序。

第 0 步（独立先做，不要混进重构）：修 shortcutSyncDialogVisible 漏登记。在 isSettingOverlayOpen(:1509) 的布尔链里加 `shortcutSyncDialogVisible.value ||`，在 closeTopSettingOverlay(:2080) 里按现有 if 模式补 `if (shortcutSyncDialogVisible.value) { shortcutSyncDialogVisible.value = false; return true }`（位置放在 contextMenuDialogVisible 分支旁）。这是 ~6 行的独立 bugfix，收益远高于整个拆分，且可单独验证：打开「功能配置」→「快捷键配置管理」→ 按 Esc，应只关对话框、设置页仍在。原提议把它塞在 useSettingOverlayKeys 迁移里附带处理，等于把一个可立即交付的修复押在一个 L 级重构上，顺序错了。

第 1 步：抽 cpns/ShortcutReservationTable.vue，消除 :187-204 与 :326-343 的整段重复。这是零风险、纯收益、样式随迁即可的一步，应该排在最前而不是被当作“另抽”。

第 2 步（样式方案必须改）：不要按行号 3072-3535 / 3536-3883 / … 切八个文件。scoped 样式的作用域是按组件走的——一旦把 template 47-133 搬进 SettingStoragePanel.vue，留在 Setting.vue 的 scoped 规则只会给子组件根元素带 data-v，子组件内部结构会整片失去样式。正确做法是样式按组件归属随 template 一起迁移（每个 Panel/Dialog 的规则跟到各自 SFC 的 <style lang="less" scoped>），跨组件共享的 token/mixin 才抽成 src/views/setting/setting-shared.less 由各 SFC `@import`。同时切点要落在规则边界上（如 3537 而非 3535）。按行号机械切 8 个文件这条建议应当作废。

第 3 步：Dialog → Panel → composable 的顺序保留（自包含度递减是对的），但每个 composable 的成员必须在动手前重新按符号定位，不能沿用原文区间——已实测 useShortcutRecorder(2140-2372) 与 useCommandMacroDrafts(1766-1960) 两组区间互相错配。

第 4 步（建议降级为可选）：v-show → v-if + keep-alive。keep-alive 不能包 `<div>`，只有在第 2 步的 Panel 组件抽完之后才谈得上，所以它不是“顺带”，是最后一步的可选项；且要权衡——改成 v-if 后每次左右方向键切页签（:setting.tab.prev/next 命令，见 :3018-3026）都会重建 117 行 × 6 tooltip，把一次性开销换成每次切换的开销，keep-alive 若配错反而更慢。原文“存储状态区展示字段（mode/migrationStatus/fallback 源/errorMessage）原样保留”的约束是对的，必须守住。

最后：App.vue:15 改 defineAsyncComponent 属于纯收益但要留意时序——App.vue:20-28 watch(settingShown) 会立即 activateLayer('setting')，而 Setting.vue onMounted(:3033) 才注册 document 捕获 keydown。异步加载会拉出一个「layer 已激活但 Setting 的键盘处理器尚未挂载」的窗口，此期间 Esc/方向键无人接管。建议加 Suspense fallback 或把 activateLayer 时机对齐组件挂载。
- 回归面: 1) 样式作用域断裂（最高风险，原文未识别）：2536 行 scoped Less 若按行号切而不按组件归属迁移，四个 Panel + 七个 Dialog 抽出后会大面积掉样式，且不会报错、只在肉眼上崩，属于典型“build 通过但界面全花”。
2) v-if 引入的 DOM 存在性假设断裂：`document.getElementById('database-path')`(:2951) 指向 basic 页签内 :53 的 input；openFeatureShortcut(:2727)/openShortcutSystemConfig(:2735)/openContextMenuShortcut(:2743) 都是先 `activeTab.value='shortcut'` 再 focusShortcutSearch()(:1966，走 nextTick 拿 shortcutSearchInputRef)。v-show 下目标元素恒存在，v-if 下依赖挂载时序，属于 project.md「修改动态滚动、焦点、高亮、列表导航时必须确认真实焦点入口和真实触发链」直接命中的区域，必须实机逐条走一遍「功能页跳快捷键并聚焦搜索框」。
3) 跨块共享 ref 的归属（原文已提示，确认成立）：hotkeyOverrides(:1346)、activeTab(:1399)、settingRootRef(:1400)、shortcutScope(:1405) 等被 template、keyDownHandler(:2965)、多个 computed 同时引用，拆 composable 时若用值传递而非 ref 传递会静默断响应式——同样是 build 绿、运行时不更新。
4) 存储状态区（:47-133）受 project.md 明文保护：「不要仅因视觉偏好重排 … 设置页存储状态区」。SettingStoragePanel 抽取必须原样保留 mode/migrationStatus/fallback 源/errorMessage 四类展示（:88/:108/:118/:124 四个 v-if 分支），且不得改动 refreshStorageStatus 的 STORAGE_STATUS_EVENT 订阅(:3009)。
5) uTools 实机面：activeTab 持久化走 utools.dbStorage(:1385/:1392)，contextMenu 顺序写 `utools.dbStorage.setItem('drawer.order', ...)`(:2759)，快捷键落盘走 setting/userConfig。拆 composable 时这些副作用必须留在同一事务边界内，否则出现“页签记住了但快捷键没存”这类半持久化。preload/listener/plugin.json 不受影响。
6) 本条不触碰搜索 reveal/IME、.clip-item-scroll、删除锚点、虚拟滚动、ClipSwitch 顶栏、repository facade（这些都在 Main.vue/ClipItemList.vue 一侧）。

## A15. [simplify] Main.vue 2588 行可抽六个 composable，且 onUnmounted 被误嵌套在 onMounted 回调体内

- 位置: `src/views/Main.vue:2329`
- 成本/风险/置信: L / medium：onUnmounted 提升会真实改变监听器注销时机（当前是嵌套但仍注册成功，提升后语义相同但更可靠）。验证：切 tab、搜索、删除、触底加载、清空对话框、置顶粘贴各走一遍，并确认离开插件后 document 上无残留 keydown/scroll 监听。 / high
- 取证: 两个核心缺陷逐字核实通过。

1) onUnmounted 嵌套：src/views/Main.vue:1814 `onMounted(() => {` 为顶层；src/views/Main.vue:2329 `onUnmounted(() => {` 虽写在第 0 列，但词法上位于 onMounted 回调体内 —— :2338 `    });` 闭合 onUnmounted 回调，:2339 `});` 才闭合 onMounted，:2340 `</script>`。全文件仅此一处 onUnmounted。✓ 行号完全准确。

2) maybePrefetchNextPage 不可达：src/views/Main.vue:1494 定义，唯一调用点是 src/views/Main.vue:1504（在 handleListLoadMore:1502 内，条件 `typeof payload?.index === "number"`:1503）。src/views/Main.vue:151 `@loadMore="handleListLoadMore"`；src/cpns/ClipItemList.vue 的四处发射 :1562 / :2212 / :2306 / :2834 全部是裸 `emit("loadMore")`，无 payload → payload 恒为 `{}` → 分支恒假。NEXT_PAGE_PREFETCH_THRESHOLD(src/views/Main.vue:527) 仅在 :1497 被读。✓ 二者确为死码。

3) 块边界部分属实、部分失实：
- tab 持久化 1769-1813 ✓（MAIN_TAB_STATE_KEY:1769 … isClearingCollectTab:1812）
- 分页与删除恢复 1443-1750 ✓（loadMoreData:1443 / handleListLoadMore:1502 / syncAfterVisibleDelete:1521 / adjustActiveIndexAfterDelete:1576 / resolveDeleteRecoveryPreferId:1598 / handleItemDelete:1613 / handleItemsDelete:1679）
- “查询装配与缓存 510-970”不纯：区间内 635-690 是清空对话框代码（getClearDialogFocusables:635 / handleRangeClick:658 / watch(clearRange):668 / CLEAR_GRID_COLS:677 / handleRangeKeydown:678），808-861 是置顶组预览辅助（getItemInlineSummary:808 / getFileNameFromPath:824 / getFilePreviewType:827 / getPinGroupPreviewLines:839），518-521 是 pinnedMap/pinGroup/pinGroupEditor 状态。
- “置顶与置顶组合 1196-1414”起点错：1196-1218 是 fullData/fullDataShow/toggleFullData/ClipSwitchRef/displayList/currentShowList —— displayList:1206 与 currentShowList:1211 是全文件共享的核心 computed，不属于置顶。
- “useMainHotkeys(2022-2332)”两端都错：registerMainHotkeyFeatures 实际是 src/views/Main.vue:2015-2326，:2327 是 `nextTick(() => registerMainHotkeyFeatures());`；2329-2339 是 onUnmounted 体，不是热键代码。
- “多选合并复制 390-509”起点含 ClipItemListRef:390，该 ref 有 28 处跨块使用，不能随 useMergeCopy 搬走。

4) 影响描述里“document scroll 监听会泄漏”不成立：src/views/Main.vue:1964-1965 注释明确“原 document 级 scroll 监听恒不触发，已移除”，onUnmounted 体内也只移除 keydown(:2337) 与 window 上的 STORAGE_STATUS_EVENT(:2331)。
- 影响: 不改：2588 行里查询装配与分页两块共约 760 行，是“30 条截断”问题（第 11 条）的收口前提；onMounted/onUnmounted 嵌套目前靠 Vue 在执行 mounted 钩子时 currentInstance 仍有效才侥幸生效，一旦 onMounted 提前 return 或改成 async，document scroll/keydown 监听与 tabPrefetchTimer 就会泄漏——这正是本条拆分中最容易被触发的改动。拆后主文件预计降到 800 行量级。
- 落地: 确认两个必做修正，但补一个原提议漏掉的硬前提：

(1) onUnmounted 上提不是原地搬行。keyDownCallBack 定义在 src/views/Main.vue:1979，即 onMounted 回调体内部；:2337 的 removeEventListener 引用的正是它。把 onUnmounted 直接提到 setup 顶层会在 setup 执行期就抛 ReferenceError（keyDownCallBack 未定义），组件挂载失败。正确做法二选一：
  a. 在 setup 顶层加 `let keyDownCallBack = null;`，onMounted 内改为赋值而非 const 声明（同时 isOtherEditableTarget:1967 等依赖若也只在 onMounted 内声明，需一并检查是否被 keyDownCallBack 闭包捕获——它们被捕获即可，无需上提）；
  b. 抽 useMainHotkeys 时把 keyDownCallBack 与 document.addEventListener(:2012)/removeEventListener 成对放进 composable，由 composable 自己注册 onMounted/onUnmounted。b 更干净，且与本条“热键注册与注销不应分属两个作用域”的目标一致。

(2) 死码清理照原提议：删 maybePrefetchNextPage(:1494-1500) 与 NEXT_PAGE_PREFETCH_THRESHOLD(:527)，并把 handleListLoadMore(:1502-1508) 简化为直接 loadMoreData()。若用户想保留预取语义，则改 src/cpns/ClipItemList.vue 的四处 emit 带上 index —— 但注意 :2212（activeIndex 接近末尾）与 :2834（长按自动滚动）语义不同于 :1562（滚动触底），三者传的 index 含义要统一，否则 remaining 计算会错。默认建议先删死码，预取另议。

(3) 块边界按上面的实测修正后再搬：useClipQuery 取 510-634 + 691-807 + 862-970（跳过 635-690 清空对话框与 808-861 置顶预览）；useClearDialog 取 635-690 + 972-1146（getItemsByTab:972 是查询函数、被 loadMoreData:1474 复用，应留在 useClipQuery 或主文件，不要塞进 useClearDialog）；usePinGroup 取 808-861 + 1220-1414（不含 1196-1218）；useMergeCopy 取 391-509（ClipItemListRef:390 留在主文件，以参数传入）；useMainHotkeys 取 1967-2327；useTabState 取 1769-1813 + 1832-1896。

原提议的两条硬约束保留且核实无误：updateShowList 内 toTop 分支的 setActiveIndex(0)(:957) + syncActiveIndexVisibility(0, {edge-align/start/forceScroll})(:958-962) + window.toTop()(:966) 顺序不得改；registerMainHotkeyFeatures 必须仍在 nextTick(:2327) 注册。
- 回归面: (1) 最大风险是 onUnmounted 上提触发 keyDownCallBack(src/views/Main.vue:1979) 的 ReferenceError —— 原提议未识别此点，直接照做会让主界面挂不起来。(2) useMainHotkeys 提前于 nextTick 注册会改变与 ClipItemList/HotkeyProvider 三个 document capture 监听器的挂载顺序（document.addEventListener("keydown", keyDownCallBack, true) 在 :2012 用 capture=true），影响搜索框 reveal/IME 保护与列表键盘导航的抢占关系。(3) 按原写的 510-970 边界搬 useClipQuery 会连带把 watch(clearRange)(:668) 和清空对话框焦点管理搬走，破坏清空对话框的方向键导航。(4) 按 1196-1414 搬 usePinGroup 会带走 displayList/currentShowList，这两个 computed 被删除恢复(:1598/:2310)、快捷粘贴缓存(:1254/:1264)、搜索计数(:1431) 依赖，破坏面很宽。(5) 搬 handleItemDelete/handleItemsDelete/syncAfterVisibleDelete 时必须保持 prepareDeleteRecovery 先于 removeVisibleItemsByIds 调用的顺序（现状 :1641/:1708/:1735/:2267/:2311 都是先设锚点再删可见项），否则 ClipItemList.vue:2232-2246 的 showList watch 拿不到 anchor，走 :2244 兜底跟滚，删除后高亮会跳。(6) 存储迁移与 JSON fallback、repository facade（window.db.query/removeItems）不在本条改动面内；uTools 实机侧 plugin.json/preload.js/listener.js 不涉及。

## A16. [simplify] Main.vue 13 处直读 window.db.dataBase 把 30 条内存快照当全量数据集，是最实质的分层违规

- 位置: `src/views/Main.vue:978`
- 成本/风险/置信: L / medium-high：属 project.md 明列的存储高危区，改动同时触及查询、清空、收藏、锁定四条链。分三个 commit（isCollected → 清空 → 置顶取值），每个后跑 test-storage-query.js 与 test-repository-batch.js，并实机验证：收藏超过 30 条后第 31 条的星标显示、对 200+ 条历史点“清空全部”的实际删除数、锁定项在清空中被跳过、置顶图片的粘贴。 / high
- 取证: 逐项复核，取证基本属实，仅个别行号偏 1 行。

仓库层（src/storage/sqliteClipboardRepository.js）：
- :14 `const TAB_CACHE_LIMIT = 30` —— 属实。
- :493-494 `selectItems('collected = 0', {}, 'update_time DESC', TAB_CACHE_LIMIT)` / `selectItems('collected = 1', {}, 'collect_time DESC, update_time DESC', TAB_CACHE_LIMIT)` —— 属实，dataBase.data 与 dataBase.collectData 都被截断到 30。
- :518（原文写 :519，差 1 行）`this.collectIdSet = new Set(this.dataBase.collects)` —— 因此 collectIdSet 最多 30 个 id。
- :764-766 `isCollected(id) { return this.collectIdSet.has(id) }` —— 属实。
- :772-774 `getCollects() { return this.dataBase.collectData }` —— 属实。
- :651 `this.upsertItemRaw(next, existing ? this.isCollected(item.id) : false)`、:661 `this.upsertItemRaw({...}, this.isCollected(id))`、:694 `if (this.isCollected(item.id) && !force) { skippedCollected++ }` —— 三处全部属实。

对照组（src/storage/clipboardRepository.js:76-101）：JSON facade 的 `get dataBase()` 直接返回 legacyDb.dataBase 全量，getCollects 走 legacyDb。所以“同名字段在两种实现下语义不同、消费者按全量语义写”这一核心论断成立。

UI 层（src/views/Main.vue）13 处直读逐行核对无误：:437、:438、:772、:773、:978、:1154、:1512、:1523、:1908、:1917、:1924、:1928、:1939。src/global/quickPasteRuntime.js:150-151 属实。

真实后果链（我复核后确认成立的三条）：
1. src/views/Main.vue:1007-1008 `clearRegularTabItems` → `filterItemsByRange(getItemsByTab(tabType), rangeValue)`，getItemsByTab(:972-981) 的非收藏分支数据源就是 `window.db.dataBase.data`（:978）。:1042-1048 `clearCollectTabItems` → `window.db.getCollects()`。两者候选集上限 30，:1113-1122 的成功提示按 result.removed 报数，所以“清空全部”确实最多删 30 条却提示成功。
2. src/views/Main.vue:1415-1419 `collectedIds` = `new Set(window.db.getCollects().map(i => i.id))`，:132 传给 ClipItemList；src/cpns/ClipItemList.vue:328-336 `isItemCollected` 先看 `item.collected`，但 sqliteClipboardRepository.js:36-55 的 rowToItem **根本没有映射 collected 字段**，所以快速通道永不命中，只能落到 collectedIds/window.db.isCollected 两个 30 上限来源 —— 第 31 条以后星标确实不显示。这条是原文没写出来的放大器。
3. isCollected 失真的删除面比原文更严重：src/views/Main.vue:1656-1662 在非收藏 tab 删除时用 isCollected 决定是否弹“已收藏项目不允许删除”，:1719-1720 批量删除用 `list.filter(item => !window.db.isCollected(item.id))` 过滤。第 31 条以后的收藏项会绕过这两道保护，再叠加 sqliteClipboardRepository.js:694 的 skippedCollected 失效，是真实的静默删除路径。

需要修正的两点范围夸大：
- getItemsByTab **不是**主列表数据源。src/views/Main.vue:901-909 `updateShowList` 在 `window.db?.query && !parsed.isStar` 时走 `window.db.query(...)`（SQL 分页，sqliteClipboardRepository.js 的 querySql 有真实 total/nextCursor），只有 star 过滤分支（:917-950）和无 query 的 JSON 降级才落到 getItemsByTab/getCollects。所以正常浏览与滚动分页没有 30 条截断。
- getAllKnownItems(:768-782) 与 quickPasteRuntime.js:150-151 都不是数据丢失点：前者在 :800-801 有 `getItemById: (id) => window.db?.getById?.(id) || ...` 兜底，后者在 quickPasteRuntime.js:146-147 有同样的 getItemById 兜底，它们只是“候选提示池”。原文把这两处与清空/收藏并列，权重偏高。

另有原文漏报但更贴近用户感知的一处：src/views/Main.vue:928-940，star 过滤（`*tag`）在 SQLite 模式下也走 else 分支，只在 `window.db.getCollects()` 这 30 条里做标签匹配，即“按标签搜索收藏”实际只搜最近 30 条收藏。
- 影响: 不改：这是 vibe/knowledge/developer-soul.md「不绕过 repository facade 做新的 list/search/delete/storage 行为」与 vibe/rules/project.md「优先走 repository facade，避免新增直接扫描」的直接违反，且已产生三类可见数据风险（清空只删 30 条、收藏星标缺失、收藏被静默取消/误删）。改后 UI 不再持有“全量数据集”这一错误心智模型，getAllKnownItems 与两个清空函数各自简化，同时是第 4 条 hydrate 收口的落点。
- 落地: 方向认可，但应按“可见数据风险优先、拆小步”重排，并砍掉两处不必要的改动。

必做（P0，独立提交、独立验证）：
1. `isCollected(id)` 改为直查 SQL（sqliteClipboardRepository.js:764）。同时在 rowToItem(:36-55) 补 `collected: row.collected === 1`，让 removeItems(:687) 复用已经取回的行、ClipItemList.vue:330-332 的 `item.collected` 快通道真正生效——这比“每处都发一次 SQL”更省，也顺带修好星标。注意 selectItems 的 SELECT 列表需包含 collected。
2. 清空链路：新增 `selectIdsForClear({ tab, range, collectTag, excludeLocked })` 只取 id 列并把时间条件下推为 SQL where，Main.vue:1007/1042 改用它，filterItemsByRange(:983) 在这条路径上退役（其他调用点保留）。
3. star 过滤分支（Main.vue:928-948）应一并纳入，否则修完清空和星标，“按标签搜收藏”仍只搜 30 条——建议让 querySql 支持 star/tag 条件，或至少为该分支提供不截断的 getCollectsForFilter()。

可做（P1）：`getItemsByIds(ids)` 供 getPinnedItemsForContext(:794)/resolvePinGroupItemsById 批量取置顶项。

建议砍掉/降级：
- `countCollected()` 原文没有指出任何调用点，Main.vue:1424 的 `getCollects()?.length` 只是搜索框占位文案，价值极低，不值得为它扩接口。
- “收敛 13 处直读”不必作为目标。:1512/:1523/:1908/:1917/:1924/:1928/:1939 的 `list.value = dataBase.data` 在 query 可用时只是 showList 的临时种子（:1909 之后立刻被 updateShowList 覆盖），:437-438 与 :772-773 有兜底，改动收益低而触碰面大。真正要改的是四个消费者：getItemsByTab（仅清空与 star 分支）、collectedIds、两个清空函数。

关于前置条件（fs.watch）：原文说 initPlugin.js:347 会把 JSON 快照整体赋给 window.db.dataBase，我核实属实（src/global/initPlugin.js:337-352，watchDataBaseUpdate 内 `window.db.dataBase = dataBase` + `listener.emit('view-change')`，由 :324 在 DB.init 成功分支注册）。但它当前实际不触发：SQLite 模式下没有任何代码写那个 JSON 文件。所以它是潜在隐患而非阻塞项——正确做法是先落地第 2 条发现的惰性化（届时 SQLite 模式根本不注册这个 watch），而不是给 dataBase 加 setter。
- 回归面: 1) 删除锚点（project.md 明列）：修好 isCollected 后，Main.vue:1656-1662 会开始对第 31 条以后的收藏项弹“已收藏项目不允许删除”，:1719-1720 的批量过滤也会开始排除它们，ClipItemList.vue:2710-2731 的 getDeleteAnchorMeta 拿到的可删集合随之变化，必须跑 test-delete-anchor.mjs 并实机验证“删除后高亮落点”。2) 虚拟滚动/分页计数：currentSearchItemCount(:1431-1440) 在 star 分支用 `getItemsByTab().filter(!isCollected)`，isCollected 变准会改变显示条数与 queryCursor 的 hasMore 判断。3) 搜索 reveal/IME：star 过滤分支若改造，直接落在搜索输入链路上，不得改动 filterText 的 reveal/IME 保护。4) 清空提示语义变化：修复后“清空全部”会真的删几百条，且 skippedLocked 数字变大，需实机确认锁定项被跳过、图片 blob（blobStore.removeForItem，:696）在大批量删除下不残留孤儿文件。5) rowToItem 增列会影响所有 selectItems 调用方与 querySql 的 SELECT，需跑 test-storage-query.js 与 test-repository-batch.js。6) removeItems 内改用行上的 collected 而非 isCollected，要确认 force:true 路径（Main.vue:2305、ClipItemList.vue:2717/2729）行为不变。

## A17. [simplify] SQLite 已是主存储，initPlugin 仍无条件全量加载并长期持有旧 JSON 库，legacy 兼容层可降为按需

- 位置: `src/global/initPlugin.js:1209`
- 成本/风险/置信: M / medium-high：project.md 明确列为高危路径，且降级分支是数据安全的最后一道兜底。验证：(1) 全新安装（无 .sqlite 无 .json）；(2) 仅有旧 JSON 的首次迁移；(3) 已迁移的正常启动（应观察到无 JSON 读盘）；(4) 手动破坏 .sqlite 触发三次重试失败后的 JSON 降级；(5) 设置页存储状态区四个场景下的 mode/migrationStatus/jsonPath 显示均正确。跑 test-json-migration.js 与 test-storage-runtime-status.js。 / high
- 取证: 取证属实，行号仅 `new DB(dbPath)` 一处应为 :1209（原文 location 写 1209 正确，正文里的 1207-1210 区间也对）。

src/global/initPlugin.js：
- :1192 `const jsonDbExists = window.exports.existsSync(dbPath)` —— 我 grep 全文件，该变量只在 :1206 的 console.log 出现过一次，确实从未参与任何分支判断，是死变量。
- :1207 `console.log('[initPlugin] 使用 JSON 文件')`、:1209 `const legacyDb = new DB(dbPath)`、:1210 `legacyDb.init()` —— 无条件执行，日志文案与实际走 SQLite 的行为确实矛盾。
- legacyDb 在全文件只出现 4 次：:1209 构造、:1210 init、:1243 传入 createSQLiteClipboardRepository、:1294 JSON 降级 `createClipboardRepository(legacyDb)`。原文对使用面的描述准确。

src/storage/sqliteClipboardRepository.js 对 legacyDb 的全部使用同样只有 4 处（grep 确认）：:92 存字段、:119 `this.legacyDb?.path`、:300 `this.setMeta(META_JSON_MIGRATION_SOURCE, this.legacyDb?.path || '')`、:382-383 `this.legacyDb?.dataBase?.data / .collectData`。前三处只需路径字符串，第四处只在 migrateFromLegacyJson 内。

关键确认：init(:139-177) 中，只要 `isJsonMigrationComplete()` 为真，整个含 migrate 的 if 块被完全跳过，:118-131 的 getJsonSourceFingerprint 也不会被调用。也就是说**已迁移的正常启动，仓库层根本不碰 legacyDb**，唯一的读盘成本纯粹来自 initPlugin.js:1210 的那次 eager init。原文论断成立。

DB.init（:158-336）实测代价比原文描述的还重，且我确认它每次冷启动都从零重跑：
- :163-168 同步 readFileSync + JSON.parse 整个旧库（含全部 base64 图片载荷）。
- :170-174 `shouldMigrateJsonDb` 为真时 `backupBeforeMigration()`（:145-149）整份复制一次 JSON。
- :313-317 收藏清理里 `this.dataBase.collectData.filter(item => this.dataBase.collects.includes(item.id))` 是 O(n·m)；:210-215 缺失收藏补齐用内嵌 `find`，同样 O(n·m)。
- :319 migrateImageThumbnails 逐张解码。
- :320-321 设置 schemaVersion 后 :322 `this.updateDataBaseLocal()`。

落盘错位属实且后果比原文更严重：updateDataBaseLocal(:365-380) 在 immediate 缺省时走 `debouncedWriteLocal()`，而 :117-125 的 debouncedWriteLocal 目标是模块级变量 `db`——在 :1210 执行时 db 还是 undefined，300ms 后 db 已是 SQLiteClipboardRepository，其 updateDataBaseLocal(:367-371) 只会 flush SQLite。所以 :321 写入的 `schemaVersion = 2` **永远回不到磁盘**，导致 shouldMigrateJsonDb(src/storage/jsonMigration.js:14-16 `dataBase.schemaVersion !== schemaVersion` 即返回 true) 每次启动都为真，:172 的整份 JSON 备份也就**每次冷启动复制一遍**，备份文件名带 `Date.now()`（:148）还会无限累积。这一点原文未指出。

还有一处原文未提但坐实结论：全仓 grep `unlinkSync|renameSync|rmSync` 只命中 src/storage/blobStore.js:74-75，**迁移成功后旧 JSON 文件从不删除也不改名**，所以“每次启动都读全量旧库”不是理论值而是稳定现象。

时序也属实：src/main.js:47-58，`await initPlugin()`（:51）在 `createApp(App)`(:57) / `app.mount('#app')`(:58) 之前，这段同步 I/O 直接计入首屏与 quick-paste 冷启动。
- 影响: 不改：每次冷启动都同步 readFileSync + JSON.parse 整个旧 JSON 库（含全部 base64 图片载荷），再跑多轮全量字段回填、maxage 裁剪、孤儿收藏清理、migrateImageThumbnails 逐张解码；这段发生在 main.js:51 的 await initPlugin() 内、createApp().mount() 之前，直接计入首屏与 quick-paste 冷启动延迟。且整份 JSON 常驻内存直到会话结束。因为 :122 的落盘目标错位，DB.init 里那套 O(n·m) 清理（:314 collectData 过滤内嵌 includes、缺失收藏补齐内嵌 find）每次启动都从零重算、永不收敛。这与性能重写设计文档「后续启动只从 SQLite 读取记录」直接矛盾。
- 落地: 惰性化方向成立，按以下修正落地。

采纳：
- initPlugin.js:1209-1210 改为 `const createLegacyDb = () => { const d = new DB(dbPath); d.init(); return d }`，只在真正需要时调用。
- sqliteClipboardRepository.js 构造参数增加 `legacyJsonPath`，:119 与 :300 改用它（两处只要路径字符串，getJsonSourceFingerprint 的其余部分全部走 this.deps.existsSync/readFileSync/statSync，不依赖 DB 实例状态——原文前置条件 (a) 判断正确）。:382-383 在 migrateFromLegacyJson 内部才调 createLegacyDb()。
- :1294 降级分支改 `createClipboardRepository(createLegacyDb())`。原文前置条件 (b) 正确且必须做。
- 删掉 :1192 死变量与 :1207 误导日志（或改成反映真实分支）。

必须补上原文遗漏的一条前置条件（e）：DB.init 的**文件不存在**分支（:333-335）会 `this.dataBase = this.defaultDB; this.updateDataBaseLocal(undefined, { immediate: true })`，即全新安装时 eager init 会**创建一个空 JSON 文件**。惰性化后这个副作用发生时机改变（只在 SQLite 创建分支调 migrateFromLegacyJson 时才创建）。需确认没有任何外部依赖（设置页展示、用户手工备份习惯、旧版共存）依赖该文件必然存在。

强烈建议**从本次改动中剥离**原文的“附带修正 :122 debouncedWriteLocal 落盘目标”：
把 debouncedWriteLocal 改为写回调用它的实例，会让 DB.init 的规范化结果真正写回 JSON 文件，从而改变文件长度与 mtime——而 getJsonSourceFingerprint(:118-131) 正是 `path|length|mtime|sha1` 组合，hasMigratedCurrentJsonSource(:309-313) 与 META_JSON_MIGRATION_FINGERPRINT/HISTORY(:296-301) 全都建立在这个指纹上。init() 的防抖写（300ms）很可能落在 markJsonMigrationComplete() 记录指纹**之后**，使记录下来的指纹当场失效；日后任何一次 isJsonMigrationComplete 为假的启动都会重新走 migrateFromLegacyJson，把用户已删除的旧条目整批复活（upsertItemRaw 按 id 主键不会产生重复行，但会复活删除项）。这直接踩到 project.md「重复导入防护」。若确实要修落盘错位，应单独一个 commit，并先确认写回发生在 markJsonMigrationComplete 之前、或干脆在 SQLite 模式下让 DB.init 完全不写盘。

可以砍掉原文的 (d)：我核对了 initPlugin.js 全部 updateStorageRuntimeStatus 调用（:1195-1205、:1231-1240、:1256-1265、:1273-1282、:1296-1306），jsonPath 一律传的是局部变量 `dbPath`，从不读 legacyDb.path，无需改动。
- 回归面: 1) JSON 降级兜底（project.md 明列的数据安全最后一道）：:1294 若漏改会在 SQLite 三次重试全失败时拿到 undefined，直接白屏；且降级时机从“启动即备好实例”变成“三次重试失败后才 new DB + 同步读盘”，失败路径多出一次全量 I/O，需确认 utools 不会在此期间超时。2) 重复导入防护：见修正提议中对 debouncedWriteLocal 的分析，指纹链（:118-131 / :296-301 / :309-313）是最脆弱的一环。3) 迁移备份：backupBeforeMigration(:145-149) 目前每次启动都跑，惰性化后只在迁移时跑——这是修复而非回归，但会改变用户目录里备份文件的产生节奏，发布说明应提及。4) 全新安装不再自动生成空 JSON 文件（:333-335），需确认设置页存储状态区在“无 sqlite 无 json”场景下 mode/migrationStatus/jsonPath 显示仍正确。5) fs.watch 副作用消失：DB.init:324 的 watchDataBaseUpdate 惰性化后在 SQLite 模式不再注册，:337-352 里 `window.db.dataBase = dataBase` + view-change 的路径随之消失——这是净收益（也正好消解第 1 条发现的前置条件），但需确认没有任何功能依赖该 watch。6) 验证按原文五个场景走，跑 test-json-migration.js 与 test-storage-runtime-status.js。

## A18. [speed] 全局样式 index.less 被 9 份重复打进首屏 CSS，1.078MB 里约 996KB 是同一份内容

- 位置: `src/style/index.less:1`
- 成本/风险/置信: S / low / high
- 取证: 取证逐条核对全部属实，行号无误：
- src/style/index.less:1-12 定义 `.import()` mixin，内含 9 个 `@import (multiple) './cpns/*.less'`。
- src/style/index.less:66 `.import();`（在 `html, #app {` 光色块内，块起始 :14-15）；src/style/index.less:121 `.import();`（在 `html[data-theme='dark'], html[data-theme='dark'] #app {` 内，块起始 :69-70）。两次全量展开确认。
- 8 处 SFC scoped 引入全部核对为真，且每个 style 块「只有」这一行 @import，无其他规则：src/cpns/ClipItemRow.vue:342 `<style lang="less" scoped>` / :343 `@import "../style";`；src/cpns/ClipOperate.vue:43/:44；src/cpns/ClipFullData.vue:145/:146；src/cpns/ClipSwitch.vue:105/:106；src/cpns/ClipSearch.vue:190/:191；src/cpns/ClipItemList.vue:3020/:3021；src/cpns/FileList.vue:27/:28；src/views/Main.vue:2342/:2343。`find src -name '*.vue' -exec grep -Hn '@import'` 全仓仅这 8 处，无遗漏无多余。
- src/main.js:7 `import './style/index.less'` 属实，构成第 9 份（唯一未加 data-v 的那份）。
- 单份编译实测 110,876 B（我用 less.render 复算；原文 110,668 B，差 208 B，可忽略）。
- 产物 dist/assets/index-Dgv_FIiW.css = 1,078,099 B 属实（dist 被 .gitignore:3 忽略，但 mtime Sep 9 21:03 晚于所有源文件 mtime，非陈旧产物）。
- 倍数关系可精确对账：`setting-card-content-item` 在编译后的单份 index.less 中出现 48 次；dist 中带 data-v 的有 8 组各 8 次（0111bab3 那 1 次来自 Setting.vue:3179 自身规则），总计 48（全局无 data-v 份）+ 8×48（scoped 份）+ 1（Setting.vue 自有）= 433，与实测 433 完全吻合。`clip-item-list-row` 单份 12 次 ×9 = 108，+1 = 109，也吻合。9 份重复是硬事实，不是估算。
- 9 × 110,876 = 997,884 B，占 1,078,099 B 的 92.6%。
补充一条原文没提但同向的证据：dist 中 `data-v-` 共 17 个不同哈希，其中 8 个整体承载了 index.less 全文——即这 8 个组件除了这份复制品之外没有任何自有样式。
- 影响: 110,668 × 9 ≈ 996KB，占首屏 CSS 的 92%。删掉 8 处 scoped @import 后 CSS 从 1.078MB 降到约 190KB（-82%）；再把 cpns/*.less 的 Less @变量改成 var(--*) 可去掉 index.less:66/121 的 light/dark 双份展开，再省一半。CSS 解析 + 样式重算是 Electron 首帧的同步阻塞项，插件每次冷启动都要付一次。不改则每加一个组件、每加一条全局规则都按 9 倍计入首屏。
- 落地: 只采纳提议 1，提议 2 必须驳回，提议 3 必须改写。

【采纳】删除 8 处 SFC scoped `@import '../style'`（连同其空壳 `<style>` 块），只保留 src/main.js:7。安全性有直接反证：src/views/Setting.vue 有 scoped style（:3071 起）但「没有」@import '../style'，而 setting.less 的样式在设置页正常生效——证明 main.js 的全局无作用域副本已足以覆盖所有元素。作用域副本的选择器集合是全局副本的真子集（Vue scoped 只给本组件模板元素加 data-v，全局副本覆盖面更广），删除不会让任何元素丢样式；只会把命中特异度从 `#app .foo[data-v-x]`(1,2,0) 降到 `#app .foo`(1,1,0)。全仓 `#app` 仅出现在 src/style/index.less:15/:70/:126/:133，无第二处 id 选择器，(1,1,0) 仍压过任何纯类名规则（含 Element Plus 与其他 SFC 的 (0,2,0)+data-v），暗色 `html[data-theme='dark'] #app .foo`(1,2,1) 也仍压过光色。预期 CSS 从 1,078,099 B 降到约 190KB。

【驳回提议 2】「把 cpns/*.less 的 Less @变量改成 var(--*)、删掉 :66/:121」不成立，成本远不是 S：
(a) src/style/cpns/ 共 94 处 Less 颜色函数作用在 @变量上（clip-item-list.less 45、clip-switch.less 12、clip-search.less 9、clip-full-data.less 8、其余各 2-4），例如 src/style/cpns/clip-item-list.less:76 `background-color: fade(@primary-color, 7%)`、:227 `linear-gradient(180deg, fade(@primary-color,8%) 0%, fade(@primary-color,4%) 100%)`。`fade(var(--primary-color), 7%)` 在 Less 里非法，必须为约 30 个不同透明度各造一个预计算 token，是大改不是顺手改。
(b) 删掉 :66/:121 会把 cpns 规则提到顶层，特异度从 (1,1,0) 掉到 (0,1,0)，此时 Setting.vue:3071 起的 scoped 规则 (0,2,0)+[data-v] 与其中大量 `:deep()` 规则会反超，设置页级联直接翻转。

【改写提议 3】src/style/cpns/collect-block.less 确为孤儿（不在 index.less:3-11 的 9 个 @import 里，全仓无任何引用），但 `.collect-block-header` 在 src/views/Main.vue:124 实际使用中——说明这份样式当前「从未生效」。「接回」等于给线上界面新增一批当前不存在的样式，是视觉变更而非清理，不能作为附带项；应当在本次只做删除或原样留置，接回需单开一次带视觉比对的改动。
- 回归面: 提议 1 的回归面（可控但需实测）：
- vibe/rules/project.md:39 明确保护 `.clip-item-scroll` 滚动容器、ClipSwitch 顶栏、`.clip-break` 占位、搜索 reveal/IME。`.clip-item-scroll` 的高度链定义在 src/style/cpns/clip-item-list.less:5，且 src/style/index.less:132-135 有专门注释「列表滚动容器必须由确定高度链撑起，否则不产生溢出，滚动会退化到 document」。删除 scoped 副本后这条链改由全局副本承担，必须实机确认 ClipItemList 虚拟滚动仍在 .clip-item-scroll 上产生溢出、未退化到 document 滚动，否则 @tanstack/vue-virtual 的测量与删除锚点定位会一起坏掉。
- ClipSwitch.vue、ClipSearch.vue 的样式同样只靠这份副本，需回归顶栏布局与搜索框 reveal/IME 组合键行为（虽是 JS 行为，但输入框尺寸/层级由这些样式决定）。
- 需检查是否存在特异度落在 (1,1,0) 与 (1,2,0) 之间的规则；我已确认全仓 id 选择器只有 index.less 里的 #app，故该区间为空，风险低。
- 与 uTools 实机无关：不触碰 plugin.json / preload.js / listener.js，dist 走 file:// 加载无 gzip，1.078MB 是真实解析量（gzip 后 119KB 只是磁盘体积，不减 CSSOM 构建成本）。
提议 2 的回归面：设置页与列表页级联整体翻转，属高风险，不应打包在同一次改动里。

## A19. [speed] 每次插件启动都无条件全量重建 FTS 索引：DELETE 全表后逐行 db.run INSERT，2N 次语句解析，纯同步阻塞首屏

- 位置: `src/storage/sqliteClipboardRepository.js:225`
- 成本/风险/置信: S / low / high
- 取证: 取证逐行核对，行号完全属实。
- src/storage/sqliteClipboardRepository.js:217-229：`CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(...)` 之后第 224-225 行 `this.ftsEnabled = true; this.rebuildFts()`，无任何条件判断。
- src/storage/sqliteClipboardRepository.js:450-465 rebuildFts()：452 `this.db.run('DELETE FROM items_fts')`；453 prepare 一次 SELECT，455-461 while 循环里每行调用一次 `this.db.run('INSERT INTO items_fts(id, search_text) VALUES ($id, $search_text)', {...})`。sql.js 的 db.run(sql, params) 内部每次 prepare+bind+step+free，确实不是预编译复用。
- 启动路径确认在首屏关键路径上：src/main.js `await initPlugin()` 之后才 `app.mount('#app')`；src/global/initPlugin.js:1241 createSQLiteClipboardRepository → sqliteClipboardRepository.js:139-144（库文件已存在分支）同样调用 ensureSchema()，所以每次冷启动都重建。
- 「重启本来就是同步的」这一点成立：persistNow(:351-356) 用 db.export() 整库落盘，items_fts 的影子表随之持久化；upsertFts(:436-443) / deleteFts(:445-448) / removeItems(:706-708) 都做了增量维护。
- 影响量级校准合理：启动期其它 O(N) 成本有限——refreshCache(:491-519) 取的是 TAB_CACHE_LIMIT=30(:14) 两页，rebuildTabCache(:534-542) 只查 5 个 tab×30 行，唯一无界的 O(N) CPU 循环就是 rebuildFts（selectTagRows :521-532 只扫收藏项）。且全仓没有历史条数上限（未搜到任何 maxItem/自动清理容量设置），N 确实会随使用时间无界增长。
- 一处取证补充（原文未提，影响提议）：emptyDataBase(:810-816) 只 `DELETE FROM items`，没有清 items_fts；目前正是靠启动无条件 rebuildFts 兜底清理这些孤儿行。
- 影响: 启动成本 O(N)，且是 2N 次 sql.js 语句执行（1 次 DELETE + N 次 INSERT，每次含一次 SQL 解析）。N=5000 时约 100~300ms 主线程阻塞，N=5 万时进入秒级，直接计入首屏和 quick-paste 冷启动延迟；且历史越长越慢，用户感知是「用久了越来越卡」。改成条件重建后这一项归零。
- 落地: 结论成立，可以改，但要按下面顺序做：
1) 先修 sqliteClipboardRepository.js:812 的孤儿行来源：emptyDataBase 里补 `if (this.ftsEnabled) this.db.run('DELETE FROM items_fts')`。否则一旦把启动重建改成条件式，清空历史后 items_fts 的孤儿行将永久残留（查询用 JOIN items 所以结果仍正确，但索引只增不减）。
2) 再做条件化：不要只用 SCHEMA_VERSION（当前恒为 1，:8），要能区分「items_fts 是刚创建的」。建议先 `SELECT count(*) FROM sqlite_master WHERE name='items_fts'` 判断存在性，再 CREATE；只有「本次新建」或 meta 里的 fts_build_version 与当前值不一致时才 rebuildFts，重建后写回 meta（meta 表已存在，:210-213，setMeta 已有）。
3) 保留一个手动兜底入口（设置页「重建搜索索引」），否则未来任何漏写 FTS 的新写路径将失去自愈能力。
4) rebuildFts 本身仍值得优化，即使条件化后：把 452-461 改成 `db.run('BEGIN'); const ins = db.prepare('INSERT INTO items_fts(id, search_text) VALUES (?, ?)'); ... ins.bind([...]); ins.step(); ins.reset(); ... ins.free(); db.run('COMMIT')`。注意 sql.js 的 Statement 复用必须 reset()，且 finally 里要 free()，异常路径要 ROLLBACK（可直接复用已有的 runInTransaction 模式，参见 :384-394 的 BEGIN IMMEDIATE/COMMIT/ROLLBACK 写法）。
5) 别改 search_text 的生成逻辑：rebuildFts 只是把 items.search_text 复制进 FTS，buildSearchIndex(src/storage/searchIndex.js:48-75) 是写入时计算的；条件化不会让搜索内容变旧，因为全量重建本来也不重算 search_text。
- 回归面: 1) 搜索结果正确性：FTS 查询是 JOIN items(sqliteClipboardRepository.js:598-599 `JOIN items_fts f ON f.id = i.id`)，孤儿行不会污染结果——所以条件化不会造成「搜到已删条目」。但索引体积会随 emptyDataBase 次数单调增长，必须配套第 1 条。
2) 自愈能力丢失：现在的无条件重建掩盖了 emptyDataBase 的漏删；条件化后任何新增的绕过 upsertFts 的写路径都不会再自动修复。
3) 迁移/降级路径：src/global/initPlugin.js:1288-1296 有 SQLite 失败回退 JSON facade 的分支，改动只能落在 sqlite 仓库内部，不能动 window.db 绑定（initPlugin.js:1212-1221），否则破坏 JSON fallback。
4) 事务化重建时注意 sql.js 是内存库 + db.export() 整库落盘，BEGIN/COMMIT 与 persistNow 的时序不能交叉（rebuildFts 在 ensureSchema 内、persistNow 之前，目前是安全的，改写时别在事务中间插 persistNow）。
5) 与 vibe/rules/project.md:39 的防误改清单无交集（不触碰搜索 reveal/IME、.clip-item-scroll、删除锚点、虚拟滚动、ClipSwitch 顶栏），也不涉及 plugin.json/preload/listener。

## A20. [speed] 原生监听程序默认缺失导致 300ms 轮询成为主路径：每次轮询对剪贴板图片重做 base64 编码 + MD5，另有一个永不清除的 800ms 定时器

- 位置: `src/global/initPlugin.js:1470`
- 成本/风险/置信: M / medium / medium
- 取证: 核心取证属实，行号需修正：
- scripts/utools-runtime-assets.mjs:229-233 targetMap（win32.exe/linux/mac），:235-237 target = path.resolve(dbPath.split('_utools_clipboard_manager_storage')[0], targetMap[platform])，:241-244 `if (!existsSync(target)) { this.emit('error','剪贴板监听程序不存在'); return }`；listening 保持 false 来自构造函数 :224（不是原文说的“:224 存在性检查”），成功时才在 :289 置 true。
- scripts/utools-runtime-assets.mjs:323-334 prepareUToolsRuntimeAssets 只写 runtimeTextAssets（plugin.json/preload.js/listener.js/time.js/time.worker.js）+ copyFileSync(logo.png)，确实无任何二进制拷贝；仓库内只有 docs/clipboard-event-handler-win32.exe，无 mac/linux 版本（find 结果）。
- src/global/initPlugin.js:1543-1556 startListening 在 setTimeout(100) 内调用，:1547-1555 检测 !listener.listening 后 500ms 降级 addCommonListener（:1460）。
- 轮询体行号修正：:1470 function loop()，:1472 `time.sleep(300).then(loop)`，:1473 pbpaste()，:1477 `crypto.createHash('md5').update(item.data)`；pbpaste 图片分支在 :1160-1180，其中 :1161-1165 已有 availableFormats 短路（无 image 格式直接 return undefined），:1167 readImage()、:1169 toDataURL()。
- src/views/Main.vue:1914（原文写 1913）`if (window.listener.listening)`，:1923-1932 setInterval(...,800)，全文件无 clearInterval（grep 确认）。且 src/main.js:51-60 await initPlugin() 后立即 mount，而 startListening 在 initPlugin.js:1543 的 setTimeout(100) 里，因此即使二进制存在，Main.vue 取到的 listening 也很可能是 false —— 比原描述更强。
- time.js（scripts/utools-runtime-assets.mjs:316 内联）cbMap.set 后无 delete，每次 sleep 泄漏一条，属实。
- 影响: 复制一张 5MB 截图后，只要它还在系统剪贴板里，插件就每 300ms 重新把它编码成 base64（约 6.7MB 字符串）并做一次全量 MD5，约 3.3 次/秒、持续到剪贴板变化为止——常驻 CPU 占用和 GC 压力，且每次还跨一次 Worker 线程（time.js 的回调 Map 从不清理，等于每 300ms 泄漏一条）。加上 Main.vue 的 800ms 定时器，降级态同时有两个常驻定时器。修好后台监听或加内容指纹短路，可把这块空转降到接近 0。
- 落地: 结论成立但需降级量化并改写提议：
1) 提议 1 的一半已实现：pbpaste 已按 availableFormats 短路（initPlugin.js:1161-1165），剩余增量只是“格式/尺寸与上次相同则跳过 toDataURL+MD5”。建议做法：在 addCommonListener 闭包内缓存上一轮 availableFormats 串 + image.getSize()，两者都未变才跳过 toDataURL；注意 getSize 相同但内容不同（同尺寸截图）会漏记，必须保留“定期强制全量校验”（如每 N 轮或 2s 强制一次）兜底，否则丢记录。
2) 提议 2（把 Main.vue 的 800ms setInterval 改成事件订阅）必须否掉当前写法：grep 全仓 view-change 仅 initPlugin.js:348（JSON DB 文件 watch）与 :437（JSON emptyDataBase）两处 emit，SQLite 仓库（src/storage/sqliteClipboardRepository.js）在新增/更新条目时完全不 emit view-change。SQLite + 轮询模式下，Main.vue:1923 的 800ms 轮询是主列表刷新的唯一机制，删掉即主界面不再更新。正确做法是先在 repository 写入路径补 view-change/mutationVersion 事件，再改 Main.vue，并补 onUnmounted 清理。
3) 提议 3（把二进制纳入构建产物）按现实现无效：查找路径是 dbPath 上级目录（uTools 插件数据目录，scripts/utools-runtime-assets.mjs:235-237），不是 dist。要改成“首启把二进制释放到 dbPath 上级目录并 chmod 0755”，或同时改 listener 的查找路径 —— 这属于 vibe/rules/project.md:31/28 明确点名的高风险区（listener 生成 + preload），必须单独立项。
4) 提议 4（loop 加 try/catch）成立且低风险：:1472 的 `time.sleep(300).then(loop)` 已先于 pbpaste 排下一轮，抛错不会停摆循环，但会吞掉未捕获 rejection；加 try/catch 只是把噪声收敛，收益小于原文宣称的“避免记录永久停摆”。
量化修正：轮询开销真实（300ms 一次 toDataURL+MD5），但仅在“剪贴板只有图片、无文本/文件”时触发（pbpaste 顺序：file→text→image）；800ms 定时器只比较 dataBase.data[0]?.id，成本近乎为零，把它列为第二个性能负担是夸大。
- 回归面: 1) 加内容指纹/退避会延迟或漏记剪贴板变更（同尺寸不同内容的截图最典型），直接影响插件核心功能。2) 删除 Main.vue:1923 的 800ms 轮询会在 SQLite 模式下彻底断掉主列表刷新（无 view-change emit），并连带影响 ClipSwitch.vue:91、TagSearchModal.vue:299 依赖的刷新链。3) 改 listener 查找路径/释放二进制触碰 scripts/utools-runtime-assets.mjs 生成的 preload/listener，属 project.md:28/31 高风险，且 uTools 实机上二进制权限、杀软拦截、路径大小写均需实测。4) 轮询延迟变化会改变 handleClipboardChange 的防回环时序（isRestoringClipboard / RESTORE_GUARD_TIMEOUT，initPlugin.js:1383-1394），可能引发重复记录或漏记。

## A21. [speed] 重复复制已有内容触发「全量读 blob → 原样写回 → 全库 export 写盘」，同一次复制还会因来源信息回填再走一遍

- 位置: `src/storage/sqliteClipboardRepository.js:657`
- 成本/风险/置信: M / medium / high
- 取证: 链路取证逐行核实属实：
- src/storage/sqliteClipboardRepository.js:657-665 updateItem → :659 this.getById(id) → :640-643 selectItems + blobStore.hydrateItem → src/storage/blobStore.js:58-69 `readFileSync(item.dataPath,'utf8')` 全量同步读。
- :661 upsertItemRaw({...item,...patch}) → :397-399 itemToParams(item, collected, this.blobStore) → src/storage/sqliteClipboardRepository.js:57-63 调用 blobStore.prepareForDb → blobStore.js:26-30 shouldExternalize（type==='image' 恒为 true）→ :49-50 `writeFileSync(dataPath, item.data||'', 'utf8')` 原样全量写回。
- :432 upsertFts → :436-443 DELETE + INSERT items_fts。
- :662 refreshCache → :491-519，其中 :497 selectTagRows → :521-532 `SELECT tags_json FROM items WHERE collected = 1` 无 LIMIT，逐行 parseJson。
- :325-340 runInTransaction → :331 queuePersist → :358-365 debounce 120ms → :351-356 persistNow：`this.db.export()` 全库序列化 + writeFileSync 整文件覆盖。
- src/global/initPlugin.js:1103-1115 enrichSourceWindowInfoLater，setTimeout(0) 内 :1110 `db.updateItem?.(item.id, info)`。
关键取证修正：重复复制的真实入口是 src/global/initPlugin.js:1444 `db.updateItemViaId(itemId)` → sqliteClipboardRepository.js:806-808 `updateItemViaId(id){ return this.updateItem(id,{updateTime:Date.now()}) }`，而不是 addItem(:645)；addItem 只在 :1453（库中不存在该 id）时才走。
- 影响: 重复复制一张已在历史里的 5MB 截图 ≈ 5MB 同步读 + 5MB 同步写 + 一次全库 export/写盘（20MB 库就是 20MB 序列化+写），并且做两遍。收藏 5000 条时，单次复制还要多付 5000 次 JSON.parse 只为重算 tagUsage。改成「仅 bump update_time 的 UPDATE 语句 + 不动 blob + tagUsage 增量维护」，可把这条热路径从几百毫秒降到个位数毫秒，并消掉每次复制的整库重写。
- 落地: 发现成立，但两处量化必须下调：
A) “整库 export 做两遍”不成立：queuePersist 有 120ms 去抖（:358-363），而 enrichSourceWindowInfoLater 是 setTimeout(0)（:1105），两次事务几乎必然落在同一 120ms 窗口内合并成一次 export。真正重复两遍的是 blob 全量读+写、upsertFts 与 refreshCache/selectTagRows。
B) “同一次复制必然两轮”不成立：initPlugin.js:1104 `if (!item?.hasSourceInfo || item.sourceApp || item.sourceWindowTitle) return` 早返回，hasSourceInfo 由 readClipboardSourcePaths（:1020-1060）非空决定，普通截图/纯文本复制通常为 false，此时没有第二轮。回填只在文件来源/uri-list 场景发生。
修正后的提议：
1) 快路径成立且是最大收益点：在 updateItem 内识别“patch 只含 updateTime / sourceApp / sourceWindowTitle”，直接 `UPDATE items SET update_time=?, source_app=?, source_window_title=? WHERE id=?`，不 getById、不进 blobStore。这一条即可消掉 5MB 读 + 5MB 写。
2) 但必须保留 refreshCache（或等效的缓存内重排）：this.dataBase.data 是主界面数据源（Main.vue:1908/1924 直接读 window.db.dataBase.data，且 800ms 轮询靠 data[0].id 变化触发刷新），快路径跳过 refreshCache 会导致“重复复制的条目不置顶、界面不刷新”。
3) 跳过 upsertFts 需加条件：search_text 由 buildSearchIndex(item, getAliasMap())（:85）生成，依赖别名表；仅当 patch 不含 data/alias/remark/tags 且别名表未变更时才可跳过，否则破坏搜索命中（project.md:39 搜索保护）。
4) 必须同步 JSON fallback 分支：src/storage/clipboardRepository.js:322-323 的 updateItemViaId 走 legacyDb，快路径只改 SQLite 会让两种存储模式行为分叉（project.md:33 要求同时确认 SQLite 主路径与 JSON fallback）。
5) 提议 4“本次事务未改动行则跳过 export”对本场景无收益：update_time 确实改了，仍需持久化；建议删掉这条，改为“把 enrichSourceWindowInfoLater 的来源信息并入首次写入”（提议 2，成立且干净）。
6) tagUsage 增量维护（提议 3）收益真实但改动面大（收藏/取消收藏/标签编辑/批量删除/清空多处入口都要维护），建议先用 mutationVersion 缓存 selectTagRows 结果，风险更低。
- 回归面: 1) 快路径若跳过 refreshCache：主界面顺序错乱、重复复制不置顶、SQLite+轮询模式下 Main.vue:1923 的 data[0].id 比较失效导致列表不刷新。2) 跳过 upsertFts 若条件判断不严，搜索索引与实际内容/别名脱节，命中 project.md:39 的搜索保护红线。3) 手写 UPDATE 绕过 itemToParams 会漏掉 collected/data_path/tags_json 的一致性，需保证只更新白名单列。4) 若快路径误判把含 data 的 patch 走进来，blob 文件不会被重写 → 数据与 data_path 不一致，属存储一致性事故（project.md:33 高风险区）。5) 未同步 JSON fallback 会造成两套存储模式行为分叉；迁移/回退时表现不一致。6) 该路径每次复制都跑，uTools 实机需验证大图（>5MB）与 5000+ 收藏两种极端下的实际耗时，不能只看单测。

## A22. [speed] 快速粘贴冷启动：flush 排在整个 Vue mount 之后，top 分支不吃缓存，图片 dataUrl 被算两遍，超 5s 静默丢弃

- 位置: `src/main.js:61`
- 成本/风险/置信: M / medium / medium
- 取证: 核心取证成立，但其中两条子结论的量化失实。

【成立】src/main.js:47-62 —— `installPluginEnterMultiplexer()`(:50) → `await initPlugin()`(:51) → `createApp`(:58) → `app.mount('#app')`(:60) → `flushPendingQuickPasteActions()`(:61)。src/global/pluginEnterHandlers.js:24-28 在 onPluginEnter 里先把 quick-paste action 推入 pendingActions，src/global/initPlugin.js:1606 `registerQuickPasteRuntime()` 才注册真正的执行 handler；冷启动时热键事件早于注册，只能靠 :61 的 flush 兑现，因此确实排在整个 mount 之后。src/global/quickPasteRuntime.js:352-399 executeQuickPasteActionSync 全链只用 utools API + localStorage + window.db，`skipResetPluginUiState:true`(:27) 使 `window.resetPluginUiState` 不被调用（src/utils/index.js:452/459），确实不依赖任何 DOM；window.db 在 initPlugin.js:1605（函数末尾、resolve 之前）已就绪。

【成立】src/global/quickPasteRuntime.js:438-448 pendingMaxAgeMs 默认 5000，pluginEnterHandlers.js:53-59 超时条目被 splice 丢弃并返回 null，:363-366 之外无任何兜底 → 超时后既不粘贴也不 hideMainWindow、无提示。

【成立但需限定】QUICK_PASTE_HOTKEY_SETTLE_MS=120 在 :32，afterHotkeySettle :337-343，但 shouldSettleHotkeyPaste(:334-335) 要求 `isWindowsRuntime()`，macOS 走 immediate 分支，不存在 120ms。

【失实一】“top 分支不吃缓存”属实（:294-308 live 优先，:303 才回落 cache；pin-group :269-274 相反），但把它算进冷启动收益是错的：pinTopRuntimeCache 是模块级变量，只由 src/views/Main.vue:1261 syncQuickPasteTopCache 在 UI 挂载后写入，冷启动时必为 null，缓存优先在冷启动路径上收益为 0。另外 :276-289 getPinnedItemsForContext 先用 getKnownItems(内存 dataBase.data/collectData) 命中，只有 quickPasteSelection.js:13-22 判定为 externalized（dataPath 有值、data 为空）时才回落 db.getById，并非“每次热键必然 1 次 SQL + 1 次读盘”。

【失实二】“图片 dataUrl 被算两遍 ≈ 省 30~80ms 读盘+base64”：重复调用属实（src/utils/index.js:423-424 算一次仅作 guard 丢弃，:433 → :299 再算一次），但两次都不会读盘。src/storage/blobStore.js:12/26-31/58-60 把 image 的 data URL 原文外置为 .txt 并在 hydrateItem 时读回 item.data，sqliteClipboardRepository.js:642 getById 已 hydrate，因此 utils/index.js:396 `isValidImageData(item.data)` 直接短路返回，:400 readFileSync 分支只在 item.data 是文件路径/file:// 的历史数据上才走。真实重复成本是对 base64 长串的两次正则匹配+捕获组复制（毫秒级），不是 30~80ms。
- 影响: 冷启动按热键的端到端延迟 = initPlugin 全链（见第 2 条，秒级）+ Vue mount（首屏 442KB JS + 1.08MB CSS 的解析与首次渲染，约 100~300ms）+ 120ms settle。把 flush 提到 createApp 之前（db 就绪 + registerQuickPasteRuntime 之后）可直接砍掉 mount 那一段；top 分支改为缓存优先可省掉每次热键的 1 次 SQL + 1 次同步 blob 读；dataUrl 复用可对 5MB 图片省掉一次完整读盘+base64（约 30~80ms）。
- 落地: 只保留经得起验证的三条：
1) 采纳（收益最确定）：把 src/main.js:61 的 flushPendingQuickPasteActions() 上移到 :57 ensureDevDbStub() 之后、:58 createApp 之前。前置条件已满足（window.db 于 initPlugin.js:1605 赋值、registerQuickPasteRuntime 于 :1606 完成、执行链零 DOM 依赖）。注意 Windows 热键路径仍走 quickPasteRuntime.js:433-434 的队列 + 120ms setTimeout，与 mount 抢同一主线程，因此该收益主要体现在 macOS/immediate 路径。
2) 采纳：flushPendingQuickPasteActions 的 pendingMaxAgeMs 默认值（quickPasteRuntime.js:440/445）提高，并在超时丢弃时至少 hideQuickPasteWindow() + 一次提示；建议改成“冷启动首次 flush 不设上限、后续沿用短上限”，避免长期驻留的过期动作被误执行。
3) 可选、按真实收益降级：把 utils/index.js:423-428 已算出的 dataUrl 通过 options 透传给 tryHideMainWindowPasteItem(:284/:299)，收益是省一次大字符串正则+复制，不是省一次读盘——不要以“省 30~80ms”为由排优先级。

驳回：
- 提议 2（top 改缓存优先）：冷启动零收益，且 pinTopRuntimeCache 只由 Main.vue:1261 单向写入、无 db 版本校验，缓存优先会在条目被取消置顶/删除后粘贴陈旧内容；:294-308 的 live 优先是刻意的正确性保证。
- 提议 5（按修饰键 keyup 触发）：uTools 渲染进程在窗口未显示时拿不到全局修饰键 keyup，无对应 API 证据，属推测性改动。
- 回归面: 1) flush 上移：paste 会在 Vue mount 前触发 utools.hideMainWindowPaste*，窗口在挂载期间已隐藏；setExitingPluginFlag 的 true→80ms→false 窗口（utils/index.js:432/439）会与组件挂载重叠，ClipItemList.vue:1088 focusUtoolsMainWindow 与 :2955 handleWindowBlur 的 __isExitingPlugin 守卫正是为此存在，方向上安全，但需在 macOS/Windows 实机各验一次“冷启动热键 → 静默粘贴 → 窗口不闪现”。属 src/global/ 与主流程改动，按 vibe/rules/project.md:34 需说明事件链/窗口行为影响。
2) pendingMaxAgeMs 放宽：pendingActions 上限 5（pluginEnterHandlers.js:4/27），放宽后更容易在“用户按了热键但已放弃、随后手动进插件”时补执行一次意外粘贴，必须同时保证 flush 只在冷启动那一次放宽。
3) dataUrl 透传：需保持 respectImageCopyGuard 语义（utils/index.js:300 返回 false vs null 决定是否回落 copy+paste），传参不当会把 null（不支持原生粘贴）误判成 false（放弃粘贴）。
不涉及搜索 reveal/IME、.clip-item-scroll、虚拟滚动、ClipSwitch 顶栏；不触及存储迁移与 JSON fallback。

## A23. [speed] 「清空最近 N 天/全部」每次最多只删 30 条：候选集取自 30 条内存快照，清 3000 条历史需要重复 100 次对话框流程

- 位置: `src/views/Main.vue:1006`
- 成本/风险/置信: M / medium / high
- 取证: 证据成立，行号需小幅修正（原文 1006/1041/977 → 实际 1007/1042/972）。

src/views/Main.vue:1007 clearRegularTabItems 候选 = `filterItemsByRange(getItemsByTab(tabType), rangeValue)`；getItemsByTab 定义在 :972-981，非 collect 分支直接取 `window.db.dataBase.data`(:978)。
src/storage/sqliteClipboardRepository.js:491-494 refreshCache 中 `data = this.selectItems('collected = 0', {}, 'update_time DESC', TAB_CACHE_LIMIT)`，TAB_CACHE_LIMIT 定义于 :14 = 30；dataBase.data 仅在 refreshCache 中赋值（:508-517），无任何分页追加，故 SQLite 模式下恒 ≤30 条。
src/global/initPlugin.js:1288-1291 默认走 `createSqliteWithRetry()`，:1294 仅在失败时回落 createClipboardRepository（JSON fallback，clipboardRepository.js:95 返回完整 dataBase.data）——即该缺陷在默认 SQLite 模式下必现，JSON 降级模式下不现。
删除本身确非 API 限制：Main.vue:1026-1030 走 `window.db.removeItems(removableIds, {force:false})`，repository :676-713 支持任意批量。
UI 反馈按截断后的候选算：进度条 :1014-1025 用 candidates.length，:1122-1123 提示“已清除 N 条记录”，N ≤30 且显示为成功。
写盘放大属实：removeItems 走 runInTransaction(:325-340) → queuePersist(:358-365) → persistNow(:351-356) `this.db.export()` + writeFileSync 全库覆盖写。
收藏分支 :1042 clearCollectTabItems 同样取 `window.db.getCollects()`（repository :772-774 返回 dataBase.collectData，同为 TAB_CACHE_LIMIT=30 截断），但它调用的是 :1071 `removeCollects`，repository :748-762 只执行 `UPDATE items SET collected = 0`——是“取消收藏”，不是删除。
次要引用亦属实：Main.vue:768-781 getAllKnownItems、:928 星标筛选取 getCollects()、:1415-1419 collectedIds 均把 30 条快照当全量。
- 影响: 用户对着几千条历史点「清空全部」，实际每次只删 30 条，且 UI 反馈是成功的——要清 3000 条需要重复约 100 次「打开对话框 → 选范围 → 确认」共 300+ 次交互，且每次都触发一次全库 export 写盘。改成按条件直接下 SQL 删除后，一次操作 = 1 次 DELETE + 1 次写盘，操作步数从 O(N/30) 降到 O(1)，耗时从分钟级降到百毫秒级。
- 落地: 方向正确，但必须按分支拆开，不能一把 DELETE：
1) 仅普通标签页（Main.vue:1007）新增仓储级范围删除，如 SQLiteClipboardRepository.removeByRange({type, sinceMs, force})：在 runInTransaction 内先 `SELECT id, data_path FROM items WHERE collected=0 AND (locked=0 OR $force) [AND type=$type] [AND update_time>=$since]`，逐条 blobStore.removeForItem 后再 DELETE items 与 items_fts（复刻 :698-708），最后 refreshCache()；返回 {removed, skippedLocked} 以驱动进度条与 :1122 提示文案。
2) 收藏标签页（Main.vue:1042）不得改成 DELETE：现行语义是取消收藏（repository :753 UPDATE collected=0）。若要突破 30 条上限，应新增 removeCollectsByRange 走同样的 UPDATE，而不是删行，否则是数据丢失级行为变更。
3) 必须做能力探测与 JSON fallback 兜底：Main.vue 现有 `window.db.removeItems ? ... : {removed:0}` 的写法要沿用（`window.db.removeByRange ? 新路径 : 旧路径`），或在 clipboardRepository facade 上补等价实现，否则 SQLite 初始化失败回落 JSON 时该入口直接失效。
4) “收口到 useClipQuery composable”作为独立重构提案单列，不要与本次修复同批改；Main.vue:768/:928/:1415 的同源缺陷各自有不同语义（星标块 COLLECT_BLOCK_CAP 截断是有意的展示上限），批量替换风险高于收益。
- 回归面: 1) 删除锚点/可见列表：现行 :1033-1038 依赖 removableIds 调 removeVisibleItemsByIds 再 scheduleDataRefresh；改成范围删除后拿不到完整 id 列表，必须改走整表重载路径（参考 :1510-1519 handleDataRemove 的 tabQueryCache.clear + list 重绑 + updateShowList），否则会打破 ClipItemList 的删除锚点与虚拟滚动游标（queryCursor/offset，见 :1521-1535 syncAfterVisibleDelete）。
2) 锁定与收藏保护：removeItems(:690-697) 同时跳过 locked 与 collected，新 SQL 必须同样带 `collected=0` 且默认 `locked=0`，否则会误删锁定项/收藏项。
3) blob 与 FTS 一致性：漏删 blobStore 文件会遗留孤儿资产，漏删 items_fts（:706-708，受 ftsEnabled 控制）会导致搜索返回已删条目。
4) 属 src/storage/ + 主界面批量删除改动，命中 vibe/rules/project.md:29/37 的高风险与“优先走 repository facade”约束：新方法必须落在仓储层并同时覆盖 SQLite 主路径与 JSON fallback，不能在 Main.vue 里直接拼 SQL 或写盘。
5) 大批量 DELETE 后仍是一次 db.export() 全库覆盖写（:351-356），需在 uTools 实机对大库验证写盘耗时与中断安全。

## A24. [speed] 设置页 5607 行 + 2536 行 scoped Less 被静态 import 进首屏 chunk，且 4 个面板用 v-show 一次性建 117 行命令表

- 位置: `src/App.vue:15`
- 成本/风险/置信: M / medium / medium
- 取证: 核心取证属实，个别数字需修正。
- src/App.vue:15 `import Setting from './views/Setting.vue'` 确为顶层静态导入；:19 `const settingShown = ref(false)`；:6 `<Setting v-if="settingShown">`（渲染已惰性，打包未惰性）。
- src/views/Setting.vue:47/134/589/750 四个面板确为 `v-show="activeTab === ..."`，因此非当前页签的整棵子树在设置页首次挂载时就全量建树。
- src/views/Setting.vue:3071 `<style lang="less" scoped>`，3071 行到文件尾 = 58,680 字节；且 Setting.vue **没有** `@import "../style"`（只有 src/cpns/ClipItemRow.vue:343、src/cpns/ClipItemList.vue:3021、src/views/Main.vue:2343 三处 import），所以这 58.6KB 是 Setting 独占的、可随 async chunk 一起分出去的样式。
- 命令数 117 属实：src/global/commandDefaults.js:13 COMMAND_DEFINITIONS 实测 81 条 + :106 `for (let i = 1; i <= 9; i += 1)` 每轮 push 4 条 = 36，合计 117。
- 列表确为裸 v-for 无虚拟化：src/views/Setting.vue:225 `v-for="row in filteredShortcutCommandRows"`；:1405 `const shortcutScope = ref('all')`，src/global/shortcutCommandRows.js:133 `if (scope === 'all') return true`，默认不过滤 → 首开即渲染全部行。
- **数字修正**：原文「模板里有 14 处 el-tooltip」是把 `grep -c` 的开闭标签行数当成了实例数。实测 `grep -c "<el-tooltip"` = 7、`</el-tooltip>` = 7；其中 6 处在 :225-295 的行模板内，且「复」(:264) 有 v-if、「启/禁」(:271/:279) 是 v-if/v-else 二选一，:258 的 tooltip 在 shortcutIds 的内层 v-for 里（通常 1 个）。实际每行约 4-5 个 ElTooltip 实例，117 行 ≈ 470~585 个，而非「600+」；量级相同，结论不变。
- src/views/Setting.vue:1582 `effectiveShortcutCommandResult` 确为 computed，内部 src/global/shortcutStore.js:294 getEffectiveShortcutCommandRows → :248 `backend.getOverridesMap()` 与 :304-306 `backend.getCommandSnapshotRows()` 两次同步 sql.js 读；migrateToCommandOverrides 确实跑两次（src/global/shortcutOverrides.js:16 一次，src/global/commandKeybindings.js:135 一次）。src/global/commandKeybindings.js:66-87 buildBindingOverrideKeyMap 确为外层 for + 内层 `bindings.find` 的 O(n²)；n 实测为 src/global/hotkeyBindings.js:103 HOTKEY_BINDINGS 的 148（不是 143）。
- 产物尺寸属实：dist/assets/index-BE2DmnbF.js 442,005 B、index-Dgv_FIiW.css 1,078,099 B；vite.config.js:32 `vendor-virtual` 分支确实永不命中（dist/assets 下无该 chunk，src 内 grep @tanstack 零命中，仅 package.json:12）。
- 影响: 入口 chunk 白背了一个只在用户点「设置」时才需要的 5607 行组件；改成 defineAsyncComponent 后首屏 JS 可少几十 KB、CSS 在配合第 1 条后可少掉 58.6KB 源码对应的产物。设置页首开时约 600+ 个 ElTooltip/ElPopper 实例同时建树，实测量级 300~800ms 卡顿；改 v-if + keep-alive 只建当前面板，命令页签接虚拟列表后只建可视 15~20 行，可降一个数量级。
- 落地: 提议 1（defineAsyncComponent）成立且风险最低，建议保留并**先只做这一条**；提议 2/3/4 需要改写：
1) src/App.vue:15 改 `defineAsyncComponent(() => import('./views/Setting.vue'))` —— 可行，且因为 Setting.vue 不 @import ../style，其 58.6KB Less 会随 async CSS 分出去，不触碰 EM-2026-06-13 要求的「弹窗全局样式必须走 src/main.js:7 `import './style/index.less'`」这条链。**但必须同时处理**：src/App.vue:20-27 的 watch 在 settingShown 翻 true 的**同一 tick** 就 `activateLayer('setting')`，而 Setting.vue:3030 的 `activateLayer('setting')` + :3032 `document.addEventListener('keydown', keyDownHandler, true)` 要等异步 chunk 落地才执行。这中间存在一个「setting 层已激活但无 handler」的按键黑洞窗口。修法：把 activateLayer 的时机移到 Setting 自身 onMounted（组件内 :3030 已有），或给 defineAsyncComponent 配 `suspensible`/loadingComponent 并在 loading 期间不激活层。
2) v-show → v-if：方向对，但「外面套 keep-alive」写法不成立 —— :47/134/589/750 是同一个组件内的普通 `<div>`，`<keep-alive>` 只缓存组件实例，对纯元素分支无效。正确做法是直接 v-if（面板内所有表单都 v-model 到组件级 ref，草稿态本来就在 setup 作用域里，不会丢），只需接受「切页签丢失各面板 DOM 滚动位置」这一个副作用。已验证 :2729/2736/2746 的 `activeTab = 'shortcut'` 后接 focusShortcutSearch()（:1966 内部是 nextTick），v-if 下仍能拿到 input，这条路径安全。
3) 命令表虚拟化：@tanstack/vue-virtual 确实闲置，用在这里合理，但要一并处理 :216 `shortcut-list--grid` 的 CSS grid 表头/表体对齐（虚拟化需绝对定位行），以及 :3001 的 ctrl+F 定位与关键词过滤后 scrollTo 的行为。建议作为提议 1/2 落地后的第二步，不要和 1/2 一次性合并。
4) **不建议照原样改**。effectiveShortcutCommandResult 是 computed，依赖 setting / hotkeyOverrides.value / shortcutSyncDocument.value，sql.js 读只在这些依赖变更时触发一次并缓存，不是「每次渲染」；改成手动 ref 会把「改完快捷键后表格自动刷新」变成必须在每个写入点显式调用，极易漏掉导致设置页显示过期键位。buildBindingOverrideKeyMap 的 O(n²) 是 148×148 ≈ 2.2 万次比较、亚毫秒级，不构成可感知开销；若仍要优化，只提 `bindings === 默认值` 这一条路径做模块级 memo，保留带参调用路径不变。
- 回归面: 1) 异步化 Setting 会打开「setting 热键层已激活 / Setting.vue keydown handler 未注册」的窗口（src/App.vue:20-27 vs src/views/Setting.vue:3030-3032），uTools 实机下用户点完设置立刻按 ↑↓/Esc 可能无响应，必须在实机验证。2) Setting.vue 的 el-dialog 走 teleport 到 body，样式依赖 src/main.js:7 的全局 index.less（EM-2026-06-13），异步化本身不破坏它，但若顺手把 index.less 挪进 Setting 就会复发该缺陷。3) v-show→v-if 触碰 vibe/rules/project.md:39 点名的「设置页存储状态区」与键盘导航，需验证 :3021-3033 的 setting.scroll.up/down、setting.tab.prev/next 四个 command 在面板未渲染时的滚动容器仍存在。4) 命令表虚拟化会让离屏行的 DOM 消失，任何依赖 querySelector 定位命令行的搜索/定位逻辑（:3001 ctrl+F 路径）需同步改造。5) 提议 4 的 computed→ref 会破坏快捷键改动后的自动刷新链（src/global/shortcutStore.js:294 是 SQLite/uTools-sync/setting 三态存储的唯一读出口），属于存储迁移与 fallback 敏感面。

## A25. [speed] 每次 keydown 都重建 143 条 command-aware binding（实测 18µs/次）并对 when 表达式重复 tokenize/parse，无任何缓存

- 位置: `src/global/hotkeyRegistry.js:401`
- 成本/风险/置信: S / low / high
- 取证: 逐条核对，全部属实，行号基本正确：

1) src/global/hotkeyRegistry.js:401 `const commandAwareBindings = getCommandAwareBindings(bindings);` —— 在 dispatch(:324) 内、每次按键都执行。确认。
2) src/global/hotkeyBindings.js:54-56 `getCommandAwareBindings(list) { return toCommandAwareBindings(list) }`；src/global/commandDefaults.js:167-169 `toCommandAwareBindings` → :153-165 `toCommandAwareBinding`，每条做 `...binding` 展开 + `getDefaultWhenForBinding({...binding, when: ...})` 又一次展开 + 第二次 `getDefaultWhenForBinding(binding)`（:156 与 :160），共 3 次对象展开 + 2 次调用。确认。
3) src/global/hotkeyBindings.js:103 起 HOTKEY_BINDINGS，`grep -c "shortcutId:"` = 143 条。确认。
4) 我在 node v24 上实测（脚本 import 真实源文件，5000 次）：getCommandAwareBindings 13.6µs/次、resolveKeybinding('down') 2.55µs/次、两者合计 16.6µs/键。原文 17.999µs 属同一量级，成立。
5) src/global/hotkeyRegistry.js:403-404 for 循环内 `getLayerPriorityOrder(activeLayers)`（:160-162 → src/global/hotkeyLayers.js:25-34 每次 new Set + map + sort）。确认在循环内，但循环体长度 = lookupIds 长度，非 Windows 恒为 1、Windows 最多 2（src/global/shortcutKey.js:332-350），所以「每轮重算」实际只有 1~2 次，不是 143 次级别的浪费。
6) src/global/whenExpression.js:127-130 `evaluateWhenExpression` → :101-103 `parseWhenExpression = createParser(tokenize(expression))`，无任何 Map/WeakMap 缓存。实测 0.33µs/次。src/global/keybindingResolver.js:14-22 `whenSpecificity` → :165-168 `getWhenLiteralSets` 又一次 `parseWhenExpression`，且在 :57-61 的排序比较器里被反复调用（比较器每次调用重算两侧 resolveWeight，同一 binding 的 when 串被 parse O(n log n) 次）。确认，且比原文描述更严重一点。
7) src/global/hotkeyRegistry.js:333-335 `document.querySelector(".el-overlay .el-message-box")` 位于 shortcutId 归一化(:345)之前；监听器 src/cpns/HotkeyProvider.vue:173 `document.addEventListener('keydown', keydownHandler, true)` capture 阶段。确认。注意它前面已有 :326-327 的 e.repeat 早退和 :328 的 isComposing 早退，所以长按非方向键、以及 IME 组字期间不会付这次查询；长按方向键（REPEAT_ALLOWED_KEYS）会付。
8) src/global/hotkeyRegistry.js:25-33 `shortcutIdForLookup` 用 `.split("+")` 拆分，而 compact id 用 `-` 分隔（src/global/shortcutKey.js:372-385 buildShortcutId），且 :310-330 eventToShortcutId 已把 metaKey 直接映射成 'c'，故 `p === "meta"` 永不成立 —— 该函数等价于多余的一次 normalizeShortcutId。「死逻辑」判断成立。
9) setBindings 唯一写入点 src/global/hotkeyRegistry.js:118，唯一调用方 src/cpns/HotkeyProvider.vue:168；`bindings` 数组没有其他外部变更点（getBindings:129 / getRegistry:437 只读导出，仓库内无调用）。缓存失效点单一，缓存方案在这一点上是安全的。
- 影响: 单次按键约 14~20µs 纯解析开销 + 143 次对象分配（GC 压力）+ 一次全文档 CSS 查询。长按方向键滚动时按 30 次/秒计，仅这一项每秒 4000+ 次对象分配；叠加第 10 条的整表 diff，是长按导航掉帧的第二来源。在 setBindings 里预计算成 `Map<layer, Map<shortcutId, binding[]>>` 并缓存 when AST 后，dispatch 只需 O(活跃层数) 次 Map 查找 + 少数候选的 AST 求值，单键工作量从约 14µs 降到约 1µs 量级。
- 落地: 提议 1、2、3 成立，提议 4、5 应否决：

【采纳】1) 在 src/global/hotkeyRegistry.js:118 setBindings 内把 getCommandAwareBindings(bindings) 结果缓存为模块级 `commandAwareCache`，dispatch:401 直接读缓存。失效点唯一（见取证 9），零风险，单独这一项就吃掉 13.6/16.6 ≈ 82% 的开销。这是投入产出比最高、且几乎无回归面的一步，建议只做这一步。

【采纳但需谨慎】2) shortcutId → binding[] 索引替换 src/global/keybindingResolver.js:38-61。必须保留三件事，否则改变命中结果：(a) `'*'` 通配绑定真实存在（src/global/hotkeyBindings.js:110-111 两条 setting-shortcut-record / setting-when-edit 的 overlay-block），索引必须同时并入精确桶与该层 '*' 桶；(b) resolveWeight(:33) 的 `- index / 10000` 用的是「在整个 bindings 数组中的原始下标」，分桶后必须把原始 index 一起存进桶里，不能用桶内下标；(c) :45 的 `layer !== 'main' && !layerPriority.includes(layer)` 过滤与 :53-54 的 layerWeight 排序语义要一比一保留。建议先加一组「同一按键在改造前后解析出同一 binding」的对拍用例再动。

【采纳】3) whenExpression AST 缓存。when 串来源受控（HOTKEY_BINDINGS 静态 when、commandDefaults.js:1-10 LAYER_WHEN_MAP、用户 override/宏 when），用 Map<string, AST> 即可；但请同时给 keybindingResolver.js:14-22 whenSpecificity 的 getWhenLiteralSets 加缓存（或干脆把 specificity 预计算进 setBindings 的缓存条目），否则排序比较器里的重复 parse 仍然存在。

【否决】4) MessageBox 布尔标志。理由：(a) hotkeyRegistry.js:336-344 的语义不是「Esc 关弹窗」这一件事，而是「MessageBox 打开时吞掉所有按键」（非 Escape 走 :343 `return false`），标志一旦漏更新就会让 Esc 穿透到 uTools 宿主导致隐藏/退窗，属于用户可见的功能回归；(b) ElMessageBox 在 src/global/registerElement.js:23,43 被注册为全局组件，调用点分散在 src/cpns/ClipItemList.vue:411、src/views/Main.vue:1951、src/views/Setting.vue 多处（全仓 17 处引用），无法穷举维护；(c) 它是三项开销里最小的一项，而且已被 :326-328 的 repeat/isComposing 早退挡掉了大部分高频场景。若一定要优化，用 MutationObserver 观察 .el-overlay 的增删来维护计数，而不是手工打标志。

【否决】5) 删 shadow 分支与 shortcutIdForLookup。shadow 分支（:367-392）是 vibe/specs/260610-shortcuts-redesign/9YG2-zz-plan-快捷键命令系统重构实施计划.ad:32 明确设计的只读对照诊断（生产默认关闭），删除等于删掉一个有文档记载的能力，且它被 `window.__EZCLIPBOARD_HOTKEY_SHADOW__ === true` 挡住，对性能零贡献。shortcutIdForLookup 确实是死逻辑，但它同样零成本，删它属于纯清理、不该混进性能改动里；真要删需按 vibe/rules/project.md「修改 src/global/ 前必须明确快捷键链」说明影响。
- 回归面: 1) 通配 '*' 绑定丢失 → setting-shortcut-record / setting-when-edit 两层的按键阻断失效，方向键/Tab 穿透回 setting 层（正是 hotkeyBindings.js:110-111 注释写明要防的问题）。2) resolveWeight 的原始 index 稳定序被分桶打乱 → 同键多绑定时命中优先级翻转，用户 override（source:'user' 权重 300）与 system 默认的相对次序可能变化。3) 缓存失效点遗漏 → HotkeyProvider.vue:174-176 的 window focus / HOTKEY_BINDINGS_UPDATED_EVENT / COMMAND_MACROS_UPDATED_EVENT 三条刷新链，以及 :188-191 的 HMR 分支，都必须经由 setBindings 走到，漏掉任一条会出现「设置页改完键、切回主界面仍是旧键」。4) MessageBox 标志（若采纳）→ Esc 穿透到 uTools 宿主，属实机行为回归，且 e2e 难覆盖。5) 本项完全不触及 .clip-item-scroll 滚动祖先、删除锚点、虚拟滚动、ClipSwitch 顶栏、repository facade、存储迁移/JSON fallback；dispatch:328 的 isComposing 早退是搜索框 IME 保护的一部分，任何改动都不得移动它相对 :326-344 的位置。plugin.json / preload.js / listener.js 不受影响。

---

# 七、附录 B：被驳回的 9 条（不要按它们立项）

## B1. [fit] quick-paste-top 被上次退出时的搜索词/锁定筛选静默过滤，与 plugin.json 声明的「粘贴置顶项」不符，且失败时无任何反馈

驳回原因: 取证在代码层面成立，但结论定性错误：被指为 bug 的两个行为（按搜索词/锁定筛选过滤置顶项、无匹配时静默不粘贴）在 vibe/knowledge/quick-paste-runtime.md:9/:58/:61 与 vibe/specs/260610-ui交互优化/11YG2-zz-record-快捷置顶实现记录.ad:22/:24 中都是显式规定的产品语义，不是与 plugin.json 声明冲突。同时 Esc（Main.vue:2225-2229）与粘贴退出（Main.vue:382-388 + utils/index.js:452-460）两条主路径都会经 watch(Main.vue:1944-1947) → persistLastActiveContext(Main.vue:969) 自动清空 keyword，影响量化被显著夸大。提议若执行会同时破坏已记录语义与 pin-group 共享上下文，按「提议会破坏现有行为则判 refuted」的标准判为 refuted。

## B2. [simplify] 四组小工具函数两处以上逐字重复，其中别名回退链两份优先级相反

驳回原因: 取证的 4 项行号基本属实（(1)(3)(4) 完全对得上，(2) 的行号也对），但两处关键结论站不住：(4) 声称的"可观测行为不一致"实为死代码，resolveItemAlias 全仓无调用方，粘贴路径不经过它；(2) 的提议方向会造成循环导入，且"CSV 列错位根因"未被证明（两处阈值本就不同）。按"提议会破坏现有行为 / 描述失实即判 refuted"的口径判 true，但 (1)(3) 的重复事实成立，可按修正后的做法执行。

## B3. [simplify] payload hydrate 逻辑在 UI 层被复制三份，根因是 repository 内部两条读路径 hydrate 行为不一致

驳回原因: 仓库层双读路径 hydrate 不一致、UI 三处补丁、quickPasteRuntime.js:183 缺校验，这些取证全部核实为真（行号 626/638 各差 1-2 行，已修正为 624/639）。但提议按原样执行会破坏现有行为：resolveItemById 的 null-drop 是承重语义而非冗余，useClipOperate 的 hydrateOperationItem 是活的兜底且输入来源不受 facade 约束。按"提议会破坏现有行为即判 refuted"的口径判 true；问题本身成立，按修正方案分步落地可行。

## B4. [simplify] 快捷键子系统 21 个 global 文件可收敛为 9 个：两个纯转发 shim、一条不可达的 legacy override 通道、一套 shadow 双解析器、四份层元数据

驳回原因: 核心方向（死码与不可达通道确实存在）成立且我逐行核实通过，但按判定口径必须判 refuted：一是描述失实（clearLayers 有 8 处测试调用却被称零调用；21→9 的文件账漏掉 7 个活文件并跨条重复计入 hotkeyGraph；四表合一把键空间不同的三张表当成同一张表；WHEN_MUTEX_GROUPS 行号错），二是提议按字面执行会破坏现有行为（删 clearLayers 打断其自身指定的 626 assert 验收网）。已给出收窄后的 A/B/C/D 版本。

## B5. [simplify] ClipItemList.vue 3342 行可按八个自然块抽 composable，其中导航仲裁与跟滚必须整体搬移

驳回原因: 结构性观察属实，但四处取证失实（导航块夹带 65 行锁定态代码、defineExpose 位置与出口数量、死码范围包含活代码、区间不含自身状态），且被列为“必须”的硬约束 (a) 会真实改变一个跨组件暴露 API 的语义并引入静默丢弃。按 refuted 判定标准（描述失实 + 提议会破坏现有行为）判 refuted=true，但保留可执行的修正版方案。

## B6. [speed] 首屏被 initPlugin 完整同步阻塞且全程白屏：旧 JSON 全量读盘 + sql.js WASM + FTS 重建 + 两次全库写盘都排在 mount 之前

驳回原因: 骨架行号大体正确，但三项量化描述失实且方向一致地夸大：(1)「全程白屏」不成立——initPlugin.js:1195 的 'checking' 经 storageRuntimeStatus.js:62 派发事件、由 main.js:31 的监听补渲进度条，作者计入白屏的 wasm 编译/整库读盘/缓存重建全程有可见进度；(2)「两次全库写盘各 100~400ms」在稳态启动上为 0 次，四处 persistNow 全在 :147 迁移分支或 :164 建库分支内；(3)「660KB wasm 的 modulepreload」不存在，dist/index.html 只预载 41KB 的 storage-sql.js。提议侧，第 2 条既逻辑循环（isJsonMigrationComplete 是需先开库的实例方法）又会破坏 initPlugin.js:1294 的 JSON 降级路径，直接违反 vibe/rules/project.md:36；第 1 条前半句破坏 mount 前 window.db 绑定的硬依赖；第 3、4 条收益≈0。核心观察（旧 JSON 全量读盘+回写无条件排在 mount 前）真实，但描述失实叠加提议会破坏现有行为，按「宁可漏报不可误报」判 refuted=true，另给出惰性化 legacyDb 的修正做法。

## B7. [speed] 搜索框无防抖：每敲一个字符都跑一次 COUNT(*) 全匹配扫描 + 30 行 blob 同步读盘 + 每条一次 dbStorage 别名读

驳回原因: 核心事实（无防抖、逐键触发查询、hydrate 在行循环内）成立，但判 refuted 的理由有三：(a) 影响量化不成立——FTS 路径的 COUNT 是索引匹配非全表扫，且 searchIndex.js:56-69 使图片行几乎不会被关键词命中，「30 次同步 readFileSync / 单键 30~120ms」是无代表性的极端上界；(b) 「每条一次 dbStorage 别名读」被错误挂到搜索主路径上，实际 SQL 路径在 Main.vue:905 就已返回，该成本只在星标/JSON fallback 分支；(c) 提议 3 与代码事实相反——Main.vue:757-766 并非按视口 hydrate，而是整页 hydrate 且额外多一次 getById SELECT，照做会更慢。加上提议 1 未处理「敲字后立刻回车粘贴」的陈旧列表问题（ClipItemList.vue:2440），按 refuted 处理更稳妥。

## B8. [speed] 列表零虚拟化，且锁定一条会让整表 key 变化触发全量卸载重挂；跟滚路径每次按键做几十次强制样式计算

驳回原因: 三段主张里，前两段（零虚拟化、锁定导致整表 key 变化重挂）经逐行核对成立，但第三段——也就是标题后半句和提议 3/4 的唯一依据——被代码直接推翻：.clip-item-scroll 的可滚性由 src/cpns/ClipItemList.vue:3025-3046 与 src/views/Main.vue:2345-2349 明确建立，并有 EM-2026-04-06-scroll-path 注释专门守护，getScrollContainer 走第一分支，逐级 getComputedStyle 的回退路径在有数百条数据时根本不会进入，「单次按键 60~90 次强制样式计算」不成立。加之提议 2 的实现方式会破坏 Main.vue:514-516 刻意的 shallowRef 设计、提议 3 会正面撞上 project.md:39 的防误改约束，四条提议中两条有害、一条实现方式错误，按「宁可漏报不可误报」判 refuted=true；其中「按 id 分行 key」这一条修正后的建议仍值得单独立项。

## B9. [speed] 改一个快捷键要 9 步且两级提交语义不统一；搜索必须回车、录制默认是「追加」而非「替换」

驳回原因: 判 refuted=true 有三条独立理由，任一条都足以否掉当前形态的立项：

(一) 定性错误。原文把「合并语义 + 仅顶栏保存」当成设计疏漏，但 vibe/specs/260613-SettingUiModify/260613-shortcut-multi-key-plan.md:13/51/123/141 与 12YG2-zz-summary:243 白纸黑字把这两点写成既定设计，:141 的「顶栏保存前重启不生效」还是一条已勾选的验收项，PROJECT_STATUS.md:36/60/67 将其标为 completed/reference。这不是 bug，是要走 spec 变更的产品决策。

(二) 提议 3 的技术前提失实。原文说「复用 :2886 里已有的 saveShortcutSettingsPayload 调用」即可即时落库；实际 src/global/shortcutStore.js:331-364 接收并落盘整个 setting payload，而 :2886 的调用点前置了 :2887-2896 三道校验、:2898-2934 打包了数据库路径/容量/自定义功能/悬浮预览/行拼接/主题。照此实现会在用户编辑路径途中把未校验值写盘，属实打实的行为破坏，且落在存储高风险区。

(三) 提议 2 会破坏现有 dirty 追踪。:2115 baseline 与 activeIds 同源，清空 active 不动 baseline 会让弹窗开即 dirty，每次关闭都触发未保存三选一。

事实取证本身大体属实（行号 :2111→:2108、:2264→:2265 需修正），其中「搜索必须回车」和「:1980 getRecordShortcutConflicts 是死代码」两点是干净、可独立落地的小改进，已在 correctedProposal 中保留。但整条以「9 步 → 4~5 步、省 50% 交互」为卖点的重构提案，证据支撑不足以对抗已验收 spec，且核心实现路径写错，按「宁可漏报不可误报」应予驳回。confidence 定 medium 而非 high，是因为「用户实际返工频率」无法从代码取证，若产品侧确有真实痛点，应作为 spec 变更重新提出而非作为缺陷。

---

# 八、本次核验未覆盖的部分

- 完整性批判 agent 因会话额度中断未执行，以下维度**未系统扫描**，不能视为无问题：
  - 错误处理与异常恢复路径
  - 并发/竞态（剪贴板监听与 UI 写入的交叉）
  - 安全（DOMPurify 使用正确性、`file://` 路径处理、SQL 拼接）
  - 可访问性、国际化
  - Windows / Linux 跨平台差异（本次仅在 macOS 上实测）
  - 内存泄漏（除预览 objectURL 外）
- 所有结论均为静态代码取证，**未在 uTools 实机运行**。路线图中标注「实机」的验证项全部待执行。
