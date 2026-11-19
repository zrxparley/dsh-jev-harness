# JEV 分级调度 Harness

一个自包含的 DeepSeek Harness 插件：**一个开关**决定这一会话由谁干活。打开后，你在会话里的每条指令都先交给 JEV 判定器判断任务性质，再由它自动分流到 Kimi（判断类）或 DeepSeek Flash（执行类）——**你不需要选层，也看不到选层**。

默认走 DSH 自己的网关卡（用你已配好的 provider / model），也可以切成插件直连。

## 界面

| 位置 | 作用 |
| --- | --- |
| 左侧栏条目 | 「JEV 分级调度」面板：总开关 + 三个网关的地址 / 密钥 / 模型 id + 连通性测试 |
| 输入框小开关 | 一键开 / 关，即时生效 |
| 设置 → 插件 → 全局插件卡片 | 同一份配置页 |

**总开关语义**

- **开**：插件接管路由。每条指令先由 JEV 判定，再走 Kimi 或 DeepSeek Flash；此时 DSH 自身的模型选择器不参与。
- **关**：插件完全让位，一切回到 DSH 自己的模型网关。

## 执行方式（在 DSH 网关上跑，还是直连）

打开后真正的两条通路，面板里「执行方式」卡片切换：

| 模式 | Kimi / DeepSeek 由谁发请求 | 需要填的密钥 |
| --- | --- | --- |
| **走 DSH 网关**（默认） | DSH 自己（`ctx.llm`，用你在 DSH 里配好的 provider/model） | 只需 JEV 判定器的 key |
| **直连本插件网关** | 插件自己直连 OpenAI 兼容地址 | JEV + Kimi + DeepSeek 三套 |

走 DSH 网关时，插件不持有也不使用 kimi / dsf 的密钥：宿主已经有 provider 凭据，插件只负责「判定该谁干活」和「把活递过去」。决策层 / 执行层的 provider + model 在面板里填，点「列出 DSH 模型」可以直接问宿主有哪些 id 可选。

> 为什么这样更稳：插件不必猜你的网关地址，也不会和 DSH 的凭据体系打架；换模型只需在 DSH 里改。

## 模型从哪来：跟着你自己的 DSH 网关

决策层 / 执行层用哪个模型，**插件不预设**。面板里的两个下拉，选项来自这台机器上 DSH 真正注册的 provider 与它提供的模型（`ctx.llm.listProviders()` / `listModels()`）——你装的是 `titigate`，别人装的是别的，各自列各自的。

- **自动（默认）**：先在 DSH 自己的模型选择器所指的那个 provider 里挑，再按模型名判断强弱——判断类优先 `kimi / k3 / pro / max / reason` 这类，执行类优先 `flash / mini / lite / fast` 这类；最终用到的组合会直接写在卡片上（`现在会用到：titigate/kimi-k3.1-pro`）。
- **手动钉住**：两个下拉选具体 provider + model，保存后不再变。
- 右上角「刷新模型清单」随时从 DSH 重新拉一次（换 provider、加模型之后点一下）。

## 流量看板

配置面板顶部有一个实时看板，按网关统计调用情况：

| 指标 | 含义 |
| --- | --- |
| 请求数 | 每一次真正发往网关的 HTTP 请求计一次（含探测、含失败） |
| token | 网关返回的 usage；失败请求记 0 |
| 成功率 / 耗时 | 按窗口内累计计算，耗时取平均 |
| 柱状图 | 近 24 小时按小时、近 7 天按天，三个网关分组对比；悬停看具体数值 |

三个网关对应三类流量：`JEV 判定`（`/systemone`）、`Kimi 决策`、`DSF 执行`。看板每 10 秒自动刷新。

账本落在本机 `<DSH_HOME>/jev-harness-usage.json`（默认 `~/.dsh/jev-harness-usage.json`），按小时与按天两个维度累计，重启不丢；只记录计数、token 与耗时，不记录提示词正文。

## 技能路由 · mattpocock/skills

