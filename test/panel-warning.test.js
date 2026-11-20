/**
 * 面板在账本损坏时要有可见提示（issue #25 的面板侧验收）。
 * 单独成文件：账本用例本身不依赖 react，渲染断言必须自己带环境闸门。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClient, findSlot, loadClient, render, requireReactOrSkip, visibleText,
} from './helpers/client.js'
import { readFixture } from './helpers/harness.js'

const { pkgs: reactPkgs, skip } = requireReactOrSkip()
const fixture = readFixture('traffic-stats.json')

function bootView() {
  const loaded = loadClient(reactPkgs)
  const { registrations } = applyClient(loaded)
  const main = findSlot(registrations, 'main')
  assert.ok(main, 'main slot 未注册，无法取到内部视图')
  const view = loaded.exports.__test && loaded.exports.__test.TrafficBoardView
  assert.equal(typeof view, 'function', 'client 没有导出 TrafficBoardView 测试缝')
  return view
}

function payloadWith(warning) {
  return {
    ok: true,
    grain: 'hour',
    windowHours: 24,
    peak: 0,
    buckets: [],
    file: 'jev-harness-usage.json',
    totals: fixture.hour.totals,
    today: fixture.hour.today,
    recent: [],
    warning,
  }
}

test('账本损坏时面板显示可见提示（issue #25）', { skip }, () => {
  const TrafficBoardView = bootView()
  const data = payloadWith({
    code: 'usage-ledger-corrupt',
    reason: 'Unexpected end of JSON input',
    file: 'jev-harness-usage.json',
    backup: 'jev-harness-usage.corrupt-2026-11-19T23-10-00-000Z.json',
    message: '用量账本损坏，旧文件已隔离，统计从这一刻重新开始。',
  })
  const html = render(reactPkgs, TrafficBoardView, { data, hours: 24, error: '', onRange: () => {} })
  const text = visibleText(html)

  assert.ok(text.includes('账本损坏'), `面板没显示损坏提示：${text.slice(0, 200)}`)
  assert.ok(text.includes('旧文件已隔离为'), '提示里要说明旧文件被隔离到哪里')
  assert.ok(text.includes('jev-harness-usage.corrupt-2026-11-19T23-10-00-000Z.json'), '提示里要带备份文件名')
  assert.ok(html.includes('role="alert"'), '损坏提示应带 alert 语义')

  // 无法隔离时也要提示，不许静默
  const noBackup = render(reactPkgs, TrafficBoardView, {
    data: payloadWith({ ...data.warning, backup: null }),
    hours: 24,
    error: '',
    onRange: () => {},
  })
  assert.ok(visibleText(noBackup).includes('旧文件无法隔离'), '无法隔离时也要说清楚')

  // 正常账本不该出现这条提示
  const clean = render(reactPkgs, TrafficBoardView, { data: payloadWith(null), hours: 24, error: '', onRange: () => {} })
  assert.ok(!visibleText(clean).includes('账本损坏'), '健康账本不该误报损坏')
})
