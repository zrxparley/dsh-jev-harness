/**
 * 看板空态与首帧（issue #15）。
 *
 * 验收原文：
 * - 0 调用时首屏出现三选一卡片之一，不出现「24 根空柱 + 网格」
 * - 有历史但无新调用时，首行是「最近一次调用 · HH:mm（N 分钟前）」
 * - 全库 grep 不到那句已废弃的空态文案（见文件末尾用例）
 * - 首帧不再显示 `0 次 / 0 tokens`，而是骨架
 * - 24h↔7d 来回切换不出现凭空新增
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyClient, findSlot, loadClient, render, requireReactOrSkip, visibleText,
} from './helpers/client.js'
import {
  REPO, boot, callRoute, makeHome, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const { pkgs: reactPkgs, skip } = requireReactOrSkip()

function bootView() {
  const loaded = loadClient(reactPkgs)
  const { registrations } = applyClient(loaded)
  const main = findSlot(registrations, 'main')
  assert.ok(main, 'main slot 未注册')
  const view = loaded.exports.__test.TrafficBoardView
  assert.equal(typeof view, 'function')
  return { view, api: loaded.exports.__test }
}

const zeroPayload = (state) => ({
  ok: true,
  state,
  grain: 'hour',
  windowHours: 24,
  peak: 0,
  buckets: [],
  totals: {
    jev: { calls: 0, ok: 0, fail: 0, tokens: 0, avgMs: 0 },
    kimi: { calls: 0, ok: 0, fail: 0, tokens: 0, avgMs: 0 },
    dsf: { calls: 0, ok: 0, fail: 0, tokens: 0, avgMs: 0 },
  },
  today: { jev: { calls: 0, tokens: 0 }, kimi: { calls: 0, tokens: 0 }, dsf: { calls: 0, tokens: 0 } },
  recent: [],
})

test('首帧是骨架：不显示 0 次 / 0 tokens', { skip }, () => {
  const { view } = bootView()
  const text = visibleText(render(reactPkgs, view, { data: null, hours: 24, error: '', onRange: () => {}, onRefresh: () => {} }))
  assert.ok(text.includes('正在读取统计'), '首帧应是骨架，不是数字')
  assert.ok(!text.includes('0 次'), '首帧不许出现 0 次')
  assert.ok(!text.includes('0 tokens'), '首帧不许出现 0 tokens')
})

test('错误态也是骨架：data 没回来就不许渲染数字', { skip }, () => {
  const { view } = bootView()
  const text = visibleText(render(reactPkgs, view, { data: null, hours: 24, error: 'HTTP 500', onRange: () => {}, onRefresh: () => {} }))
  assert.ok(text.includes('正在读取统计'), '错误态也要先给骨架')
  assert.ok(text.includes('统计读取失败：HTTP 500'), '错误原因要单独可见')
  assert.ok(!text.includes('0 次'), '错误态不许出现假的 0 次')
  assert.ok(!text.includes('0 tokens'), '错误态不许出现假的 0 tokens')
})

test('24h↔7d 切窗：baseline 取新窗口，delta 恒为 0，不出现凭空新增', { skip }, () => {
  const { api } = bootView()
  const payload = (calls) => ({
    totals: {
      jev: { calls: 0 }, kimi: { calls: 0 }, dsf: { calls },
    },
    recent: [],
  })
  // 24h 41 → 切 7d（还没数据）→ 7d 300 → 切回 24h（还没数据）→ 24h 41
  const day = api.trafficWindowState({ hours: 24, baseline: null }, 24, payload(41))
  assert.equal(day.data !== null, true)
  assert.equal(day.baseline, 41)
  assert.equal(day.delta, 0)

  const switchingOut = api.trafficWindowState(day, 168, null)
  assert.equal(switchingOut.data, null, '切换瞬间必须回到骨架')
  assert.equal(switchingOut.baseline, null)

  const week = api.trafficWindowState(switchingOut, 168, payload(300))
  assert.equal(week.baseline, 300, 'baseline 必须取新窗口的总量')
  assert.equal(week.delta, 0, '换窗口不许冒出「打开后新增」')

  const switchingBack = api.trafficWindowState(week, 24, null)
  assert.equal(switchingBack.baseline, null)
  const back = api.trafficWindowState(switchingBack, 24, payload(41))
  assert.equal(back.baseline, 41)
  assert.equal(back.delta, 0)

  for (const state of [day, week, back]) {
    const line = api.liveLine({ data: state.data, rows: [], updatedAt: Date.now(), polls: 1, baseline: state.baseline })
    assert.equal(line.includes('打开后新增'), false, `不该出现凭空新增：${line}`)
  }
})

test('0 调用：off / setup / ready 三选一卡片，文案逐字', { skip }, () => {
  const { view } = bootView()
  const cases = [
    ['off', 'JEV 已让位', '现在的请求由 DSH 模型处理，不会记在这里。打开 JEV 后，经过它的请求才会出现在这里。', '打开 JEV'],
    ['setup', '请求还没有发出去', 'Kimi 或 Flash 的接口地址还没填完整。请先填写；未发出的尝试会记为「未发出」。', '去填写网关'],
    ['ready', '还没有调用记录', '开关已打开。第一条经过 JEV 的请求会出现在这里；如果未发出或没有回答，也会明确标记。', '测试连通'],
  ]
  for (const [state, title, body, action] of cases) {
    const text = visibleText(render(reactPkgs, view, { data: zeroPayload(state), hours: 24, error: '', onRange: () => {}, onRefresh: () => {} }))
    assert.ok(text.includes(title), `${state} 缺少标题「${title}」`)
    assert.ok(text.includes(body), `${state} 正文不一致`)
    assert.ok(text.includes(action), `${state} 缺少主按钮「${action}」`)
    assert.ok(!text.includes('0 次'), `${state} 空态卡不许出现 0 次`)
    assert.ok(!text.includes('<svg'), '空态不该画图表')
  }
})

test('有历史无新调用：锚点行「最近一次调用 · HH:mm（N 分钟前）」', { skip }, () => {
  const { api } = bootView()
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString()
  const line = api.lastCallLine({ recent: [{ t: fiveMinutesAgo, g: 'dsf', tool: 'call', ok: true }] })
  assert.match(line, /^最近一次调用 · \d{2}:\d{2}（5 分钟前）$/)
  assert.equal(api.lastCallLine({ recent: [] }), '')

  const live = api.liveLine({
    data: { totals: { jev: { calls: 1 }, kimi: { calls: 0 }, dsf: { calls: 0 } }, recent: [{ t: fiveMinutesAgo }] },
    rows: [],
    updatedAt: Date.now(),
    polls: 2,
    baseline: 1,
  })
  assert.ok(live.includes('最近一次调用 · '), `liveLine 应带锚点行：${live}`)
})

test('已废弃的空态文案从仓库消失', () => {
  // 拼出旧文案，避免让这条用例自身成为全库 grep 的命中项。
  const retired = `打开后${'暂无新调用'}`
  const files = ['lib/client.js', 'index.js', 'client.js']
  for (const file of files) {
    const full = path.join(REPO, file)
    if (!fs.existsSync(full)) continue
    assert.equal(fs.readFileSync(full, 'utf8').includes(retired), false, `${file} 仍含旧文案`)
  }
})

test('看板显示「无回答 N」，成功率不再把空正文算成功', { skip }, () => {
  const { view } = bootView()
  const payload = {
    ok: true,
    state: 'ready',
    grain: 'hour',
    windowHours: 24,
    peak: 1,
    buckets: [{ key: 'k', label: '10:00', day: '1/1', gateways: { jev: { calls: 0, tokens: 0, fail: 0 }, kimi: { calls: 3, tokens: 0, fail: 1 }, dsf: { calls: 0, tokens: 0, fail: 0 } } }],
    totals: {
      jev: { calls: 0, ok: 0, fail: 0, tokens: 0, avgMs: 0 },
      kimi: { calls: 3, ok: 3, fail: 0, tokens: 30, avgMs: 100, unanswered: 1, answered: 2, notSent: 0, probeCalls: 0 },
      dsf: { calls: 0, ok: 0, fail: 0, tokens: 0, avgMs: 0 },
    },
    today: { jev: { calls: 0, tokens: 0 }, kimi: { calls: 0, tokens: 0 }, dsf: { calls: 0, tokens: 0 } },
    recent: [
      { t: new Date().toISOString(), g: 'kimi', tool: 'call', ok: true, kind: 'no-answer', sent: true, answered: false, ms: 100, pt: 10, ct: 0 },
      { t: new Date().toISOString(), g: 'kimi', tool: 'call', ok: false, kind: 'not-sent', sent: false, answered: false, ms: 0, pt: 0, ct: 0 },
    ],
  }
  const text = visibleText(render(reactPkgs, view, { data: payload, hours: 24, error: '', onRange: () => {}, onRefresh: () => {} }))
  assert.ok(text.includes('无回答 1'), `看板必须显示「无回答 1」：${text.slice(0, 160)}`)
  assert.ok(text.includes('成功率 67%'), '3 次里 1 次空正文 → 成功率应 2/3=67%，不是 100%')
  assert.ok(!text.includes('成功率 100%'))
  assert.ok(text.includes('无回答') && text.includes('未发出'), '最近调用表要能看出「无回答 / 未发出」')
})

test('/stats 带 state，供空态卡分流', async () => {
  const home = makeHome('traffic-state')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const status = (await callRoute(routes, '/api/jev-harness/status', { url: '/api/jev-harness/status' })).body
    const stats = (await callRoute(routes, '/api/jev-harness/stats', { url: '/api/jev-harness/stats?hours=24' })).body
    assert.equal(stats.state, status.state)
    assert.equal(stats.state, 'ready')
  } finally {
    stub.restore()
    removeHome(home)
  }
})
