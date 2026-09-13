# Documentation Rules

Tool: codex

## Purpose

Consolidation follows [Single Authority And Current Entry](../../../CzzProj/CodeNote/AiRef/VibePractice/Vibe_Rules/process/documentation-impact.md#single-authority-and-current-entry). This adapter keeps only local paths and constraints.

Define EzClipboard-specific documentation routing. Cross-project principles stay in the CodeNote master rules; this file only maps those principles onto this repository.

## Documentation Layers

| Layer | Location | Role |
|---|---|---|
| Global master | [../../../CzzProj/CodeNote/AiRef/VibePractice/Vibe_Rules/VibeAi.md](../../../CzzProj/CodeNote/AiRef/VibePractice/Vibe_Rules/VibeAi.md) | Cross-project AI workflow, safety, memory, verification, and documentation rules. |
| DB governance | [../../../CzzProj/CodeNote/DevelopRef/调试工具/db/governance/README.md](../../../CzzProj/CodeNote/DevelopRef/调试工具/db/governance/README.md#5-workspace-shape-and-naming) | AI-DB workspace shape, storage routing, and naming authority. |
| Project adapters | [../../AGENTS.md](../../AGENTS.md), [context-loading.md](context-loading.md), [../../.agents/skills/ezclipboard-rules/SKILL.md](../../.agents/skills/ezclipboard-rules/SKILL.md) | Route tools to the authoritative rule tree without copying master rules. |
| Project rules | [README.md](README.md), [project.md](project.md), [workflow.md](workflow.md), [knowledge.md](knowledge.md), [documentation.md](documentation.md) | EzClipboard stack, risk boundaries, commands, verification, and documentation governance. |
| Process hub | [../specs/PROJECT_STATUS.md](../specs/PROJECT_STATUS.md) | Current main line, active task index, authoritative task docs, and closeout requirements. |
| Task docs | [../specs/](../specs/) | Requirements, plans, audits, verification records, handoffs, and task-local evidence. |
| Project knowledge | [../knowledge/MEMORY_INDEX.md](../knowledge/MEMORY_INDEX.md) | Reusable project memories, ADR routing, error memories, and architecture facts. |

## Write Policy

- Keep project-specific facts in this repository; keep reusable cross-project rules in CodeNote.
- Use [../specs/PROJECT_STATUS.md](../specs/PROJECT_STATUS.md) as the routing surface for current work, not as a detailed implementation log.
- Put detailed scope, implementation notes, verification, and handoff in task directories under [../specs/](../specs/).
- Task/archive folder date grouping and flat-folder repair are not redefined here; follow [CodeNote process rules](../../../CzzProj/CodeNote/AiRef/VibePractice/Vibe_Rules/process/rules.md#3-project-location).
- Promote only reusable, verified, safe knowledge through [../knowledge/MEMORY_INDEX.md](../knowledge/MEMORY_INDEX.md).
- Write Markdown links relative to the document location and include line suffixes for implementation evidence **in task docs citing current code**; authoritative knowledge and error memories prefer file-level links without stale line numbers.
- Do not create an empty DB documentation workspace; if DB/data work becomes active, initialize `vibe/ai-db/` through the DB governance authority above.

## Knowledge Hygiene（权威文档原则）

正式知识只保留**现行正确事实**与**已证伪的误区概念**；不保留中间产物、排查流水账、或错误方案的代码细节。

| 保留 | 不保留 |
|------|--------|
| 单一权威正文（如 runtime / architecture 知识页） | 同一事实在多处重复或互相矛盾 |
| 错误记忆中的：症状、错误思路（概念）、正确方向、禁止再试 | 中间尝试的参数、废弃 API 调用栈、supersede 附录、迁移桩 |
| 任务 spec 中的需求、落点、验证结论 | 失效行号引用、已推翻方案的正文描述 |
| 一条链接指向权威页，而非复制全文 | `vibe-doc` 与 `knowledge` 双份正文 |

**整理动作**

1. 过时主张：从 spec / 排查文档**正文删除或改为现行语义**，不追加「保留历史」附录；确需留痕的误区写入 [../knowledge/error-memory/](../knowledge/error-memory/)。
2. 失效引用：删除或改为指向权威文件的链接；行号仅在任务证据中维护，知识库以文件路径为准。
3. 晋升：可复用结论更新权威知识页；误区概念进 error-memory；两者均从 [../knowledge/MEMORY_INDEX.md](../knowledge/MEMORY_INDEX.md) 索引。
4. 过程 hub（[../specs/PROJECT_STATUS.md](../specs/PROJECT_STATUS.md)）只写里程碑与链接，不写实现排查细节。

**错误记忆最低结构**（概念级，无错误代码块）：症状 → 错误思路 → 正确思路 → 禁止再试 → 详见（权威知识链接）。

## Task Thresholds

- Small rule-only edits: update the affected rule file and run the project AI rule audit.
- Medium or larger documentation changes: update or create a task document under [../specs/](../specs/) and validate code links when citing implementation files.
- Business, storage, command, UI interaction, or architecture changes: keep the relevant task document synchronized and update [../specs/PROJECT_STATUS.md](../specs/PROJECT_STATUS.md) when focus, status, or authoritative docs change.

## Closeout

Every task touching documentation must report:

- Verification performed or skipped with reason.
- Memory routing: none, project memory, error archive, ADR, DB memory, or needs user confirmation.
- Process document status: not needed, created, updated, compacted, or archived.
