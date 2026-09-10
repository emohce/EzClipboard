# 剪贴板（uTools 插件 `eClipboard`）

多类型剪贴板历史管理（文本/图片/文件）、收藏分组、快速粘贴、多选合并、操作抽屉、桌面预览、可配置快捷键与主页功能。

## 核心特性
- 多类型历史：文本/图片/文件自动入库，空文本过滤，按更新时间倒序。
- 去重与写回：内容 MD5 去重；复制后写回剪贴板保持可粘贴状态（文本/图片）。
- 收藏分离：收藏独立存储并保留收藏时间，可锁定避免误删。
- 来源信息：记录剪贴板文件路径（`sourcePaths`/`fromFileSource`），便于追溯来源。
  > 前台窗口标题（`sourceApp`/`sourceWindowTitle`）依赖 `utools.shellExec`，真实宿主未提供该 API，实际恒为空且无 UI 消费；详见 vibe/specs/260909/2133-full-code-audit/report.md 的 A6。
- 稳健监听：优先原生监听，失败自动降级 300ms 轮询。
- 高性能存储：底层采用 SQLite 持久化，搜索走 `search_text` 冗余列的 LIKE 子串匹配。
  > 代码保留了 FTS5 建表分支，但当前打包的 `sql.js` wasm 未编译 FTS5 模块（实测 `no such module: fts5`），`ftsEnabled` 恒为 false，始终走 LIKE 回退。切换到 fts4 前必须先解决中文分词（simple 分词下 `MATCH '好世'` 匹配不到 `你好世界`，会比现状退化）。
- 分页加载：列表按游标分页拉取（初始一页、触底追加），已加载项由 `v-for` 全量渲染。
  > 尚未实现窗口化虚拟滚动：`src/cpns/ClipItemList.vue:16` 对整个 `showList` 做 `v-for`，`useVirtualListScroll` 的 `virtualizer` 传入 `null`（`src/cpns/ClipItemList.vue:1547`），`@tanstack/vue-virtual` 在 `src/` 下无任何引用。
- 多选合并：批量复制/粘贴，含图片/文件时自动走文件合并流程。
- 操作区可配：主页功能可勾选、排序，支持自定义跳转功能。
- 快捷键分层：主界面/搜索态/抽屉/清除对话框/全文预览/设置层屏蔽删键。

## 目录与代码地图
- 插件元数据：由 `scripts/utools-runtime-assets.mjs` 生成到 `dist/plugin.json`（名称、入口、预加载、平台、命令词）@scripts/utools-runtime-assets.mjs#4-23
- 入口：`src/main.js` 初始化插件并挂载 Vue @src/main.js#1-11
- 核心逻辑：`src/global/initPlugin.js` 数据库、监听、降级、收藏/锁定/删除等 @src/global/initPlugin.js#31-871
- 快捷键体系：`hotkeyBindings.js`/`hotkeyLabels.js`/`hotkeyLayers.js`/`hotkeyRegistry.js` @src/global/hotkeyBindings.js#1-343 @src/global/hotkeyLabels.js#1-145 @src/global/hotkeyLayers.js#1-46 @src/global/hotkeyRegistry.js#1-165
- 页面：`views/Main.vue` 主界面、搜索、多选、清除对话框 @src/views/Main.vue#1-240；`views/Setting.vue` 存储/快捷键/功能配置与自定义功能管理 @src/views/Setting.vue#1-185
- 组件：`src/cpns/*`（列表、全文预览、搜索、操作抽屉、悬浮按钮、标签编辑/搜索等）
- 数据：`src/data/operation.json` 内置操作 @src/data/operation.json#1-11；`src/data/setting.json` 默认配置模板（路径/条数/天数、展示功能、自定义示例）@src/data/setting.json#1-80

## 页面与层级
- **App.vue**：HotkeyProvider 包裹，主界面/设置页切换；进入设置时启用 `setting` 层屏蔽主界面删键 @src/App.vue#1-29。
- **主界面 (Main.vue)**：
  - 标签页：历史 / 收藏等（ClipSwitch）。
  - 列表：ClipItemList 展示文本/图片/文件，支持操作抽屉、全文预览、大图预览。
  - 搜索：可展开/收起，搜索态有独立快捷键。
  - 多选：空格或按钮开启，批量复制/粘贴，自动合并文件/图片。
  - 清除对话框：按时间范围清除当前标签页（收藏需先取消收藏）。
- **设置页 (Setting.vue)**：
  - 存储：路径查看/修改/打开，最大条数、保存天数（无限为 null）。
  - 快捷键：展示当前有效绑定（含用户覆盖结果）。
  - 功能：主页功能勾选/排序，自定义功能新增/编辑/删除（匹配条件 + 跳转命令）。

