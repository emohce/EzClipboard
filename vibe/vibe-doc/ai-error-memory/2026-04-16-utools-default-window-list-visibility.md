# Error Memory: EM-2026-04-16-utools-default-window-list-visibility

## 1. 背景与症状

- **任务背景**：EzClipboard 主列表在 **uTools 默认窗口（macOS）** 下使用；独立拉大窗口或浏览器全屏 **不是**默认验收环境。
- **直接症状**：不是单纯「底部半条裁切」，而是 **连续向下键盘导航多步后**，当前高亮项 **仍不在列表滚动可视区内**；修完下移后又暴露 **向上移动时顶部会“漏一个”**。
- **用户真实目标**：**无必要不要滚动**，但目标项一旦不完整可见，就必须滚到**完整可见**；**不是**恒定居中。
- **用户可观察现象**：默认窗矮、**图片类条目**约 **2×** 单行文字条目的行高；按 **条目数** 一屏约 **6 条**量级时，按 **等效行/栅格** 约 **12 行**量级，**勿混用「6」与「12」**。

## 2. 错误归类

- `environment-assumption`（用大视口或错误参照系判断「可见」）
- `invalid-verification`（未在 uTools 默认窗复现即下结论）
- `runtime-path-mismatch`（滚动祖先、`scrollIntoView` 与列表容器不一致）
- `repeated-trial`（同一 action 多次 rAF 重复滚仍不收敛）

## 3. 误判链路

- 把问题窄化成「底部半条裁切」，忽略 **长距离导航不跟滚**。
- 命中 [EM-2026-04-06-scroll-path](2026-04-06-scroll-path.md) 后，仍继续把主精力放在手写 `scrollTop` / 容器推断 / inset 阈值上，而没有坚持 **原生 `scrollIntoView()` 先打通真实祖先链**。
- 把旧版“自动居中能滚起来”误读成“center 策略正确”，实际关键线索是：**旧版命中了原生 DOM 滚动通路**，不是“居中”本身。
- 把上移与下移都收敛成同一套 `nearest` 语义，导致 **下移已正常时，上移仍会漏一条**；上移需要单独保留“需要滚动时用 `end` 对齐”的 reveal 语义。

## 4. 已证伪方案

- 仅增加 `runNavigationScroll` 重试次数而不收敛到 **单一滚动实现**。
- 散点调用多处 `scrollToIndex` / 直接改 `scrollTop`，不经 **`submitNavigationAction`** 中枢与优先级。
- 以浏览器全屏或独立窗为唯一验证环境，推断默认窗行为。
- 在**高度链断裂**（滚动落到 document、顶部被 fixed 顶栏遮挡）的前提下把上移压成裸 `nearest`：目标项会滚到顶栏底下，形成“上移漏一条”。高度链修复后 `nearest + revealRows` 才成立。
- 把“无必要不滚”误写成“先靠手写容器补偿判断要不要滚，再决定是否调 `scrollIntoView`”，这会再次偏离 [EM-2026-04-06-scroll-path](2026-04-06-scroll-path.md) 的主通路。
- 只在滚动策略层排查“上移每步都滚”，而没有回到**滚动容器与坐标系**：`edge-align + end` 在 DOM 主通路里会无条件底对齐，`shouldScroll:false` 根本没有被消费。

## 5. 已确认通路

