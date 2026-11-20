/**
 * 判定失败模式（issue #39）。
 *
 * 验收原文：
 * - TypeSafe 返回 500 / 超时 / 非法 JSON 三种情况下，harness_call 仍返回可用答案，
 *   账本记录 source:heuristic + degraded:true + error
 * - jev/auto 作为 provider 时，JEV 全挂也能正常对话
 * - 浮层与面板对「JEV 未参与」「已降级」有明确文案，不许显示成绿色成功
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createJevAdapter } from '../index.js'
import { applyClient, loadClient, requireReactOrSkip } from './helpers/client.js'
import {
  boot, callRoute, jsonResponse, makeHome, removeHome, stubFetch, textResponse, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'

async function withCall(stubHandler, run) {
  const home = makeHome('degraded')
  writeStore(home)
  const stub = stubFetch(stubHandler)
  try {
    const { tools, routes } = await boot({ home, config: { timeoutMs: 60 } })
    await run({ tools, routes })
  } finally {
    stub.restore()
    removeHome(home)
  }
}

async function lastDecision(routes) {
  const body = (await callRoute(routes, STATUS, { url: STATUS })).body
  return body.decisions[body.decisions.length - 1]
}

test('JEV 返回 500：仍有答案，账本 source=heuristic + degraded + error', async () => {
  await withCall((url) => {
    if (String(url).includes('/systemone')) return jsonResponse({ error: 'boom' }, 500)
    if (String(url).includes('/chat/completions')) {
      return jsonResponse({ choices: [{ message: { content: '仍然答出来了' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    }
    return undefined
  }, async ({ tools, routes }) => {
    const result = await tools.get('harness_call').execute({ task: '评审这个方案', tier: 'auto', skill: 'off' }, {})
    assert.equal(result.ok, true)
    assert.equal(result.text, '仍然答出来了', 'JEV 挂了也必须有可用答案')
    const decision = await lastDecision(routes)
    assert.equal(decision.source, 'heuristic')
    assert.equal(decision.degraded, true)
    assert.match(String(decision.error), /500/)
  })
})

test('JEV 返回非法 JSON：同样降级且不中断', async () => {
  await withCall((url) => {
    if (String(url).includes('/systemone')) return textResponse('<html>gateway login</html>')
    if (String(url).includes('/chat/completions')) {
      return jsonResponse({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    }
    return undefined
  }, async ({ tools, routes }) => {
    const result = await tools.get('harness_call').execute({ task: '评审', tier: 'auto', skill: 'off' }, {})
    assert.equal(result.ok, true)
    const decision = await lastDecision(routes)
    assert.equal(decision.degraded, true)
    assert.ok(String(decision.error).length > 0, '非法 JSON 要留下原因')
  })
})

test('JEV 超时：判定按 60ms 超时，仍然走兜底并出字', async () => {
  await withCall((url, init) => {
    if (String(url).includes('/systemone')) {
      // 永不主动返回，但要响应 abort，否则测试会挂死
      return new Promise((_resolve, reject) => {
        const signal = init && init.signal
        if (!signal) return
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      })
    }
    if (String(url).includes('/chat/completions')) {
      return jsonResponse({ choices: [{ message: { content: '超时也答' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    }
    return undefined
  }, async ({ tools, routes }) => {
    const result = await tools.get('harness_call').execute({ task: '评审', tier: 'auto', skill: 'off' }, {})
    assert.equal(result.ok, true)
    assert.equal(result.text, '超时也答')
    const decision = await lastDecision(routes)
    assert.equal(decision.source, 'heuristic')
    assert.equal(decision.degraded, true)
  })
})

test('「判不出来就用最贵」被禁止：adapter 降级走默认（廉价）模型', async () => {
  const calls = []
  const llm = {
    async prepareCall({ provider, model }) {
      calls.push({ provider, model })
      return { config: {}, async *stream() { yield { type: 'text-delta', text: '好' } } }
    },
  }
  const decisions = []
  const adapter = createJevAdapter({
    getConfig: () => ({ enabled: true, jev: { base: 'https://jev.test/v1' } }),
    llm,
    decide: async () => ({ tier: 'decision', source: 'heuristic', degraded: true, error: 'HTTP 500', confidence: 0.2 }),
    resolveBinding: async () => ({ key: 'kimi', provider: 'titigate', model: 'kimi-k3.1-pro' }),
    fallbackBinding: async () => ({ key: 'dsf', provider: 'deepseek-account', model: 'deepseek-flash' }),
    recordUsage: () => {},
    recordDecision: (entry) => decisions.push(entry),
  })
  for await (const _ of adapter.stream({ provider: 'jev', model: 'auto', messages: [{ role: 'user', content: '评审' }] })) { /* drain */ }
  assert.deepEqual(calls, [{ provider: 'deepseek-account', model: 'deepseek-flash' }], '降级不许用决策档（贵）模型')
  assert.equal(decisions[0].degraded, true)
  assert.equal(decisions[0].source, 'fallback')
  assert.match(String(decisions[0].error), /500/)
})

test('面板文案：JEV 未参与 / 已降级 / 调用失败，不许绿色成功', { skip: requireReactOrSkip().skip }, () => {
  const { pkgs } = requireReactOrSkip()
  const loaded = loadClient(pkgs)
  applyClient(loaded)
  const detail = loaded.exports.__test.decisionDetail

  const heuristic = detail({ source: 'heuristic', tier: 'decision', degraded: true, host: { provider: 'x', model: 'y' } })
  assert.match(heuristic.judge, /JEV 未参与/)
  assert.match(heuristic.judge, /已降级/)
  assert.equal(heuristic.tone, '#d29922', '降级必须是琥珀，不是绿色')

  const fallback = detail({ source: 'fallback', ok: true })
  assert.match(fallback.judge, /已降级/)
  assert.equal(fallback.tone, '#d29922')

  const failed = detail({ source: 'jev', tier: 'decision', ok: false, host: { provider: 'x', model: 'y' } })
  assert.match(failed.usage, /调用失败/)
  assert.equal(failed.tone, '#f85149', '最终失败必须是红色')
})
