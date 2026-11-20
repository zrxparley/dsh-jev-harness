/**
 * #8 会话每日 token 预算：超限必须在**花钱之前**拒绝，不许静默继续扣。
 *
 * 这条曾被 `dc9e78e` 整段删掉（迁移事故），本文件是防止再丢的常驻断言。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, callRoute, chatResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const SAVE = '/api/jev-harness/save'
const STATS = '/api/jev-harness/stats'
const usageFile = (home) => path.join(home, 'jev-harness-usage.json')
const pad = (n) => String(n).padStart(2, '0')
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 造一份「今天已经用掉 N tokens」的账本（session 可指定）。 */
function seedToday(home, sessionId, tokens) {
  const now = new Date()
  const ledger = {
    version: 1, hours: {}, days: {}, recent: [],
    decisions: [{
      t: now.toISOString(), task: 'seed', session: sessionId, tier: 'execution', asked: 'auto',
      source: 'explicit', choice: 'execution', provider: 'dsf', model: 'm', skill: 'none',
      ok: true, ms: 1, pt: tokens, ct: 0,
    }],
  }
  return ledger
}

const chatStub = (url) => {
  if (String(url).includes('/chat/completions')) return chatResponse('完成')
  return undefined
}

test('#8: 超预算的调用在花出去之前被拒绝（不发请求、不记账）', async () => {
  const home = makeHome('budget-refuse')
  writeStore(home, { budgetDailyTokens: 50 })
  const ledger = seedToday(home, 's1', 80)
  fs.writeFileSync(usageFile(home), JSON.stringify(ledger))
  const stub = stubFetch(chatStub)
  try {
    const { tools, routes } = await boot({ home })
    const before = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, { sessionId: 's1' })
    assert.equal(out.ok, false, '超预算必须拒绝')
    assert.match(String(out.note), /超出每日 token 预算上限/)
    assert.deepEqual(out.budget, { session: 's1', used: 80, limit: 50 })
    assert.deepEqual(stub.urls(), [], '拒绝要发生在发请求之前，一个 gateway 都不许打')

    const after = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(after.totals.dsf.calls, before.totals.dsf.calls, '不许继续扣账')
    const decisions = readJsonFile(usageFile(home)).decisions || []
    assert.equal(decisions.length, 1, '被拒绝的调用不写决策（账本里仍只有 seed 那一条）')
  } finally {
    stub.restore(); fs.rmSync(home, { recursive: true, force: true })
  }
})

test('#8: 未超预算照常执行；别的会话不受影响', async () => {
  const home = makeHome('budget-pass')
  writeStore(home, { budgetDailyTokens: 1000 })
  const ledger = seedToday(home, 's1', 10)
  fs.writeFileSync(usageFile(home), JSON.stringify(ledger))
  const stub = stubFetch(chatStub)
  try {
    const { tools } = await boot({ home })
    const busy = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, { sessionId: 's1' })
    assert.equal(busy.ok, true, '没超预算要放行')
    const other = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, { sessionId: 's2' })
    assert.equal(other.ok, true, '预算是按会话算的，s2 不该被 s1 拖累')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#8: unknown 会话同样受预算约束（不许当成无限制）', async () => {
  const home = makeHome('budget-unknown')
  writeStore(home, { budgetDailyTokens: 10 })
  const ledger = seedToday(home, 'unknown', 40)
  fs.writeFileSync(usageFile(home), JSON.stringify(ledger))
  const stub = stubFetch(chatStub)
  try {
    const { tools } = await boot({ home })
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    assert.equal(out.ok, false)
    assert.equal(out.budget.session, 'unknown')
    assert.deepEqual(stub.urls(), [])
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#8: 预算可从 /save 设置并回显，非法值 400', async () => {
  const home = makeHome('budget-save')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const saved = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { budgetDailyTokens: 500 } })
    assert.equal(saved.status, 200)
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.budgetDailyTokens, 500, '/status 要回显预算')
    const store = readJsonFile(path.join(home, 'jev-harness.json'))
    assert.equal(store.budgetDailyTokens, 500, '预算必须真的落盘')
    // 0 = 不限制，也要能存
    await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { budgetDailyTokens: 0 } })
    assert.equal((await callRoute(routes, STATUS, { url: STATUS })).body.budgetDailyTokens, 0)
    const bad = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { budgetDailyTokens: -1 } })
    assert.equal(bad.status, 400)
    const nan = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { budgetDailyTokens: 'abc' } })
    assert.equal(nan.status, 400)
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#8: 预算按本地日算——昨天的用量不占今天的额度', async () => {
  const home = makeHome('budget-day')
  writeStore(home, { budgetDailyTokens: 50 })
  const yesterday = new Date(Date.now() - 26 * 3600 * 1000)
  const ledger = {
    version: 1, hours: {}, days: {}, recent: [],
    decisions: [{
      t: yesterday.toISOString(), task: 'old', session: 's1', tier: 'execution', asked: 'auto',
      source: 'explicit', choice: 'execution', provider: 'dsf', model: 'm', skill: 'none',
      ok: true, ms: 1, pt: 9999, ct: 0,
    }],
  }
  fs.writeFileSync(usageFile(home), JSON.stringify(ledger))
  const stub = stubFetch(chatStub)
  try {
    const { tools } = await boot({ home })
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, { sessionId: 's1' })
    assert.equal(out.ok, true, `昨天的用量不该占今天额度（今天是 ${localDay()}）`)
  } finally {
    stub.restore(); removeHome(home)
  }
})
