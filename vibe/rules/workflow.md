# Workflow Rules

Tool: codex

## Commands

- Known commands or command families: pnpm install; pnpm run serve; pnpm run build
- Prefer existing project scripts and documented commands over inventing new ones.
- Do not run destructive commands or production operations without explicit confirmation.

## Verification

- For small rule-only edits, run the CodeNote project audit.
- For code changes, run the nearest project-approved test or provide the smallest manual verification path.
- For documentation-heavy changes, validate Markdown links and record unresolved links.

## uTools 实机包

`pnpm run build` 只写 `dist/`，不安装插件包。生成源是 [../../scripts/utools-runtime-assets.mjs](../../scripts/utools-runtime-assets.mjs#L5)。

1. 生成的 `plugin.json` 保持已安装身份：`name` 为 `zplatjxv`，`version` 为 `1.3.8`，`pluginName` 为 `EzClipboard`，`author` 为 `emohce`。`name` 必须匹配 `^[a-zA-Z0-9]{3,16}$`。
2. 打包后确认包内同时有本次构建的脚本标记和 `zplatjxv`。
3. 只替换当前 uTools 渲染进程打开的 asar，替换前备份。不要替换另一份未打开的 `unsafe-*.asar`。
4. 进程仍映射旧文件时，完全退出 uTools 再打开。插件内「重新加载」会新建 asar，不会换掉已映射内容；清单不合法时，重载会装回上一份合格包。
5. `development.main` 为 `http://localhost:8081/`。目录开发模式走这个地址，不读 `dist/index.html`。asar 忽略该字段。

宿主机制见 [../../../../../czz/CzzProj/CodeNote/DevelopRef/Multi-System-Use/uTools/error-memory/utools-reload-keeps-mapped-asar.md](../../../../../czz/CzzProj/CodeNote/DevelopRef/Multi-System-Use/uTools/error-memory/utools-reload-keeps-mapped-asar.md)。项目薄指针见 [../knowledge/error-memory/2026-10-20-utools-reload-keeps-old-pack.md](../knowledge/error-memory/2026-10-20-utools-reload-keeps-old-pack.md)。

## Required AI Rule Audit

```bash
python3 /Users/gdkmjd/work/czz/CzzProj/CodeNote/AiRef/VibePractice/Vibe_Rules/scripts/audit_ai_rules.py . --mode project --fix-links
python3 /Users/gdkmjd/work/czz/CzzProj/CodeNote/AiRef/VibePractice/Vibe_Rules/scripts/audit_ai_rules.py . --mode project
```
