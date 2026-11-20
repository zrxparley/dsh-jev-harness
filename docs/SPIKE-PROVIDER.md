# SPIKE: 把 jev-harness 做成 DSH 的一个 provider（#5 收口结论）

- 状态：调研完成，结论 = **可行**，已由 **#37 实装**
- 日期：2026-11-19
- 证据行号以 `index.js` sha256 `47b3f0864ad4772fdef78e646e561a65d7911a4031d107789c1a1aa64f066ce9` 及本机宿主包 `/Applications/DS Bot.app/Contents/Resources/app.asar` 实测为准。行号随提交漂移，引用前重新 grep。

> 本文件是 **#5（调研并验证 provider 路线）的收口文档**。它的作用是把「能不能做」回答成「怎么做、做到哪了、还差什么」，并说明 **#5 由 #37 消解**的替代关系。

## 一、结论（先说答案）

**可行。** DSH 宿主提供 `ctx.llm.registerAdapter(providers, adapter)` 扩展点，允许插件注册自己的 provider 路由。我们把 `jev` 注册为 provider、只暴露单模型 `auto`，用户在下拉框选中 `jev/auto` 后，每一次模型调用都先经 JEV 判定、再委派白名单底层模型生成。

落地分三步（第一、二步已进 main，第三步待授权）：

| 步 | 内容 | 状态 |
|---|---|---|
| 1 | 合并判定（#38）+ 失败降级（#39）+ 判据版本化（#42） | ✅ 已进 main，离线用例覆盖 |
| 2 | `createJevAdapter` + 注册 `jev/auto`（#37） | ✅ 代码已进 main（`d69fca4` + `6c850c5`） |
| 3 | 宿主级验收（下拉出现、普通对话落账、子代理同走、卸载不残留） | ⏳ **未实测**，等测试环境授权 |

## 二、扩展点（能力边界，本机实证）

`registerAdapter` 的能力边界——这部分我们**在本机宿主包里直接验到了**，不是照抄 issue：

- 符号存在：`/Applications/DS Bot.app/Contents/Resources/app.asar` 中 grep 到 `registerAdapter`，偏移 116679036 处注释原文为
  > "…Register implementations with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include `attributionHeaders()`…"
- 语义出处（issue #5 评论引用）：`dsh-llm/src/index.ts:10359`，`abstract class LlmAdapter { prepareCall(provider, model, signal); stream(options) }`——一个 provider 就是「把请求转给谁」的实现。

本插件侧的实现锚点：

| 能力 | 位置（index.js） |
|---|---|
| adapter 工厂 | `createJevAdapter` (765) |
| 委派真实模型 | `llm.prepareCall({provider,model})` (865) + `for await…target.stream()` (876) |
| adapter 暴露的接口 | `listModels` (913) / `resolveModel` (916) / `prepareCall` (919) / `stream` (922) |
| 注册 | `registerJevProvider` (2828) → `llm.registerAdapter(['jev'], adapter)` (2842)，调用点 2855 |

**能力边界（要注意的）**：`registerAdapter` 属宿主**内部接口**，非稳定公开 API，宿主升级可能破坏。已用 `try/catch` 包裹，注册失败退化为仅 L1 工具（#37）。宿主没有 `webServer` 的 headless 场景，注册路径在 `6c850c5` 中已改为不依赖 webServer。

## 三、协议适配

`openai-completions` 流的三件套现状：

- **stream**：`@deepseek-ai/dsh-llm` 不能从 bundle 路径 import（`Cannot find package`），所以流聚合是自己写的——`text-delta` / `reasoning-delta` / `usage`，只依赖宿主注入的 `ctx.llm` 契约（见 #5 评论与 adapter 实现）。
- **tool_calls**：实测带 `tools` 的请求能正确返回 `tool_calls`（Chief 在 shim 链路实测：`shell`，参数 `ls -la /tmp`）。**这是红线，已过**。
- **usage**：账本 `recordUsage`/`recordDecision` 记录 tokens（pt/ct），决策行含 tier/choice/confidence/source/degraded（#4 #39）。

## 四、L1/L2/L3 分层与「为什么 L2 不做」

