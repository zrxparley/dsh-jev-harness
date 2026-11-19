# 迭代路线（v2.0）

> 这份文档与 GitHub Issues 同步维护：需求细节、验收标准、讨论都在 issue 里，这里只保留**顺序与取舍**。
> 跟踪 issue：<https://github.com/zrxparley/dsh-jev-harness/issues/12>

评估基线：**v1.6.1**（2026-11-19）

一句话结论：功能面够用了，但「harness」这个定位目前只是**约定，不是机制**；真正卡迭代的是工程地基——测试全在 `/tmp`，仓库里 0 个。

## 顺序与理由

| 顺位 | 需求 | 为什么排这里 | 依赖 |
|---|---|---|---|
| 0 | [#1](https://github.com/zrxparley/dsh-jev-harness/issues/1) 测试进仓库 + CI | 半天成本，之后每次改动都有安全网 | — |
| 1 | [#2](https://github.com/zrxparley/dsh-jev-harness/issues/2) 自动带入会话上下文 | 最高频翻车点（「继续上一轮」是断头路），改动小 | #1 |
| 2 | [#3](https://github.com/zrxparley/dsh-jev-harness/issues/3) 降级链 + 熔断 + 分级超时 | 纯可靠性收益，看板能直接看到效果 | #1 |
| 3 | [#4](https://github.com/zrxparley/dsh-jev-harness/issues/4) 判定置信度策略 + 可审计 | 判定从黑盒变可复盘 | #1 |
| 4 | [#5](https://github.com/zrxparley/dsh-jev-harness/issues/5) provider 路线 spike | 最大结构升级：让「开」真正接管 | #2 |
| 5 | [#6](https://github.com/zrxparley/dsh-jev-harness/issues/6) 单一源同步 · [#7](https://github.com/zrxparley/dsh-jev-harness/issues/7) 启动自检 | 防漂移、防静默白板 | #1 |
| 6 | [#8](https://github.com/zrxparley/dsh-jev-harness/issues/8) 会话统计/预算/导出 · [#9](https://github.com/zrxparley/dsh-jev-harness/issues/9) 密钥 · [#11](https://github.com/zrxparley/dsh-jev-harness/issues/11) 判定回归集 · [#10](https://github.com/zrxparley/dsh-jev-harness/issues/10) 技能深化 | 产品化，不阻塞使用 | #1 #4 |

## 核心判断

**「开 = 不走 DSH 网关」目前严格说不成立。** 插件只能注册工具 + 插一段 system prompt，真正决定请求发给谁的是 DSH 的 provider 层。当前链路是「DSH 模型读了 prompt，自觉去调 `harness_call`」。上下文一长、prompt 被压、模型犯懒，就会静默走回 DSH 网关，而流量看板也不会显示（那不是插件流量）。要让它成立，只有 #5 一条路。

**无状态单轮是更早咬人的问题。** `harness_call(task, context)` 不带会话历史，「继续」「把刚才那段改一下」只能答歪，或让调用方把历史复制进 `context`（重复计费）。所以 #2 排在 #5 之前。

## 已知阻塞（与迭代无关）

- **npm publish 无凭证**：`npm whoami` → `ENEEDAUTH`，`~/.npmrc` 无 `_authToken`。需要本机 `npm login`。当前发布走 **GitHub Release tarball + 市场条目 tarball 字段**，不依赖 npm。
- **DSHmarket PR #16794**：OPEN / MERGEABLE，CI 仅卡仓库「年龄 < 1 天」的时间闸，会自动重跑清除（约 2026-11-20T03:11Z），无需重新提交。

## 已完成（对照用）

- **v1.6.1** 修「近 7 天」全 0 —— `USAGE_HOURS=48` 裁掉小时桶，而 `/stats?hours=168` 仍读小时桶；改为超过 48h 自动切日桶（`grain: 'hour'|'day'`）
- **v1.6.0** 流量看板：三网关请求量 / tokens / 失败 / 最近调用表，24h 与 7d 两种粒度
- **v1.5.0** 技能路由：JEV 从 `mattpocock/skills` 的 39 个 skill 中挑选并挂载正文，支持刷新与缓存
- **v1.4.0** 总开关：开 = 走 JEV 分流；关 = 让位 DSH 自身网关

## 每个版本的收尾动作

```
npm run sync        # 仓库 → 本地 bundle（并改写 patch 行 name）
npm test            # 离线回归
npm version patch   # 单一版本源
npm pack            # 生成 tarball
gh release create   # 挂 tarball
# 市场 yml 的 tarball 指向新版本 → 推 PR 分支
# 本地 plugin_manager 重装 → 面板 ⌘R 验证
```
