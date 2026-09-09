# 列表上移滚动锚定与滚动容器高度链修复

Tool: claude

## 背景与症状

- 一屏可见约 12 条时，光标位于底部向上移动，底部锚点每按一次就上移一行（依次 13、12），列表被迫跟滚。
- 期望：目标项已完全可见时不滚动，底部锚点保持不动，只移动光标选择。
- 下移方向表现正常，形成“下移正常、上移每步都滚”的不对称。

## 根因

### R1 上移无条件底对齐

- 上移使用 `scrollMode:"edge-align" + edge:"end" + forceScroll:false`。
- `applyScrollToItemIndex` 的 DOM 主通路无条件调用 `scrollIntoView({block:'end'})`，`shouldScroll:false` 被丢弃。
- 下移使用 `center-preferred` → `block:'nearest'`，原生语义在完全可见时天然不滚，因此只有上移暴露问题。

### R2 滚动容器高度链断裂（多层嵌套根因）

- `.clip-item-list{height:100%}` 的祖先链 `html` / `body` / `#app` / `.app` / `.main` 均无确定高度，百分比高度退化为 `auto`。
- `.clip-item-scroll` 因此永不产生溢出，真实滚动落到 `document.scrollingElement`。
- 派生失效：
  - `getScrollContainer` 回退到 document，`getNodeMetrics` 用整篇文档盒当视口，可见性判定几乎恒为 true；
  - `ensureVisible` rAF 补偿成为死代码；
  - `.clip-item-scroll` 的 `@scroll` 永不触发，滚轮触底 `loadMore` 失效；
  - `getPageStep` 取整篇内容高，翻页/长按步长≈整表长度；
  - fixed 顶栏遮挡文档视口顶部，而 inset 硬编码 8/8，形成历史“上移漏一个”，并倒逼 R1 的 end 兜底。

## 改造范围

| 步骤 | 落点 | 内容 |
|---|---|---|
| S1 | `src/style/index.less`、`src/views/Main.vue`、`src/cpns/ClipItemList.vue`、`src/style/cpns/clip-item-list.less`、`src/style/cpns/collect-block.less` | 补齐 `html→.clip-item-scroll` 高度链；`.main` 纵向 flex；固定占位块 `flex:none` 防收缩 |
| S2 | `src/hooks/useVirtualListScroll.js` | `shouldScroll:false` 时统一把 `align` 归一到 `nearest`，使“完全可见则不滚”在 DOM 主通路成立 |
| S3 | `src/hooks/useVirtualListScroll.js`、`src/cpns/ClipItemList.vue` | 上移改 `scrollMode:"nearest" + revealRows:1`：最小位移，并在目标项上方保留一行上下文 |
| S4 | `src/views/Main.vue`、`src/global/initPlugin.js`、`src/global/devDbStub.js` | 移除恒不触发的 document 级 scroll 懒加载监听；`toTop`/`toBottom` 改指真实滚动容器 |

## 关键约束

- 不在 `scrollIntoView()` 之前插入会抑制滚动的短路判断：`shouldScroll:false` 只降级对齐方式，`nearest` 在判断失准时仍会最小滚动。
- reveal 余量通过扩大顶部 inset 表达，由 `scrollIntoView` 之后的 `ensureVisible` 补偿完成，主通路顺序不变。
- `STEP_NAV_UP_REVEAL_ROWS` 置 0 即回到“严格完全可见才不滚、不留余量”。

## 验收

见 [verify.md](verify.md)。
