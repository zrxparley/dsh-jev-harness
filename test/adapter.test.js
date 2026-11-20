/**
 * `jev/auto` provider adapter（issue #37）。
 *
 * 离线用例覆盖：白名单委派、jev→jev 递归拒绝、JEV 失败→默认模型、开关关闭→默认模型、
 * 同轮判定缓存、流式透传、账本 host 记录，以及「选择器停在 jev/auto 时不回写」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createJevAdapter } from '../index.js'
import { applyClient, loadClient, requireReactOrSkip } from './helpers/client.js'

const REAL = { key: 'kimi', provider: 'titigate', model: 'kimi-k3.1-pro' }
const EXEC = { key: 'dsf', provider: 'titigate', model: 'deepseek-v4.1-flash-1017' }
const DEFAULT = { key: 'dsf', provider: 'deepseek-account', model: 'deepseek-flash' }

function makeLlm() {
  const calls = []
  return {
    calls,
    async prepareCall({ provider, model }) {
      calls.push({ provider, model })
      return {
        config: {},
        async *stream() {
          yield { type: 'text-delta', index: 0, text: '你' }
          yield { type: 'text-delta', index: 0, text: '好' }
          yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } }
          yield { type: 'finish', reason: 'stop' }
        },
      }
    },
  }
}

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function build(overrides = {}) {
  const llm = makeLlm()
  const usage = []
  const decisions = []
  let judgeCalls = 0
  const state = {
    cfg: { enabled: true, jev: { base: 'https://jev.test/v1' }, ...(overrides.cfg || {}) },
  }
  const adapter = createJevAdapter({
    getConfig: () => state.cfg,
    llm,
    decide: async (task) => {
      judgeCalls += 1
      if (overrides.decide) return overrides.decide(task, judgeCalls)
      return { tier: 'decision', source: 'jev', confidence: 0.92, reason: 'jev said decision' }
    },
    resolveBinding: async (which) => (overrides.resolveBinding ? overrides.resolveBinding(which) : (which === 'kimi' ? REAL : EXEC)),
    fallbackBinding: async () => (overrides.fallbackBinding ? overrides.fallbackBinding() : DEFAULT),
    recordUsage: (event) => usage.push(event),
    recordDecision: (event) => decisions.push(event),
  })
  return { adapter, llm, usage, decisions, state, judgeCalls: () => judgeCalls }
}

const options = {
  provider: 'jev',
  model: 'auto',
  sessionId: 's1',
  messages: [{ role: 'user', content: '评审这个方案' }],
  system: 'sys',
  signal: undefined,
}

test('listModels 只暴露 auto；resolveModel 保留 provider/model', async () => {
  const { adapter } = build()
  assert.deepEqual(await adapter.listModels('jev'), [{ id: 'auto', name: 'JEV 自动分流 · auto' }])
  assert.deepEqual(await adapter.listModels('other'), [])
  const model = await adapter.resolveModel('jev', 'auto')
  assert.equal(model.provider, 'jev')
  assert.equal(model.id, 'auto')
})

test('判定成功：按 tier 委派给白名单模型，流式透传并记账', async () => {
  const { adapter, llm, usage, decisions } = build()
  const chunks = await collect(adapter.stream(options))
  assert.deepEqual(chunks.map((chunk) => chunk.type), ['text-delta', 'text-delta', 'usage', 'finish'])
  assert.deepEqual(llm.calls, [{ provider: 'titigate', model: 'kimi-k3.1-pro' }])
  assert.equal(usage.length, 1)
  assert.equal(usage[0].tool, 'adapter')
  assert.equal(usage[0].ok, true)
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].tier, 'decision')
  assert.equal(decisions[0].source, 'jev')
  assert.deepEqual(decisions[0].host, { provider: 'titigate', model: 'kimi-k3.1-pro' })
})

test('递归拒绝：resolveBinding 返回 jev 时改走默认模型，绝不 jev→jev', async () => {
  const { adapter, llm, decisions } = build({
    resolveBinding: async () => ({ key: 'jev', provider: 'jev', model: 'auto' }),
  })
  const chunks = await collect(adapter.stream(options))
  assert.ok(chunks.length > 0, '仍然要能答话')
  assert.deepEqual(llm.calls, [{ provider: 'deepseek-account', model: 'deepseek-flash' }])
  assert.equal(llm.calls.some((call) => call.provider === 'jev'), false, '不许出现 jev 路由')
  assert.equal(decisions[0].source, 'fallback')
})

test('JEV 失败：不猜 tier，直接走默认模型且对话不中断', async () => {
  const { adapter, llm, decisions } = build({
    decide: async () => ({ tier: 'decision', source: 'heuristic', confidence: 0.1, reason: 'jev router failed' }),
  })
  const chunks = await collect(adapter.stream(options))
  assert.ok(chunks.length > 0)
  assert.deepEqual(llm.calls, [{ provider: 'deepseek-account', model: 'deepseek-flash' }])
  assert.equal(decisions[0].source, 'fallback')
})

test('没有配置 JEV：本地启发式仍然分流，并标 source=heuristic', async () => {
  const { adapter, llm, decisions } = build({
    cfg: { jev: { base: '' } },
    decide: async () => ({ tier: 'execution', source: 'heuristic', reason: 'no jev base' }),
  })
  await collect(adapter.stream(options))
  assert.deepEqual(llm.calls, [{ provider: 'titigate', model: 'deepseek-v4.1-flash-1017' }])
  assert.equal(decisions[0].source, 'heuristic')
})

test('开关关闭：不判定，直接默认模型', async () => {
  const { adapter, llm, judgeCalls, decisions } = build({ cfg: { enabled: false } })
  await collect(adapter.stream(options))
  assert.equal(judgeCalls(), 0)
  assert.deepEqual(llm.calls, [{ provider: 'deepseek-account', model: 'deepseek-flash' }])
  assert.equal(decisions[0].source, 'off')
})

test('同一轮的工具往返复用判定，但新的 user 请求必须重判', async () => {
  const tasks = []
  const { adapter } = build({ decide: async (task) => { tasks.push(task); return { tier: 'execution', source: 'jev', confidence: 0.9 } } })
  // 第一轮：一次 user + 一次工具往返（追加 assistant 消息，最后一条 user 未变）
  await collect(adapter.stream(options))
  await collect(adapter.stream({ ...options, messages: [...options.messages, { role: 'assistant', content: '调用工具' }, { role: 'tool', content: '{}' }] }))
  assert.deepEqual(tasks, ['评审这个方案'], '同轮工具往返只问一次')

  // 第二轮：用户发来新请求，必须重新判定
  await collect(adapter.stream({ ...options, messages: [...options.messages, { role: 'assistant', content: '完成' }, { role: 'user', content: '把这句话翻成英文' }] }))
  assert.deepEqual(tasks, ['评审这个方案', '把这句话翻成英文'], '新 user 必须重判，不许沿用上一轮 tier')
})

test('headless 宿主（有 llm 无 webServer）也会注册 adapter', async () => {
  const registered = []
  const { boot, makeHome, removeHome, stubFetch, writeStore } = await import('./helpers/harness.js')
  const home = makeHome('adapter-headless')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  const llm = {
    registerAdapter(providers, adapter) {
      registered.push({ providers, adapter })
      return () => {}
    },
  }
  try {
    await boot({ home, services: { llm } })
    assert.equal(registered.length, 1, '无 webServer 时也要注册')
    assert.deepEqual(registered[0].providers, ['jev'])
    assert.deepEqual(await registered[0].adapter.listModels('jev'), [{ id: 'auto', name: 'JEV 自动分流 · auto' }])
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('选择器停在 jev/auto 时不回写 sessions.selectModel，连续两轮仍走 adapter', { skip: requireReactOrSkip().skip }, () => {
  const { pkgs } = requireReactOrSkip()
  const loaded = loadClient(pkgs)
  applyClient(loaded)
  const shouldFollow = loaded.exports.__test.shouldFollowDecision
  const status = {
    route: { mode: 'dsh', followModel: true, follow: { provider: 'jev', model: 'auto' } },
    decisions: [{ t: 'now', host: { provider: 'titigate', model: 'kimi-k3.1-pro' } }],
  }
  assert.equal(shouldFollow(status), false, '第一轮不许回写')
  assert.equal(shouldFollow(status), false, '第二轮仍不许回写（否则退出 adapter）')

  const plain = {
    route: { mode: 'dsh', followModel: true, follow: { provider: 'deepseek-account', model: 'deepseek-v4-pro' } },
    decisions: [{ t: 'now', host: { provider: 'titigate', model: 'kimi-k3.1-pro' } }],
  }
  assert.equal(shouldFollow(plain), true, '普通模型仍保持原有跟随行为')
})
