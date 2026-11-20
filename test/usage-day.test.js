/**
 * 7 天视图必须读日汇总（对应旧的临时脚本 test-usage-7d.mjs）。
 *
 * 这条锁的是 v1.6.0 的真实事故：小时桶只保留 48 小时，
 * 但 /stats?hours=168 当时仍读小时桶，于是「近 7 天」图全是 0。
 * 这里故意只给今天留小时明细，剩下 4 天只有日汇总。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, callRoute, makeHome, removeHome, stubFetch, writeJsonFile, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const pad = (n) => String(n).padStart(2, '0')
const dayKey = (offset) => {
  const at = new Date()
  at.setHours(12, 0, 0, 0)
  at.setDate(at.getDate() - offset)
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}
const hourKey = () => {
  const at = new Date()
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}`
}
const bucket = (calls, promptTokens, completionTokens, ms) => ({
  calls, ok: calls, fail: 0, promptTokens, completionTokens, ms,
})

test('hours=168 走日汇总，hours=24 走小时桶', async () => {
  const home = makeHome('usage-day')
  writeStore(home)

  const days = {}
  for (let offset = 0; offset < 5; offset += 1) {
    days[dayKey(offset)] = {
      kimi: bucket(2, 100, 50, 4000),
      dsf: bucket(3, 200, 100, 1500),
      jev: bucket(1, 5, 1, 300),
    }
  }
  const hours = { [hourKey()]: { dsf: bucket(1, 30, 10, 900) } }
  const ledgerFile = writeJsonFile(path.join(home, 'jev-harness-usage.json'), { version: 1, hours, days, recent: [], decisions: [] })

  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })

    const week = (await callRoute(routes, STATS, { url: `${STATS}?hours=168` })).body
    assert.equal(week.ok, true)
    assert.equal(week.grain, 'day', '168 小时必须按日粒度出图')
    assert.equal(week.buckets.length, 7, '7 天视图应有 7 个日桶')

    // 4 天的数据只存在于 days 里；小时桶里根本没有它们 —— 读到数就证明读的是日汇总
    assert.equal(week.totals.kimi.calls, 10)
    assert.equal(week.totals.dsf.calls, 15)
    assert.equal(week.totals.jev.calls, 5)
    assert.equal(week.totals.kimi.tokens, 750)
    assert.equal(week.totals.dsf.tokens, 1500)
    assert.ok(
      week.buckets.filter((row) => row.gateways.dsf.calls > 0).length >= 5,
      '至少 5 个日桶应有执行层调用',
    )

    // 桶从旧到新，最后一桶是今天
    const labels = week.buckets.map((row) => row.label)
    const today = dayKey(0)
    assert.equal(week.buckets[week.buckets.length - 1].key, today)
    assert.equal(labels[labels.length - 1], `${pad(new Date().getMonth() + 1)}/${pad(new Date().getDate())}`)

    // 24 小时窗口仍读小时桶：只有今天这一笔执行层调用，没有日汇总里的历史
    const day = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(day.grain, 'hour')
    assert.equal(day.buckets.length, 24)
    assert.equal(day.totals.dsf.calls, 1)
    assert.equal(day.totals.kimi.calls, 0, '小时窗口不该把日汇总里的历史算进来')
    assert.equal(day.totals.dsf.tokens, 40)

    // 两个窗口读同一份账本，文件没被测试过程改动
    assert.equal(JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).version, 1)

    // 纯读接口：一次网络请求都不该发
    assert.deepEqual(stub.urls(), [], `读统计不该发网络请求：${stub.urls().join(', ')}`)
  } finally {
    stub.restore()
    removeHome(home)
  }
})