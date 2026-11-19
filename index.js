/**
 * JEV tiered LLM harness — Host plugin for DeepSeek Harness.
 *
 * Exposes four model-facing tools that call OpenAI-compatible gateways directly,
 * so no DSH provider configuration or Host route authorization is required:
 *
 *   harness_call      route a task to the decision or execution tier
 *   harness_classify  decide which tier a task belongs to
 *   harness_review    second-model quality gate
 *   harness_probe     connectivity / model discovery check
 *
 * Base URLs, model IDs and API keys are filled in the plugin's own settings page
 * (Plugins -> JEV Tiered Harness -> 配置). That page is a client half
 * (lib/client.js) talking to the bridge routes registered here:
 *   GET  /api/jev-harness/status   current values (keys reduced to set/unset)
 *   POST /api/jev-harness/save     persist baseUrl / apiKey / model per gateway
 *   POST /api/jev-harness/test     probe each gateway's GET /models
 * Values persist in <DSH_HOME>/jev-harness.json (mode 0600). Fallbacks:
 *   config: jevBaseUrl / kimiBaseUrl / dsfBaseUrl, jevApiKey / kimiApiKey / dsfApiKey
 *   env:    JEV_BASE_URL / KIMI_BASE_URL / DSF_BASE_URL, JEV_API_KEY / KIMI_API_KEY / DSF_API_KEY
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'jev-harness'
export const inject = ['tools']

/* ------------------------------------------------------------------ config */

function env(name) {
  try {
    const value = process.env?.[name]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
  } catch {
    return ''
  }
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/* --------------------------------------------------------------- settings store */

/** The user-editable values, persisted outside the profile so the settings page can own them. */
const STORE_FIELDS = [
  'enabled',
  'jevBaseUrl', 'jevApiKey', 'jevModel',
  'kimiBaseUrl', 'kimiApiKey', 'kimiModel',
  'dsfBaseUrl', 'dsfApiKey', 'dsfModel',
]

/** Booleans are stored as real JSON booleans, not strings. */
const STORE_BOOLEANS = new Set(['enabled'])

function truthy(value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['true', 'on', 'yes', '1'].includes(text)) return true
    if (['false', 'off', 'no', '0'].includes(text)) return false
  }
  return fallback
}

