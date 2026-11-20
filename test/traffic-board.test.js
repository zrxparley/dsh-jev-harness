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
  assert.ok(text.includes('判定'), 'judge 行应显示为「判定」（#18 中文化）')
  assert.ok(text.includes('0.88'), `judge 行应显示 confidence 0.88，实际：${text.slice(0, 200)}`)
  assert.ok(text.includes('JEV 判定'), 'judge 行应显示来源「JEV 判定」')
})

test('#41: 判定质量区块显示四指标 + 准确率 + 会话筛选', { skip }, () => {
  const TrafficBoardView = bootView()
  const data = buildPayload({
    ...fixture.hour,
    recent: [
      { t: new Date().toISOString(), g: 'jev', tool: 'judge', ok: true, kind: 'ok', ms: 120, session: 'sess-A', choice: 'execution', confidence: 0.9, source: 'jev' },
      { t: new Date().toISOString(), g: 'dsf', tool: 'call', ok: true, kind: 'ok', ms: 800, session: 'sess-A' },
    ],
  }, 24)
  data.judgeQuality = { judgedCount: 5, heuristicShare: 0.2, lowConfidenceShare: 0.1, tierDistribution: { decision: 2, execution: 3 }, avgJudgeMs: 130, judgeToExecutionMsRatio: 0.16 }
  data.judgeAccuracy = { tierAccuracy: 0.85, skillAccuracy: 0.7, cases: 20, criteriaVersion: '1.1.0', at: '2026-11-19T22:00:00.000Z' }
  const html = render(reactPkgs, TrafficBoardView, { data, hours: 24, error: '', onRange: () => {}, sessionFilter: '', onSessionChange: () => {} })
  const text = visibleText(html)
  assert.ok(text.includes('判定质量'), '判定质量区块标题')
  assert.ok(text.includes('判定次数'), '判定次数卡')
  assert.ok(text.includes('启发式占比'), '启发式占比卡')
  assert.ok(text.includes('低置信占比'), '低置信占比卡')
  assert.ok(text.includes('平均判定耗时'), '平均判定耗时卡')
  assert.ok(text.includes('金标准准确率'), '准确率行')
  assert.ok(text.includes('85%'), 'tier 准确率 85%')
  assert.ok(text.includes('全机（所有会话）'), '默认全机选项')
})

test('#41: unknown 会话标注为「未知会话」，绝不写成「本会话」', { skip }, () => {
  const TrafficBoardView = bootView()
  const data = buildPayload({
    ...fixture.hour,
    recent: [
      { t: new Date().toISOString(), g: 'jev', tool: 'judge', ok: true, kind: 'ok', ms: 120, session: 'unknown', choice: 'execution', confidence: 0.9, source: 'heuristic' },
    ],
  }, 24)
  data.judgeQuality = { judgedCount: 1, heuristicShare: 1, lowConfidenceShare: 0, tierDistribution: { decision: 0, execution: 1 }, avgJudgeMs: 100, judgeToExecutionMsRatio: null }
  const html = render(reactPkgs, TrafficBoardView, { data, hours: 24, error: '', onRange: () => {}, sessionFilter: '', onSessionChange: () => {} })
  const text = visibleText(html)
  assert.ok(text.includes('未知会话'), 'unknown 应标注为「未知会话」')
  assert.ok(!text.includes('本会话'), '绝不能把 unknown 写成「本会话」')
})

/* ---------- #18 三个图表细节：左侧刻度 / 午夜竖虚线+日期 / 「现在」标记 ---------- */

function bootExports() {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const seam = loaded.exports.__test
  assert.ok(seam, 'client 没有导出 __test 测试缝')
  return seam
}

