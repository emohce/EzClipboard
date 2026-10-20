# Error Memory Index

Tool: codex

记录**误区概念**与正确方向；遵循 [../../rules/documentation.md](../../rules/documentation.md#knowledge-hygiene权威文档原则)。

## 写什么

- 症状（一句话）
- 错误思路（概念，非代码）
- 正确思路（概念 + 链到权威知识页）
- 禁止再试（概念）

## 不写什么

- 中间产物（临时参数、废弃分支、排查时序图）
- 错误方案的代码块、调用栈、commit 引用
- 与权威知识页重复的正文

## 索引

| ID | 文件 | 主题 |
|----|------|------|
| EM-2026-04-06 | [2026-04-06-hideMainWindow-showMainWindow-api-race.md](2026-04-06-hideMainWindow-showMainWindow-api-race.md) | 列表粘贴退出 blur 链误弹窗 |
| EM-2026-06-13 | [2026-06-13-quick-paste-simulateKeyboardTap-only-v.md](2026-06-13-quick-paste-simulateKeyboardTap-only-v.md) | 静默快捷粘贴 API 选择错误 |
| EM-2026-06-13-setting-dialog | [2026-06-13-setting-dialog-teleport-global-less.md](2026-06-13-setting-dialog-teleport-global-less.md) | 设置页弹窗全局样式 teleport 未命中 |
| EM-2026-07-07-shortcut-legacy-final-key | [2026-07-07-shortcut-legacy-final-key.md](2026-07-07-shortcut-legacy-final-key.md) | legacy 快捷键最后一段被误当修饰符 |
| EM-2026-07-07-externalized-payload | [2026-07-07-externalized-payload-hydration.md](2026-07-07-externalized-payload-hydration.md) | 外置 payload 轻量行误作完整 item |
| EM-2026-07-11-node18-esm-test-runner | [2026-07-11-node18-esm-test-runner.md](2026-07-11-node18-esm-test-runner.md) | Node 18 无法加载核心测试动态导入的 `.js` ESM 源码 |
| EM-2026-07-15-pin-group-active-context | [2026-07-15-pin-group-active-context-bucket-drift.md](2026-07-15-pin-group-active-context-bucket-drift.md) | 置顶组合保存分桶与全局触发 Tab 上下文漂移 |
| EM-2026-10-20-chat-container-image | [2026-10-20-chat-container-image-preview.md](2026-10-20-chat-container-image-preview.md) | 微信/企业微信容器图片显示「图片无法预览」 |
| EM-2026-10-20-utools-reload | [2026-10-20-utools-reload-keeps-old-pack.md](2026-10-20-utools-reload-keeps-old-pack.md) | 重新加载或换错 asar 后仍在跑旧包；正文在 CodeNote |

权威实现见各主题知识页（例：[../quick-paste-runtime.md](../quick-paste-runtime.md)）。
