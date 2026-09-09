# 验证记录：列表上移滚动锚定与滚动容器高度链修复

Tool: claude

时间：2026-09-09（GMT+8）。

## 环境

- `pnpm run build`（vite 6）通过。
- `pnpm run serve` + 内置浏览器，视口 800x600 与 700x420 两档。
- 浏览器面板处于隐藏状态时 rAF/定时器被节流，验证脚本将 `requestAnimationFrame` 临时改为同步调用，只改调度不改逻辑。
- 真实剪贴板数据不可用（dev stub 返回空库），列表行由与真实结构一致的 DOM 注入模拟；滚动钩子通过 `import('/src/hooks/useVirtualListScroll.js')` 加载真实模块驱动。

## 结果

### V1 滚动容器归位（S1）

| 项 | 改造前推断 | 实测（800x600） |
|---|---|---|
| `document.scrollingElement` 可滚 | 是 | 否（clientH 600 = scrollH 600） |
| `.clip-item-scroll` 可滚 | 否 | 是（clientH 540 / scrollH 1760） |
| 顶栏与滚动区重叠 | — | `.clip-switch` 底 55 < 滚动区顶 60，无重叠 |

- 过程中发现并修复回归：`.main` 变为 flex 容器后空占位块 `.clip-break` 被压缩（52 → 19.8px），顶栏会压住首行；补 `flex: none` 后恢复。
- 过程中发现并修复保真问题：空态占位「暂无数据」被挤出可视区；`.clip-item-list` 改为纵向 flex、滚动区 `flex:1 1 auto` 后恢复可见（578→600，视口内）。

### V2 上移语义（S2 + S3）

起点：滚到底部，`scrollTop=1220`，底部可见项 39。

| 目标索引 | scrollTop | 底部可见项 |
|---|---|---|
| 38 → 29 | 1220（不变） | 39（不变） |
| 28 | 1180 | 38 |
| 27 | 1136 | 37 |
| 26 | 1092 | 36 |

- 连续 10 次上移零滚动，底部锚点保持不动，符合需求。
- 需要滚动后每步位移一行（Δ44），首步 Δ40 为 reveal 余量与 8px inset 的合成值。
- 700x420（一屏 7 行）复测同构：38 → 34 零滚动，33 起每步一行。

### V3 下移与边界无回归

| 场景 | 结果 |
|---|---|
| 下移 `center-preferred` | 目标 ≤11 可见时 scrollTop 保持 0；12 起底部锚点逐行推进 |
| 末项 `edge-align + end` | scrollTop = 1220 = 最大滚动量，底部可见项 39 |
| 首项 `edge-align + start` | scrollTop = 0 |

### V4 派生缺陷（S4）

| 项 | 结果 |
|---|---|
| `getPageStep` | 800x600 → 11（一屏约 12 行）；700x420 → 6（一屏 7 行）。改造前取整篇内容高，步长≈整表长度 |
| 滚轮触底 `loadMore` 判据 | `scrollTop + clientHeight + 12 >= scrollHeight` 在触底时成立 |
| 控制台错误 | 无 |

## 未覆盖

- uTools 默认窗实机验收（图片 Tab、长距离上下移、长按加速）未执行，需人工复测。
- 真实数据下的懒加载翻页、删除恢复、多选态行高变化未覆盖。
- 已知既有问题（非本次引入）：700px 宽下顶栏实测 98px 而 `.clip-break` 响应式档位为 96px，存在 2px 重叠；改造前后一致。
