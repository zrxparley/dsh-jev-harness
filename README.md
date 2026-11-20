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

## Execution route (DSH gateway vs direct)

Two real paths once the switch is ON — pick one in the 执行方式 card:

| Mode | Who sends the Kimi / DeepSeek request | Keys needed here |
| --- | --- | --- |
| **Via DSH gateway** (default) | DSH itself (`ctx.llm`, using providers/models configured in DSH) | JEV judge key only |
| **Direct** | the plugin calls its own OpenAI-compatible endpoints | JEV + Kimi + DeepSeek |

In DSH mode the plugin holds and uses no kimi/dsf credentials: the Host already owns provider credentials, so the plugin only decides the tier and hands the work over. Tier provider/model are two dropdowns filled from `ctx.llm.listProviders()` / `listModels()` (「刷新模型清单」 re-asks the Host). Leaving them empty means auto: follow the provider you picked in the DSH selector, then rank model names for strongest vs fastest.

「让 DSH 选择器跟随」 is on by default: after JEV hands work to a model, the Host `agentDefaultModel` is rewritten to that provider/model, so the selector above the composer shows the model that actually did the work. Turn it off if you do not want that rewrite.

## Where the models come from: your own DSH gateway

The plugin does not pick providers for you. Both dropdowns are filled from what this machine's DSH actually registered (`ctx.llm.listProviders()` / `listModels()`) — you have `titigate`, somebody else has theirs, and each install lists its own.

- **Auto (default)**: stay inside the provider your DSH model selector points at, then rank by model name — judge-like ids (`kimi / k3 / pro / max / reason`) for the decision tier, fast ids (`flash / mini / lite / fast`) for execution. The resulting pair is printed on the card (`现在会用到：titigate/kimi-k3.1-pro`).
- **Pin it**: choose an explicit provider + model in the dropdowns.
- 「刷新模型清单」 re-reads the list from DSH at any time.

## Traffic dashboard

The top of the settings page is a live per-gateway dashboard:

| Metric | Meaning |
| --- | --- |
| Requests | one per real HTTP call to a gateway (probes and failures included) |
| Tokens | the gateway's own `usage`; failed calls count 0 |
| Success rate / latency | accumulated over the selected window, latency averaged |
| Bars | hourly for the last 24h, daily for the last 7d, grouped by gateway; hover for exact values |

Three gateways, three traffic kinds: `JEV judge` (`/systemone`), `Kimi decision`, `DSF execution`. It refreshes every 10 seconds.

The ledger lives at `<DSH_HOME>/jev-harness-usage.json` (default `~/.dsh/jev-harness-usage.json`), accumulated hourly and daily so it survives restarts; only counts, tokens and latency are stored, never prompt text.

## Skill routing · mattpocock/skills

With "auto-mount skill" on, `harness_call` asks the JEV judge one more question before dispatching: **does this task have a skill that would change how it is executed?** The judge picks one of the 39 skills in [mattpocock/skills](https://github.com/mattpocock/skills) (TDD, code-review, diagnosing-bugs, wayfinder, to-spec, to-tickets, triage, wizard, grilling, teach, …) or answers `none`. The chosen skill's body is prepended as a `## Skill: <name>` block, so the routed model follows it instead of improvising.

| Mode | How |
| --- | --- |
| auto | default; `harness_call` picks and mounts |
| explicit | `harness_call(skill="engineering/tdd")` |
| skip | `harness_call(skill="off")` |
| browse | `harness_skill(action="list")` |
| dry-run the pick | `harness_skill(action="pick", task="…")` |
| read a body | `harness_skill(action="read", id="engineering/tdd")` |
| sync upstream | `harness_skill(action="refresh")` or the panel's refresh button |

- The catalog ships bundled (routing costs no network). `refresh` issues exactly one request (the GitHub source tarball), rewrites `~/.dsh/jev-harness-skills/catalog.json` and caches all 39 bodies, so later reads are local.
- Upstream changes need a refresh, not a plugin upgrade. If the JEV gateway is unreachable, a local keyword matcher takes over.

## Design boundaries (convention vs guarantee)

Not every behaviour here is equally solid. Some are **guaranteed by code** (the merged judge fires exactly one request, recursion `jev→jev` is refused, degradation is always marked in the ledger); others are **conventions held by prompts** (the "harness owns routing" switch only works if the agent actually calls `harness_call`). Confusing the two is how this project kept breaking. The component diagram and the full convention-vs-guarantee table live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the reasoning behind each decision is in [docs/adr/](docs/adr/).

## Roadmap

Iteration items live as GitHub issues with现状 evidence, requirements and acceptance criteria. The ordering and the reasoning behind it are in [docs/ROADMAP.md](docs/ROADMAP.md), tracked by [#12](https://github.com/zrxparley/dsh-jev-harness/issues/12).

Honest status: **"switch ON = traffic does not go through the DSH gateway" is a convention today, not a mechanism.** The plugin can register tools and a system prompt; which endpoint actually serves a request is decided by the DSH provider layer. Making that guarantee real is [#5](https://github.com/zrxparley/dsh-jev-harness/issues/5).

## Tools

| Tool | Purpose |
| --- | --- |
| `harness_call` | The entry point, `tier=auto` by default: JEV judges, then Kimi / DeepSeek Flash answers |
| `harness_classify` | Ask what tier the judge would pick, without executing (diagnostics) |
| `harness_review` | Second-model quality gate: decision drafts reviewed by Flash, execution drafts by Kimi |
| `harness_skill` | catalog of the 39 skills: list / pick / read / refresh / status |
| `harness_probe` | Probe gateway reachability and discover real model ids via OpenAI-compatible `GET /models` |

Tier rule: *does a human need to judge whether this is right?* → decision (Kimi); mechanical execution → execution (Flash). Without a JEV gateway the plugin falls back to a local keyword heuristic, ties going to decision.

- **Hover the switch** for the decision trace: which tier the judge picked and with what confidence, which model actually answered, tokens, latency and a task excerpt. Falls back honestly to `heuristic (JEV unreachable)` when the judge is down.

## Install

```bash
dsh plugin add @zrxparley/dsh-jev-harness
```

Or DSH Settings → Plugins → Add plugin → search `@zrxparley/dsh-jev-harness`.

## Client bundle id and release installs

DSH's client module loader keys every bundle factory by its **boot-manifest row id**, which is
the installed package name. A client half that hardcodes the other name never materializes:
the loader throws `no registered factory for "<id>"` and the panel silently never mounts.

`lib/client.js` therefore derives its id at load time from `window.__DSH_BOOT__.entries`
(the row whose id ends in `jev-harness`, with a `/client` suffix stripped), and falls back to
`@local/jev-harness` when no manifest is present (unit tests, older hosts). Both install modes
work with the same file:

| Install mode | manifest row id | registered id |
|---|---|---|
| local bundle | `@local/jev-harness` | `@local/jev-harness` |
| npm / tarball | `@zrxparley/dsh-jev-harness` | `@zrxparley/dsh-jev-harness` |

Verified without npm: `test/release-pack.test.js` builds a tarball from `package.json`'s `files`
with the system tar, unpacks it, loads the unpacked `lib/client.js` against a release-shaped
manifest, and asserts that **both** `main` and `sidebar.panellist` register with components.
`test/bundle-id.test.js` locks the id derivation itself (npm id, local id, `/client` suffix,
missing manifest, unrelated entries). With npm available, run `npm pack` and feed the tarball
to the same assertions.


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