## 快捷键（默认）
- 当前配置存储使用 compact shortcutId，例如 `c-f`（Ctrl/Cmd+F）、`c-s-del`（Ctrl/Cmd+Shift+Delete）、`cr`（Enter）、`left`（←）。旧式 `ctrl+` / `ArrowLeft` 仅作为兼容输入归一化。
- 主界面：`tab`/`s-tab` 切分页；`c-1`~`c-9` 切标签；`c-f` 搜索；`c-s-u` 触发/取消“有锁”条件搜索并继续文字检索；`esc` 退出；`up`/`down`/`c-k`/`c-j` 导航；`left` 全文预览；`right` 操作抽屉；`cr` 复制；`c-cr` 复制并锁定；`c-c` 复制；`c-s` 收藏；`c-u` 锁定；`s-del`/`s-backspace` 开清除框；`del`/`backspace` 删除；`c-del`/`c-backspace` 强制删锁定；`space` 多选；`mod-s` 预览图片/文字；`a-1`~`a-9` 快速复制；`c-a-1`~`c-a-9` 抽屉子功能；`f2` 别名/标签编辑；`s-f2` 查看全文；`c-a-s` 打开设置；`pageup`/`pagedown` 翻页。见 [hotkeyBindings.js](src/global/hotkeyBindings.js:294)。
- 搜索态：`c-del`/`c-backspace` 删除，`c-s-del` 强删。见 [hotkeyBindings.js](src/global/hotkeyBindings.js:274)。
- 抽屉：`esc`/`left`/`c-left` 关闭；`up`/`down` 导航；`cr`/`c-cr` 选中；`c-1`~`c-9` 直选。见 [hotkeyBindings.js](src/global/hotkeyBindings.js:163)。
- 全文预览：`esc`/`right` 关闭；`up`/`down` 半页滚动。见 [hotkeyBindings.js](src/global/hotkeyBindings.js:190)。
- 清除对话框：数字 1/2/3/4/5/6 选范围（1小时/5小时/8小时/24小时/7天/全部）；`tab`/`s-tab` 切换；`cr` 确认；`esc` 关闭。见 [hotkeyBindings.js](src/global/hotkeyBindings.js:110)。
- 设置层保护：setting 层 Del/Backspace 不拦截，保留输入框行为。见 [hotkeyRegistry.js](src/global/hotkeyRegistry.js:348)。

> 快捷键可在设置页通过 `hotkeyOverrides` 覆盖；当前写入值为 compact shortcutId，并优先进入 SQLite shortcut repository，SQLite 不可用时回退 `utools.dbStorage`。

## 数据与配置
- 存储结构：底层 SQLite 存储，含剪贴板历史、收藏、标签等；首次启动自动迁移旧 JSON 数据并备份，路径按设备 ID 区分 @src/global/initPlugin.js#53-190.
- 清理策略：maxsize（最大条数）/ maxage（最长天数）配置项位于设置页，收藏不受影响；设置来源 `readSetting`。
  > 当前仅在 JSON 回退路径生效（实现在 `src/global/initPlugin.js` 的 legacy `DB` 内）。SQLite 主路径尚未实现该清理，`src/storage/sqliteClipboardRepository.js` 中无 maxsize/maxage 逻辑；详见审计报告 A3 / P1-3。
- 迁移与回退：首次启动自动检测旧 JSON 数据，备份后迁移至 SQLite；保留 JSON 回退机制 @src/storage/jsonMigration.js.
- 来源信息：解析剪贴板文件路径存入 `item.sourcePaths` / `fromFileSource` / `hasSourceInfo`；`sourceApp` / `sourceWindowTitle` 两列保留但当前恒为空（见「核心特性」注）。
- 文件处理：文件/图片保留 originPaths，列表支持图片预览和原始路径展示 @src/global/initPlugin.js#144-159 @src/cpns/ClipItemList.vue#47-101.
- 自定义功能：类型/正则匹配 + redirect 命令，设置页维护，默认示例见 `setting.json` @src/data/setting.json#12-78.

## 构建与发布
1) 开发：`pnpm install`，`pnpm run serve`（dev server 8081，对应 plugin.json development.main）。
2) 生产：`pnpm run build` 生成 `dist/`（相对 publicPath），包含 plugin.json 与静态资源。
3) 打包：确保 `dist/plugin.json` 在根，压缩为 zip 并改名 `.upx` 后上传 uTools 后台。
4) 本地调试：uTools 开发者工具加载 `dist/` 或 `.upx`.

## 使用速览
1) 复制任意文本/图片/文件，历史自动入库（空文本忽略）。
2) ↑/↓ 选择，Enter 复制；Ctrl+Enter 复制并锁定；Ctrl+S 收藏.
3) 空格开启多选，批量复制/粘贴；含文件/图片自动合并处理。
4) Shift 预览图片；Ctrl+← 查看全文；Ctrl+→/→ 打开操作抽屉。
5) Shift+Del 打开清除对话框，数字键选清理范围。
6) `Ctrl+Shift+U` 可在“全部 / 有锁”条件搜索间快速切换，再继续输入关键字缩小范围。
7) 设置页可改存储、上限、快捷键、主页功能与自定义跳转。

## 已知限制
- 文件写回剪贴板暂未实现；文本/图片已支持 @src/global/initPlugin.js#667-685.

## 参考项目

### ClipboardManager
- **项目地址**: [https://github.com/ZiuChen/ClipboardManager](https://github.com/ZiuChen/ClipboardManager)
- **技术栈**: Vue 3.5 + Vite 6 + Element Plus 2 + @tanstack/vue-virtual 3 + uTools
- **核心功能**: 剪贴板历史管理、多类型支持（文本/图片/文件）
- **特点**: 基于 Vue 3 框架，使用 Element Plus UI 组件库，支持 uTools 插件生态
- **官网**: [https://ziuchen.gitee.io/project/ClipboardManager/](https://ziuchen.gitee.io/project/ClipboardManager/)
- **贡献指南**: [CONTRIBUTE.md](https://github.com/ZiuChen/ClipboardManager/blob/main/docs/CONTRIBUTE.md)

## 测试建议
- 正常：文本/图片/文件入库与去重；收藏/取消收藏；锁定与强制删除；多选合并粘贴；快捷键导航。
- 边界：空文本不入库；大图预览；maxsize/maxage（当前仅 JSON 回退路径）；快捷键覆盖。
- 安全：文件原路径展示正确，锁定项不被常规删除。
- 回归：监听降级后仍能入库；自定义功能匹配与排序。
