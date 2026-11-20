/**
 * #4 confidence strategy + judge auditability. All STUB, no live gateway.
 *
 *   - low judge confidence (< threshold) escalates an execution pick to decision
 *     (Kimi); high confidence follows the judge's choice;
 *   - JEV unreachable -> heuristic fallback with source:'heuristic';
 *   - the threshold takes effect on the NEXT call after a store change (refresh),
 *     no plugin reinstall;
 *   - /stats recent carries choice / confidence / source on judge records;
 *   - ledger skill is 'none' (never an ambiguous empty string) when judged none;
 *   - escalated decisions are marked escalated:true in the ledger.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  boot, callRoute, chatResponse, jsonResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const USAGE = () => path.join(process.env.DSH_HOME, 'jev-harness-usage.json')

function judgeStub({ tier = 'execution', skill = 'none', difficulty = 'normal', confidence = 0.9 } = {}) {
  return (url, init) => {
    if (!url.includes('/systemone')) return undefined
    const payload = init.body ? JSON.parse(init.body) : {}
    const answers = {}
    if (payload.questions?.tier) answers.tier = { choice: tier, confidence }
    if (payload.questions?.skill) answers.skill = { choice: skill, confidence }
    if (payload.questions?.difficulty) answers.difficulty = { choice: difficulty, confidence }
    return jsonResponse({ model: 'jev-test', answers, usage: { input_tokens: 5, output_tokens: 1 } })
  }
}

function chatStub(url) {
  if (url.includes('/chat/completions')) return chatResponse('完成')
  if (url.includes('/models')) return jsonResponse({ data: [{ id: 'm1' }] })
  return undefined
}

test('#4: low confidence (<0.6) escalates execution pick to decision (Kimi)', async () => {
  const home = makeHome('conf-low')
  writeStore(home)
  const judge = judgeStub({ tier: 'execution', confidence: 0.4 })  // judge says execution but unsure
  const stub = stubFetch((url, init) => judge(url, init) ?? chatStub(url))
  try {
    const { tools } = await boot({ home })
    const res = await tools.get('harness_call').execute({ task: '把这个类拆分', tier: 'auto' }, {})
    assert.equal(res.ok, true, res.note)
    assert.equal(res.tier, 'decision', 'low confidence must escalate to decision')
    assert.equal(res.provider, 'kimi', 'escalated call must run on Kimi')
    assert.ok(/low confidence/i.test(res.note), 'note must explain the escalation')
    const d = readJsonFile(USAGE()).decisions.at(-1)
    assert.equal(d.escalated, true, 'ledger must mark escalated:true')
    assert.equal(d.tier, 'decision')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#4: high confidence follows the judge choice (execution stays on Flash)', async () => {
  const home = makeHome('conf-high')
  writeStore(home)
  const judge = judgeStub({ tier: 'execution', confidence: 0.95 })
  const stub = stubFetch((url, init) => judge(url, init) ?? chatStub(url))
  try {
    const { tools } = await boot({ home })
    const res = await tools.get('harness_call').execute({ task: '把这个类拆分', tier: 'auto' }, {})
    assert.equal(res.tier, 'execution')
    assert.equal(res.provider, 'dsf', 'high-confidence execution stays on Flash')
    const d = readJsonFile(USAGE()).decisions.at(-1)
    assert.equal(d.escalated, false, 'no escalation when confidence is high')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#4: JEV unreachable -> heuristic fallback with source:heuristic', async () => {
  const home = makeHome('conf-down')
  writeStore(home)
  const stub = stubFetch((url) => {
    if (url.includes('/systemone')) throw new Error('connect ECONNREFUSED')
    return chatStub(url)
  })
  try {
    const { tools } = await boot({ home })
    const res = await tools.get('harness_call').execute({ task: '翻译这段', tier: 'auto' }, {})
    assert.equal(res.ok, true, 'call still succeeds via heuristic')
    const d = readJsonFile(USAGE()).decisions.at(-1)
    assert.equal(d.source, 'heuristic')
    assert.equal(d.escalated, false, 'heuristic has no confidence -> no escalation')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#4: threshold change takes effect on the NEXT call (no reinstall)', async () => {
  const home = makeHome('conf-threshold')
  writeStore(home, { lowConfidenceThreshold: 0.95 })  // very strict: even 0.9 escalates
  const judge = judgeStub({ tier: 'execution', confidence: 0.9 })
  const stub = stubFetch((url, init) => judge(url, init) ?? chatStub(url))
  try {
    const { tools } = await boot({ home })
    // 0.9 < 0.95 threshold -> escalates to decision even though 0.9 is "high"
    const res = await tools.get('harness_call').execute({ task: '拆分这个类', tier: 'auto' }, {})
    assert.equal(res.tier, 'decision', 'strict threshold 0.95 must escalate a 0.9 pick')
    assert.equal(res.provider, 'kimi')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#4: /stats recent judge record carries choice / confidence / source', async () => {
  const home = makeHome('conf-recent')
  writeStore(home)
  const judge = judgeStub({ tier: 'execution', confidence: 0.88 })
  const stub = stubFetch((url, init) => judge(url, init) ?? chatStub(url))
  try {
    const { tools, routes } = await boot({ home })
    await tools.get('harness_call').execute({ task: '拆分这个类', tier: 'auto' }, {})
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    const judgeRec = (stats.recent || []).find(r => r.tool === 'judge')
    assert.ok(judgeRec, 'a judge record exists in recent')
    assert.equal(judgeRec.choice, 'execution', 'recent carries choice')
    assert.equal(judgeRec.confidence, 0.88, 'recent carries confidence')
    assert.equal(judgeRec.source, 'jev', 'recent carries source')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test("#4: ledger skill is 'none' (not empty string) when the judge picks none", async () => {
  const home = makeHome('conf-skillnone')
  writeStore(home)
  const judge = judgeStub({ tier: 'execution', skill: 'none', confidence: 0.9 })
  const stub = stubFetch((url, init) => judge(url, init) ?? chatStub(url))
  try {
    const { tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: '翻译这句话', tier: 'auto' }, {})
    const d = readJsonFile(USAGE()).decisions.at(-1)
    assert.equal(d.skill, 'none', "skill must be the explicit string 'none', not an ambiguous empty string")
  } finally {
    stub.restore(); removeHome(home)
  }
})

const STATUS = '/api/jev-harness/status'
const SAVE = '/api/jev-harness/save'

test('#4 F1: /status echoes lowConfidenceThreshold (default 0.6)', async () => {
  const home = makeHome('conf-status')
  writeStore(home)
  const stub = stubFetch((url, init) => chatStub(url))
  try {
    const { routes } = await boot({ home })
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.lowConfidenceThreshold, 0.6, '/status must echo the threshold so the panel can render it')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#4 F1: POST /save persists the threshold and /status reflects it', async () => {
  const home = makeHome('conf-save')
  writeStore(home)
  const stub = stubFetch((url, init) => chatStub(url))
  try {
    const { routes } = await boot({ home })
    const saved = (await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { lowConfidenceThreshold: 0.85 } })).body
    assert.equal(saved.lowConfidenceThreshold, 0.85, 'save response echoes the new threshold')
    // re-read /status: the value must have persisted through writeStore
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.lowConfidenceThreshold, 0.85, 'persisted threshold survives a fresh /status read')
    const onDisk = readJsonFile(path.join(home, 'jev-harness.json'))
    assert.equal(onDisk.lowConfidenceThreshold, 0.85, 'threshold is written to the store file')
  } finally {
    stub.restore(); removeHome(home)
  }
})
