# ADR 0001: 判定放在 L3 provider，L1 保留为手动入口

- Status: Accepted
- Date: 2026-11-19
- Issue: #37（前置 #38 合并判定、#39 失败降级）
- 证据行号以 `index.js` sha256 `a3995b3bff20177b…`（HEAD `84f1f2e`）为准，后续会漂移。

## Context

「harness 接管」最初只是**约定**：系统提示词要求 agent 调 `harness_call`（index.js:2855 起的提示文本），agent 照做才有判定，不照做 DSH 就直接作答。实测账本就停在「六小时只写入 8 条 probe」——**约定没有机制兜底，等于没有接管**。

要真正接管，必须把判定从「靠 agent 自觉的工具调用」升格为「宿主模型网关里的一等 provider」：用户在下拉框选中 `jev/auto`，此后每一次模型调用都先过 JEV。

## Decision

在 L3（provider 层）注册 `jev/auto` adapter：`createJevAdapter`（index.js:765）实现 `prepareCall/stream`，先判定、再委派白名单底层模型、流式回传；`registerJevProvider`（index.js:2816）通过 `ctx.llm.registerAdapter(['jev'], adapter)` 注册，宿主没有该方法或抛错时 `try/catch` 退化为仅 L1 工具。

**L1（`harness_call` 等五个工具，index.js:1748/1920/1951/2081/2186）保留**，作为手动指定与调试入口，不再是唯一路径。

## Alternatives

- **只靠 L1 工具 + 提示词约定**：已证伪——约定无法强制，账本证明大量请求绕过判定。
- **改宿主 DSH 源码强制路由**：侵入宿主、升级即碎，且超出本仓库边界（#26 的宿主鉴权问题已经示范了「改宿主」的成本）。
- **adapter 自己持有 kimi/dsf 密钥直连**：违反「不存他人凭据」红线；改用 `ctx.llm` 委派，宿主已有密钥。

## Consequences

- 正面：接管从约定变机制；`jev→jev` 递归被代码拒绝（adapter.test.js 断言 `prepareCall` 从未收到 `provider:'jev'`）；`shouldFollowDecision` 在 `jev/auto` 下不回写选择器（自噬防护）。
- 负面/限制：宿主级行为（下拉出现、子代理同走、卸载不残留）依赖 `registerAdapter` 这一宿主内部接口，升级可能破坏——已用 `try/catch` 包裹，失败退化 L1。这些宿主级验收**尚未实测**（等测试环境授权）。
- 已知限制：headless 宿主（有 llm 无 webServer）的注册路径已在 #37 补刀中处理，但宿主实测仍未做。
