/**
 * #41 session-partitioned ledger + judge-quality metrics. STUB, no live gateway.
 *
 *   - decisions and recent rows carry a session; pre-partition rows migrate to
 *     'legacy' on read (history preserved, never misattributed to current session);
 *   - per-session retention keeps at least the last 50 decisions per session;
 *   - /stats?session=<id> returns that session's judge-quality metrics;
 *   - judgeQuality computes all six indicators;
 *   - /stats exposes judgeAccuracy read from the #10 eval result file, with its
 *     timestamp.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import {
  boot, callRoute, chatResponse, jsonResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const usageFile = (home) => path.join(home, 'jev-harness-usage.json')

function judgeStub({ tier = 'execution', confidence = 0.9 } = {}) {
  return (url, init) => {
    if (!url.includes('/systemone')) return undefined
    const payload = init.body ? JSON.parse(init.body) : {}
    const answers = {}
    if (payload.questions?.tier) answers.tier = { choice: tier, confidence }
    if (payload.questions?.skill) answers.skill = { choice: 'none', confidence }
    if (payload.questions?.difficulty) answers.difficulty = { choice: 'normal', confidence }
    return jsonResponse({ model: 'jev-test', answers, usage: { input_tokens: 5, output_tokens: 1 } })
  }
}
const chatStub = (url) => {
  if (url.includes('/chat/completions')) return chatResponse('完成')
  if (url.includes('/models')) return jsonResponse({ data: [{ id: 'm1' }] })
  return undefined
}

test('#41: decisions and recent rows carry a session field', async () => {
  const home = makeHome('sess-field')
  writeStore(home)
  const judge = judgeStub({})
  const stub = stubFetch((url, init) => judge(url, init) ?? chatStub(url))
  try {
    const { tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: '拆分这个类', tier: 'auto' }, {})
    const usage = readJsonFile(usageFile(home))
    const d = usage.decisions.at(-1)
    assert.ok('session' in d, 'decision row has a session field')
    const r = usage.recent.at(-1)
    assert.ok('session' in r, 'recent row has a session field')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#41: pre-partition rows migrate to legacy on read (history preserved)', async () => {
  const home = makeHome('sess-legacy')
  writeStore(home)
  // Hand-write an OLD ledger with no session fields.
  fs.writeFileSync(usageFile(home), JSON.stringify({
    version: 1,
    hours: {}, days: {},
    recent: [{ t: new Date().toISOString(), g: 'dsf', tool: 'call', ok: true, ms: 10 }],
    decisions: [{ t: new Date().toISOString(), task: 'old', tier: 'execution', source: 'jev', ok: true }],
  }))
  const stub = stubFetch((url) => chatStub(url))
  try {
    const { routes } = await boot({ home })
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    // old rows must still be present (history not dropped)
    assert.ok(stats.recent.length >= 1, 'old recent row preserved')
    // and /stats must not crash on session-less rows; judgeQuality should still compute
    assert.ok(stats.judgeQuality, 'judgeQuality present even with legacy rows')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#41: /stats?session= returns only that session decisions + judge metrics', async () => {
  const home = makeHome('sess-filter')
  writeStore(home)
  const judge = judgeStub({})
  const stub = stubFetch((url, init) => judge(url, init) ?? chatStub(url))
  try {
    const { tools, routes } = await boot({ home })
    // two calls with different session ids via exec
    await tools.get('harness_call').execute({ task: '任务A', tier: 'auto' }, { sessionId: 'sess-A' })
    await tools.get('harness_call').execute({ task: '任务B', tier: 'auto' }, { sessionId: 'sess-B' })

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24&session=sess-A` })).body
    assert.ok(stats.session, 'session block present')
    assert.equal(stats.session.id, 'sess-A')
    // only sess-A decisions
    assert.ok(stats.session.decisions.every(d => d.session === 'sess-A'), 'filtered to sess-A only')
    assert.ok(stats.session.decisions.some(d => d.task === '任务A'), 'sess-A task present')
    assert.ok(!stats.session.decisions.some(d => d.task === '任务B'), 'sess-B task excluded')
    assert.ok(stats.session.judgeQuality, 'session judge metrics present')
    // global metrics also present
    assert.ok(stats.judgeQuality, 'global judge metrics present')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#41: judgeQuality computes all six indicators', async () => {
  const home = makeHome('sess-quality')
  writeStore(home)
  // one confident jev call + one heuristic (JEV down) call
  const judge = judgeStub({ confidence: 0.9 })
  const stub = stubFetch((url, init) => judge(url, init) ?? chatStub(url))
  try {
    const { tools, routes } = await boot({ home })
    await tools.get('harness_call').execute({ task: '拆分', tier: 'auto' }, { sessionId: 's1' })
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    const q = stats.judgeQuality
    for (const key of ['judgedCount', 'heuristicShare', 'lowConfidenceShare', 'tierDistribution', 'avgJudgeMs', 'judgeToExecutionMsRatio']) {
      assert.ok(key in q, `judgeQuality has ${key}`)
    }
    assert.ok(q.judgedCount >= 1, 'at least one judged decision')
    assert.ok(q.tierDistribution.execution >= 1, 'execution tier counted')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#41: per-session retention keeps at least 50 decisions for the current session', async () => {
  const home = makeHome('sess-retention')
  writeStore(home)
  const judge = judgeStub({})
  const stub = stubFetch((url, init) => judge(url, init) ?? chatStub(url))
  try {
    const { tools } = await boot({ home })
    // push 60 decisions in one session
    for (let i = 0; i < 60; i++) {
      await tools.get('harness_call').execute({ task: `任务${i}`, tier: 'auto' }, { sessionId: 'busy' })
    }
    const usage = readJsonFile(usageFile(home))
    const busy = usage.decisions.filter(d => d.session === 'busy')
    assert.ok(busy.length >= 50, `current session keeps >=50 decisions, got ${busy.length}`)
    assert.ok(busy.length <= 50 + 1, `but bounded near 50, got ${busy.length}`)
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#41: /stats exposes judgeAccuracy read from the eval result file, with timestamp', async () => {
  const home = makeHome('sess-accuracy')
  writeStore(home)
  // hand-write an eval result file (as the #10 runner would)
  fs.writeFileSync(path.join(home, 'jev-harness-eval.json'), JSON.stringify({
    at: '2026-11-19T22:00:00.000Z', criteriaVersion: '1.1.0', cases: 20,
    tierAccuracy: 0.85, skillAccuracy: 0.7, tierCorrect: 17, skillCorrect: 14,
  }))
  const stub = stubFetch((url) => chatStub(url))
  try {
    const { routes } = await boot({ home })
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.ok(stats.judgeAccuracy, 'judgeAccuracy present')
    assert.equal(stats.judgeAccuracy.tierAccuracy, 0.85)
    assert.equal(stats.judgeAccuracy.at, '2026-11-19T22:00:00.000Z', 'timestamp surfaced')
    assert.equal(stats.judgeAccuracy.criteriaVersion, '1.1.0')
  } finally {
    stub.restore(); removeHome(home)
  }
})
