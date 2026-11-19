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
 * API keys are read from the environment (JEV_API_KEY / KIMI_API_KEY /
 * DSF_API_KEY). Base URLs and exact model IDs come from plugin config with
 * environment fallbacks. All registrations live in one ctx.effect.
 */

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

function resolveConfig(config = {}) {
  const c = config && typeof config === 'object' ? config : {}
  return {
    jev: {
      base: String(c.jevBaseUrl || env('JEV_BASE_URL') || ''),
      key: env('JEV_API_KEY'),
      model: String(c.jevModel || env('JEV_MODEL') || 'jev-router'),
    },
    kimi: {
      base: String(c.kimiBaseUrl || env('KIMI_BASE_URL') || ''),
      key: env('KIMI_API_KEY'),
      model: String(c.kimiModel || env('KIMI_MODEL') || 'K3.1Pro'),
    },
    dsf: {
      base: String(c.dsfBaseUrl || env('DSF_BASE_URL') || ''),
      key: env('DSF_API_KEY'),
      model: String(c.dsfModel || env('DSF_MODEL') || 'DeepSeek4.1Flash101'),
    },
    timeoutMs: num(c.timeoutMs, 120000),
    temperature: Number.isFinite(Number(c.temperature)) ? Number(c.temperature) : 0.2,
  }
}

/* ----------------------------------------------------------------- routing */

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
        temperature: Number.isFinite(opts.temperature) ? opts.temperature : cfg.temperature,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        stream: false,
      }),
      signal: link.signal,
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${opts.provider}: ${raw.slice(0, 500)}`)
    let body
    try { body = JSON.parse(raw) } catch { throw new Error(`non-JSON response from ${opts.provider}: ${raw.slice(0, 300)}`) }
    const text = body?.choices?.[0]?.message?.content
    const usage = body?.usage || {}
    return {
      text: typeof text === 'string' ? text : (text == null ? '' : JSON.stringify(text)),
      promptTokens: Number(usage.prompt_tokens) || 0,
      completionTokens: Number(usage.completion_tokens) || 0,
      totalTokens: Number(usage.total_tokens) || 0,
    }
  } finally {
    link.dispose()
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
  const cfg = resolveConfig(config)

  /** Pick the concrete route for a tier. JEV is only used for auto-classification. */
  function routeFor(tier) {
    return tier === 'decision' ? { key: 'kimi', route: cfg.kimi } : { key: 'dsf', route: cfg.dsf }
  }

  async function decideTier(task, context) {
    if (cfg.jev.base) {
      try {
        const classification = await chat(cfg.jev, [
          { role: 'system', content: 'You are a task router. Classify the task into exactly one tier. Reply with ONLY a JSON object: {"tier":"decision"|"execution","reason":"short reason"}. decision = human judgment, choice, evaluation, architecture, risk, quality. execution = mechanical implementation, transformation, formatting, extraction, generation.' },
          { role: 'user', content: `Task:\n${task}\n\nContext:\n${context || '(none)'}` },
        ], { provider: 'jev', temperature: 0 }, cfg, undefined)
        const match = classification.text.match(/\{[\s\S]*\}/)
        if (match) {
          const parsed = JSON.parse(match[0])
          if (parsed.tier === 'decision' || parsed.tier === 'execution') {
            return { tier: parsed.tier, reason: `jev router: ${String(parsed.reason || '').slice(0, 200)}` }
          }
        }
      } catch (err) {
        return { tier: heuristicTier(task).tier, reason: `jev router failed (${shortError(err)}); used heuristic` }
      }
    }
    return heuristicTier(task)
  }

  const tools = [
    {
      name: 'harness_call',
      description: 'Route a task through the JEV tiered harness. Use tier=decision for anything requiring judgment, choice, evaluation, architecture, risk, or quality — it runs on Kimi K3.1Pro. Use tier=execution for mechanical implementation, transformation, formatting, extraction, or generation — it runs on DeepSeek4.1Flash101. Use tier=auto to let the harness classify (JEV router when configured, otherwise a local heuristic that defaults to the quality tier). Set provider=force to override the tier with an explicit model. Returns the model answer and token usage.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'The full task or question to send to the selected model.' },
          tier: { type: 'string', enum: ['auto', 'decision', 'execution'], description: 'Tier selector. Defaults to auto.' },
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
          return result({
            ok: true,
            tier,
            provider: selected,
            model: route.model,
            text: answer.text,
            note: note || `${tier} tier via ${selected}`,
            ...answer,
          })
        } catch (err) {
          return result({ tier, provider: selected, model: route.model, note: `call failed: ${shortError(err)}` })
        }
      },
    },
    {
      name: 'harness_classify',
      description: 'Classify a task into the decision (quality) or execution tier without running it. Use this to plan which model should handle a task. decision = judgment, choice, evaluation, architecture, risk, quality. execution = mechanical implementation, transformation, formatting, extraction, generation. When JEV router is configured it is consulted; otherwise a local cue-based heuristic is used and ties default to the quality tier.',
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
          note: `${okCount}/${which.length} gateways reachable`,
        })
      },
    },
  ]

  ctx.effect(() => {
    const disposers = tools.map(definition => ctx.tools.register(definition))

    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt) {
      disposers.push(systemPrompt.section({
        name: 'jev-harness:tiers',
        order: 700,
        text: 'JEV tiered harness is available. Use harness_call for delegated work: tier=decision (Kimi K3.1Pro) for anything requiring judgment, choice, evaluation, architecture, risk, or quality; tier=execution (DeepSeek4.1Flash101) for mechanical implementation, transformation, formatting, extraction, and generation. Use harness_classify to decide the tier, harness_review as a second-model quality gate before committing high-stakes output, and harness_probe to verify gateway connectivity and exact model IDs.',
      }))
    }

    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* best effort during teardown */ }
      }
    }
  })
}
