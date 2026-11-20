/**
 * 面板韧性（issue #16）：组件抛错不能白屏，要出可恢复的卡片。
 *
 * 验收原文：人为让 HarnessPage 抛错 → 出「面板加载失败」卡片而非白屏；
 * 卡片含版本号、可复制诊断；「重新加载面板」能恢复渲染。
 *
 * SSR 不执行 error boundary，所以这里直接驱动边界类：先用
 * getDerivedStateFromError 复现 React 的捕获步，再渲染它自己的卡片；
 * 恢复则调用 reload() 后重新渲染不抛错的子组件。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClient, loadClient, render, requireReactOrSkip, visibleText,
} from './helpers/client.js'
import { jsonResponse, stubFetch } from './helpers/harness.js'

const { pkgs: reactPkgs, skip } = requireReactOrSkip()

function bootClient() {
  const stub = stubFetch((url) => {
    if (url === '/api/jev-harness/token') return jsonResponse({ ok: true, token: 'a'.repeat(64) })
    if (url === '/api/jev-harness/status') {
      return jsonResponse({ ok: true, version: '1.10.1', state: 'ready', enabled: true, gateways: {}, skills: {} })
    }
    if (url.startsWith('/api/jev-harness/stats')) {
      return jsonResponse({ ok: true, state: 'ready', totals: {}, buckets: [], recent: [] })
    }
    return undefined
  })
  const loaded = loadClient(reactPkgs, { fetch: globalThis.fetch })
  const applied = applyClient(loaded)
  return { ...applied, loaded, stub }
}

test('HarnessPage 的测试缝真的会抛错', { skip }, () => {
  const { loaded, stub } = bootClient()
  try {
    const HarnessPage = loaded.exports.__test.HarnessPage
    assert.throws(() => render(reactPkgs, HarnessPage, { __throwForTest: true }), /panel exploded/)
  } finally {
    stub.restore()
  }
})

test('抛错后出「面板加载失败」卡片，含版本 / 重载 / 复制诊断', { skip }, async () => {
  const client = bootClient()
  try {
    const { PanelBoundary, HarnessPage } = client.loaded.exports.__test
    const boundary = new PanelBoundary({ children: reactPkgs.react.createElement(HarnessPage, { __throwForTest: true }) })
    boundary.state = { ...boundary.state, ...PanelBoundary.getDerivedStateFromError(new Error('panel exploded (test seam)')) }
    // 模拟 componentDidCatch 先记录的最近错误
    boundary.state.diag = { message: 'panel exploded (test seam)', componentStack: '' }

    // 类实例不在 React 树里，setState 不会落地；方法同时把结果返回，测试据此更新实例状态。
    boundary.state = { ...boundary.state, diag: await boundary.loadDiagnostics() }
    const text = visibleText(render(reactPkgs, boundary.render.bind(boundary)))

    assert.ok(text.includes('面板加载失败'), `应出现失败卡片：${text.slice(0, 120)}`)
    assert.ok(text.includes('1.10.1'), '卡片要显示版本号')
    assert.ok(text.includes('重新加载面板'), '要有重载按钮')
    assert.ok(text.includes('复制诊断信息'), '要有复制诊断按钮')
    assert.match(text, /状态接口：ok/)
    assert.match(text, /统计接口：ok/)
    assert.match(text, /最近错误：panel exploded/)
    assert.match(text, /slot 注册：main/) // apply 时记录过 slot 注册

    const diag = await boundary.copyDiagnostics()
    const parsed = JSON.parse(diag)
    assert.equal(parsed.version, '1.10.1')
    assert.match(parsed.message, /panel exploded/)
  } finally {
    client.stub.restore()
  }
})

test('重新加载面板：清掉错误态并渲染出正常面板', { skip }, () => {
  const client = bootClient()
  try {
    const { PanelBoundary, HarnessPage } = client.loaded.exports.__test
    const boundary = new PanelBoundary({ children: reactPkgs.react.createElement(HarnessPage, { __throwForTest: true }) })
    boundary.state = { ...boundary.state, ...PanelBoundary.getDerivedStateFromError(new Error('boom')) }
    assert.ok(visibleText(render(reactPkgs, boundary.render.bind(boundary))).includes('面板加载失败'))

    boundary.state = { ...boundary.state, ...boundary.reload() }
    assert.equal(boundary.state.error, null, 'reload 应清空错误态')
    // 恢复后子组件不再抛错，正常面板要能渲染出内容（不是白屏）
    boundary.props = { children: reactPkgs.react.createElement(HarnessPage, {}) }
    const text = visibleText(render(reactPkgs, boundary.render.bind(boundary)))
    assert.ok(text.includes('总开关'), '恢复后应渲染正常面板')
    assert.ok(!text.includes('面板加载失败'))
  } finally {
    client.stub.restore()
  }
})
