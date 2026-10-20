# Error Memory: EM-2026-04-10-utools-runtime-assets

## 1. 背景与症状
- uTools / Electron 控制台报 `Unable to load preload script: /Users/gdkmjd/work/czz/EzClipboard/dist/preload.js`。
- 随后业务入口报 `Cannot destructure property 'utools' of 'window.exports' as it is undefined`。
- 当前仓库没有 `public/` 目录，但旧 [`vite.config.js`](../../../vite.config.js#L6) 仍按 `public/plugin.json`、`public/preload.js` 等复制到 `dist/`。

## 2. 错误归类
- `runtime-path-mismatch`：真实运行路径是 uTools 从 `dist/plugin.json` 相对加载 `dist/preload.js`。
- `environment-assumption`：误以为 `public/` 仍是静态入口源，或误以为 Vite dev server 会自动提供 preload。

## 3. 误判链路
- 看到缺失 `dist/preload.js` 后，直接从历史提交恢复 `public/`，会重新引入已删除目录，而不是修正当前仓库的配置与脚本契约。

## 4. 已证伪方案
- 单纯恢复旧 `public/`：不符合当前仓库“配置/脚本生成运行时入口”的维护方向。
- 只启动 `vite`：Vite 只服务前端页面，不会自动生成 uTools 需要的 `dist/plugin.json` / `dist/preload.js`。

## 5. 已确认通路
- [`scripts/utools-runtime-assets.mjs`](../../../scripts/utools-runtime-assets.mjs#L4) 是 uTools 运行时入口的单一生成源。
- [`package.json`](../../../package.json#L4) 的 `serve` 必须先执行 `prepare:utools`，确保 uTools dev 模式读取 `dist/preload.js` 时文件已存在。
- [`vite.config.js`](../../../vite.config.js#L5) 在 `closeBundle` 阶段生成同一批运行时资产，确保生产构建后的 `dist/` 可直接加载。

## 6. 适用触发条件
- 排查 `dist/preload.js`、`dist/plugin.json`、`window.exports`、uTools dev 模式加载失败、构建产物缺少插件入口文件时检索本条。

## 7. 禁止再试的做法
- 未确认当前仓库入口生成策略前，不要直接恢复旧 `public/` 目录。
- 不要只修改 `plugin.json` 的 `preload` 字段绕过缺失文件；业务代码依赖 `window.exports`，preload 必须真实加载。

## 8. 推荐优先策略
- 先运行 `pnpm run prepare:utools` 或 `pnpm run build`，再检查 `dist/plugin.json`、`dist/preload.js`、`dist/listener.js` 是否齐全。
- 若需要调整 uTools 静态入口，优先改 [`scripts/utools-runtime-assets.mjs`](../../../scripts/utools-runtime-assets.mjs#L4)，保持 dev 与 build 共用同一生成源。

## 9. 关联文件 / 模块
- [`scripts/utools-runtime-assets.mjs`](../../../scripts/utools-runtime-assets.mjs#L4)：运行时入口资产定义与生成。
- [`scripts/prepare-utools-runtime.mjs`](../../../scripts/prepare-utools-runtime.mjs#L1)：开发启动前的生成入口。
- [`vite.config.js`](../../../vite.config.js#L5)：生产构建后的生成钩子。
- [`package.json`](../../../package.json#L4)：`serve` 前置生成脚本。

## 10. 后续观察点
- 若后续重新引入 `public/`，需要同时更新 Vite 配置、脚本和本文，避免双源分叉。

## 11. 重新加载仍是旧包
- 症状与清单身份见 [../../knowledge/error-memory/2026-10-20-utools-reload-keeps-old-pack.md](../../knowledge/error-memory/2026-10-20-utools-reload-keeps-old-pack.md)。
- 宿主机制不在本文复述。验收步骤见 [../../rules/workflow.md](../../rules/workflow.md)。
