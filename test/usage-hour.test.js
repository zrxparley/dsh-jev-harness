/**
 * 账本记账 + /stats 的小时粒度（对应旧的临时脚本 test-usage.mjs）。
 *
 * 真工具 + 真路由 + stub 网络：跑四次不同类型的调用，再读 /stats?hours=24，
 * 逐项核对 calls / tokens / peak / recent，确认「每一次真正发往网关的请求都记了一次」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, callRoute, chatResponse, fileExists, jevAnswer, makeHome, modelsResponse,
  readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const pad = (n) => String(n).padStart(2, '0')
const hourKeyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}`
const dayKeyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

test('四次调用后 /stats?hours=24 的账目与明细都对得上', async () => {
  const home = makeHome('usage-hour')
  writeStore(home)
  const judge = jevAnswer({ tier: 'execution', skill: 'none' })
  const stub = stubFetch((url, init) => {
    const fromJudge = judge(url, init || {})
    if (fromJudge !== undefined) return fromJudge
    if (url.includes('/chat/completions')) return chatResponse('完成')
    if (url.includes('/models')) return modelsResponse(['m1', 'm2'])
    return undefined
  })

  try {
    const { tools, routes } = await boot({ home })

    const auto = await tools.get('harness_call').execute({ task: '实现这一步', tier: 'auto', skill: 'off' }, {})
    assert.equal(auto.ok, true, `harness_call(auto) 失败：${auto.note || ''}`)
    assert.equal(auto.provider, 'dsf', 'JEV 判定 execution 就该落到 DeepSeek 执行层')

    const decision = await tools.get('harness_call').execute({ task: '评审这个方案', tier: 'decision', skill: 'off' }, {})
    assert.equal(decision.ok, true, `harness_call(decision) 失败：${decision.note || ''}`)
    assert.equal(decision.provider, 'kimi', 'decision 层就该落到 Kimi')

    const classify = await tools.get('harness_classify').execute({ task: '评审方案' }, {})
    assert.equal(classify.ok, true)
    assert.equal(classify.tier, 'execution')

    const probe = await tools.get('harness_probe').execute({ provider: 'kimi' }, {})
    assert.equal(probe.ok, true, `probe 失败：${probe.note || ''}`)
    assert.ok(String(probe.text).includes('m1'), 'probe 没有回显网关提供的模型')

    const stats = await callRoute(routes, STATS, { url: `${STATS}?hours=24` })
    assert.equal(stats.status, 200)
    const body = stats.body

    // 窗口形状
    assert.equal(body.ok, true)
    assert.equal(body.grain, 'hour')
    assert.equal(body.windowHours, 24)
    assert.equal(body.buckets.length, 24)

    // 账目：jev = 两次判定；kimi = 一次调用 + 一次探测；dsf = 一次调用
    assert.deepEqual(
      { jev: body.totals.jev.calls, kimi: body.totals.kimi.calls, dsf: body.totals.dsf.calls },
      { jev: 2, kimi: 2, dsf: 1 },
    )
    assert.deepEqual(
      { jev: body.totals.jev.tokens, kimi: body.totals.kimi.tokens, dsf: body.totals.dsf.tokens },
      { jev: 12, kimi: 140, dsf: 140 },
      'token 数不对：判定 5+1、chat 100+40、探测 0',
    )
    assert.equal(body.totals.kimi.ok, 2)
    assert.equal(body.totals.kimi.fail, 0)
    assert.equal(body.peak, 2, 'peak 应等于最忙网关的 calls')

    // 桶里的和必须等于 totals —— 证明 totals 是从窗口里算出来的，不是另存一份
    for (const gateway of ['jev', 'kimi', 'dsf']) {
      const summed = body.buckets.reduce((sum, bucket) => sum + bucket.gateways[gateway].calls, 0)
      assert.equal(summed, body.totals[gateway].calls, `${gateway} 的桶内合计与 totals 不一致`)
    }

    // 今天这一小时就是刚才那几笔：本地时区键
    const nowHour = hourKeyOf(new Date())
    const current = body.buckets[body.buckets.length - 1]
    assert.equal(current.key, nowHour)
    assert.equal(current.gateways.jev.calls, 2)
    assert.equal(current.gateways.kimi.calls, 2)
    assert.equal(current.gateways.dsf.calls, 1)

    // 最近调用明细
    assert.equal(body.recent.length, 5)
    assert.deepEqual(
      body.recent.map((entry) => `${entry.g}:${entry.tool}`),
      ['kimi:probe', 'jev:classify', 'kimi:call', 'dsf:call', 'jev:classify'],
    )
    assert.ok(body.recent.every((entry) => entry.ok === true))
    assert.ok(body.recent.every((entry) => typeof entry.t === 'string' && entry.t.endsWith('Z')), '时间戳要存 ISO')

    // 落盘：账本文件真的写出来了，权限 0600，内容是合法 JSON
    const ledgerFile = path.join(home, 'jev-harness-usage.json')
    assert.ok(fileExists(ledgerFile), '账本文件没有落盘')
    assert.equal(fs.statSync(ledgerFile).mode & 0o777, 0o600, '账本权限不是 0600')
    const ledger = readJsonFile(ledgerFile)
    assert.equal(ledger.version, 1)
    assert.ok(ledger.hours[nowHour], '没有写小时桶')
    assert.ok(ledger.days[dayKeyOf(new Date())], '没有写日桶')
    assert.equal(ledger.hours[nowHour].dsf.calls, 1)

    // today 只校验形状：它按 UTC 日取键，跨过 UTC 零点后与本地日不同（另案处理）
    assert.deepEqual(Object.keys(body.today).sort(), ['dsf', 'jev', 'kimi'])

    // 全程没有真网络：每条 URL 都落在被 stub 的域名里
    const allowed = ['https://jev.test/', 'https://kimi.test/', 'https://dsf.test/']
    for (const url of stub.urls()) {
      assert.ok(allowed.some((prefix) => url.startsWith(prefix)), `出现未预期的网络请求：${url}`)
    }
  } finally {
    stub.restore()
    removeHome(home)
  }
})