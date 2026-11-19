# JEV 分级调度 Harness

一个自包含的 DeepSeek Harness 插件：**一个开关**决定这一会话由谁干活。打开后，你在会话里的每条指令都先交给 JEV 判定器判断任务性质，再由它自动分流到 Kimi（判断类）或 DeepSeek Flash（执行类）——**你不需要选层，也看不到选层**。

不需要在 DSH 里配置 provider，也不需要授权路由。

## 界面

| 位置 | 作用 |
| --- | --- |
| 左侧栏条目 | 「JEV 分级调度」面板：总开关 + 三个网关的地址 / 密钥 / 模型 id + 连通性测试 |
| 输入框小开关 | 一键开 / 关，即时生效 |
| 设置 → 插件 → 全局插件卡片 | 同一份配置页 |

**总开关语义**

- **开**：插件接管路由。每条指令先由 JEV 判定，再走 Kimi 或 DeepSeek Flash；此时 DSH 自身的模型选择器不参与。
- **关**：插件完全让位，一切回到 DSH 自己的模型网关。

## 工具

| 工具 | 用途 |
| --- | --- |
| `harness_call` | 核心入口，默认 `tier=auto`：JEV 判定 → Kimi / DeepSeek Flash |
| `harness_classify` | 只问判定器会判成哪一层，不执行（诊断用） |
| `harness_review` | 第二模型质量闸门：策划稿交 Flash 复核，执行稿交 Kimi 复核 |
| `harness_probe` | 探测网关连通性，并通过 OpenAI 兼容的 `GET /models` 发现真实 model id |

分层口径：**要不要人来判断对错** → decision（Kimi）；机械执行 → execution（Flash）。未配置 JEV 网关时退回本地关键词启发式，平局归 decision。

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