/** 24 个柱子的合成行：前 12 个 11/18，后 12 个 11/19（跨一次午夜）。 */
function chartRows() {
  const rows = []
  for (let i = 0; i < 24; i++) {
    rows.push({
      label: `${pad(i)}:00`,
      sub: i < 12 ? '11/18' : '11/19',
      gateways: {
        jev: { calls: 13, tokens: 10, fail: 0 },
        kimi: { calls: 0, tokens: 0, fail: 0 },
        dsf: { calls: 2, tokens: 5, fail: 0 },
      },
    })
  }
  return rows
}

test('#18: 柱状图补左侧刻度，读数不再靠猜归一化', { skip }, () => {
  const { TrafficChart } = bootExports()
  const html = render(reactPkgs, TrafficChart, { rows: chartRows() })
  const text = visibleText(html)

  // peak=13 → nice 上限 20；刻度应为 0/5/10/15/20，而不是把 13 顶到满格还说不出数字。
  for (const tick of ['0', '5', '10', '15', '20']) {
    assert.ok(text.includes(tick), `左侧刻度缺少 ${tick}：${text.slice(0, 200)}`)
  }
  // 刻度文字是贴左轴、右对齐的（text-anchor=end），不是横轴标签。
  const endAnchored = (html.match(/text-anchor="end"/g) || []).length
  assert.ok(endAnchored >= 5, `右对齐的刻度标签太少：${endAnchored}`)
  // 纵轴：一条贴左侧刻度区（x=34）的实线，横轴基线也在。
  assert.ok(/x1="34"[^>]*x2="34"/.test(html), '缺少纵轴')
  assert.ok(/y1="158"[^>]*y2="158"/.test(html), '缺少横轴基线')
})

test('#18: 峰值只有 1 时柱子不再顶满全图（刻度下限 2）', { skip }, () => {
  const { TrafficChart } = bootExports()
  const rows = []
  for (let i = 0; i < 24; i++) {
    rows.push({
      label: `${pad(i)}:00`,
      sub: i < 12 ? '11/18' : '11/19',
      gateways: {
        jev: { calls: i === 5 ? 1 : 0, tokens: 0, fail: 0 },
        kimi: { calls: 0, tokens: 0, fail: 0 },
        dsf: { calls: 0, tokens: 0, fail: 0 },
      },
    })
  }
  const html = render(reactPkgs, TrafficChart, { rows })
  const text = visibleText(html)
  // 刻度 0/1/2：读者能看出最多只有 1 次，而不是以为「满格 = 很多次」。
  assert.ok(text.includes('2') && text.includes('1') && text.includes('0'), `刻度应含 0/1/2：${text.slice(0, 160)}`)
  const heights = [...html.matchAll(/<rect[^>]*height="([^"]+)"/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 2)
  assert.ok(heights.length > 0, '应有一根可见的柱子')
  // plotHeight = 148，刻度上限 2 → 1 次调用 = 74 高，恰好半格。
  assert.ok(Math.max(...heights) <= 75, `峰值 1 的柱高应 ≤ 半格（75），实际 ${Math.max(...heights)}`)
})

test('#18: 24h 跨午夜处有竖虚线 + 日期，最右有「现在」标记', { skip }, () => {
  const { TrafficChart } = bootExports()
  const html = render(reactPkgs, TrafficChart, { rows: chartRows() })
  const text = visibleText(html)

  // 午夜：行 12 从 11/18 切到 11/19，必须画竖虚线并把日期写出来（bucket.day 不再闲置）。
  assert.ok(text.includes('11/19'), '午夜边界应写日期 11/19')
  const dashed = [...html.matchAll(/<line[^>]*stroke-dasharray="[^"]*"[^>]*>/g)].map((m) => m[0])
  assert.ok(dashed.length >= 2, `竖虚线至少 2 条（午夜 + 现在），实际 ${dashed.length}`)
  for (const line of dashed) {
    const x1 = /x1="([^"]+)"/.exec(line)
    const x2 = /x2="([^"]+)"/.exec(line)
    assert.equal(x1[1], x2[1], `虚线必须是竖的：${line}`)
  }
  // 「现在」：文字 + 一条贴右边界（x=720-26=694）的竖线。
  assert.ok(text.includes('现在'), '图表缺少「现在」标记')
  assert.ok(/x1="694"[^>]*x2="694"/.test(html), '「现在」竖线没有贴在最右边界')
})

