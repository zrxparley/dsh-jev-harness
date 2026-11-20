# 架构（Architecture）

本文件描述 dsh-jev-harness 的组件、数据流，以及最重要的——**哪些行为是「约定」（靠提示词/纪律），哪些行为是「保证」（靠代码强制）**。混淆这两者是这个项目反复出事故的根因。

> 行号证据以 `index.js` sha256 `a3995b3bff20177b…`（HEAD `84f1f2e`，#39 全路径补刀）为准。后续提交会让行号漂移，**引用前请重新 grep 锚点**，不要把本文行号当成永久事实。本文刻意区分「已实现」与「已采纳未实现」。

## 组件图

```
                        ┌─────────────────────────────────────────────┐
                        │              用户 / Agent                    │
                        └───────────────┬─────────────────────────────┘
                                        │ 一句话 / 一个任务
                                        ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                    DeepSeek Harness (宿主)                     │
        │                                                               │
        │   模型下拉框 ──选中──▶  jev / auto  (provider, #37)             │
        │          │                                │                   │
        │          │                    ctx.llm.registerAdapter        │
        │          │                     (index.js:2816)                │
        │          ▼                                ▼                   │
        │   ┌─────────────────────────────────────────────┐            │
        │   │   createJevAdapter  (index.js:765)           │            │
        │   │   · prepareCall / stream                     │            │
        │   │   · 递归防护: 永不委派给 provider 'jev'        │            │
        │   │   · 缓存: 同一 session+turn 复用一次判定        │            │
        │   └───────────────┬─────────────────────────────┘            │
        │                   │ 判定                                       │
        └───────────────────┼───────────────────────────────────────────┘
                            ▼
              POST {base}/v1/systemone   （JEV / TypeSafe）
              ┌──────────────────────────────────────┐
              │  一次混问三题 (#38, judgeOnce:1505)    │
              │   tier       choice: decision/execution│
              │   skill      choice: top-8 候选 + none │
              │   difficulty choice: trivial/normal/hard│
              └───────────────┬──────────────────────┘
                              │ answers.{tier,skill,difficulty} + confidence
                              ▼
              ┌──────────────────────────────────────────┐
              │  委派到白名单底层 provider（真实生成）       │
              │   decision  → kimi-k3.1-pro               │
              │   execution → deepseek-v4.1-flash-1017    │
              │   流式原样回传（打字机效果）                  │
              └───────────────┬──────────────────────────┘
                              │ recordUsage + recordDecision
                              ▼
              ┌──────────────────────────────────────────┐
              │  账本 ledger (recordUsage:556 /            │
              │   recordDecision:518)                     │
              │   · recent[]  环形, 含 choice/confidence/  │
              │     source/degraded (#4 #39)              │
              │   · decisions[] 含 tier/skill/difficulty/  │
              │     confidence/criteriaVersion/escalated   │
              │   · hours/days 分桶                        │
              │   落盘: <DSH_HOME>/jev-harness-usage.json │
              └──────────────────────────────────────────┘

   L1 工具层（手动/调试入口，保留）：
     harness_call(1748) harness_classify(1920) harness_review(1951)
     harness_probe(2081) harness_skill(2186)

   客户端 bundle (lib/client.js)：设置面板 / 流量看板 / 侧栏芯片
        └── bridge 路由 (/api/jev-harness/*)：status/save/toggle/stats/test/token
            · Origin 闸 (#26) · Bearer token (#26) · 写请求校验
```

## 数据流（一轮普通对话，选中 `jev/auto`）

1. 宿主把 `messages` 交给 `createJevAdapter`（765）。
2. `cacheKey`（794）按「sessionId + 最后一条 user 消息下标 + 文本」判定是否需要重新问 JEV——同一轮工具往返复用，新 user 必重判。
3. `decideTier`（1226）向 JEV `POST /v1/systemone` 发 choice 题；超时由 `judgeTimeoutMs` 兜底（#39）。
4. 判定结果经白名单 `dshResolve(..., {exclude:['jev']})` 委派到真实模型，**绝不委派回 `jev`**（递归防护）。
5. 真实模型的流式响应原样回传宿主。
6. `recordUsage`/`recordDecision` 落账，含 tier/choice/confidence/source/degraded。

## 约定 vs 保证（本文件的核心）

| 行为 | 是约定还是保证 | 证据 / 强制点 |
|---|---|---|
| JEV 只判定、不生成 | **保证**（协议层）：`/v1/systemone` 只回答 `choice/noul/score/box`，不产出文字 | judgeOnce:1505 只用 choice 题 |
| 每轮一次混问（tier+skill+difficulty） | **保证**（代码）：merged 主路径只发一次 `/systemone` | judgeOnce:1505；测试 test/merged-judge.test.js 断言 exactly 1 |
| 请求体不随技能目录增长 | **保证**（代码）：候选先本地缩到 top-8 | slimSkills（scoreSkills:1148 起）；39→200 条对照测试 |
| 递归防护（jev 不委派给 jev） | **保证**（代码）：`dshResolve(exclude:['jev'])` + fallback | createJevAdapter:765 区域；adapter.test.js |
| 降级必须标注（不静默回退最贵模型） | **保证**（代码+账本）：`degraded:true` + `source:heuristic` + `error` | decideTier:1287、judgeOnce:1572/1594；#39 |
| 低置信升级到决策层 | **保证**（代码）：confidence<阈值→decision，阈值面板可调 | index.js:212 阈值解析；confidence.test.js |
| 判据版本化 + 回归集同步 | **保证**（测试）：版本变了金标准没同步→守卫红 | criteria.js；test/criteria-as-code.test.js |
| 「harness 接管每个指令」 | **约定**（提示词）：靠系统提示让 agent 调 `harness_call`；agent 不调，DSH 直接作答 | index.js:2855 起的提示词文本。**这正是 #37 存在的理由**——把约定升格为机制 |
| 「切到 `jev/auto` 后每轮都过 JEV」 | **保证**（机制，#37）：provider 层拦截，不依赖 agent 自觉 | createJevAdapter:765 + registerJevProvider:2816 |
| 账本按会话分区 | **已采纳、未实现**：当前是全局单文件 `jev-harness-usage.json`，无 session 维度 | usagePath:290-292。**见 ADR 0006，勿当现状** |
| 宿主级 adapter 行为（下拉出现、子代理同走、卸载残留） | **未实测**：需测试环境授权，离线用例不覆盖 | 见 #37 交付说明 |

## 关键术语

- **provider / adapter**：DSH 模型网关里的一个可提供模型的实体（provider）及其适配器（adapter）。`jev/auto` 是我们注册的「元 provider」，它自己不生成，判定后委派给真实 provider。
- **ledger（账本）**：所有出站网关调用与判定决策的本地记录，支撑看板与审计。
- **projection（视图/读模型）**：`usageReport` 把账本投影成小时/日桶供看板渲染。

## 相关 ADR

- [0001 judge-layer](adr/0001-judge-layer.md) — 判定放 L3 provider，L1 保留手动入口
- [0002 judge-only](adr/0002-judge-only.md) — JEV 只判定不生成
- [0003 single-judge-call](adr/0003-single-judge-call.md) — 每轮一次混问
- [0004 criteria-as-code](adr/0004-criteria-as-code.md) — 判据进仓库带版本
- [0005 judgement-timeout](adr/0005-judgement-timeout.md) — 判定超时与诚实降级
- [0006 session-scoped-ledger](adr/0006-session-scoped-ledger.md) — 账本按会话分区（**已采纳未实现**）