function storePath() {
  const home = String(process.env.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh')
  return path.join(home, 'jev-harness.json')
}

/** Read the saved settings; a missing or unreadable file simply means "nothing saved yet". */
function readStore() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8')
    const parsed = JSON.parse(raw)
    const out = {}
    if (parsed && typeof parsed === 'object') {
      for (const key of STORE_FIELDS) {
        const value = parsed[key]
        if (STORE_BOOLEANS.has(key)) {
          if (typeof value === 'boolean') out[key] = value
          continue
        }
        if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim()
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Merge changed fields into the saved settings and write them back with owner-only permissions. */
function writeStore(patch) {
  const next = { ...readStore() }
  for (const key of STORE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    if (STORE_BOOLEANS.has(key)) {
      const flag = truthy(patch[key], undefined)
      if (flag === undefined) continue
      next[key] = flag
      continue
    }
    const value = typeof patch[key] === 'string' ? patch[key].trim() : ''
    if (value === '') delete next[key]
    else next[key] = value
  }
  const target = storePath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  try { fs.chmodSync(target, 0o600) } catch { /* best effort on exotic filesystems */ }
  return next
}

/** First non-empty string wins: saved settings, then plugin config, then environment. */
function pick(...values) {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text !== '') return text
  }
  return ''
}

function resolveConfig(config = {}, store = readStore()) {
  const c = config && typeof config === 'object' ? config : {}
  return {
    // Master switch: OFF means the harness steps aside entirely and the caller
    // must fall back to DSH's own model gateway.
    enabled: store.enabled !== undefined ? truthy(store.enabled, true) : truthy(c.enabled, true),
    jev: {
      base: pick(store.jevBaseUrl, c.jevBaseUrl, env('JEV_BASE_URL')),
      key: pick(store.jevApiKey, c.jevApiKey, env('JEV_API_KEY')),
      model: pick(store.jevModel, c.jevModel, env('JEV_MODEL'), 'jev-router'),
    },
    kimi: {
      base: pick(store.kimiBaseUrl, c.kimiBaseUrl, env('KIMI_BASE_URL')),
      key: pick(store.kimiApiKey, c.kimiApiKey, env('KIMI_API_KEY')),
      model: pick(store.kimiModel, c.kimiModel, env('KIMI_MODEL'), 'K3.1Pro'),
    },
    dsf: {
      base: pick(store.dsfBaseUrl, c.dsfBaseUrl, env('DSF_BASE_URL')),
      key: pick(store.dsfApiKey, c.dsfApiKey, env('DSF_API_KEY')),
      model: pick(store.dsfModel, c.dsfModel, env('DSF_MODEL'), 'DeepSeek4.1Flash101'),
    },
    timeoutMs: num(c.timeoutMs, 120000),
    temperature: Number.isFinite(Number(c.temperature)) ? Number(c.temperature) : 0.2,
  }
}

/* ----------------------------------------------------------------- routing */

/**
 * Returned by every routing tool while the master switch is OFF. The wording is
 * addressed to the calling agent: it must not retry the harness, it must use
 * DSH's own configured model gateway instead.
 */
const DISABLED_NOTE = 'harness switch is OFF (JEV 分级调度已关闭)：不要使用本插件路由，改用 DSH 自身配置的模型网关完成任务。需要恢复时在 JEV 设置面板打开总开关。'

const DECISION_WORDS = [
  '决策', '判断', '拍板', '权衡', '取舍', '该不该', '要不要', '是否', '评估', '方案',
  '架构', '风险', '优先级', '评审', '判断对错', '决策质量', '选择哪个', '定夺',
  'decide', 'judge', 'evaluate', 'tradeoff', 'should we', 'choose', 'architecture',
  'risk', 'review', 'verdict', 'which one', 'prioritize', 'assess',
]
const EXECUTION_WORDS = [
  '实现', '写代码', '执行', '转换', '格式化', '提取', '生成', '翻译', '批量', '运行',
  '整理', '列出', '查找', '统计', '改写', '润色', '总结', '复述', '计算', '迁移',
  'implement', 'execute', 'format', 'convert', 'extract', 'translate', 'summarize',
  'batch', 'list', 'count', 'refactor', 'generate', 'rewrite', 'compute',
]

/** Deterministic fallback classifier; fail-safe leans to the quality tier. */
function heuristicTier(task) {
  const text = String(task || '').toLowerCase()
  let d = 0
  let e = 0
  for (const w of DECISION_WORDS) if (text.includes(w.toLowerCase())) d += 1
  for (const w of EXECUTION_WORDS) if (text.includes(w.toLowerCase())) e += 1
  if (d === 0 && e === 0) return { tier: 'decision', reason: 'no strong signal; defaulted to quality tier' }
  if (d > e) return { tier: 'decision', reason: `decision cues ${d} > execution cues ${e}` }
  if (e > d) return { tier: 'execution', reason: `execution cues ${e} > decision cues ${d}` }
  return { tier: 'decision', reason: 'tie; defaulted to quality tier' }
}

/* ----------------------------------------------------------------- http */

function chatUrl(base) {
  let b = String(base || '').trim().replace(/\/+$/, '')
  if (!b) return ''
  if (/\/chat\/completions$/i.test(b)) return b
  if (/\/v\d+$/i.test(b)) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

function modelsUrl(base) {
  const u = chatUrl(base)
  return u ? u.replace(/\/chat\/completions$/i, '/models') : ''
}

function combineSignal(cfgTimeout, execSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfgTimeout)
  const onAbort = () => controller.abort()
  if (execSignal) {
    if (execSignal.aborted) controller.abort()
    else execSignal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      if (execSignal) execSignal.removeEventListener('abort', onAbort)
    },
  }
}

