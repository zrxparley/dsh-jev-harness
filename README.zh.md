# JEV 分级调度 Harness

一个自包含的 DeepSeek Harness 插件：按任务类型把工作分派到不同模型，无需在 DSH 里配置 provider 或授权路由。

## 能力

| 工具 | 用途 |
| --- | --- |
| `harness_call` | 核心入口。`tier=decision` 走 Kimi K3.1Pro，`tier=execution` 走 DeepSeek4.1Flash101，`tier=auto` 自动分类 |
| `harness_classify` | 只判定分层，不执行 |
| `harness_review` | 第二模型质量闸门：决策稿交给 Flash 复核，执行稿交给 Kimi 复核 |
| `harness_probe` | 探测网关连通性，并通过 OpenAI 兼容的 `GET /models` 发现真实 model id |

分层口径：**要不要人来判断对错** → decision（Kimi）；机械执行 → execution（Flash）。自动分类在配置 jev 网关时调用网关，否则用本地关键词启发式，平局归 quality 层。

## 安装

```bash
dsh plugin add @zrxparley/dsh-jev-harness
```

或在 DSH 设置 → 插件 → Add plugin 搜索 `@zrxparley/dsh-jev-harness`。

## 配置

安装后在插件设置中填写：

- `jevBaseUrl` / `kimiBaseUrl` / `dsfBaseUrl`：三个 OpenAI 兼容网关的 base URL（可带 `/v1`，插件自动补 `/chat/completions`）
- `kimiModel` / `dsfModel` / `jevModel`：精确 model id（默认是营销名，**请用 harness_probe 核对后改成网关真实 id**）
- `timeoutMs`、`temperature`

API key 通过环境变量提供，不落盘：

```
JEV_API_KEY=...
KIMI_API_KEY=...
DSF_API_KEY=...
```

环境变量也支持 `JEV_BASE_URL` / `KIMI_BASE_URL` / `DSF_BASE_URL` / `JEV_MODEL` / `KIMI_MODEL` / `DSF_MODEL` 作为配置兜底。

## 验证

配置后调用 `harness_probe`，它会逐个网关报告可达 / 未配置 / 不可达，并列出可用 model id，方便你把精确 id 复制进设置。

## 许可证

MIT
