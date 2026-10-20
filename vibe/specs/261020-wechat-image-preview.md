# 微信复制图片无法预览

## 原因

1. 从微信复制的图片会被记成文件。路径落在微信容器 `temp/`（`RWTemp` 或 `InputTemp`）下。企业微信缓存图落在企业微信容器的 `Caches/Images`。
2. 列表把纯图片文件组当成图片。容器路径若用 `file://` 预览，读失败后行内显示「图片无法预览」。微信临时文件随后会被删掉，旧记录无法补回。
3. 同一内容哈希只会刷新时间，不会替换已存数据。预览失败的旧行在再次复制后仍然还在。

## 处理

1. 采集微信容器内的单张图片，以及企业微信图片缓存。能读到原文件就按原字节保存；原文件不可读时，单张非 GIF 改用剪贴板里的 PNG/JPEG，只有像素时再编码成 PNG。见 [capturedFiles.mjs](../../src/utils/capturedFiles.mjs#L86)。
2. 副本放在 userData 的 `original-material/captured-files`。多文件组、GIF、普通文件、超限和写入失败仍保持原记录。
3. 预览容器路径和副本时，在进程内读字节并生成 data URL；读不到再用 nativeImage，不退回 `file://`。见 [imagePresentation.mjs](../../src/utils/imagePresentation.mjs#L28) 与 [ClipItemList.vue](../../src/cpns/ClipItemList.vue#L733)。
4. 插件清单保持已安装身份 `zplatjxv` / `1.3.8`。见 [utools-runtime-assets.mjs](../../scripts/utools-runtime-assets.mjs#L5)。换包步骤见 [workflow.md](../rules/workflow.md)。

## 验证

1. `node test-captured-files.mjs`、`node test-gif-preview.mjs`、`node test-image-classification.mjs` 在预览修复后通过。清单身份只改生成源，这三项没有因此重跑。
2. 2026-10-20 用户确认：完全退出 uTools 再打开后，容器图片可以预览。本轮没有代为打开插件界面。
3. 此前「重新加载」仍看到旧预览，是因为运行的不是这次构建。规则见 [旧包指针](../knowledge/error-memory/2026-10-20-utools-reload-keeps-old-pack.md) 与 [图片预览误区](../knowledge/error-memory/2026-10-20-chat-container-image-preview.md)。

## 限度

1. 已经删掉的微信临时文件不能恢复，对应旧行也不会回填。
2. 不改数据库结构，不写用户现有 SQLite。
