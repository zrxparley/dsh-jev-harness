/**
 * 记账口径（issue #14）：
 * - 未配置 → 落一条「未发出」
 * - HTTP 200 空正文 → answered:false／「无回答」，不再算成功
 * - 「今天」用本地日键（与小时桶同源）
 * - 平均耗时排除 probe
 * - 日回退用 setDate，跨 DST 不漂移
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  REPO, boot, callRoute, chatResponse, jsonResponse, makeHome, modelsResponse,
  removeHome, stubFetch, writeJsonFile, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const pad = (n) => String(n).padStart(2, '0')
const localDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const localHour = (date = new Date()) => `${localDay(date)}T${pad(date.getHours())}`

test('未配置网关：发一条指令也留下「未发出」记录', async () => {
  const home = makeHome('metrics-notsent')
  writeStore(home, { kimiBaseUrl: '', dsfBaseUrl: '', jevBaseUrl: '' })
  const stub = stubFetch(() => undefined)
  try {
    const { tools, routes } = await boot({ home })
    const result = await tools.get('harness_call').execute({ task: '评审这个方案', tier: 'decision', skill: 'off' }, {})
    assert.equal(result.ok, false)

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    const totals = Object.values(stats.totals)
    assert.equal(totals.reduce((sum, entry) => sum + entry.notSent, 0), 1, '未发出的调用要有一条记录')
    assert.equal(stats.recent.length, 1)
    assert.equal(stats.recent[0].sent, false)
    assert.equal(stats.recent[0].answered, false, '没发出去就不算回答')
    assert.equal(stats.recent[0].kind, 'not-sent')
    assert.match(stats.recent[0].error, /未发出/)
    assert.equal(stats.recent[0].ms, 0)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('HTTP 200 但正文为空：记「无回答」，不再算成功', async () => {
  const home = makeHome('metrics-noanswer')
  writeStore(home)
  const stub = stubFetch((url) => {
    if (String(url).includes('/chat/completions')) {
      return jsonResponse({
        choices: [{ message: { content: '', reasoning_content: '想了很多但没写出来' } }],
        usage: { prompt_tokens: 10, completion_tokens: 40 },
      })
    }
    return undefined
  })
  try {
    const { tools, routes } = await boot({ home })
    const result = await tools.get('harness_call').execute({ task: '评审', tier: 'decision', skill: 'off' }, {})
    assert.equal(result.ok, true, '空正文仍是 HTTP 成功')

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.totals.kimi.unanswered, 1)
    assert.equal(stats.totals.kimi.answered, 0)
    assert.equal(stats.recent[0].answered, false)
    assert.equal(stats.recent[0].kind, 'no-answer')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('「今天」用本地日键，不读 UTC 日期', async () => {
  const home = makeHome('metrics-today')
  writeStore(home)
  const local = localDay()
  const utc = new Date().toISOString().slice(0, 10)
  const days = { [local]: { dsf: { calls: 7, ok: 7, fail: 0, promptTokens: 1, completionTokens: 1, ms: 1 } } }
  if (utc !== local) days[utc] = { dsf: { calls: 99, ok: 99, fail: 0, promptTokens: 1, completionTokens: 1, ms: 1 } }
  writeJsonFile(path.join(home, 'jev-harness-usage.json'), { version: 1, hours: {}, days, recent: [], decisions: [] })

  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.today.dsf.calls, 7, `本地日 ${local} 与 UTC 日 ${utc} 不许混用`)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('平均耗时排除 probe：分母也只算真正回答的调用', async () => {
  const home = makeHome('metrics-avg')
  writeStore(home)
  const key = localHour()
  writeJsonFile(path.join(home, 'jev-harness-usage.json'), {
    version: 1,
    hours: {
      [key]: {
        kimi: { calls: 3, ok: 2, fail: 1, promptTokens: 1, completionTokens: 1, ms: 1000, probeCalls: 1, probeMs: 5000, answered: 2, unanswered: 0, notSent: 1 },
      },
    },
    days: {},
    recent: [],
    decisions: [],
  })
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.totals.kimi.probeCalls, 1)
    assert.equal(stats.totals.kimi.notSent, 1)
    assert.equal(stats.totals.kimi.avgMs, 1000, 'avgMs 分母要排除 probe 与未发出：1000/(3-1-1)')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('日回退用 setDate：跨美国春季 DST 不漂移', () => {
  // 在子进程里固定 TZ，避免污染当前进程。
  const script = `
    const { localDayKey, addLocalDays } = await import(${JSON.stringify(`file://${path.join(REPO, 'index.js')}`)});
    const start = new Date(2026, 2, 7, 12, 0, 0); // 2026-03-07 12:00 本地
    const keys = [0, 1, 2].map((i) => localDayKey(addLocalDays(start, i)));
    console.log(JSON.stringify(keys));
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'America/New_York' },
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout.trim()), ['2026-03-07', '2026-03-08', '2026-03-09'])
})
