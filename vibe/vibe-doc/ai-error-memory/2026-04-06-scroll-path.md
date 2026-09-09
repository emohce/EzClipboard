# Error Memory: EM-2026-04-06-scroll-path

## 1. 背景与症状
- 背景：列表键盘导航需要在高亮移动时自动滚动，并尽量让目标项居中显示。
- 直接症状：`activeIndex` 正常变化，但程序性自动滚动无效。
- 用户可观察现象：鼠标滚轮可以正常滚动列表，键盘触发的自动滚动不生效。

## 2. 错误归类
- `runtime-path-mismatch`
- `framework-misuse`
- `repeated-trial`

## 3. 误判链路
- 先把问题判断成“滚动策略阈值不合理”，尝试半页滚动、固定第 6 项后居中等策略微调。
- 随后把问题判断成虚拟列表的 `scrollToIndex(center)` 用法不对，继续围绕虚拟滚动器试错。
- 后续又尝试手动写容器 `scrollTop`，但仍未命中真实生效的滚动祖先链路。
- 真正浪费时间的原因不是“没实现居中策略”，而是一直没有先确认真实的程序滚动通路。

## 4. 已证伪方案
- 虚拟列表 `scrollToIndex(center)`。
- 手动计算并写入 `scrollTop`。
- 继续微调“前半页豁免”“第 6 项后居中”等阈值策略。

## 5. 已确认通路
- 普通列表 + 目标节点原生 `scrollIntoView()`。
- 生效原因：`scrollIntoView()` 会沿真实可滚动祖先链滚动，命中了鼠标滚轮同一条有效通路。
- **当时手写 `scrollTop` 无效的根因**：`.clip-item-list` 到 `html` 的高度链断裂，百分比高度退化为 `auto`，`.clip-item-scroll` 不产生溢出，真正滚动的是 `document`；`scrollTop` 被写在了不滚动的元素上。
- 该高度链已补齐（`html` / `body` / `#app` / `.app` 定高，`.main` 纵向 flex，`.clip-item-list` `flex:1 + min-height:0`），`.clip-item-scroll` 现在是真实滚动容器，容器坐标系与 `scrollIntoView()` 一致。

## 6. 适用触发条件
- 路径 / 模块：`src/cpns/ClipItemList.vue`、`src/hooks/useVirtualListScroll.js`、列表导航相关样式。
- 症状关键词：`active` 正常、手动滚动正常、程序滚动无效。
- 关键 API：`scrollIntoView`、`scrollTop`、`scrollToIndex`。
- 运行环境：`uTools` 默认窗口尺寸下的列表导航。

## 7. 禁止再试的做法
- 在没有确认真实滚动祖先前，继续调阈值策略。
- 用 `height: 100%` 声明列表滚动容器却不保证祖先链定高；flex 布局下同时缺 `min-height: 0` 也会让滚动静默回落到 `document`。
- 在没有新证据前，重复回到虚拟列表的 `scrollToIndex(center)`。
- 仅凭“鼠标能滚”推断“手动写 `scrollTop` 也一定有效”。

## 8. 推荐优先策略
- 如果“用户手动滚动正常但程序滚动异常”，优先检查真实滚动祖先和原生 DOM 通路。
- 优先验证目标节点原生 `scrollIntoView()` 是否命中正确通路，再决定是否需要更复杂的滚动控制。
- 先打通真实通路，再调居中、半页、长按等策略细节。

## 9. 关联文件 / 模块
- `src/cpns/ClipItemList.vue` (`../../src/cpns/ClipItemList.vue`)
- `src/hooks/useVirtualListScroll.js` (`../../src/hooks/useVirtualListScroll.js`)
- `src/style/cpns/clip-item-list.less` (`../../src/style/cpns/clip-item-list.less`)

## 10. 后续观察点
- 若后续重新引入虚拟列表，必须重新验证真实滚动祖先和定位链路。
- 改动 `.main` / `.clip-item-list` / `.clip-item-scroll` 的高度或 flex 声明后，回归判据：`.clip-item-scroll` 的 `scrollHeight > clientHeight` 且 `document.scrollingElement` 不可滚。
- 如果普通列表在大数据量下出现性能问题，应先补性能证据，再评估是否恢复虚拟化。
