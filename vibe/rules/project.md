# Project Rules

Tool: codex

## Project Profile

- Name: `EzClipboard`
- Current inferred stack: Vue 3 + Vite + Element Plus + uTools clipboard utility
- Migration date: 2026-06-06

## Detected Manifests

- `package.json`
- `vite.config.js`

## Local Rule Policy

- Keep project-specific constraints here; move reusable cross-project rules to CodeNote.
- Do not overwrite existing user work or unrelated business files.
- Before implementation, inspect the relevant source paths and existing docs for the current task.
- For UI work, follow project style first, then CodeNote UI rules.
- For security, data, release, or permission work, apply CodeNote high-risk gates.

## High-Risk Areas

- Treat configuration, credentials, release scripts, generated artifacts, data mutations, and external-service writes as high risk until project-specific rules say otherwise.
- Add concrete high-risk paths here as they are discovered.
- Storage migration and repository changes are high risk: before editing `src/global/initPlugin.js`, `src/storage/`, or storage-related settings UI, state migration, fallback, data consistency, and verification impact.
- uTools runtime asset changes are high risk: before editing `scripts/utools-runtime-assets.mjs`, `vite.config.js`, or plugin preload/listener generation, state the dev/build/runtime impact.
- 插件清单必须保留已安装身份 `name: zplatjxv` 与合法 `version`。缺 `name` 时重新加载不会采用新的 `dist`。实机换包前备份，只替换当前渲染进程打开的 asar，并完全退出 uTools 后再验收。步骤见 [workflow.md](workflow.md)。
## Migrated Project-Specific Constraints

- 修改 `public/plugin.json`、`public/preload.js`、`public/listener.js` 前必须说明影响范围和回归风险。
- 修改 `src/global/` 前必须明确事件链、快捷键链、窗口行为或持久化路径。
- 修改动态滚动、焦点、高亮、列表导航时必须确认真实滚动祖先、真实焦点入口和真实触发链。
- `dist/` 是构建产物，不手改。
- 修改 `src/storage/`、`src/global/initPlugin.js` 的存储路径时，必须同时确认 SQLite 主路径、JSON fallback、迁移备份、重复导入防护和设置页状态展示。
- 修改主界面查询、批量删除、收藏、锁定、标签逻辑时，优先走 repository facade，避免新增直接扫描或直接写磁盘路径。
- 修改 UI 展示/布局/交互前，必须先阅读 [UI 结构与交互防误改记忆](../vibe-doc/ai-error-memory/2026-06-09-ui-structure-interaction-guardrails.md)，说明当前结构、必要性、替代链路和验证方式。
- 不要仅因视觉偏好重排 `ClipSwitch` 顶栏、`.clip-break` 占位、`.clip-item-scroll` 滚动容器、搜索 reveal/IME 保护、设置页存储状态区；除非能证明不会破坏搜索、键盘导航、虚拟滚动、删除锚点和输入框默认行为。
