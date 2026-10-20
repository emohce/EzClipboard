---
id: ezclipboard-utools-reload-old-pack-pointer
status: verified
scope: ezclipboard-pointer
fingerprint: utools-reload-writes-new-asar-keeps-mapped-inode__invalid-plugin-json-name-reinstalls-last-valid-pack
first_seen: 2026-10-20
last_verified: 2026-10-20
review_after: 2027-04-20
evidence:
  - user-confirmed
tags:
  - utools
  - packaging
---

# 重新加载后仍是旧插件包

## 症状

本地已经构建，重新加载或换了一份 asar 之后，插件行为仍是旧的。

## 错误思路

把「重新加载」、构建成功，或磁盘上任意一份较新的 `unsafe-*.asar`，当成正在运行的代码。

## 正确思路

本机已安装身份必须由生成源写出：`name` 为 `zplatjxv`，`version` 为 `1.3.8`，`pluginName` 为 `EzClipboard`，`author` 为 `emohce`。只替换当前渲染进程打开的 asar，完全退出 uTools 后再验收。

宿主机制与检测顺序的权威记录是 [../../../../../../czz/CzzProj/CodeNote/DevelopRef/Multi-System-Use/uTools/error-memory/utools-reload-keeps-mapped-asar.md](../../../../../../czz/CzzProj/CodeNote/DevelopRef/Multi-System-Use/uTools/error-memory/utools-reload-keeps-mapped-asar.md)。本项目验收步骤见 [../../rules/workflow.md](../../rules/workflow.md)。

## 禁止再试

- 不要从生成清单里去掉 `name` 或 `version`。
- 不要把展示名 `超级剪贴板` 写成 `name`，也不要改掉 `zplatjxv`。
- 不要替换一份并未被当前进程打开的 asar，也不要把插件内重新加载当成验收。