async function chat(route, messages, opts, cfg, exec) {
  const url = chatUrl(route.base)
  if (!url) throw new Error(`no base URL configured for ${opts.provider}; set it in plugin settings or ${opts.provider.toUpperCase()}_BASE_URL`)
  const temperature = Number.isFinite(opts.temperature) ? opts.temperature : cfg.temperature

  const send = async (keepTemperature) => {
    const link = combineSignal(cfg.timeoutMs, exec?.signal)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(route.key ? { authorization: `Bearer ${route.key}` } : {}),
        },
        body: JSON.stringify({
          model: route.model,
          messages,
          ...(keepTemperature ? { temperature } : {}),
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          stream: false,
        }),
        signal: link.signal,
      })
      const raw = await res.text()
      return { res, raw }
    } finally {
      link.dispose()
    }
  }

  let { res, raw } = await send(true)
  // Some reasoning models (kimi-k3 family) reject sampling parameters outright
  // with "Parameter 'temperature'=0.2 is not supported". Retry once without it
  // rather than surfacing a hard failure for a purely cosmetic parameter.
  if (!res.ok && res.status === 400 && /temperature/i.test(raw)) {
    ;({ res, raw } = await send(false))
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${opts.provider}: ${raw.slice(0, 500)}`)
  let body
  try { body = JSON.parse(raw) } catch { throw new Error(`non-JSON response from ${opts.provider}: ${raw.slice(0, 300)}`) }
  const message = body?.choices?.[0]?.message || {}
  const text = message.content
  const reasoning = message.reasoning_content || message.reasoning
  const usage = body?.usage || {}
  const details = usage.completion_tokens_details || {}
  return {
    text: typeof text === 'string' ? text : (text == null ? '' : JSON.stringify(text)),
    promptTokens: Number(usage.prompt_tokens) || 0,
    completionTokens: Number(usage.completion_tokens) || 0,
    totalTokens: Number(usage.total_tokens) || 0,
    // Reasoning models bill their thinking here; an empty `text` next to a
    // non-zero `reasoningTokens` means the budget ran out mid-thought.
    reasoningTokens: Number(details.reasoning_tokens) || (typeof reasoning === 'string' ? Math.ceil(reasoning.length / 3) : 0),
  }
}

function result(overrides = {}) {
  return {
    ok: false,
    tier: '',
    provider: '',
    model: '',
    text: '',
    note: '',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    ...overrides,
  }
}

function shortError(err) {
  if (err?.name === 'AbortError') return 'cancelled or timed out'
  return String(err?.message || err).slice(0, 600)
}

/* ------------------------------------------------------------ tool schemas */

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'tier', 'provider', 'model', 'text', 'note', 'promptTokens', 'completionTokens', 'totalTokens'],
  properties: {
    ok: { type: 'boolean' },
    tier: { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    text: { type: 'string' },
    note: { type: 'string' },
    promptTokens: { type: 'integer' },
    completionTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
    reasoningTokens: { type: 'integer' },
  },
}

function render(title) {
  return (_args, value) => [{
    type: 'text',
    text: `${title}\n${JSON.stringify(value, null, 2)}`,
  }]
}

/* ------------------------------------------------------------------- apply */

export function apply(ctx, config = {}) {
  let cfg = resolveConfig(config)

  /** Re-read the saved settings so a change made in the settings page applies to the next call. */
  function refresh() {
    cfg = resolveConfig(config)
    return cfg
  }

  /** Pick the concrete route for a tier. JEV is only used for auto-classification. */
  function routeFor(tier) {
    return tier === 'decision' ? { key: 'kimi', route: cfg.kimi } : { key: 'dsf', route: cfg.dsf }
  }

  async function decideTier(task, context) {
    if (cfg.jev.base) {
      try {
        // The JEV gateway is not an OpenAI chat endpoint: it exposes a single
        // POST /v1/systemone that answers typed questions (noul / choice /
        // score / box) about a `state` payload. A `choice` question is exactly
        // a router, and confidence/probabilities come back with it.
        const base = String(cfg.jev.base).replace(/\/+$/, '')
        const url = /\/v1$/.test(base) ? `${base}/systemone` : `${base}/v1/systemone`
        const link = combineSignal(cfg.timeoutMs, undefined)
        let raw, res
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cfg.jev.key ? { authorization: `Bearer ${cfg.jev.key}` } : {}),
            },
            body: JSON.stringify({
              model: cfg.jev.model || 'jev-latest',
              state: context ? { task, context } : { task },
              questions: {
                tier: {
                  type: 'choice',
                  instructions: 'Decide which tier should handle this task.',
                  criteria: {
                    decision: 'Requires human-level judgment: evaluation, trade-offs, review, architecture, risk, strategy, or quality calls.',
                    execution: 'Mechanical work: implementation, transformation, formatting, extraction, bulk generation, or translation.',
                  },
                },
              },
            }),
            signal: link.signal,
          })
          raw = await res.text()
        } finally {
          link.dispose()
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`)
        const body = JSON.parse(raw)
        const answer = body && body.answers && body.answers.tier
        const choice = answer && (answer.choice || answer.noul)
        const tier = choice === 'decision' || choice === 'execution' ? choice : undefined
        if (tier) {
          const confidence = Number(answer.confidence)
          return {
            tier,
            reason: `jev ${body.model || cfg.jev.model} choice=${tier}` +
              (Number.isFinite(confidence) ? ` (confidence ${confidence.toFixed(2)})` : ''),
          }
        }
        return { tier: heuristicTier(task).tier, reason: 'jev returned no usable choice; used heuristic' }
      } catch (err) {
        return { tier: heuristicTier(task).tier, reason: `jev router failed (${shortError(err)}); used heuristic` }
      }
    }
    return heuristicTier(task)
  }

  const tools = [
    {
      name: 'harness_call',
      description: 'Route work through the JEV tiered harness. While the harness switch is ON this is the ONLY way to produce an answer in the session: always call it with tier=auto — the JEV judge reads the task and picks the tier, then the work runs on Kimi (decision: judgment, evaluation, architecture, risk, quality) or DeepSeek Flash (execution: implementation, transformation, formatting, extraction, generation). Never ask the user to choose a tier. tier=decision / tier=execution exist for diagnostics and internal checks; provider forces a specific model. Returns the model answer plus token usage, and reasoningTokens when the model is a reasoning model.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'The full task or question to send to the selected model.' },
          tier: { type: 'string', enum: ['auto', 'decision', 'execution'], description: 'Defaults to auto — JEV decides the tier and the user never picks one. Only override for diagnostics.' },
          context: { type: 'string', description: 'Optional supporting context, constraints, or background.' },
          maxTokens: { type: 'integer', description: 'Optional max completion tokens.' },
          temperature: { type: 'number', description: 'Optional sampling temperature; defaults to 0.2.' },
          provider: { type: 'string', enum: ['auto', 'kimi', 'dsf'], description: 'Force a specific model regardless of tier. Defaults to auto.' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('Harness call') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args, exec) {
        refresh()
        if (!cfg.enabled) return result({ note: DISABLED_NOTE })
        const task = String(args.task || '').trim()
        if (!task) return result({ note: 'task must be a non-empty string' })
        let tier = args.tier === 'decision' || args.tier === 'execution' ? args.tier : 'auto'
        let note = ''
        if (tier === 'auto') {
          const decided = await decideTier(task, args.context)
          tier = decided.tier
          note = `auto-classified as ${tier}: ${decided.reason}`
        }
        const forced = args.provider === 'kimi' || args.provider === 'dsf'
        const selected = forced ? args.provider : routeFor(tier).key
        const route = selected === 'kimi' ? cfg.kimi : cfg.dsf
        try {
          const answer = await chat(route, [
            { role: 'system', content: 'You are executing a task delegated by a chief-of-staff agent. Follow the task precisely and return a complete, self-contained answer.' },
            { role: 'user', content: args.context ? `Task:\n${task}\n\nContext:\n${args.context}` : task },
          ], { provider: selected, temperature: args.temperature, maxTokens: args.maxTokens }, cfg, exec)
          const emptyHint = !answer.text && answer.completionTokens > 0
            ? ` — empty content: the model spent ${answer.reasoningTokens || answer.completionTokens} of ${answer.completionTokens} completion tokens on reasoning and never reached an answer; retry with maxTokens around ${Math.max(600, (answer.reasoningTokens || answer.completionTokens) * 2)}`
            : ''
          return result({
            ok: true,
            tier,
            provider: selected,
            model: route.model,
            ...answer,
            note: (note || `${tier} tier via ${selected}`) + emptyHint,
          })
        } catch (err) {
          return result({ tier, provider: selected, model: route.model, note: `call failed: ${shortError(err)}` })
        }
      },
    },
    {
      name: 'harness_classify',
      description: 'Ask the JEV judge what tier a task would get, without running it (diagnostics; normal work goes through harness_call with tier=auto). Returns decision (quality) or execution. decision = judgment, choice, evaluation, architecture, risk, quality. execution = mechanical implementation, transformation, formatting, extraction, generation. When JEV router is configured it is consulted; otherwise a local cue-based heuristic is used and ties default to the quality tier.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'Task description to classify.' },
          context: { type: 'string', description: 'Optional background that affects the tier.' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('Tier classification') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args) {
        refresh()
        if (!cfg.enabled) return result({ note: DISABLED_NOTE })
        const task = String(args.task || '').trim()
        if (!task) return result({ note: 'task must be a non-empty string' })
        const decided = await decideTier(task, args.context)
        return result({
          ok: true,
          tier: decided.tier,
          provider: 'jev',
          model: cfg.jev.base ? cfg.jev.model : 'local-heuristic',
          text: decided.tier,
          note: decided.reason,
        })
      },
    },
    {
      name: 'harness_review',
      description: 'Quality gate: send a draft to the OTHER model for an independent review before commit or delivery. By default a decision-tier draft is reviewed by DeepSeek4.1Flash101 and an execution-tier draft is reviewed by Kimi K3.1Pro. The reviewer returns a verdict plus concrete issues. Use this when a decision is high-stakes or when output correctness matters.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'draft'],
        properties: {
          task: { type: 'string', description: 'The original task or decision the draft addresses.' },
          draft: { type: 'string', description: 'The answer, plan, or decision to review.' },
          primaryTier: { type: 'string', enum: ['auto', 'decision', 'execution'], description: 'Tier of the model that produced the draft. Defaults to auto.' },
          reviewer: { type: 'string', enum: ['auto', 'kimi', 'dsf'], description: 'Force a specific reviewer. Defaults to the opposite model.' },
          criteria: { type: 'string', description: 'Optional specific review criteria.' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('Quality review') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args, exec) {
        refresh()
        if (!cfg.enabled) return result({ note: DISABLED_NOTE })
        const task = String(args.task || '').trim()
        const draft = String(args.draft || '').trim()
        if (!task || !draft) return result({ note: 'task and draft must be non-empty strings' })
        let primary = args.primaryTier === 'decision' || args.primaryTier === 'execution' ? args.primaryTier : 'auto'
        let note = ''
        if (primary === 'auto') {
          const decided = await decideTier(task, '')
          primary = decided.tier
          note = `draft tier inferred as ${primary}: ${decided.reason}`
        }
        const reviewer = args.reviewer === 'kimi' || args.reviewer === 'dsf'
          ? args.reviewer
          : (primary === 'decision' ? 'dsf' : 'kimi')
        const route = reviewer === 'kimi' ? cfg.kimi : cfg.dsf
        try {
          const answer = await chat(route, [
            { role: 'system', content: 'You are an independent reviewer. Assess the draft against the task. State a verdict (PASS or CHANGE), then list concrete issues and fixes. Be concise and specific.' },
            { role: 'user', content: `Task:\n${task}\n\n${args.criteria ? `Criteria:\n${args.criteria}\n\n` : ''}Draft to review:\n${draft}` },
          ], { provider: reviewer, temperature: 0.1 }, cfg, exec)
          return result({
            ok: true,
            tier: primary,
            provider: reviewer,
            model: route.model,
            text: answer.text,
            note: note || `reviewed ${primary}-tier draft with ${reviewer}`,
            ...answer,
          })
        } catch (err) {
          return result({ tier: primary, provider: reviewer, model: route.model, note: `review failed: ${shortError(err)}` })
        }
      },
    },
    {
      name: 'harness_probe',
      description: 'Check connectivity and discover the exact model IDs served by a gateway. Uses the OpenAI-compatible GET /models endpoint. Call this once after configuring a base URL and key, especially when the configured marketing model name may not match the gateway model ID.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', enum: ['jev', 'kimi', 'dsf'], description: 'Which gateway to probe. Defaults to all three.' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('Gateway probe') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args, exec) {
        refresh()
        const which = args.provider === 'jev' || args.provider === 'kimi' || args.provider === 'dsf'
          ? [args.provider]
          : ['jev', 'kimi', 'dsf']
        const lines = []
        let okCount = 0
        for (const key of which) {
          const route = cfg[key]
          const url = modelsUrl(route.base)
          if (!url) {
            lines.push(`${key}: NOT CONFIGURED (no base URL)`)
            continue
          }
          const link = combineSignal(cfg.timeoutMs, exec?.signal)
          try {
            const res = await fetch(url, {
              headers: route.key ? { authorization: `Bearer ${route.key}` } : {},
              signal: link.signal,
            })
            const raw = await res.text()
            if (!res.ok) {
              lines.push(`${key}: HTTP ${res.status} ${raw.slice(0, 200)}`)
              continue
            }
            let ids = []
            try {
              const body = JSON.parse(raw)
              ids = (Array.isArray(body?.data) ? body.data : []).map(m => m?.id).filter(Boolean)
            } catch {
              ids = []
            }
            okCount += 1
            lines.push(`${key}: OK (configured model "${route.model}")${ids.length ? ` — served: ${ids.slice(0, 30).join(', ')}` : ''}`)
          } catch (err) {
            lines.push(`${key}: ERROR ${shortError(err)}`)
          } finally {
            link.dispose()
          }
        }
        return result({
          ok: okCount > 0,
          provider: which.join(','),
          text: lines.join('\n'),
          note: `${okCount}/${which.length} gateways reachable${cfg.enabled ? '' : ' (harness switch is OFF — probe still works, but harness_call/classify/review refuse to route)'}`,
        })
      },
    },
  ]

  /* ------------------------------------------------------- settings bridge */

  /** One gateway's reachability and the model ids it actually serves. */
  async function probeRoute(key) {
    const route = cfg[key]
    const url = modelsUrl(route.base)
    if (!url) return { key, ok: false, detail: 'NOT CONFIGURED (no base URL)', models: [] }
    const link = combineSignal(cfg.timeoutMs, undefined)
    try {
      const res = await fetch(url, {
        headers: route.key ? { authorization: `Bearer ${route.key}` } : {},
        signal: link.signal,
      })
      const raw = await res.text()
      if (!res.ok) return { key, ok: false, detail: `HTTP ${res.status} ${raw.slice(0, 200)}`, models: [] }
      let models = []
      try {
        const body = JSON.parse(raw)
        models = (Array.isArray(body?.data) ? body.data : []).map(model => model?.id).filter(Boolean)
      } catch { models = [] }
      return { key, ok: true, detail: `configured model "${route.model}"`, models }
    } catch (err) {
      return { key, ok: false, detail: shortError(err), models: [] }
    } finally {
      link.dispose()
    }
  }

  /** Only the local desktop page may talk to these routes. */
  function bridgeAllowed(req) {
    const host = String(req.headers?.host || '')
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) return false
    const origin = String(req.headers?.origin || '')
    if (origin !== '' && !origin.endsWith(`://${host}`)) return false
    return true
  }

  function writeJson(res, status, body) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    res.end(JSON.stringify(body))
  }

  async function readJsonBody(req, limit = 65536) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) return undefined
      chunks.push(chunk)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return undefined }
  }

  /** Current effective settings, with keys reduced to a set/unset flag. */
  function statusPayload() {
    const live = refresh()
    const saved = readStore()
    const view = (key) => ({
      baseUrl: live[key].base,
      model: live[key].model,
      keySet: live[key].key !== '',
      baseFromSettings: Boolean(saved[`${key}BaseUrl`]),
      keyFromSettings: Boolean(saved[`${key}ApiKey`]),
    })
    return {
      ok: true,
      enabled: live.enabled,
      file: storePath(),
      gateways: { jev: view('jev'), kimi: view('kimi'), dsf: view('dsf') },
      tiers: { decision: 'kimi', execution: 'dsf' },
    }
  }

  const bridgeRoutes = [
    {
      kind: 'exact',
      path: '/api/jev-harness/status',
      handler: (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, { ok: false, error: 'local requests only' }); return }
        writeJson(res, 200, statusPayload())
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/save',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, { ok: false, error: 'local requests only' }); return }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') { writeJson(res, 400, { ok: false, error: 'malformed JSON body' }); return }
        const patch = {}
        if (Object.prototype.hasOwnProperty.call(body, 'enabled')) patch.enabled = body.enabled
        for (const key of ['jev', 'kimi', 'dsf']) {
          const entry = body[key]
          if (!entry || typeof entry !== 'object') continue
          if (typeof entry.baseUrl === 'string') patch[`${key}BaseUrl`] = entry.baseUrl
          if (typeof entry.model === 'string') patch[`${key}Model`] = entry.model
          // A blank key field means "keep the stored key"; only an explicit null clears it.
          if (entry.apiKey === null) patch[`${key}ApiKey`] = ''
          else if (typeof entry.apiKey === 'string' && entry.apiKey.trim() !== '') patch[`${key}ApiKey`] = entry.apiKey
        }
        try {
          writeStore(patch)
        } catch (err) {
          writeJson(res, 500, { ok: false, error: `could not save: ${shortError(err)}` })
          return
        }
        writeJson(res, 200, statusPayload())
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/toggle',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, { ok: false, error: 'local requests only' }); return }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') { writeJson(res, 400, { ok: false, error: 'malformed JSON body' }); return }
        const flag = truthy(body.enabled, undefined)
        if (flag === undefined) { writeJson(res, 400, { ok: false, error: 'enabled must be a boolean' }); return }
        try {
          writeStore({ enabled: flag })
        } catch (err) {
          writeJson(res, 500, { ok: false, error: `could not save: ${shortError(err)}` })
          return
        }
        writeJson(res, 200, statusPayload())
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/test',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, { ok: false, error: 'local requests only' }); return }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        refresh()
        const results = []
        for (const key of ['jev', 'kimi', 'dsf']) results.push(await probeRoute(key))
        writeJson(res, 200, { ok: results.some(entry => entry.ok), results })
      },
    },
  ]

  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const server = sctx.get('webServer')
      if (!server || typeof server.register !== 'function') return () => {}
      const disposers = bridgeRoutes.map(route => server.register(route))
      return () => {
        for (const dispose of disposers) {
          try { dispose() } catch { /* best effort during teardown */ }
        }
      }
    }, 'jev-harness: settings bridge')
  })

  ctx.effect(() => {
    const disposers = tools.map(definition => ctx.tools.register(definition))

    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt) {
      disposers.push(systemPrompt.section({
        name: 'jev-harness:tiers',
        order: 700,
        text: [
          'JEV tiered harness (`jev-harness`) is installed and exposes ONE master switch (top of its settings panel, plus the small JEV switch in the composer). That switch decides who does the work in this session.',
          '',
          'WHILE THE SWITCH IS ON — the harness owns routing for EVERY user instruction in this session:',
          '1. Never answer a substantive instruction with your own model. Route it through `harness_call` with tier=auto.',
          '2. With tier=auto the JEV judge (`jev`) reads the task and returns a tier, then the work runs on Kimi (decision tier, `kimi`) or DeepSeek Flash (execution tier, `dsf`). Relay that returned text as the answer; you may format or trim it, never rewrite its substance or add claims of its own.',
          '3. Never ask the user to choose a tier or a provider. The tier is the JEV judge decision, not a user setting, and the user must not see tier selection anywhere.',
          '4. Do not skip the call because a task looks small or because you could answer it yourself. Only ask the user for clarification when the request itself is ambiguous.',
          '5. DeepSeek Flash is a reasoning model: if a result comes back with empty text and reasoningTokens, retry that call once with a larger maxTokens (600-1200) rather than answering yourself.',
          '',
          'Helper tools: `harness_classify` shows what the JEV judge would decide without executing (diagnostics only); `harness_review` runs a second-model quality gate on a finished draft; `harness_probe` verifies gateway wiring and the real served model ids.',
          '',
          'WHILE THE SWITCH IS OFF — these tools return a note instead of routing. That note means the harness has stepped aside: answer with the DSH model gateway and never retry the harness against it.',
        ].join('\n'),
      }))
    }

    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* best effort during teardown */ }
      }
    }
  })
}
