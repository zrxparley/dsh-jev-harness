# 迭代路线（v2.0）

> 这份文档与 GitHub Issues 同步维护：需求细节、验收标准、讨论都在 issue 里，这里只保留**顺序与取舍**。
> 功能线跟踪：<https://github.com/zrxparley/dsh-jev-harness/issues/12>
> 架构线跟踪：<https://github.com/zrxparley/dsh-jev-harness/issues/43>

评估基线：**v1.10.1**（2026-11-19）

一句话结论：功能面够用了，但「harness」这个定位目前只是**约定，不是机制**；真正卡迭代的是工程地基——测试全在 `/tmp`，仓库里 0 个。架构上的破局点是：把 JEV 从「工具」升格成「provider」。

## 两条线

功能线（#1–#36）解决「用起来对不对」；架构线（#37–#43）解决「到底谁在干活」。架构线顺序更靠前，因为它决定 JEV 的判定价值能不能兑现。

## 架构线顺序（#43）

| 顺位 | 需求 | 为什么排这里 | 依赖 |
|---|---|---|---|
| 1 | [#38](https://github.com/zrxparley/dsh-jev-harness/issues/38) 合并判定：tier + skill + difficulty 一次混问 | 低风险、当天见效；不做则 L3 每轮多付 0.9–2.1 s | — |
| 2 | [#37](https://github.com/zrxparley/dsh-jev-harness/issues/37) provider adapter：注册 `jev/auto` | 判定从「建议」变「控制面」；做完 **#5 关闭、#35 消解** | #38 |
| 3 | [#39](https://github.com/zrxparley/dsh-jev-harness/issues/39) 判定失败模式：诚实降级 / 永不阻断对话 | adapter 抛错 = DSH 答不了话 | #37 |
| 4 | [#42](https://github.com/zrxparley/dsh-jev-harness/issues/42) 判据版本化 → [#10](https://github.com/zrxparley/dsh-jev-harness/issues/10) 回归集 | 判定从「手感」变「有测试的组件」 | #38 |
| 5 | [#41](https://github.com/zrxparley/dsh-jev-harness/issues/41) 判定指标 + 分会话账本 → [#8](https://github.com/zrxparley/dsh-jev-harness/issues/8) 预算/导出 | 准不准要能看见 | #10 |
| 6 | [#40](https://github.com/zrxparley/dsh-jev-harness/issues/40) 架构文档 + 6 条 ADR | 与上述并行，最后收口 | — |

## 功能线顺序（#12）

| 顺位 | 需求 | 为什么排这里 | 依赖 |
|---|---|---|---|
| 0 | [#1](https://github.com/zrxparley/dsh-jev-harness/issues/1) 测试进仓库 + CI | 半天成本，之后每次改动都有安全网 | — |
| 1 | [#2](https://github.com/zrxparley/dsh-jev-harness/issues/2) 自动带入会话上下文 | 最高频翻车点（「继续上一轮」是断头路），改动小 | #1 |
| 2 | [#3](https://github.com/zrxparley/dsh-jev-harness/issues/3) 降级链 + 熔断 + 分级超时 | 纯可靠性收益，看板能直接看到效果 | #1 |
| 3 | [#4](https://github.com/zrxparley/dsh-jev-harness/issues/4) 判定置信度策略 + 可审计 | 判定从黑盒变可复盘 | #1 |
| 4 | [#6](https://github.com/zrxparley/dsh-jev-harness/issues/6) 单一源同步 · [#7](https://github.com/zrxparley/dsh-jev-harness/issues/7) 启动自检 | 防漂移、防静默白板 | #1 |
| 5 | [#9](https://github.com/zrxparley/dsh-jev-harness/issues/9) 密钥 · [#11](https://github.com/zrxparley/dsh-jev-harness/issues/11) 技能路由深化 | 产品化，不阻塞使用 | #1 |

UX 批次（#13–#24）与可靠性批次（#25–#36）按各自 issue 内的顺序走；其中 **#14 / #15** 与架构线有交叉：一旦 #37 生效，每轮都产生决策，账本 12 条上限会被瞬间冲掉 —— 所以 **#41 的分会话改造要早于打开 L3 开关**。

## 核心判断

**「开 = 不走 DSH 网关」目前严格说不成立。** 插件只能注册工具 + 插一段 system prompt，真正决定请求发给谁的是 DSH 的 provider 层。当前链路是「DSH 模型读了 prompt，自觉去调 `harness_call`」。上下文一长、prompt 被压、模型犯懒，就会静默走回 DSH 网关，而流量看板也不会显示（那不是插件流量）。

破局点已确认可行：DSH 暴露 `ctx.llm.registerAdapter(providers, adapter)`（`dsh-llm/src/index.ts:10359`），插件可以注册自己的 provider 路由。注册 `jev` + 单模型 `auto`，用户选一次即全局接管，连子代理都走 —— 这就是 #37。

**无状态单轮是更早咬人的问题。** `harness_call(task, context)` 不带会话历史，「继续」「把刚才那段改一下」只能答歪，或让调用方把历史复制进 `context`（重复计费）。所以 #2 仍在功能线最前面。

## 已知阻塞（与迭代无关）

- **DSHmarket PR #16794**：OPEN / MERGEABLE，CI 仅卡仓库「年龄 < 1 天」的时间闸，会自动重跑清除（约 2026-11-20T03:11Z），无需重新提交。
- **npm 发布凭证**：已解决（`~/.npmrc` 内有 40 字符 granular token，1.6.2 起持续发布成功）。注意 npm 侧有数分钟异步处理 + CDN 边缘缓存，publish 后 3 分钟内 404 **不代表失败**。

## 已完成（对照用）

- **v1.10.1** 会话内选择器联动：改 `sessions.selectModel({sessionId, provider, model})` —— 之前只写 `agentDefaultModel.saveSelection()` 只改「新建会话默认值」，活会话显示的是自己的 `modelSelection` projection，所以表面看「永远不变」
- **v1.10.0** 让 DSH 选择器跟随（`followModel`）+ 模型从用户自己的 DSH 清单里发现（`listProviders` / `dshResolve` 打分，0 硬编码）
- **v1.9.0** 模型不再硬编码：决策层/执行层从本机 DSH 网关的 provider/model 清单里挑
- **v1.8.0** 执行方式双路由：默认走 DSH 网关（`ctx.llm`，只需 JEV key），可切直连
- **v1.7.0** 决策追踪：悬停开关看「这次是谁干的」（判定理由 + 实际模型 + tokens）
- **v1.6.2** 流量看板可观测：`更新于 / 已刷新 N 次 / 打开后新增 N 次` + 立即刷新
- **v1.6.1** 修「近 7 天」全 0 —— `USAGE_HOURS=48` 裁掉小时桶，而 `/stats?hours=168` 仍读小时桶；改为超过 48h 自动切日桶（`grain: 'hour'|'day'`）
- **v1.6.0** 流量看板：三网关请求量 / tokens / 失败 / 最近调用表，24h 与 7d 两种粒度
- **v1.5.0** 技能路由：JEV 从 `mattpocock/skills` 的 39 个 skill 中挑选并挂载正文，支持刷新与缓存
- **v1.4.0** 总开关：开 = 走 JEV 分流；关 = 让位 DSH 自身网关

## 每个版本的收尾动作

```
npm pack                    # 生成 tarball（先在两棵树同步：index.js / skills.js / lib/client.js / locale/*）
npm publish --access public
gh release create vX.Y.Z    # 挂 tarball
# 市场 yml 的 tarball 指向新版本 → 推 PR 分支
# 本地 plugin_manager 重装 → 面板 ⌘R 验证
```

> `npm run sync` / `npm test` 目前**尚不存在**（见 #6 / #1），发布前是手工 `cp`。