test('#18: 稀疏时间线右端也标「现在」', { skip }, () => {
  const { TrafficTimeline } = bootExports()
  const data = {
    recent: [
      { t: new Date().toISOString(), g: 'jev', tool: 'judge', ok: true, kind: 'ok' },
      { t: new Date().toISOString(), g: 'dsf', tool: 'call', ok: false, kind: 'fail', error: 'boom' },
    ],
  }
  const html = render(reactPkgs, TrafficTimeline, { data })
  const text = visibleText(html)
  assert.ok(text.includes('调用时间线'), '时间线说明行')
  assert.ok(text.includes('现在'), '时间线右端缺少「现在」标记')
  const circles = (html.match(/<circle/g) || []).length
  assert.equal(circles, 2, `每个调用一个点，实际 ${circles}`)
})

/* ---------- #41 后续：会话下拉改用 /stats.sessions 全量聚合 ---------- */

test('#41: 会话下拉读 /stats.sessions，不再只列 recent 40 条里的会话', { skip }, () => {
  const TrafficBoardView = bootView()
  const data = buildPayload({ ...fixture.hour }, 24)
  // recent 环形里只有 s-new；s-old 已经滑出 40 条，但账本里还有 60 条决策。
  data.recent = [{ t: new Date().toISOString(), g: 'jev', tool: 'judge', ok: true, kind: 'ok', ms: 100, session: 's-new' }]
  data.sessions = [
    { id: 's-new', decisions: 3, recent: 1, total: 4, lastAt: '2026-11-19T22:00:00.000Z' },
    { id: 's-old', decisions: 60, recent: 0, total: 60, lastAt: '2026-11-18T09:00:00.000Z' },
    { id: 'unknown', decisions: 2, recent: 0, total: 2, lastAt: '2026-11-18T10:00:00.000Z' },
  ]
  data.judgeQuality = { judgedCount: 4, heuristicShare: 0, lowConfidenceShare: 0, tierDistribution: { decision: 0, execution: 4 }, avgJudgeMs: 100, judgeToExecutionMsRatio: 0.1 }
  const html = render(reactPkgs, TrafficBoardView, { data, hours: 24, error: '', onRange: () => {}, sessionFilter: '', onSessionChange: () => {} })
  const text = visibleText(html)
  assert.ok(text.includes('s-old'), '滑出 recent 环形但在账本里的会话必须仍可选')
  assert.ok(text.includes('s-old（60）'), `选项应带该会话的行数，实际：${text.slice(0, 400)}`)
  assert.ok(text.includes('未知会话（未携带 sessionId）'), 'unknown 仍是诚实标签')
})

test('#3: 网关冷却时流量卡显示灰点 + 剩余分钟', { skip }, () => {
  const TrafficBoardView = bootView()
  const data = buildPayload({ ...fixture.hour, recent: [] }, 24)
  data.breakers = {
    jev: { coolingDown: false, cooldownMs: 0, minutesLeft: 0 },
    kimi: { coolingDown: true, cooldownMs: 480000, minutesLeft: 8 },
    dsf: { coolingDown: false, cooldownMs: 0, minutesLeft: 0 },
  }
  const html = render(reactPkgs, TrafficBoardView, { data, hours: 24, error: '', onRange: () => {} })
  const text = visibleText(html)
  assert.ok(text.includes('冷却 8 分钟'), `kimi 冷却徽标应显示剩余分钟，实际：${text.slice(0, 300)}`)
  assert.ok(!text.includes('冷却 0 分钟'), '未冷却的网关不显示冷却徽标')
})
