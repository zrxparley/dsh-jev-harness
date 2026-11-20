/**
 * #3 execution-layer failover + circuit breaker + tiered timeouts. STUB.
 *
 *   - normal: primary answers, no degradation;
 *   - degrade: primary dead -> backup answers, marked degraded in note + ledger;
 *   - breaker: 3 consecutive failures on a provider opens a cooldown; during the
 *     cooldown that provider is SKIPPED without spending a timeout (kind:'cooldown');
 *   - recovery: after the cooldown a successful trial closes the breaker again;
 *   - tiered timeout: probe uses a short budget (not the 120s generation budget).
 *
 * NOT covered here (needs config): 4xx / not-configured do NOT trigger failover
 * (covered indirectly by test/model-id.test.js and test/usage-metrics.test.js).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  boot, callRoute, chatResponse, jsonResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const usageFile = (home) => path.join(home, 'jev-harness-usage.json')

function jev(url, init) {
  if (!url.includes('/systemone')) return undefined
  const p = JSON.parse(init.body)
  const answers = {}
  if (p.questions?.tier) answers.tier = { choice: 'decision', confidence: 0.95 }
  if (p.questions?.skill) answers.skill = { choice: 'none', confidence: 0.9 }
  if (p.questions?.difficulty) answers.difficulty = { choice: 'hard', confidence: 0.9 }
  return jsonResponse({ model: 'jev', answers, usage: { input_tokens: 5, output_tokens: 1 } })
}

/** kimi dead, dsf fine. */
function kimiDeadDsfOk(url, init) {
  const j = jev(url, init); if (j !== undefined) return j
  if (url.includes('kimi.test') && url.includes('/chat/completions')) throw new Error('kimi ECONNREFUSED')
  if (url.includes('dsf.test') && url.includes('/chat/completions')) return chatResponse('dsf 兜底')
  return undefined
}

const decision = (tools, task = '评审方案') => tools.get('harness_call').execute({ task, tier: 'decision', skill: 'off' }, {})

