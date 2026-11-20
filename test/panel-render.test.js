/**
 * 主面板真渲染（对应旧的临时脚本 render-harness-panel.cjs）。
 *
 * 用 profile 里的真 react + react-dom/server 把 main slot 的组件渲染成 HTML，
 * 断言页面上真的能看见总开关、流量看板、技能库与表单字段 —— 而不是「组件注册了就算过」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClient, findSlot, loadClient, render, requireReactOrSkip, visibleText,
} from './helpers/client.js'
import { jsonResponse, stubFetch } from './helpers/harness.js'

const { pkgs: reactPkgs, skip } = requireReactOrSkip()

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

test('主面板渲染出可见内容：总开关 / 流量看板 / 技能库 / 39 个技能', { skip }, () => {
  const { registrations, stub } = bootPanel()
  const main = findSlot(registrations, 'main')
  assert.ok(main, 'main slot 未注册')
  assert.equal(typeof main.comp, 'function', 'main slot 的组件必须是 register 的第二参数')

  const before = stub.seen.length
  const html = render(reactPkgs, main.comp)
  assert.ok(html.length > 4000, `面板 HTML 太短，疑似渲染成白板：${html.length}`)

  const text = visibleText(html)
  const mustContain = [
    'JEV 分级调度 Harness',
    '总开关',
    '流量看板',
    '技能库 · mattpocock/skills',
    '39 个技能',
    '接口地址',
    '密钥',
    '模型',
    '保存',
    '测试连通',
    '决策层',
    '执行层',
  ]
  const missing = mustContain.filter((needle) => !text.includes(needle))
  assert.deepEqual(missing, [], `面板缺少文案：${missing.join(' / ')}`)

  // 开关是可点的真控件，不是一张图
  const switches = html.match(/role="switch"/g) || []
  assert.ok(switches.length >= 2, `开关数量不足：${switches.length}`)

  // 静态渲染只读状态，不发请求（网络由测试自己 stub，这里断言渲染本身是纯的）
  assert.equal(stub.seen.length, before, `渲染期间发生了网络请求：${stub.urls().slice(before).join(', ')}`)
  stub.restore()
})

test('侧边栏图标渲染成 18px 的 svg', { skip }, () => {
  const { registrations } = bootPanel()
  const side = findSlot(registrations, 'sidebar.panellist')
  assert.ok(side, 'sidebar.panellist 未注册')
  assert.equal(typeof side.def.label, 'function', '侧边栏条目需要 label()')

  const html = render(reactPkgs, side.comp, { size: 18, active: false })
  assert.ok(html.startsWith('<svg'), `不是 svg：${html.slice(0, 40)}`)
  assert.ok(html.includes('width="18"'), '图标没有按 size 渲染')
})

test('插件管理里的配置席位两个视图都能渲染', { skip }, () => {
  const { registrations } = bootPanel()
  const seat = findSlot(registrations, 'plugins.bundle.config')
  assert.ok(seat, 'plugins.bundle.config 未注册')

  const summary = render(reactPkgs, seat.comp, { view: 'summary' })
  assert.ok(visibleText(summary).includes('JEV 分级调度'), '摘要视图缺少状态说明')
  assert.ok(visibleText(summary).includes('打开 JEV 面板'), '摘要视图缺少唯一入口按钮')

  const page = render(reactPkgs, seat.comp, { view: 'page' })
  assert.ok(page.length > 200, `配置页太短：${page.length}`)
  assert.equal(visibleText(page).includes('Base URL'), false, '入口卡不许内嵌完整表单')
})