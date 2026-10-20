---
id: ezclipboard-chat-container-image-preview
status: verified
scope: ezclipboard
fingerprint: chat-container-image-shows-unpreviewable__file-url-and-same-hash-recopy-do-not-repair
first_seen: 2026-10-20
last_verified: 2026-10-20
review_after: 2027-04-20
evidence:
  - user-confirmed
  - test
tags:
  - clipboard
  - image-preview
  - wechat
  - wework
---

# 聊天容器图片显示「图片无法预览」

## 症状

从微信或企业微信复制的图片，系统剪贴板里有，插件列表仍显示「图片无法预览」。

## 错误思路

用 `file://` 打开微信或企业微信容器里的路径。以为再复制一次会改掉旧记录的内容。把占位文案先归因成渲染进程读不了该文件。

## 正确思路

采集时把容器内的单张非 GIF 图片复制到 userData 的 `original-material/captured-files`。原文件不可读时，单张非 GIF 改用剪贴板里的 PNG/JPEG，只有像素时再编码成 PNG。列表对容器路径和这份副本在进程内读字节做 data URL，读不到再用 nativeImage。内容哈希不变时，再次复制只刷新时间，坏记录不会被覆盖。已经删掉的临时文件不能靠改数据库补回。

权威行为见 [../technical-details.md](../technical-details.md)。任务证据见 [../../specs/261020-wechat-image-preview.md](../../specs/261020-wechat-image-preview.md)。

## 禁止再试

- 不要让容器路径或副本路径退回 `file://`。
- 不要回填或改写用户现有 SQLite，也不要恢复已删除的临时文件。
- 不要把 GIF 或多文件组压成一张静态图，也不要复制普通文件。
- 不要用 `globalThis.crypto` 代替 preload 提供的 `crypto.createHash`。
- 不要在未确认正在运行的是新插件包之前，继续改预览代码。换包规则见 [2026-10-20-utools-reload-keeps-old-pack.md](2026-10-20-utools-reload-keeps-old-pack.md)。
