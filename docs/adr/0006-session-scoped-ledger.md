# ADR 0006: 账本按会话分区（session-scoped ledger）

- Status: **Accepted — 已采纳，尚未实现（NOT yet implemented）**
- Date: 2026-11-19
- Issue: #40（与 #37 的 session 缓存、#39 的审计需求相关）
- 证据行号以 `index.js` sha256 `47b3f0864ad4772fdef78e646e561a65d7911a4031d107789c1a1aa64f066ce9`（行号采集于 commit `0e96932`）为准。

> **诚实现状**：本条是**决策采纳**，不是已实现功能。当前账本是全局单文件，**没有**按会话分区。写进 ADR 是为了让下一个实现者（或 agent）知道「该往哪改、为什么、别踩什么坑」，**不要为了好看而把它读成已上线能力**。

## Context

账本 `usagePath()` 固定返回 `<DSH_HOME>/jev-harness-usage.json`（index.js:290-292），所有 session 的 `recordUsage`/`recordDecision` 都写进这同一个文件。后果：

- 多 session 并发时，看板无法区分「这笔调用属于哪段对话」；审计想复盘「某次会话里 JEV 判了什么」只能按时间窗猜。
- 与 #37 的 session 缓存（`cacheKey` 已按 sessionId + 最后一条 user 下标分区，index.js:794-801）不对称——**判定按 session 复用了，账本却没按 session 分区**，两者粒度不一致。

## Decision

采纳「账本按会话分区」作为目标方向：`recordUsage`/`recordDecision` 的每条记录应携带 session 标识，看板与审计能按 session 过滤/复盘。分区键与 #37 的 `cacheKey` 对齐（sessionId + turn），避免出现「判定按 turn、账本按全局」的错位。

**本 ADR 落地前，账本仍是全局单文件**；任何依赖「按 session 查账」的功能都必须等本 ADR 实现。

## Alternatives

- **维持全局单文件**：现状。简单、跨 session 聚合方便，但无法按会话审计，且多 session 写同一文件靠文件锁串行化（usagePath 的 `.lock`，index.js:448），高并发下是瓶颈。
- **每 session 一个独立文件**：隔离彻底，但文件数量随 session 爆炸，跨 session 汇总要看目录扫描；需要额外的清理策略。
- **单文件 + 记录带 sessionId 字段（推荐）**：保留单文件的聚合便利，又能按 session 过滤；迁移成本最低（只是加字段 + 看板加过滤）。倾向这条，但**尚未实现**。

## Consequences

- 正面（实现后）：判定缓存与账本粒度一致；按会话复盘成为可能；多 session 审计不再靠时间窗猜。
- 成本：要改 `recordUsage`/`recordDecision` 的写入、`usageReport` 的投影、看板的过滤 UI；需要一次旧账本迁移或兼容（旧记录无 sessionId 时归为「未知会话」）。
- **当前风险（未实现状态）**：任何「按 session 看账」的需求都不能声称已支持；多 session 共写下仍依赖全局文件锁。本 ADR 关闭前，相关 issue 不应据此宣称完成。
