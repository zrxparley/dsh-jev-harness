# JEV Tiered Harness

A self-contained plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) that routes tasks to different models by tier — without configuring DSH providers or authorizing model routes.

## What it does

| Tool | Purpose |
| --- | --- |
| `harness_call` | Main entry. `tier=decision` → Kimi K3.1Pro, `tier=execution` → DeepSeek4.1Flash101, `tier=auto` → auto-classify |
| `harness_classify` | Tier decision only, no execution |
| `harness_review` | Second-model quality gate: decision drafts reviewed by Flash, execution drafts by Kimi |
| `harness_probe` | Probe gateway connectivity and discover real model ids via OpenAI-compatible `GET /models` |

Tier rule: **does a human need to judge right/wrong?** → `decision` (Kimi); mechanical execution → `execution` (Flash). Auto classification calls the JEV gateway when configured, otherwise uses a local keyword heuristic (ties go to the quality tier).

## Install

```bash
dsh plugin add @zrxparley/dsh-jev-harness
```

Or in DSH: Settings → Plugins → Add plugin, and search for `@zrxparley/dsh-jev-harness`.

## Configure

In the plugin settings:

- `jevBaseUrl` / `kimiBaseUrl` / `dsfBaseUrl` — base URLs of the three OpenAI-compatible gateways (may include `/v1`; the plugin appends `/chat/completions`)
- `kimiModel` / `dsfModel` / `jevModel` — exact model ids (defaults are marketing names; **run `harness_probe` and replace with the real ids**)
- `timeoutMs`, `temperature`

API keys are read from environment variables (never written to disk):

```
JEV_API_KEY=...
KIMI_API_KEY=...
DSF_API_KEY=...
```

`JEV_BASE_URL` / `KIMI_BASE_URL` / `DSF_BASE_URL` / `JEV_MODEL` / `KIMI_MODEL` / `DSF_MODEL` are also honored as config fallbacks.

## Verify

Call `harness_probe` after setup. It reports each gateway as reachable / misconfigured / unreachable and lists available model ids, so you can copy the exact id into the settings.

## License

MIT
