# 验证记录

Date: 2026-09-09

## 一、已落地的修复

### P0-2 / P0-3 收藏数据丢失（不可逆，最高优先）

缺陷链：`refreshCache` 只取最新 30 条收藏 → `collectIdSet` 仅含这 30 个 id → `isCollected` 对第 31 条以后恒为 false →
`updateItem` 把 `collected` 写回 0（静默取消收藏）、`removeItems` 的收藏保护被跳过（条目被真删）。

| 改动 | 位置 |
| --- | --- |
| `rowToItem` 增加 `collected: row.collected === 1` | `src/storage/sqliteClipboardRepository.js` |
| `collectIdSet` 改由新增 `selectCollectedIds()` 全量构建 | 同上 |
| `addItem` / `updateItem` / `removeItems` 改用已取回行上的 `collected`（避免 N+1） | 同上 |

顺序按报告要求执行：**先补字段，再改判定**。颠倒会把「30 条失真」升级为「100% 全丢」。

### 其余 P0

| 项 | 改动 |
| --- | --- |
| Esc 逃逸 | `Setting.vue` 的 `isSettingOverlayOpen` / `closeTopSettingOverlay` 补 `shortcutSyncDialogVisible` |
| Radio 不可点 | `registerElement.js` 注册 `ElRadioGroup`/`ElRadioButton` + 3 个 theme-chalk CSS；`Setting.vue` `:label` → `:value` |
| CSS 重复 9 份 | 删 8 处 SFC scoped `@import "../style"` |
| 每次按键重建绑定 | `hotkeyRegistry.setBindings` 内缓存 command-aware 绑定，`dispatch` 读缓存 |
| quick-paste 冷启动 | `main.js` 的 `flushPendingQuickPasteActions()` 上移到 `createApp` 之前 |
| 死码清理 | 删 10 个文件 + 3 处 in-file 死块（详见下表） |
| 死配置 | `operation.drawerOrder`（只写不读）、`getRecordShortcutConflicts`（零调用）、`@tanstack/vue-virtual`（零引用）+ `vite.config.js` 对应死分支 |
| 抽屉拖拽 | 按用户决策**删除拖拽手势**：`ClipDrawerMenu.vue` 的 draggable/dragstart/dragover/drop、`reorder` emit、`onDragStart`/`onDrop`，及 `ClipItemList.vue` 的 `handleDrawerReorder`。排序入口收敛到设置页 |

删除的文件：

| 批次 | 文件 | 行数 |
| --- | --- | --- |
| 1 | `src/global/hotkeyGraph.js` | 157 |
| 1 | `src/cpns/HotkeyTreeView.vue` | 143 |
| 1 | `src/cpns/HotkeyTreeViewLayer.vue` | 147 |
| 1 | `src/cpns/HotkeyTreeViewShortcut.vue` | 215 |
| 1 | `src/cpns/ClipFloatBtn.vue` | 16 |
| 1 | `src/cpns/ClipWordBreak.vue` | 27 |
| 2 | `src/global/utoolsDB.js` | 529 |
| 2 | `src/global/dbMigration.js` | 217 |
| 附 | `src/style/cpns/clip-float-btn.less` | 32 |
| 附 | `src/style/cpns/clip-word-break.less` | 41 |

批 1 六个文件构成闭合簇（`HotkeyTreeView*` 三者仅互相引用，其余零引用）；批 2 两个文件亦为闭合对（`utoolsDB` 仅被 `dbMigration` 引用，`dbMigration` 零引用），实现的是**已废弃的 JSON→uTools DB 迁移线**，与当前 JSON→SQLite 主线（`src/storage/jsonMigration.js`）无关。

> **能力移除声明**：随批 2 删除，旧的「JSON → uTools DB」迁移与回滚能力一并移除。当前迁移主线为 JSON → SQLite。

`ClipItemList.vue` in-file 死块：`externalPreviewWindow` / `escapePreviewText` / `openExternalPreview` / `focusUtoolsMainWindow` / `closeExternalPreview` 共 230 行。`openExternalPreview` 零调用，故 `externalPreviewWindow` 恒 null，`closeExternalPreview` 为纯 no-op，其两处调用点一并移除。

## 二、验证证据

### 自动化

