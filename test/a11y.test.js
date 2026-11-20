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
  assert.ok(/role: message && message\.kind === 'bad' \? 'alert' : 'status'/.test(src), '结果行缺错误 alert 分流')
  assert.ok(/'aria-live': message && message\.kind === 'bad' \? 'assertive' : 'polite'/.test(src), '错误要 assertive')
  // 账本损坏的警告本来就是 alert，别退化
  assert.ok(/style: styles\.bad, role: 'alert'/.test(src), '账本损坏警告要保留 role=alert')
})

/** 从渲染出的 HTML 里取所有可控件（原生控件 + 带 role 的非原生元素）及其尺寸。 */
function interactiveSizes(html) {
  const tags = []
  for (const m of html.matchAll(/<(button|input|select|textarea)\b[^>]*>/g)) tags.push(m[0])
  for (const m of html.matchAll(/<div\b[^>]*role="(?:button|switch)"[^>]*>/g)) tags.push(m[0])
  return tags.map((tag) => {
    const style = /style="([^"]*)"/.exec(tag)
    const css = style ? style[1] : ''
    const min = /min-height:\s*(\d+(?:\.\d+)?)px/.exec(css)
    const height = /(?:^|;)\s*height:\s*(\d+(?:\.\d+)?)px/.exec(css)
    return { tag: tag.slice(0, 110), min: min ? Number(min[1]) : null, height: height ? Number(height[1]) : null }
  })
}

test('#22: 所有可控件在渲染结果里都 ≥32 高（按 DOM，不按源码排版）', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const seam = loaded.exports.__test
  const { registrations, stub } = bootPanel()
  const pages = []
  try {
    const panelHtml = render(reactPkgs, findSlot(registrations, 'main').comp)
    pages.push(['面板', panelHtml])
    pages.push(['流量看板（骨架）', render(reactPkgs, seam.TrafficBoardView, { data: null, hours: 24, error: '', onRange: () => {} })])
    pages.push(['流量看板（有数据）', render(reactPkgs, seam.TrafficBoardView, { data: trafficPayload(), hours: 24, error: '', onRange: () => {} })])
    pages.push(['输入框开关', render(reactPkgs, seam.ComposerChip, {})])
  } finally {
    stub.restore()
  }
  const bad = []
  let total = 0
  for (const [name, html] of pages) {
    for (const item of interactiveSizes(html)) {
      total += 1
      const ok = (item.min !== null && item.min >= 32) || (item.height !== null && item.height >= 32)
      if (!ok) bad.push(`${name}: ${item.tag}`)
    }
  }
  assert.ok(total >= 20, `可控件数量太少，检查可能没覆盖到：${total}`)
  assert.deepEqual(bad, [], `可点区域不足 32×32：\n${bad.join('\n')}`)
})

test('#22: live region 初始渲染就存在（不是有消息才出现）', { skip }, () => {
  const { registrations, stub } = bootPanel()
  try {
    const html = render(reactPkgs, findSlot(registrations, 'main').comp)
    assert.ok(/role="status"/.test(html), '初始渲染就要有 role=status 的 live 节点')
    assert.ok(/aria-live="polite"/.test(html), '初始渲染要有 aria-live=polite')
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

/** 按渲染结果找小字号（≤11px）且透明度 < .7 的文本元素。 */
function dimSmallText(html) {
  const bad = []
  for (const m of html.matchAll(/<[a-zA-Z][^>]*style="[^"]*"[^>]*>/g)) {
    const css = /style="([^"]*)"/.exec(m[0])[1]
    const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(css)
    if (!size || Number(size[1]) > 11) continue
    const opacity = /opacity:\s*(0?\.\d+)/.exec(css)
    if (opacity && Number(opacity[1]) < 0.7) bad.push(css.slice(0, 140))
  }
  return bad
}

test('#22: 11px（含更小）文本透明度 ≥ .7——按渲染结果检查', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const seam = loaded.exports.__test
  const { registrations, stub } = bootPanel()
  const pages = []
  try {
    pages.push(['面板', render(reactPkgs, findSlot(registrations, 'main').comp)])
    pages.push(['流量看板（骨架）', render(reactPkgs, seam.TrafficBoardView, { data: null, hours: 24, error: '', onRange: () => {} })])
    pages.push(['流量看板（有数据）', render(reactPkgs, seam.TrafficBoardView, { data: trafficPayload(), hours: 24, error: '', onRange: () => {} })])
  } finally {
    stub.restore()
  }
  const bad = []
  for (const [name, html] of pages) {
    for (const css of dimSmallText(html)) bad.push(`${name}: ${css}`)
  }
  assert.deepEqual(bad, [], `小字号文本透明度低于 .7：\n${bad.join('\n')}`)
})

test('#22: 非原生可点元素必须带 role 与键盘可达', () => {
  const src = fs.readFileSync(CLIENT, 'utf8')
  // DecisionRow 面板行用 div，必须是 role=button + tabIndex，不能只挂 onClick。
  assert.ok(/role: onToggle \? 'button' : undefined/.test(src), '决策行缺少 role=button')
  assert.ok(/tabIndex: onToggle \? 0 : undefined/.test(src), '决策行缺少键盘可达的 tabIndex')
})