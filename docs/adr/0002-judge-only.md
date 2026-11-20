# ADR 0002: JEV 只判定，不生成

- Status: Accepted
- Date: 2026-11-19
- Issue: #37 / #38（TypeSafe `/v1/systemone` 的语义边界）
- 证据行号以 `index.js` sha256 `a3995b3bff20177b…`（HEAD `84f1f2e`）为准。

## Context

JEV 网关（TypeSafe 兼容）不是 OpenAI 对话端点：它只暴露 `GET /v1/models` 与 `POST /v1/systemone`，后者回答四类**判断题**——`noul` / `choice` / `score` / `box`——并返回置信度，**不生成自然语言**。把它当对话模型用（直接回答用户）在协议层面就不成立。

因此「选 `jev/auto` 当模型」这件事必须包一层：JEV 负责「该谁干」，真正的文字由底层生成模型产出。

## Decision

JEV 在本系统里**只做判定**：`judgeOnce`（index.js:1505）与 `decideTier`（1226）、`pickSkill`（1421）全部只用 `choice` 题向 `/v1/systemone` 提问，拿回 `answers.{tier,skill,difficulty}` 与 `confidence`，随后**委派白名单底层 provider 生成文字**（decision→kimi-k3.1-pro，execution→deepseek-v4.1-flash-1017）。JEV 自身从不出现在「生成」角色里。

## Alternatives

- **让 JEV 也生成**：协议不支持，`/v1/systemone` 返回的是题型答案不是文本。
- **用一个本地规则版替代 JEV 判定**：作为兜底保留（`heuristicTier`/`heuristicSkill`），但主判定走 JEV；规则兜底必须标 `source:heuristic`（#39），不许冒充 JEV。
- **判定与生成合并到同一个大模型**：会失去「用便宜模型做路由、用对的模型做活」的分层意义，也无法独立评估判定质量（#10 回归集依赖判定可单独调用）。

## Consequences

- 正面：判定可独立评测（20 条金标准对 `/v1/systemone` 出题判分）；判定成本与生成成本解耦；降级路径清晰（JEV 挂→heuristic→仍出字）。
- 负面：多一次网络往返（已由 #38 合并判定把两次并一次缓解）；判定本身有延迟，需要 `judgeTimeoutMs` 兜底（#39，全路径）。
- 约束：任何「让 JEV 直接回答用户」的提议都违反本 ADR，应先回到协议能力核对。