| 项 | 结果 |
| --- | --- |
| 14 个测试脚本全量 | **14 / 14 通过** |
| `node_modules/.bin/vite build` | 通过，无告警击穿 |
| 悬空引用扫描（21 个已删符号/文件名） | **0 处残留** |

新增回归测试 `test-collect-beyond-cache.mjs`，灌入 40 条收藏（超过 30 条缓存上限），断言：缓存外收藏项的 `isCollected`、`getById().collected`、`updateItem` 后不被取消收藏、`removeItems` 非 force 时被保护、force 时仍可删。

**反证已执行**（证明该测试确实能捕获缺陷）：

```
修复后            → PASS
临时还原修复前源码 → FAIL: 缓存外的收藏项也必须判定为已收藏（修复前此处为 false）
恢复修复版        → PASS
```

`test-syntax.js` 中一条断言硬编码了旧表达式，已同步更新，并**保留其原有防回归意图**（不得引用未定义的 `id`），另加两条守卫覆盖本次修复点。

### 量化收益

| 指标 | 修复前 | 修复后 | 变化 |
| --- | --- | --- | --- |
| 首屏 `index-*.css` | 1,078,099 B | 183,789 B | **−83.0%** |
| 首屏 CSS 合计（含 element-plus） | 1,161,292 B | 274,609 B | **−76.4%** |
| distinct 选择器 | 1448 | 1448 | **0 丢失** |
| 声明对 | 1277 | 1277 | **0 丢失** |
| `src/` 代码行数 | 30,748 | 29,240 | −1,508 |
| 已跟踪文件净行数 | — | — | −1,654 |

CSS 去重的安全性以**选择器集合与声明集合逐一比对**验证（剥离 `data-v` 属性后完全一致），唯一语义变化是特异度下降一级；针对 element-plus 内部类的 63 条规则全部属于 `Setting.vue` 自有 scoped 样式（`Setting.vue` 本就没有 `@import "../style"`），未受影响。`src/main.js` 的全局样式链按防误改清单要求保留未动。

### 浏览器实测（dev server）

| 界面 | 结果 |
| --- | --- |
| 主界面顶栏 / 空态占位 | 正常 |
| 搜索面板 reveal + `el-input` 覆盖样式 | 正常（该项为 CSS 去重的最高风险面） |
| 设置页存储状态区四分支 | 正常 |
| 快捷键配置管理 Radio 控件 | **修复生效**：渲染为真实 `el-radio-group`/`el-radio-button`，v-model 切换生效（修复前为两段裸文本） |

## 三、遗留缺口（未验证 / 未执行）

1. **Esc 修复未取得运行时验证**。dev 环境的启动 MessageBox「重要版本更新提示」无法关闭（dev stub 用内存存储，每次 reload 重现），而 `Setting.vue` 的 `isSettingMessageBoxOpen()` 守卫在设计上让 Esc 成为 no-op，该分支在 dev 里无法被触达。代码层面可确认：修复前 `closeTopSettingOverlay()` 无该对话框分支 → 返回 false → 走 `emit('back')` 退出整页；修复后新分支返回 true 并 `stopPropagation`。**属代码推理，非实测。**
2. **全部 uTools 实机复测未执行**：收藏超 30 条后的星标与删除保护、明暗两套主题的视觉回归、冷启动 quick-paste（macOS/Windows 两条路径）、抽屉排序改由设置页管理后的实际手感。
3. **审计本身的完整性批判未跑完**（会话额度中断）。以下维度未系统扫描，不能视为无问题：错误处理与异常恢复、并发/竞态、安全（DOMPurify 使用、`file://` 路径、SQL 拼接）、可访问性、国际化、Windows/Linux 差异、内存泄漏。
4. **P1/P2 未动**，按 [report.md](report.md) 路线图执行。

## 四、并发提示

本次修复期间有另一 session 同时在本仓库工作（新增 commit `849c61d`、`a2d13b4`，并改动了 `quickPasteSelection.js`、`shortcutReservations.js`、`whenBuilder.js`、`pinnedItems.js`）。两边改动无重叠，`ClipItemList.vue` 的删除区间（883-1112）与其改动区间（1611 / 2333-2342 / 2823-2896 / 3043）已逐一比对确认不冲突。上述测试与构建结果是在合并后的工作区上取得的。