| 层 | 是什么 | 是否采用 |
|---|---|---|
| **L1** | 工具级：`harness_call` 等五个工具，agent 按提示词调用 | 保留为手动/调试入口，**不再是唯一路径** |
| **L2** | 提示词 / 中间件级拦截 | **不做**（见下） |
| **L3** | provider 级：`jev/auto` 注册进宿主模型网关 | **采用**（#37） |

**为什么 L2 不做**：L2（再写一段更强的 system prompt、或在 agent 层包一个中间件）本质上仍是**约定**——它拦截不到宿主内部每一次模型调用，模型可以不调、子代理可以绕过、长上下文压缩后提示词会丢。#5 的全部痛点正是「约定不是机制」。要真正接管，必须下潜到 provider 层（L3），让宿主在路由阶段就拦下请求，不依赖 agent 自觉。L2 不能解决 #5 要解决的问题，所以不做。

## 五、共存方案（provider 接管后，L1 工具还留吗）

**留。** L1 五个工具（`harness_call`/`harness_classify`/`harness_review`/`harness_probe`/`harness_skill`）保留为**手动指定与调试入口**：诊断时强制某 tier（`tier=decision/execution`）、单独问判定结果（`harness_classify`）、质量门（`harness_review`）、连通探测（`harness_probe`）、技能目录管理（`harness_skill`）。

`registerJevProvider` 失败（宿主无 `registerAdapter` 或抛错）时**自动退化为仅 L1**，其余行为不变（#37）。两条路径共用同一套判定与账本，不会分叉。

## 六、改造范围与工作量评估

| 项 | 范围 | 工作量（实际） |
|---|---|---|
| 合并判定 #38 | `judgeOnce` 一次混问三维 + 候选瘦身 + 账本一行 | 已完成，6 条离线用例 |
| 判据版本化 #42 | `criteria.js` + 版本入账 + zh/en + 守卫 | 已完成，含 1.1.0 补刀 |
| 低置信策略 #4 | 阈值配置 + 升级 + 审计 + 面板输入 | 已完成，含面板 F1 补刀 |
| 失败降级 #39 | 三条判定路径统一 `judgeTimeoutMs` + degraded/skillError 入账 | 已完成，全路径补刀 |
| provider adapter #37 | `createJevAdapter` + 白名单委派 + 递归防护 + 自噬防护 + 注册 | 代码完成，8 条离线用例 |
| 宿主级验收 | 下拉/对话/子代理/卸载 | **未做**，需测试环境 |

## 七、风险与回退路径

| 风险 | 应对 |
|---|---|
| 宿主 `registerAdapter` 升级破坏 | `try/catch` 包裹，失败退化 L1；属已知限制，已写进 ADR 0001 |
| adapter 挂了 = DSH 不能说话 | 红线：JEV 超时/报错/不可用 → 直接委派默认模型继续出字，`source:fallback`（#39）；递归防护 `jev→jev` 被拒绝 |
| 判定缓存跨轮误命中 | 已修（`6c850c5`）：`cacheKey` 按「sessionId + 最后一条 user 下标」，新 user 必重判 |
| 回退路径 | 卸载/禁用插件即恢复原生 provider 列表；`registerJevProvider` 返回 false 时仅 L1。**卸载不残留**这条属宿主级验收，**未实测** |

## 八、#5 由 #37 消解的替代关系（关闭依据）

#5 问的是「能不能把 jev-harness 做成 DSH 的一个 provider」。**这个问题已由 #37 的实装回答**：`registerAdapter` 扩展点存在（本机实证）、adapter 已实现并注册（main）、递归防护与降级已落地、L1 共存方案已定。

因此 **#5 作为「调研」可以关闭**——它的产出就是本文件 + #37 的实现。**但 #5 关心的「让开真正接管」这一最终目标尚未完全闭合**：宿主级四条验收（下拉出现 `jev/auto`、普通对话落账、子代理同走、卸载不残留）**仍未实测**，需要测试环境授权。关闭 #5 不等于宣称「接管已验证」，而是「调研已完成、实施在 #37 跟踪」。

**最小 PoC**：`createJevAdapter`（index.js:765）即 PoC，已在 main（`d69fca4`+`6c850c5`）。它超出了 #5「spike 不进主流程」的原始预期——spike 直接长成了实施。宿主级验证待授权，**不以离线结果冒充宿主实测**。
