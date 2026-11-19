# JEV Tiered Harness

A self-contained DeepSeek Harness plugin: **one switch** decides who does the work in a session. While it is ON, every instruction you send is first read by a JEV judge, which picks the tier and routes the work to Kimi (judgment) or DeepSeek Flash (execution). **You never choose a tier — and there is no tier UI to choose from.**

No provider configuration and no route authorization in DSH are required.

## Where it shows up

| Location | What it does |
| --- | --- |
| Left sidebar entry | "JEV 分级调度" panel: master switch + base URL / API key / model id per gateway + connectivity test |
| Composer switch | One-click ON/OFF, effective immediately |
| Settings → Plugins → global plugin card | The same configuration page |

**Master switch**

- **ON** — the harness owns routing: JEV judges each instruction, then Kimi or DeepSeek Flash produces the answer; DSH's own model selector is not part of the path.
- **OFF** — the harness steps aside completely and everything falls back to DSH's own model gateway.

## Tools

| Tool | Purpose |
| --- | --- |
| `harness_call` | The entry point, `tier=auto` by default: JEV judges, then Kimi / DeepSeek Flash answers |
| `harness_classify` | Ask what tier the judge would pick, without executing (diagnostics) |
| `harness_review` | Second-model quality gate: decision drafts reviewed by Flash, execution drafts by Kimi |
| `harness_probe` | Probe gateway reachability and discover real model ids via OpenAI-compatible `GET /models` |

Tier rule: *does a human need to judge whether this is right?* → decision (Kimi); mechanical execution → execution (Flash). Without a JEV gateway the plugin falls back to a local keyword heuristic, ties going to decision.

## Install

```bash
dsh plugin add @zrxparley/dsh-jev-harness
```

Or DSH Settings → Plugins → Add plugin → search `@zrxparley/dsh-jev-harness`.

## Configure

Fill the in-plugin settings panel (written to `~/.dsh/jev-harness.json`, mode 0600 — keys never enter the repo or the config file):

- `kimiBaseUrl` / `kimiApiKey` / `kimiModel` — decision tier, e.g. `https://your-gateway/v1` + `kimi-k3.1-pro`
- `dsfBaseUrl` / `dsfApiKey` / `dsfModel` — execution tier, e.g. `https://your-gateway/v1` + `deepseek-v4.1-flash-1017`
- `jevBaseUrl` / `jevApiKey` / `jevModel` — the judge, a TypeSafe-compatible `/v1/systemone`

> Use the gateway's **real** model ids, not marketing names. "Test connectivity" lists the ids the gateway actually serves.

Environment variables work as a fallback: `KIMI_API_KEY` / `DSF_API_KEY` / `JEV_API_KEY`, plus `*_BASE_URL` / `*_MODEL`.

## Note

`deepseek-v4.1-flash-1017` is a reasoning model, so its thinking spends the completion budget. On empty content the result carries `reasoningTokens` and suggests retrying with `maxTokens` around 600–1200.

## License

MIT
