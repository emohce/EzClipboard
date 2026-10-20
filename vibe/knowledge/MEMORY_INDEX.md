# Memory Reference Index

Tool: codex

## Purpose

This index is the project-level entry for reusable memories. Tasks should link to this file instead of searching every historical document first.

## Global Memory Sources

| Scope | Location | Use When |
|-------|----------|----------|
| Cross-project rules | [../../../CzzProj/CodeNote/AiRef/VibePractice/Vibe_Rules/VibeAi.md](../../../CzzProj/CodeNote/AiRef/VibePractice/Vibe_Rules/VibeAi.md) | General AI workflow, process, testing, memory, safety, and documentation rules. |
| Project rules | [../rules/README.md](../rules/README.md) | EzClipboard-specific constraints, task loading, verification, and high-risk areas. |
| Developer soul | [developer-soul.md](developer-soul.md) | High-level EzClipboard engineering taste, UI/product judgment, configuration philosophy, performance view, and AI collaboration defaults. |
| Project architecture | [ARCHITECTURE.md](ARCHITECTURE.md) | Stable architecture, module boundaries, runtime assumptions, and business behavior. |
| Quick paste runtime (top + group) | [quick-paste-runtime.md](quick-paste-runtime.md) | **Read first** when modifying `quick-paste-top`, `quick-paste-pin-group`, silent paste API, bootstrap pending, or product selection rules. |
| Quick paste pin group cache | [quick-paste-pin-group-cache.md](quick-paste-pin-group-cache.md) | Pin-group runtime cache shape, per-Tab type buckets, update timing, and hot-path id-resolution limits (subsection of quick paste runtime). |
| Error memories | [error-memory/README.md](error-memory/README.md) | Verified **misconception concepts** and guardrails—not intermediate attempts or wrong-code traces. |
| Chat container image preview | [error-memory/2026-10-20-chat-container-image-preview.md](error-memory/2026-10-20-chat-container-image-preview.md) | 微信/企业微信容器图需在采集时保存副本，预览读进程内字节；禁止退回 `file://`，禁止回填旧库。 |
| uTools pack reload | [error-memory/2026-10-20-utools-reload-keeps-old-pack.md](error-memory/2026-10-20-utools-reload-keeps-old-pack.md) | 本机插件身份与换包验收；宿主机制在 CodeNote，不在此复述。 |
| Clipboard navigation / deletion guardrails | [../vibe-doc/ai-error-memory/2026-04-08-clipboard-nav-scroll-search-layout.md](../vibe-doc/ai-error-memory/2026-04-08-clipboard-nav-scroll-search-layout.md) | Main list scroll, search focus, IME, multi-delete recovery, and delete-cache refresh; read before changing highlight, virtual scroll, multi-delete, or search-key handling. |
| ADRs | [adr/README.md](adr/README.md) | Accepted decisions and tradeoffs that should not be rediscovered. |
| Active process hub | [../specs/PROJECT_STATUS.md](../specs/PROJECT_STATUS.md) | Current progress, active task docs, and latest implementation focus. |
| Rich file preview runtime | [technical-details.md](technical-details.md) | File preview classification, uTools preload read/render APIs, PDF/PPTX/Office parser boundaries, or preview performance changes. |
| Setting page UI (2026-06-13) | [../specs/260613-SettingUiModify/260613-zz-raw-settingUiModify.md](../specs/260613-SettingUiModify/260613-zz-raw-settingUiModify.md) | Tab 布局、改键/When 弹窗、遮罩与 teleport 样式、热键穿透屏蔽。 |
| Shortcut multi-key binding (2026-06-13) | [../specs/260613-SettingUiModify/260613-shortcut-multi-key-plan.md](../specs/260613-SettingUiModify/260613-shortcut-multi-key-plan.md) | `cmd:` override、`shortcutIds[]`、场景化保留规则、改键弹窗状态机、冲突硬阻断；实现见 `src/global/commandKeybindings.js`、`src/global/shortcutReservations.js`。 |
| Shortcut compact semantics (2026-06-14) | [../specs/260613-SettingUiModify/260614-shortcut-compact-semantics.md](../specs/260613-SettingUiModify/260614-shortcut-compact-semantics.md) | `c/s/a` + key token 存储格式、legacy shortcut id 迁移、Tab/Space 固定键（含无 context 录入入口）、纯 Shift 内部 `mod-s`。 |
| Legacy sources | [legacy/README.md](legacy/README.md) | Historical context only; promote useful conclusions before relying on them. |

## Task Memory Protocol

Each medium or larger task should include a `Knowledge Context` section in its spec or plan:

- `required`: links that must be read before implementation.
- `related`: links that may affect edge cases or prior decisions.
- `new memory candidates`: facts discovered during work that may need promotion.
- `memory routing`: none, project memory, error memory, ADR, DB memory, or needs user confirmation.

## Promotion Rules

- Promote only reusable, verified, safe knowledge.
- Prefer updating an existing authoritative memory over creating duplicates.
- **Hygiene** ([../rules/documentation.md](../rules/documentation.md#knowledge-hygiene权威文档原则)): task specs keep scope and evidence; long-term truth lives in `vibe/knowledge/`; wrong ideas live in `error-memory/` as concepts only.
- Do not duplicate authoritative bodies in task notes—link once from spec conclusion or PROJECT_STATUS.
- When memory affects future implementation, link it from this index or an index linked here.