- **真实滚动容器**：`.clip-item-scroll`。其成立前提是 `html` / `body` / `#app` / `.app` / `.main` 到 `.clip-item-list` 的**确定高度链**；高度链一旦断裂，百分比高度退化为 `auto`，滚动会整体回落到 `document`，可见性坐标系随之失真（详见 [EM-2026-04-06-scroll-path](2026-04-06-scroll-path.md)）。
- **列表程序滚动主通路**：``src/hooks/useVirtualListScroll.js`` (`../../src/hooks/useVirtualListScroll.js`) 中 **`applyScrollToItemIndex`**（`scrollToIndex` 为其别名）为 **唯一 DOM 滚动入口**；只要目标节点存在，**优先直接调用原生 `scrollIntoView()`**，让浏览器沿真实可滚动祖先链决定是否滚动。
- **首项特例**：`index === 0 && align === 'start'` 仍优先 **`container.scrollTop = 0`**，避免 `scrollIntoView(start)` 在嵌套 WebView 中误滚祖先（对齐 [EM-2026-04-08-clipboard-nav-scroll-search-layout](2026-04-08-clipboard-nav-scroll-search-layout.md)）。
- **补滚方式**：`scrollIntoView()` 后允许少量 `requestAnimationFrame` 内 `ensure-visible` 兜底，但这只是补充，**不是主路径**。
- **业务中枢**：``src/cpns/ClipItemList.vue`` (`../../src/cpns/ClipItemList.vue`) **`submitNavigationAction`** → **`runNavigationScroll`** 是键盘导航唯一主入口；`Main.vue` 等直接改 `activeIndex` 的旁路，必须额外调用可见性同步。
- **“完整可见则不滚”的实现方式**：`resolveScrollInstruction` 在 `shouldScroll:false` 时把 `align` 归一到 **`nearest`**，交给原生 `scrollIntoView({block:'nearest'})` 天然 no-op；**不允许**在 `scrollIntoView()` 之前插入会抑制滚动的短路，判断失准时 `nearest` 仍会最小滚动。
- **单步语义**：
  - **下移**：目标项完整可见则不滚；不完整可见时由原生 DOM 通路补滚到完整可见。
  - **上移**：目标项完整可见则不滚（底部锚点不动，只移光标）；确需滚动时做**最小位移**，并通过 `revealRows` 扩大顶部 inset，在目标项上方保留一行上下文。余量由 `scrollIntoView()` 之后的 `ensure-visible` 补偿完成。

## 6. 适用触发条件

| 维度 | 说明 |
|------|------|
| 路径 / 模块 | `ClipItemList.vue`, `useVirtualListScroll.js` |
| 症状关键词 | 下移多步、高亮不在视口、上移漏一个、`activeIndex` 变但列表不滚、图片 tab、`scrollIntoView` |
| 关键 API | `applyScrollToItemIndex`, `submitNavigationAction`, `runNavigationScroll`, `list-nav-up`, `scrollIntoView`, `scrollTop` |
| 运行环境 | **uTools 插件默认窗口**，优先 macOS |

## 7. 禁止再试的做法

- 不经 **`submitNavigationAction`** 增加新的列表跟滚入口。
- 在未验证 [EM-2026-04-06-scroll-path](2026-04-06-scroll-path.md) 主通路前，再次把 `scrollTop` / 容器探测 / inset 判断放在 `scrollIntoView()` 前面。
- 在 **未对齐真实滚动祖先** 的坐标系上继续调「可见区」阈值。
- 让 `edge-align` 在“已完全可见且未 `forceScroll`”时仍以 `end` / `start` 对齐进入 DOM 主通路：这会把“无必要不滚”直接作废。

## 8. 推荐优先策略

- 先读 [EM-2026-04-06-scroll-path](2026-04-06-scroll-path.md) 再读本条：**先用原生 `scrollIntoView()` 打通真实滚动链，再谈“无必要不滚”的细化语义**。
- 单步导航目标固定为：**完整可见则不滚；不完整可见才滚到完整可见**，不要退回恒定居中。
- 上移或下移“该滚不滚 / 不该滚却滚”时，先确认 **`.clip-item-scroll` 是否仍是真实滚动容器**（`scrollHeight > clientHeight` 且 `document.scrollingElement` 不可滚），再看策略；坐标系错了调阈值一定无效。
- 上移“每步都滚”优先检查 ``list-nav-up`` (`../../src/cpns/ClipItemList.vue`) 是否被改回 `edge-align + end`；下移问题优先检查是否误把 `scrollIntoView()` 主通路短路掉。
- 验收固定在 **uTools 默认窗 + 图片 Tab + 长距离下移/上移**，不要只在浏览器大窗口判断。

## 9. 关联文件 / 模块

- ``src/hooks/useVirtualListScroll.js`` (`../../src/hooks/useVirtualListScroll.js`)
- ``src/cpns/ClipItemList.vue`` (`../../src/cpns/ClipItemList.vue`)
- [`vibe/knowledge/glossary.md`](../glossary.md)（`uTools default window`）

## 10. 后续观察点

- 极长单项（高于视口）时键盘导航是否需 **显式**「顶/底」用户预期切换。
- `hold-scroll` 长按连滚与 **单次滚动** 契约是否需进一步统一计时与清除 `currentNavigationAction`。
- 若未来再次出现“下移正常、上移漏一条”，先确认高度链是否又断裂（滚动回落 document、顶栏遮挡），再看 `list-nav-up` 的 `revealRows` 是否被置 0。
