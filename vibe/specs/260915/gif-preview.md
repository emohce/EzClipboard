# 图片分类与 GIF 展示

## 1. 范围与状态

1. 2026-09-15：代码实现、聚焦回归、独立图像解码、浏览器实际列表组件验证和生产构建通过；uTools 完整实机验收待办。
2. 所有受支持的纯图片文件记录（包括已有记录和多图组）统一归入图片列，从文件列排除；底层 type/data 和复制文件语义保留。列表显示第一张实际图片，不以文件名列表为主，多图显示数量。GIF 显示第一帧与 GIF 标识，预览使用完整动画。
3. GIF 的普通复制、列表粘贴与静默快捷粘贴使用原始 `.gif` 文件通道，防止静态图片 API 丢帧。
4. 图片与文档混合组保持完整文件记录；目录、损坏结构不误归类。分类基于项目既有图片格式识别，不需要迁移用户历史数据。无法读取或宿主无法解码时显示预览占位；GIF 首帧读取上限 50 MiB。来源应用只提供静态位图时无法恢复动画。

## 2. BusinessChangeReview

| 项目 | 约束与落点 |
| --- | --- |
| Baseline sources/version | 本次 GIF 需求；[富文件预览规范](../260616-rich-file-preview/01-spec.md:5)；[开发约束](../../rules/project.md:1)；[快捷粘贴执行契约](../../knowledge/quick-paste-runtime.md:26)。 |
| Allowed delta | 图片展示分类与存储类型分离；旧文件型图片和纯图片组进入图片列；实际首图、GIF 标识、首帧与动画预览；文件列不重复展示。 |
| Preserved invariants | 图片 Shift/全屏预览入口、现有布局/焦点/滚动/快捷键、非 GIF 文字与图片复制、多文件集合不拆分；保留来源路径。 |
| Storage boundary | 复用 image/data/thumbnail 字段，SQLite 与 JSON fallback 使用相同采集结果；不修改 schema、迁移、备份、重复导入、保留策略和设置状态。没有操作用户数据库。 |
| Affected consumers | SQLite/JSON 查询、分页/搜索/分类清空；Main 回退筛选及共享置顶匹配；列表图片样式与高度估计；Shift、详情、复制/静默粘贴；采集与恢复守卫。 |
| Test expectation changes | 新增图片分类测试；文件型单图/纯图片组展示为 image，但结果 type 仍为 file；混合组保持 file；图片列和文件列查询/清理集合一致。原有回归断言不改。 |
| Evidence/results | 见第 4 节；实机数据捕获、动画播放和目标应用粘贴仍未验收。 |
| Coverage gaps | uTools 文件 URL 读取、宿主图片解码能力和目标应用粘贴需实测；不能从静态位图重建动画。 |

## 3. 实现

1. [GIF 工具](../../../src/utils/gifPreview.mjs#L1)：按 [GIF89a 规范](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)遍历控制扩展、色表与图像子块，截取第一张图像后补结束标记。列表图无需按浏览器动画时钟抓帧；完整数据独立保留。
2. [采集入口](../../../src/global/initPlugin.js#L1131)：单 GIF 文件读取完整数据；原始剪贴板 GIF 优先于文本及 nativeImage 转换。生成首帧 thumbnail，并跳过会抹掉动画的剪贴板静态写回。
3. [列表展示](../../../src/cpns/ClipItemRow.vue#L107)：使用展示分类渲染图片分支；文件型图片读取第一张图片 URL，GIF 异步读取首帧，角标和数量不依赖文件名。
4. [复制入口](../../../src/utils/index.js#L262)：GIF 复用现有 createFile 输出完整 `.gif` 后走复制/原生粘贴文件 API，静态图片保持图片 API。

5. [统一展示分类](../../../src/utils/imagePresentation.mjs#L1)：复用既有格式分类；SQLite 注册内存函数供查询、分页和清空复用，导出数据库后恢复该函数；JSON、Main 和置顶匹配使用同一个 JS 分类函数，不改存储结构。

## 4. VerificationImpactTrace

| 验证 | 结果 |
| --- | --- |
| [GIF 回归](../../../test-gif-preview.mjs#L1) | 通过：两帧样本、首帧截取、扩展/局部色表、截断与损坏、大小/读取失败回退、真实 pbpaste 分类、文字/PNG 保持、GIF 恢复守卫、普通/静默复制字节一致。 |
| [图片分类回归](../../../test-image-classification.mjs#L1) | 通过：旧文件型图片、纯图片组/混合组/目录/坏结构；48 条图片跨页无重漏；文件列排除；搜索、置顶匹配、锁定/收藏保护、分类清空；存储 type/data 保留；flush 后函数继续可用。 |
| 浏览器组件验证 | 通过：实际 ClipItemRow 编译组件加载 4 个图片记录及 GIF 首帧，3 处 GIF 标识、多图数量可见，不呈现文件名列表；切换文件列只剩文档。使用合成样本与受控 preload，非完整 uTools 实机。 |
| 独立 Pillow 解码 | 通过：原图 2 帧，列表图 1 帧，第一帧 RGBA 像素与画布尺寸完全相同。 |
| [图片载荷](../../../test-image-payload-path.js#L1)、[文件预览](../../../test-file-preview.mjs#L1)、[预览布局](../../../test-preview-layout.mjs#L1)、[预览滚动](../../../test-preview-scroll.mjs#L1) | 全部通过。 |
| [JSON 迁移](../../../test-json-migration.js#L1)、[旧 JSON 惰性初始化](../../../test-legacy-json-lazy.mjs#L1) | 通过；测试在独立临时存储运行，SQLite 的 FTS5 不可用时使用既有 LIKE 回退。 |
| 生产构建 | 通过；现有 PDF.js eval 提示仍在。 |
| 项目规则审计 | 未通过：现有 AGENTS 路由、文档模板契约与项目状态传播/验收标记不完整；与本次 GIF 改动无关，未扩展修改规则。 |
| uTools 实机 | 未运行：需重新加载构建后，确认已有图片文件记录自动进入图片列、GIF 首帧及标识、纯图片组数量、混合组保留、Shift/全屏播放与复制粘贴。 |

## 5. Knowledge Context 与收尾

1. 已加载[项目规则](../../rules/README.md:1)、[开发偏好](../../knowledge/developer-soul.md:1)、[知识索引](../../knowledge/MEMORY_INDEX.md:1)、[UI 保护约束](../../vibe-doc/ai-error-memory/2026-06-09-ui-structure-interaction-guardrails.md:1)、[存储边界](../../vibe-doc/ai-error-memory/2026-06-09-storage-performance-rewrite-pitfalls.md:1)。
2. 过程文档：本页与[项目状态](../PROJECT_STATUS.md:24)同步。记忆路由：无新增持久记忆。
3. 保留工作区其他任务改动，本轮不安装或重启 uTools，提交交付不替代现场验收。
