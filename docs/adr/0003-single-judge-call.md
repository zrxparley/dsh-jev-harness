# ADR 0003: 每轮一次混问 tier+skill+difficulty

- Status: Accepted
- Date: 2026-11-19
- Issue: #38（前置 #10 回归集、#42 判据版本化）
- 证据行号以 `index.js` sha256 `47b3f0864ad4772fdef78e646e561a65d7911a4031d107789c1a1aa64f066ce9`（行号采集于 commit `0e96932`）为准。

## Context

早期每次判定打两次 JEV：`decideTier` 问 tier（一次 `/systemone`），`pickSkill` 问 skill（再一次），skill criteria 里还塞了全部 39 条技能描述。成本：tier ~334ms，skill-pick 868–2057ms 且随目录线性增长。这是主路径上纯粹可省的往返。

TypeSafe `/v1/systemone` 的 `questions` 是对象，**同一请求可混多种题型**，我们只用了单个 choice。

## Decision

主路径（`harness_call` 且 tier+skill 都 auto）合并为**一次** `judgeOnce`（index.js:1505）：一个请求里同时问 `tier`（choice）、`skill`（choice）、`difficulty`（choice：trivial/normal/hard）。

- **候选瘦身**：skill 候选先由 `scoreSkills`/`slimSkills` 本地缩到 top-8 再进 criteria，请求体与目录规模解耦（39→200 条同样大小）。
- **一次落账**：merged 只记一条 `tool:'judge'` 的 `recordUsage`，`recordDecision` 一行含 tier+skill+difficulty+confidence。
- **保留单题入口**：`harness_classify`/`harness_review` 只要 tier，仍走 `decideTier` 单题——不为只要 tier 的入口多付 skill+difficulty 的 token。

## Alternatives

- **保持两次调用**：主路径每轮多付 0.9–2.1s，且请求体随目录膨胀，已证伪。
- **所有入口一律合并**：被否——只要 tier 的入口合并是纯浪费；合并的目的是省主路径往返，不是形式统一。
- **difficulty 用 `score`（连续值）**：被否——回归集无法对连续值做混淆矩阵；改 `choice` 三档（见 #42 判据）。

## Consequences

- 正面：单轮 1 次 `/systemone`（test/merged-judge.test.js 断言 exactly 1）；请求体 <12KB 且 39→200 不涨；审计一行看全三维。
- 负面/风险：混问让单请求更脆弱（一题判据写错影响全部）→ 由 #39 降级策略兜底，且三处判定路径（decideTier/judgeOnce/pickSkill）统一接 `judgeTimeoutMs`。
- **未实测**：真实 P95<400ms、混问 vs 分两次 tier 一致率 ≥90%——都需 `JEV_API_KEY`，标「未实测」，不用 stub 延迟凑数。
