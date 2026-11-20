/**
 * #22 可访问性：表单语义、aria-live、点击区、焦点环、图表文字摘要、小字号对比度。
 *
 * 静态渲染能验证结构与文案；**键盘 Tab 走查与真实焦点环外观需要浏览器**，
 * 这里用「可执行检查 + 结构断言」锁住能做到的部分，不谎称已做浏览器验收。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyClient, findSlot, loadClient, render, requireReactOrSkip, visibleText,
} from './helpers/client.js'
import { jsonResponse, stubFetch } from './helpers/harness.js'

const { pkgs: reactPkgs, skip } = requireReactOrSkip()
const CLIENT = path.join(import.meta.dirname, '..', 'lib', 'client.js')
const pad = (n) => String(n).padStart(2, '0')

function bootPanel() {
  const stub = stubFetch(() => jsonResponse({
    ok: true,
    enabled: true,
    file: 'jev-harness.json',
    gateways: {
      jev: { baseUrl: 'https://jev.test/v1', model: 'jev-1.14.0', keySet: true },
      kimi: { baseUrl: 'https://kimi.test/v1', model: 'kimi-k3.1-pro', keySet: true },
      dsf: { baseUrl: 'https://dsf.test/v1', model: 'deepseek-v4.1-flash-1017', keySet: true },
    },
    tiers: { decision: 'kimi', execution: 'dsf' },
    route: { mode: 'dsh', dshAvailable: false, active: false, decision: {}, execution: {}, catalog: { ok: false, providers: [] }, follow: null, followModel: true, resolved: null },
    decisions: [],
    skills: { auto: true, count: 39, cached: 39, source: 'bundled', snapshot: {}, dir: '/tmp', repo: 'https://github.com/mattpocock/skills' },
  }))
  const loaded = loadClient(reactPkgs)
  const applied = applyClient(loaded)
  return { ...applied, loaded, stub }
}

/** 一份足够画柱状图 + 最近调用表的 /stats 形状数据。 */
function trafficPayload() {
  const empty = () => ({ calls: 0, tokens: 0, fail: 0 })
  const buckets = Array.from({ length: 24 }, (_, i) => ({
    key: `2026-11-19T${pad(i)}`,
    label: `${pad(i)}:00`,
    day: '11/19',
    gateways: { jev: empty(), kimi: empty(), dsf: empty() },
  }))
  const totals = {
    jev: { calls: 5, ok: 5, fail: 0, tokens: 100, avgMs: 120, probeCalls: 0, notSent: 0, unanswered: 0 },
    kimi: { calls: 6, ok: 6, fail: 0, tokens: 200, avgMs: 800, probeCalls: 0, notSent: 0, unanswered: 0 },
    dsf: { calls: 4, ok: 4, fail: 0, tokens: 300, avgMs: 900, probeCalls: 0, notSent: 0, unanswered: 0 },
  }
  return {
    ok: true,
    grain: 'hour',
    windowHours: 24,
    peak: 1,
    buckets,
    totals,
    today: totals,
    recent: [{ t: new Date().toISOString(), g: 'dsf', tool: 'call', ok: true, sent: true, answered: true, kind: 'ok', ms: 321, pt: 10, ct: 20 }],
    judgeQuality: null,
  }
}

