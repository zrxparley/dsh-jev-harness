/**
 * #34 补测：用量与时间层（T01–T06、T08、T11）。
 *
 * 这些用例补的是 Prototyper 对账表里点名的缺口，**不改任何行为**：
 *   T01/T02  「今天」用本地日键、跨年不串桶 —— 用测试时钟冻结 `Date`，
 *            这样不必给生产代码加注入口（#34 的 createHarness({now}) 尚未做）；
 *   T03      DST 当天 7 个日桶仍是 7 个不同本地日（子进程固定 TZ 跑真实函数）；
 *   T04      47/48/49/168 的 grain 与 buckets.length 边界；
 *   T05      168 小时视图首行（最早那天）真的有调用；
 *   T06      裁剪：60 小时键 → 48、40 日键 → 30、60 recent → 40；
 *   T08      NUL 填充 4KB 的半写账本 → warning + 隔离 + 重记从 1 起算；
 *   T11      事故 4 回归：recent[0].ms 是 number、note 不含 "is not defined"。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  REPO, boot, callRoute, chatResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const pad = (n) => String(n).padStart(2, '0')
const usageFile = (home) => path.join(home, 'jev-harness-usage.json')
const chatStub = (url) => (String(url).includes('/chat/completions') ? chatResponse('完成') : undefined)

/**
 * 冻结时钟：只影响测试进程里的 `Date`，生产代码一行不动。
 * getNow 可以是固定字符串，也可以是返回字符串的函数（跨年用例要换点）。
 */
function freezeClock(getNow) {
  const RealDate = globalThis.Date
  const resolve = typeof getNow === 'function' ? getNow : () => getNow
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.parse(resolve()))
      else super(...args)
    }
    static now() { return RealDate.parse(resolve()) }
  }
  globalThis.Date = FrozenDate
  return () => { globalThis.Date = RealDate }
}

const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const localHour = (date) => `${localDay(date)}T${pad(date.getHours())}`

test('#34 T01: 注入 now 后记 1 次 dsf，「今天」用同一套本地日键', async () => {
  const home = makeHome('spec-t01')
  writeStore(home)
  const restore = freezeClock('2026-12-31T23:30:00') // 本地时间，年尾最后一个半小时
  const stub = stubFetch(chatStub)
  try {
    const { tools, routes } = await boot({ home })
    await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.today.dsf.calls, 1, 'today 必须数到这一次调用')

    const usage = readJsonFile(usageFile(home))
    const dayKey = localDay(new Date()) // 同一台冻结时钟
    assert.equal(dayKey, '2026-12-31')
    assert.ok(usage.days[dayKey], `日桶键必须是 ${dayKey}，实际 ${Object.keys(usage.days).join(',')}`)
    assert.ok(usage.hours[`${dayKey}T23`], '小时桶键与日桶键同源（同一个本地日 + 23 点）')
    assert.equal(usage.days[dayKey].dsf.calls, 1)
  } finally {
    stub.restore(); restore(); removeHome(home)
  }
})

test('#34 T02: 跨年两条调用不串桶——12-31 的 1 次不归到 01-01', async () => {
  const home = makeHome('spec-t02')
  writeStore(home)
  let nowIso = '2026-12-31T23:30:00'
  const restore = freezeClock(() => nowIso)
  const stub = stubFetch(chatStub)
  try {
    const { tools, routes } = await boot({ home })
    await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    nowIso = '2027-01-01T00:30:00'
    await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})

    const usage = readJsonFile(usageFile(home))
    assert.equal(usage.days['2026-12-31'].dsf.calls, 1, '12-31 自己一格')
    assert.equal(usage.days['2027-01-01'].dsf.calls, 1, '01-01 自己一格')

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.today.dsf.calls, 1, '「今天」只能是 01-01 那一次，31 号的不许归进来')

    // 24 小时窗口跨了午夜：两个桶的 day 标签必须不同。
    const nonEmpty = stats.buckets.filter((b) => b.gateways.dsf.calls > 0)
    assert.equal(nonEmpty.length, 2, `跨午夜应有两个桶有调用，实际 ${nonEmpty.length}`)
    assert.notEqual(nonEmpty[0].day, nonEmpty[1].day, '两个桶属于不同本地日')
    assert.deepEqual(nonEmpty.map((b) => b.day).sort(), ['01/01', '12/31'])
  } finally {
    stub.restore(); restore(); removeHome(home)
  }
})

test('#34 T03: DST 当天，7 个日桶仍是 7 个不同本地日', () => {
  // 子进程固定 TZ，直接跑 usageReport 用的那两个函数（localDayKey / addLocalDays）。
  const script = `
    const { localDayKey, addLocalDays } = await import(${JSON.stringify(`file://${path.join(REPO, 'index.js')}`)});
    const today = new Date(2027, 2, 15, 12, 0, 0); // 2027-03-15，DST 已于 03-14 生效
    today.setHours(0, 0, 0, 0);
    const keys = Array.from({ length: 7 }, (_, i) => localDayKey(addLocalDays(today, -(6 - i))));
    console.log(JSON.stringify(keys));
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'America/New_York' },
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  const keys = JSON.parse(run.stdout.trim())
  assert.equal(keys.length, 7)
  assert.equal(new Set(keys).size, 7, `DST 期间不许重复/跳过某天：${keys.join(',')}`)
  assert.deepEqual(keys, [
    '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12', '2027-03-13', '2027-03-14', '2027-03-15',
  ])
  assert.ok(keys.includes('2027-03-14'), 'DST 切换日本身必须在窗口里')
})

