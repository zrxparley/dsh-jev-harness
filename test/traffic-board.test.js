/**
 * 流量看板渲染（对应旧的临时脚本 render-traffic.cjs）。
 *
 * TrafficBoardView 是纯视图：给它一份 /stats 形状的数据就能渲染。
 * 这里分别喂 24 小时（hour 粒度）和 7 天（day 粒度）两份数据，
 * 断言图表真的画出了柱子和图例，而不是空壳。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClient, findSlot, loadClient, render, requireReactOrSkip, visibleText,
} from './helpers/client.js'
import { readFixture } from './helpers/harness.js'

const { pkgs: reactPkgs, skip } = requireReactOrSkip()
const fixture = readFixture('traffic-stats.json')

const pad = (n) => String(n).padStart(2, '0')

/** 按 /stats 的返回形状造时间桶：hour 粒度看小时，day 粒度看日。 */
function buildPayload(spec, hours) {
  const dayGrain = hours > 48
  const buckets = []
  if (dayGrain) {
    const days = Math.max(1, Math.ceil(hours / 24))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = days - 1; i >= 0; i--) {
      const at = new Date(today.getTime() - i * 86400000)
      const label = `${pad(at.getMonth() + 1)}/${pad(at.getDate())}`
      buckets.push({
        key: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
        label,
        day: label,
        gateways: {
          jev: { calls: i % 4, tokens: i * 20, fail: 0 },
          kimi: { calls: i % 3, tokens: i * 120, fail: 0 },
          dsf: { calls: (i * 2) % 6, tokens: i * 260, fail: i === 0 ? 1 : 0 },
        },
      })
    }
  } else {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    for (let i = hours - 1; i >= 0; i--) {
      const at = new Date(now.getTime() - i * 3600000)
      buckets.push({
        key: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}`,
        label: `${pad(at.getHours())}:00`,
        day: `${pad(at.getMonth() + 1)}/${pad(at.getDate())}`,
        gateways: {
          jev: { calls: (i * 3) % 7, tokens: i * 20, fail: 0 },
          kimi: { calls: (i * 2) % 5, tokens: i * 120, fail: i === 5 ? 1 : 0 },
          dsf: { calls: (i * 5) % 9, tokens: i * 260, fail: 0 },
        },
      })
    }
  }
  return {
    ok: true,
    grain: dayGrain ? 'day' : 'hour',
    windowHours: hours,
    peak: spec.peak,
    buckets,
    totals: spec.totals,
    today: spec.today,
    recent: spec.recent,
  }
}

function bootView() {
  const loaded = loadClient(reactPkgs)
  const { registrations } = applyClient(loaded)
  const main = findSlot(registrations, 'main')
  assert.ok(main, 'main slot 未注册，无法取到内部视图')
  const view = loaded.exports.__test && loaded.exports.__test.TrafficBoardView
  assert.equal(typeof view, 'function', 'client 没有导出 TrafficBoardView 测试缝')
  return view
}

test('近 24 小时：三个网关的柱状图与图例都画出来了', { skip }, () => {
  const TrafficBoardView = bootView()
  const data = buildPayload(fixture.hour, 24)
  const html = render(reactPkgs, TrafficBoardView, { data, hours: 24, error: '', onRange: () => {} })
  const text = visibleText(html)

  const mustContain = [
    '流量看板', '近 24 小时', '近 7 天', '立即刷新',
    'JEV 判定', 'Kimi 决策', 'DSF 执行',
    '41 次', '27 次', '53 次',
    '成功率 96%',
    '今天', '统计口径', 'FAIL', 'OK',
  ]
  const missing = mustContain.filter((needle) => !text.includes(needle))
  assert.deepEqual(missing, [], `流量看板缺少：${missing.join(' / ')}`)

  // 图例带总数，证明它读的是 totals 不是 buckets
  assert.ok(text.includes('JEV 判定（41）'), '图例总数不对')
  assert.ok(text.includes('Kimi 决策（27）'), '图例总数不对')
  assert.ok(text.includes('DSF 执行（53）'), '图例总数不对')

  const svgCount = (html.match(/<svg/g) || []).length
  const rectCount = (html.match(/<rect/g) || []).length
  assert.ok(svgCount >= 1, '没有 svg 图表')
  assert.ok(rectCount > 10, `柱子太少：${rectCount}`)
  assert.ok(html.includes('viewBox="0 0 720 176"'), '图表画布尺寸变了')
})

test('近 7 天：日粒度同样画出柱子', { skip }, () => {
  const TrafficBoardView = bootView()
  const data = buildPayload(fixture.day, 168)
  const html = render(reactPkgs, TrafficBoardView, { data, hours: 168, error: '', onRange: () => {} })
  const text = visibleText(html)

  assert.equal(data.grain, 'day')
  assert.equal(data.buckets.length, 7)
  assert.ok(text.includes('流量看板'))
  assert.ok(text.includes('近 7 天'))
  assert.ok(html.length > 1000, `7 天视图太短：${html.length}`)
  const rectCount = (html.match(/<rect/g) || []).length
  assert.ok(rectCount > 0, '7 天视图没有柱子')
})

test('读取失败时把错误显示出来，不装作有数据', { skip }, () => {
  const TrafficBoardView = bootView()
  const html = render(reactPkgs, TrafficBoardView, { data: null, hours: 24, error: 'HTTP 500', onRange: () => {} })
  const text = visibleText(html)
  assert.ok(text.includes('统计读取失败：HTTP 500'), '错误没有显示给用户')
  assert.ok(text.includes('正在读取统计'), 'data 没回来时应是骨架')
  assert.ok(!text.includes('0 次'), '错误态不许渲染假的 0 次')
})

test('#4: judge 行显示 confidence 与来源', { skip }, () => {
  const TrafficBoardView = bootView()
  const data = buildPayload({
    ...fixture.hour,
    recent: [
      { t: new Date().toISOString(), g: 'jev', m: 'jev-1', tool: 'judge', ok: true, sent: true, answered: true, kind: 'ok', status: 200, ms: 120, pt: 5, ct: 1, choice: 'execution', confidence: 0.88, source: 'jev' },
      { t: new Date().toISOString(), g: 'dsf', m: 'deepseek', tool: 'call', ok: true, sent: true, answered: true, kind: 'ok', status: 200, ms: 800, pt: 100, ct: 40 },
    ],
  }, 24)
  const html = render(reactPkgs, TrafficBoardView, { data, hours: 24, error: '', onRange: () => {} })
  const text = visibleText(html)
  assert.ok(text.includes('judge'), 'judge 行应出现')
  assert.ok(text.includes('0.88'), `judge 行应显示 confidence 0.88，实际：${text.slice(0, 200)}`)
  assert.ok(text.includes('jev'), 'judge 行应显示来源 jev')
})