打开「自动挂载 skill」后，`harness_call` 在派活前会多问 JEV 一句：**这件事该不该套一个 skill？** 判定器在 [mattpocock/skills](https://github.com/mattpocock/skills) 的 39 个技能里挑一个（TDD、code-review、diagnosing-bugs、wayfinder、to-spec、to-tickets、triage、wizard、grilling、teach…），也可以回答 `none` 表示这次不需要。挑中的 skill 正文会作为 `## Skill: <name>` 块挂进系统提示，模型照着它干活，而不是凭感觉。

| 动作 | 怎么用 |
| --- | --- |
| 自动 | 默认。`harness_call` 自己问、自己挂 |
| 指定 | `harness_call(skill="engineering/tdd")` |
| 跳过 | `harness_call(skill="off")` |
| 浏览 | `harness_skill(action="list")` → 39 个 id + 一句话说明 |
| 试用判定 | `harness_skill(action="pick", task="…")` → 只回答该用哪个 |
| 看正文 | `harness_skill(action="read", id="engineering/tdd")` |
| 同步上游 | `harness_skill(action="refresh")`，或面板上的「刷新技能目录」 |

- 目录随插件内置（零网络判定），`refresh` 只发**一个**请求（GitHub 源码 tarball），直接重建 `~/.dsh/jev-harness-skills/catalog.json` 并把 39 份正文写入缓存；之后 `read` 全部命中本地缓存。
- 上游仓库更新后，刷新即可，不用升级插件。JEV 网关不可用时退回本地关键词匹配。

## 迭代路线

需求以 GitHub issue 形式维护，每条都带现状证据（文件/行号）、需求与可验收标准；顺序与取舍理由见 [docs/ROADMAP.md](docs/ROADMAP.md)，跟踪 issue 为 [#12](https://github.com/zrxparley/dsh-jev-harness/issues/12)。

一句实话：**「开关打开 = 不走 DSH 网关」目前是约定，不是机制。** 插件能注册工具和一段 system prompt，真正决定请求发给谁的是 DSH 的 provider 层；要让这个语义成立，见 [#5](https://github.com/zrxparley/dsh-jev-harness/issues/5)。

## 工具

| 工具 | 用途 |
| --- | --- |
| `harness_call` | 核心入口，默认 `tier=auto`：JEV 判定 → Kimi / DeepSeek Flash |
| `harness_classify` | 只问判定器会判成哪一层，不执行（诊断用） |
| `harness_review` | 第二模型质量闸门：策划稿交 Flash 复核，执行稿交 Kimi 复核 |
| `harness_skill` | 39 个 skill 的目录：list / pick / read / refresh / status |
| `harness_probe` | 探测网关连通性，并通过 OpenAI 兼容的 `GET /models` 发现真实 model id |

分层口径：**要不要人来判断对错** → decision（Kimi）；机械执行 → execution（Flash）。未配置 JEV 网关时退回本地关键词启发式，平局归 decision。

- **悬停看决策**：鼠标悬停输入框那颗 `JEV` 开关，浮层会列出最近 3 次「谁在干活」——JEV 判定结果与置信度、实际调用的模型、token 与耗时、任务摘要。判定不可用退回启发式时会明确写「启发式（JEV 未参与）」，不冒充判定。

## 安装

```bash
dsh plugin add @zrxparley/dsh-jev-harness
```

或在 DSH 设置 → 插件 → Add plugin 搜索 `@zrxparley/dsh-jev-harness`。

## 配置

在插件设置面板里填写（写入 `~/.dsh/jev-harness.json`，权限 0600，密钥不会进配置文件或仓库）：

- `kimiBaseUrl` / `kimiApiKey` / `kimiModel` —— 判断层，例如 `https://your-gateway/v1` + `kimi-k3.1-pro`
- `dsfBaseUrl` / `dsfApiKey` / `dsfModel` —— 执行层，例如 `https://your-gateway/v1` + `deepseek-v4.1-flash-1017`
- `jevBaseUrl` / `jevApiKey` / `jevModel` —— 判定器，指向 TypeSafe 兼容的 `/v1/systemone`

> 模型 id 请填网关服务的**真实 id**，不要填营销名。点「测试连通」会列出该网关实际提供的 id。

也支持环境变量作为兜底：`KIMI_API_KEY` / `DSF_API_KEY` / `JEV_API_KEY`，以及 `*_BASE_URL` / `*_MODEL`。

## 注意

`deepseek-v4.1-flash-1017` 是推理模型，思维链会占用 completion 预算。若正文为空，结果里会带 `reasoningTokens`，并提示把 `maxTokens` 提到 600–1200 后重试。

## 许可证

MIT