test('#34 T04: grain 边界 47/48/49/168', async () => {
  const home = makeHome('spec-t04')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const read = async (hours) => (await callRoute(routes, STATS, { url: `${STATS}?hours=${hours}` })).body
    for (const [hours, grain, length] of [[47, 'hour', 47], [48, 'hour', 48], [49, 'day', 3], [168, 'day', 7]]) {
      const report = await read(hours)
      assert.equal(report.windowHours, hours)
      assert.equal(report.grain, grain, `hours=${hours} 的 grain 应为 ${grain}`)
      assert.equal(report.buckets.length, length, `hours=${hours} 的桶数应为 ${length}`)
    }
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T05: 168 小时视图首行（最早那天）真的有调用', async () => {
  const home = makeHome('spec-t05')
  writeStore(home)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const sixAgo = new Date(today)
  sixAgo.setDate(sixAgo.getDate() - 6)
  const bucket = (calls) => ({
    dsf: { calls, ok: calls, fail: 0, promptTokens: 10, completionTokens: 5, ms: 100, probeCalls: 0, probeMs: 0, answered: calls, unanswered: 0, notSent: 0 },
  })
  const ledger = { version: 1, hours: {}, days: {}, recent: [], decisions: [] }
  ledger.days[localDay(sixAgo)] = bucket(3)
  ledger.days[localDay(today)] = bucket(2)
  fs.writeFileSync(usageFile(home), JSON.stringify(ledger))
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const report = (await callRoute(routes, STATS, { url: `${STATS}?hours=168` })).body
    assert.equal(report.grain, 'day')
    assert.equal(report.buckets.length, 7)
    assert.equal(report.buckets[0].gateways.dsf.calls, 3, '首行（6 天前）必须有调用，不能是空壳')
    assert.equal(report.buckets[6].gateways.dsf.calls, 2, '末行（今天）也要有调用')
    assert.equal(report.totals.dsf.calls, 5)
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T06: 裁剪 60 小时键→48、40 日键→30、60 recent→40', async () => {
  const home = makeHome('spec-t06')
  writeStore(home)
  const ledger = { version: 1, hours: {}, days: {}, recent: [], decisions: [] }
  const base = new Date(2027, 0, 1, 0, 0, 0)
  for (let i = 0; i < 60; i++) {
    const at = new Date(base)
    at.setHours(at.getHours() + i)
    ledger.hours[localHour(at)] = { dsf: { calls: 1, ok: 1, fail: 0 } }
  }
  for (let i = 0; i < 40; i++) {
    const at = new Date(base)
    at.setDate(at.getDate() + i)
    ledger.days[localDay(at)] = { dsf: { calls: 1, ok: 1, fail: 0 } }
  }
  for (let i = 0; i < 60; i++) ledger.recent.push({ t: new Date(base.getTime() + i * 1000).toISOString(), g: 'dsf', tool: 'call', ok: true })
  fs.writeFileSync(usageFile(home), JSON.stringify(ledger))

  const stub = stubFetch(chatStub)
  try {
    const { tools } = await boot({ home })
    // 任意一次记账都会触发 trimUsage。
    await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    const usage = readJsonFile(usageFile(home))
    assert.equal(Object.keys(usage.hours).length, 48, '小时桶上限 48')
    assert.equal(Object.keys(usage.days).length, 30, '日桶上限 30')
    assert.equal(usage.recent.length, 40, 'recent 环上限 40')
    // 留下的是最新的键（旧的先被淘汰）。
    const hourKeys = Object.keys(usage.hours).sort()
    assert.ok(!hourKeys.includes(localHour(base)), '最旧的小时桶应被淘汰')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T08: NUL 填充 4KB 的半写账本 → warning + 隔离 + 重记从 1 起算', async () => {
  const home = makeHome('spec-t08')
  writeStore(home)
  fs.writeFileSync(usageFile(home), Buffer.alloc(4096, 0))
  const stub = stubFetch(chatStub)
  try {
    const { tools, routes } = await boot({ home })
    const first = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.ok(first.warning, 'NUL 半写必须给出 warning，不能静默当空账本')
    assert.equal(first.warning.code, 'usage-ledger-corrupt')
    const backups = fs.readdirSync(home).filter((f) => f.includes('.corrupt-'))
    assert.equal(backups.length, 1, `坏账本应被隔离成 *.corrupt-<ts>，实际 ${backups.join(',')}`)

    await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    const second = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(second.totals.dsf.calls, 1, '重记后从 1 起算')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T11: 事故 4 回归——recent[0].ms 是 number，note 不含 is not defined', async () => {
  const home = makeHome('spec-t11')
  writeStore(home)
  const stub = stubFetch(chatStub)
  try {
    const { tools, routes } = await boot({ home })
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    assert.equal(out.ok, true)
    assert.ok(!String(out.note).includes('is not defined'), `note 里出现未定义变量：${out.note}`)
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(typeof stats.recent[0].ms, 'number', 'recent[0].ms 必须是 number')
    assert.ok(Number.isFinite(stats.recent[0].ms), 'ms 不许是 NaN')
    assert.equal(stats.recent[0].tool, 'call')
  } finally {
    stub.restore(); removeHome(home)
  }
})