test('#3 normal: primary answers, no degradation', async () => {
  const home = makeHome('fo-normal')
  writeStore(home)
  const stub = stubFetch((url, init) => {
    const j = jev(url, init); if (j !== undefined) return j
    if (url.includes('/chat/completions')) return chatResponse('kimi 回答')
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    const res = await decision(tools)
    assert.equal(res.ok, true, res.note)
    assert.equal(res.provider, 'kimi', 'decision runs on kimi when healthy')
    assert.ok(!/降级|冷却/.test(res.note), 'no degradation marker on a healthy call')
  } finally { stub.restore(); removeHome(home) }
})

test('#3 degrade: kimi dead -> dsf answers, note + ledger marked degraded', async () => {
  const home = makeHome('fo-degrade')
  writeStore(home)
  const stub = stubFetch(kimiDeadDsfOk)
  try {
    const { tools } = await boot({ home })
    const res = await decision(tools)
    assert.equal(res.ok, true, `degraded call should still succeed: ${res.note}`)
    assert.equal(res.provider, 'dsf', 'degraded to dsf')
    assert.ok(/降级/.test(res.note), `note must mark degradation, got: ${res.note}`)
    const usage = readJsonFile(usageFile(home))
    const d = usage.decisions.at(-1)
    assert.equal(d.degraded, true, 'ledger decision marked degraded')
    assert.equal(d.degradedFrom, 'kimi', 'degradedFrom records the failed primary')
    // recent rows carry the degraded marker on the backup call
    const degradedRow = usage.recent.find(r => r.degraded === 'kimi')
    assert.ok(degradedRow, 'a recent row is marked degraded from kimi')
  } finally { stub.restore(); removeHome(home) }
})

test('#3 breaker: 3 failures open a cooldown; cooling provider is skipped without a timeout', async () => {
  const home = makeHome('fo-breaker')
  writeStore(home)
  const stub = stubFetch(kimiDeadDsfOk)
  try {
    const { tools, routes } = await boot({ home })
    // 3 consecutive kimi failures (each degrades to dsf) open the breaker
    await decision(tools); await decision(tools); await decision(tools)
    // 4th call: kimi is now cooling down -> skipped directly, kind:'cooldown' recorded
    const res = await decision(tools)
    assert.equal(res.ok, true, res.note)
    assert.equal(res.provider, 'dsf')
    assert.ok(/冷却/.test(res.note), `note must mention the cooldown, got: ${res.note}`)
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    const cooldownRow = stats.recent.find(r => r.kind === 'cooldown')
    assert.ok(cooldownRow, 'a recent row is marked kind:cooldown (skipped without spending a timeout)')
    assert.equal(cooldownRow.sent, false, 'cooling provider is not even contacted')
  } finally { stub.restore(); removeHome(home) }
})

test('#3 recovery: after the cooldown a successful trial closes the breaker', async () => {
  const home = makeHome('fo-recover')
  writeStore(home)
  process.env.JEV_BREAKER_COOLDOWN_MS = '60'  // shrink the cooldown for the test
  let kimiDown = true
  const stub = stubFetch((url, init) => {
    const j = jev(url, init); if (j !== undefined) return j
    if (url.includes('kimi.test') && url.includes('/chat/completions')) {
      if (kimiDown) throw new Error('kimi ECONNREFUSED')
      return chatResponse('kimi 恢复')
    }
    if (url.includes('dsf.test') && url.includes('/chat/completions')) return chatResponse('dsf 兜底')
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    await decision(tools); await decision(tools); await decision(tools)  // open breaker
    // kimi recovers; after the (tiny) cooldown the next trial should use kimi again
    kimiDown = false
    await new Promise(r => setTimeout(r, 80))  // let the 60ms cooldown lapse
    const res = await decision(tools)
    assert.equal(res.provider, 'kimi', 'after cooldown a healthy kimi is used again')
    assert.ok(!/冷却/.test(res.note), 'no cooldown once recovered')
  } finally {
    delete process.env.JEV_BREAKER_COOLDOWN_MS
    stub.restore(); removeHome(home)
  }
})

test('#3 tiered timeout: probe uses a short budget, not the 120s generation budget', async () => {
  const home = makeHome('fo-probe-timeout')
  writeStore(home)
  let sawSignalTimeout = null
  const stub = stubFetch((url, init) => {
    if (url.includes('/models')) {
      // capture the abort signal's timeout indirectly: respond immediately but record that a signal existed
      sawSignalTimeout = init && init.signal ? 'signal-present' : 'no-signal'
      return jsonResponse({ data: [{ id: 'm1' }] })
    }
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    await tools.get('harness_probe').execute({ provider: 'kimi' }, {})
    // Real wiring: the probe route's combineSignal must use timeoutFor('probe'),
    // which defaults to 10000ms — NOT the 120s generation budget.
    const src = (await import('node:fs')).readFileSync(path.join(process.cwd(), 'index.js'), 'utf8')
    assert.ok(/combineSignal\(timeoutFor\('probe', cfg\)/.test(src), 'probe route must call combineSignal with the probe budget')
    assert.ok(/probe: num\(store.timeoutProbe, 10000\)/.test(src), 'probe budget defaults to 10000ms')
  } finally { stub.restore(); removeHome(home) }
})

test('#3: timeoutProbe override via /save changes the probe budget', async () => {
  const home = makeHome('fo-probe-override')
  writeStore(home)
  const stub = stubFetch((url) => url.includes('/models') ? jsonResponse({ data: [{ id: 'm1' }] }) : undefined)
  try {
    const { routes } = await boot({ home })
    await callRoute(routes, '/api/jev-harness/save', { method: 'POST', url: '/api/jev-harness/save', body: { timeoutProbe: 5000 } })
    const onDisk = readJsonFile(path.join(home, 'jev-harness.json'))
    assert.equal(onDisk.timeoutProbe, 5000, 'timeoutProbe persisted via /save')
  } finally { stub.restore(); removeHome(home) }
})
