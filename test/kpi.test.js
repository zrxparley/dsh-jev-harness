/**
 * KPI 任务语言 + 稀疏图 + 失败红段（issue #18）。
 *
 * 验收原文：
 * - 首屏第一行能读出「几次、谁做的、坏没坏」，不需要理解 gateway 概念
 * - 3 次调用时不再出现「一根柱顶满 + 23 根空柱」
 * - 任一失败在看板上一眼可见（红色，不是淡色），并能看到原因
 * - 最近调用表不再出现 probe / skill-pick 等英文枚举
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClient, findSlot, loadClient, render, requireReactOrSkip, visibleText,
} from './helpers/client.js'

const { pkgs: reactPkgs, skip } = requireReactOrSkip()

function bootView() {
  const loaded = loadClient(reactPkgs)
  const { registrations } = applyClient(loaded)
  const main = findSlot(registrations, 'main')
  assert.ok(main)
  return loaded.exports.__test.TrafficBoardView
}

const now = new Date()
const iso = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60000).toISOString()

function sparsePayload() {
  return {
    ok: true, state: 'ready', grain: 'hour', windowHours: 24, peak: 2,
    buckets: [{ key: 'k', label: '10:00', day: '1/1', gateways: { jev: { calls: 0, tokens: 0, fail: 0 }, kimi: { calls: 2, tokens: 0, fail: 1 }, dsf: { calls: 1, tokens: 0, fail: 0 } } }],
    totals: {
      jev: { calls: 0, ok: 0, fail: 0, tokens: 0, avgMs: 0, unanswered: 0, notSent: 0 },
      kimi: { calls: 2, ok: 1, fail: 1, tokens: 0, avgMs: 0, answered: 1, unanswered: 0, notSent: 0 },
      dsf: { calls: 1, ok: 1, fail: 0, tokens: 0, avgMs: 0, answered: 1, unanswered: 0, notSent: 0 },
    },
    today: { jev: { calls: 0, tokens: 0 }, kimi: { calls: 2, tokens: 0 }, dsf: { calls: 1, tokens: 0 } },
    recent: [
      { t: iso(1), g: 'kimi', tool: 'probe', ok: false, error: 'HTTP 500 from kimi', kind: 'fail', ms: 10, pt: 0, ct: 0 },
      { t: iso(2), g: 'kimi', tool: 'skill-pick', ok: true, kind: 'ok', ms: 20, pt: 0, ct: 0 },
      { t: iso(3), g: 'dsf', tool: 'call', ok: true, kind: 'ok', ms: 30, pt: 0, ct: 0 },
    ],
  }
}

function densePayload() {
  const buckets = []
  for (let i = 0; i < 24; i += 1) {
    buckets.push({
      key: `b${i}`, label: `${String(i).padStart(2, '0')}:00`, day: '1/1',
      gateways: {
        jev: { calls: 2, tokens: 10, fail: 0 },
        kimi: { calls: i === 5 ? 3 : 0, tokens: 20, fail: i === 5 ? 2 : 0 },
        dsf: { calls: 1, tokens: 5, fail: 0 },
      },
    })
  }
  return {
    ok: true, state: 'ready', grain: 'hour', windowHours: 24, peak: 3, buckets,
    totals: {
      jev: { calls: 48, ok: 48, fail: 0, tokens: 240, avgMs: 100 },
      kimi: { calls: 3, ok: 1, fail: 2, tokens: 60, avgMs: 200 },
      dsf: { calls: 24, ok: 24, fail: 0, tokens: 120, avgMs: 150 },
    },
    today: { jev: { calls: 0, tokens: 0 }, kimi: { calls: 0, tokens: 0 }, dsf: { calls: 0, tokens: 0 } },
    recent: [],
  }
}

test('首屏第一行是任务语言：几次 / 谁做的 / 坏没坏', { skip }, () => {
  const view = bootView()
  const text = visibleText(render(reactPkgs, view, { data: sparsePayload(), hours: 24, error: '', onRange: () => {}, onRefresh: () => {} }))
  assert.match(text, /本窗口 3 次请求/)
  assert.match(text, /Kimi 2 次判断/)
  assert.match(text, /Flash 1 次执行/)
  assert.match(text, /失败 1/)
  assert.match(text, /无回答 0/)
})

test('0 tokens 显示 — 并说明网关未返回用量', { skip }, () => {
  const view = bootView()
  const text = visibleText(render(reactPkgs, view, { data: sparsePayload(), hours: 24, error: '', onRange: () => {}, onRefresh: () => {} }))
  assert.match(text, /— tokens（网关未返回用量）/)
})

test('3 次调用走时间线，不画 24 根柱', { skip }, () => {
  const view = bootView()
  const html = render(reactPkgs, view, { data: sparsePayload(), hours: 24, error: '', onRange: () => {}, onRefresh: () => {} })
  const text = visibleText(html)
  assert.match(text, /调用时间线/)
  const rects = (html.match(/<rect/g) || []).length
  assert.ok(rects < 5, `稀疏数据不该出现大量柱子，实际 ${rects} 个 rect`)
  assert.ok((html.match(/<circle/g) || []).length >= 3, '时间线应给每个调用一个点')
})

test('最近调用表中文化，并显示失败原因', { skip }, () => {
  const view = bootView()
  const text = visibleText(render(reactPkgs, view, { data: sparsePayload(), hours: 24, error: '', onRange: () => {}, onRefresh: () => {} }))
  assert.equal(text.includes('probe'), false, '不许出现 probe 枚举')
  assert.equal(text.includes('skill-pick'), false, '不许出现 skill-pick 枚举')
  assert.ok(text.includes('连通测试'), 'probe 应显示为「连通测试」')
  assert.ok(text.includes('选技能'), 'skill-pick 应显示为「选技能」')
  assert.match(text, /原因：HTTP 500 from kimi/)
})

test('数据够多时保留柱状图，失败是红色实心段', { skip }, () => {
  const view = bootView()
  const html = render(reactPkgs, view, { data: densePayload(), hours: 24, error: '', onRange: () => {}, onRefresh: () => {} })
  const text = visibleText(html)
  assert.equal(text.includes('调用时间线'), false, '数据够多应画柱状图')
  assert.ok((html.match(/<rect/g) || []).length > 20, '柱状图要有柱子')
  assert.ok(html.includes('fill="#f85149"'), '失败必须是红色实心段')
  assert.match(text, /失败 2/)
})