test('#22: 网关表单用 fieldset/legend，label for 与 input id 成对', { skip }, () => {
  const { registrations, stub } = bootPanel()
  try {
    const main = findSlot(registrations, 'main')
    const html = render(reactPkgs, main.comp)
    assert.equal((html.match(/<fieldset/g) || []).length, 3, '三张网关卡都要是 fieldset')
    assert.equal((html.match(/<legend/g) || []).length, 3, '每张卡都要有 legend')
    for (const key of ['jev', 'kimi', 'dsf']) {
      for (const field of ['baseUrl', 'apiKey', 'model']) {
        const id = `jev-gw-${key}-${field}`
        assert.ok(html.includes(`for="${id}"`), `缺少 label for=${id}`)
        assert.ok(new RegExp(`id="${id}"`).test(html), `缺少 input id=${id}`)
      }
    }
    assert.equal((html.match(/for="jev-gw-/g) || []).length, 9, '9 个字段 = 9 个 label')
    assert.ok(/<label[^>]*for="jev-gw-kimi-apiKey"/.test(html), 'label 必须是 <label for>，不是 span')
  } finally {
    stub.restore()
  }
})

test('#22: 异步结果有 aria-live，错误是 role=alert', () => {
  const src = fs.readFileSync(CLIENT, 'utf8')
  // 结果区（探测结果）整体是 polite 的 status 区域
  assert.ok(/role: 'status', 'aria-live': 'polite'/.test(src), '探测结果区缺 role=status/aria-live=polite')
  // 保存 / 测试 / 切换的结果行：失败用 alert + assertive，成功用 status + polite
  assert.ok(/role: message\.kind === 'bad' \? 'alert' : 'status'/.test(src), '结果行缺错误 alert 分流')
  assert.ok(/'aria-live': message\.kind === 'bad' \? 'assertive' : 'polite'/.test(src), '错误要 assertive')
  // 账本损坏的警告本来就是 alert，别退化
  assert.ok(/style: styles\.bad, role: 'alert'/.test(src), '账本损坏警告要保留 role=alert')
})

test('#22: 可点区域 ≥32×32，覆盖按钮/chip/输入框芯片', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { MIN_TARGET } = loaded.exports.__test
  assert.equal(MIN_TARGET.minHeight, '32px')
  assert.equal(MIN_TARGET.minWidth, '32px')

  const src = fs.readFileSync(CLIENT, 'utf8')
  const uses = (src.match(/\.\.\.MIN_TARGET/g) || []).length
  assert.ok(uses >= 4, `MIN_TARGET 至少用于普通按钮/主按钮/流量 chip/输入框芯片，实际 ${uses}`)

  const { registrations, stub } = bootPanel()
  try {
    const html = render(reactPkgs, findSlot(registrations, 'main').comp)
    const sizes = html.match(/min-height:32px/g) || []
    assert.ok(sizes.length >= 3, `渲染出的按钮应带 min-height:32px，实际 ${sizes.length}`)
  } finally {
    stub.restore()
  }
})

test('#22: 焦点环 :focus-visible 2px，无 document 时安全跳过', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { A11Y_CSS, ensureA11yStyles } = loaded.exports.__test
  assert.match(A11Y_CSS, /:focus-visible/)
  assert.match(A11Y_CSS, /outline:2px solid/)
  // 测试环境没有 document：必须安全返回 false，不许抛。
  assert.equal(ensureA11yStyles(), false)

  const src = fs.readFileSync(CLIENT, 'utf8')
  assert.ok(src.includes('ensureA11yStyles()'), 'apply 里必须真的调用注入函数')
  assert.ok(src.includes("'data-jev-a11y': '1'"), '根节点要带 data-jev-a11y 作用域标记')

  const { registrations, stub } = bootPanel()
  try {
    const html = render(reactPkgs, findSlot(registrations, 'main').comp)
    assert.ok(html.includes('data-jev-a11y="1"'), '渲染出的面板根节点要带作用域标记')
  } finally {
    stub.restore()
  }
})

test('#22: 图表有文字摘要，不依赖悬停', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { TrafficBoardView } = loaded.exports.__test
  const html = render(reactPkgs, TrafficBoardView, { data: trafficPayload(), hours: 24, error: '', onRange: () => {} })
  const text = visibleText(html)
  assert.match(text, /本窗口 15 次调用 — JEV 5 · Kimi 6 · Flash 4/, `缺图表文字摘要：${text.slice(0, 300)}`)
  assert.ok(html.includes('id="jev-chart-summary"'), '摘要要有 id，供 aria-describedby 引用')
  assert.ok(/aria-describedby="jev-chart-summary"/.test(html), 'svg 要 aria-describedby 指向摘要')
})

test('#22: 最近调用表有 table/row/columnheader 语义', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { TrafficBoardView } = loaded.exports.__test
  const html = render(reactPkgs, TrafficBoardView, { data: trafficPayload(), hours: 24, error: '', onRange: () => {} })
  assert.ok(/role="table"/.test(html), '最近调用应有 role=table')
  assert.equal((html.match(/role="columnheader"/g) || []).length, 6, '六个列头')
  assert.ok((html.match(/role="row"/g) || []).length >= 2, '表头 + 至少一行数据')
})

test('#22: 11px 文本透明度不低于 .7（可执行检查）', () => {
  const src = fs.readFileSync(CLIENT, 'utf8')
  const bad = []
  src.split('\n').forEach((line, index) => {
    if (!line.includes("fontSize: '11px'")) return
    const match = /opacity:\s*(0?\.\d+)/.exec(line)
    if (!match) return
    if (Number(match[1]) < 0.7) bad.push(`L${index + 1}: ${line.trim()}`)
  })
  assert.deepEqual(bad, [], `11px 文本透明度低于 .7：\n${bad.join('\n')}`)

  // 之前最薄的那几档必须都抬到 .7 以上
  for (const key of ['tileSub', 'recentHead', 'dim', 'task', 'hint']) {
    const match = new RegExp(`${key}: \\{[^}]*opacity: (0?\\.\\d+)`).exec(src)
    assert.ok(match, `${key} 样式没找到`)
    assert.ok(Number(match[1]) >= 0.7, `${key} 透明度 ${match[1]} < 0.7`)
  }
})

test('#22: 非原生可点元素必须带 role 与键盘可达', () => {
  const src = fs.readFileSync(CLIENT, 'utf8')
  // DecisionRow 面板行用 div，必须是 role=button + tabIndex，不能只挂 onClick。
  assert.ok(/role: onToggle \? 'button' : undefined/.test(src), '决策行缺少 role=button')
  assert.ok(/tabIndex: onToggle \? 0 : undefined/.test(src), '决策行缺少键盘可达的 tabIndex')
})