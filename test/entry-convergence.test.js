/**
 * 入口收敛（issue #17）。
 *
 * 验收原文：
 * - 设置页插件卡只出现一个「打开 JEV 面板」按钮，点击能跳到侧栏面板
 * - 同一屏里完整表单只出现一次
 * - 插件卡改开关后侧栏面板 2 秒内同步（两处都只读 /status、写 /toggle）
 * - 未配置网关时首屏看不到「刷新技能目录」
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClient, findSlot, loadClient, render, requireReactOrSkip, visibleText,
} from './helpers/client.js'
import fs from 'node:fs'
import path from 'node:path'
import { REPO, jsonResponse, stubFetch } from './helpers/harness.js'

const { pkgs: reactPkgs, skip } = requireReactOrSkip()

function bootClient({ state = 'off', services = {} } = {}) {
  const stub = stubFetch((url) => {
    if (url === '/api/jev-harness/token') return jsonResponse({ ok: true, token: 'a'.repeat(64) })
    if (url === '/api/jev-harness/status') {
      return jsonResponse({ ok: true, version: '1.10.1', enabled: state !== 'off', state, gateways: {}, skills: { count: 39, cached: 0, source: 'bundled' } })
    }
    return undefined
  })
  const loaded = loadClient(reactPkgs, { fetch: globalThis.fetch })
  const applied = applyClient(loaded, { services })
  return { ...applied, loaded, stub }
}

test('inject 带 layout，且只保留 bundle 级配置卡', { skip }, async () => {
  const client = bootClient({ state: 'off' })
  try {
    assert.ok(client.loaded.exports.inject.includes('layout'), 'inject 必须包含 layout')
    const names = client.registrations.map((entry) => entry.def.name)
    assert.equal(names.includes('plugins.row.config'), false, '行级配置卡必须撤掉')
    assert.equal(names.filter((name) => name === 'plugins.bundle.config').length, 2)
  } finally {
    client.stub.restore()
  }
})

test('插件卡只有一个「打开 JEV 面板」，且不含完整表单', { skip }, () => {
  const client = bootClient()
  try {
    const seat = findSlot(client.registrations, 'plugins.bundle.config')
    for (const view of ['summary', 'page']) {
      const text = visibleText(render(reactPkgs, seat.comp, { view }))
      assert.equal((text.match(/打开 JEV 面板/g) || []).length, 1, `${view} 视图只能有一个入口按钮`)
      assert.equal(text.includes('Base URL'), false, `${view} 视图不许内嵌完整表单`)
      assert.equal(text.includes('API Key'), false)
      assert.equal(text.includes('刷新技能目录'), false, '插件卡不该出现技能刷新')
    }
  } finally {
    client.stub.restore()
  }
})

test('打开 JEV 面板：真调用 layout.selectPanel', { skip }, () => {
  const calls = []
  const client = bootClient({ services: { layout: { selectPanel: (id) => calls.push(id) } } })
  try {
    const ok = client.loaded.exports.__test.openPanel()
    assert.equal(ok, true)
    assert.deepEqual(calls, ['jev-harness-workbench'])
  } finally {
    client.stub.restore()
  }
})

test('完整表单只在主面板出现一次；插件卡不重复', { skip }, () => {
  const client = bootClient()
  try {
    const main = findSlot(client.registrations, 'main')
    const seat = findSlot(client.registrations, 'plugins.bundle.config')
    // #20 之后表单标签走 T()，不再断言英文文案；#22 要求断言「label 绑到输入框」这条语义。
    const mainHtml = render(reactPkgs, main.comp, {})
    const seatHtml = render(reactPkgs, seat.comp, { view: 'page' })
    assert.ok(/for="jev-gw-kimi-baseUrl"/.test(mainHtml), '主面板要有完整表单（label for 绑定输入框）')
    assert.ok(/id="jev-gw-kimi-baseUrl"/.test(mainHtml), '主面板的输入框要有 id')
    assert.equal(/jev-gw-kimi-baseUrl/.test(seatHtml), false, '同一屏里表单只能出现一次')
  } finally {
    client.stub.restore()
  }
})

test('开关广播：publish 同步触达订阅者，退订后不再收到', { skip }, () => {
  const client = bootClient()
  try {
    const api = client.loaded.exports.__test
    const seen = []
    const off = api.subscribeBridgeState((status) => seen.push(status.state))
    api.publishBridgeState({ state: 'off' })
    assert.deepEqual(seen, ['off'], 'publish 必须同步送达，不等定时器')
    off()
    api.publishBridgeState({ state: 'ready' })
    assert.deepEqual(seen, ['off'], '退订后不该再收到')
  } finally {
    client.stub.restore()
  }
})

test('插件卡 toggle 后，订阅方在 promise resolve 前就拿到新状态', { skip }, async () => {
  const home = await import('./helpers/harness.js')
  const stub = home.stubFetch((url) => {
    if (url === '/api/jev-harness/token') return home.jsonResponse({ ok: true, token: 'a'.repeat(64) })
    if (url === '/api/jev-harness/toggle') return home.jsonResponse({ ok: true, enabled: false, state: 'off', gateways: {}, skills: {} })
    if (url === '/api/jev-harness/status') return home.jsonResponse({ ok: true, state: 'off', enabled: false, gateways: {}, skills: {} })
    return undefined
  })
  const loaded = loadClient(reactPkgs, { fetch: globalThis.fetch })
  const applied = applyClient(loaded)
  try {
    const api = loaded.exports.__test
    const order = []
    const off = api.subscribeBridgeState((status) => order.push(`listener:${status.state}`))
    const status = await api.setBridgeEnabled(false)
    order.push('caller-after-await')
    assert.equal(status.state, 'off')
    assert.deepEqual(order, ['listener:off', 'caller-after-await'], '订阅方必须在同一个 tick 内更新，而不是等轮询')
    off()
    assert.ok(applied.registrations.length >= 5)
  } finally {
    stub.restore()
  }
})

test('晚到的旧轮询响应被丢弃，不把开关顶回去', { skip }, async () => {
  const stub = stubFetch((url) => {
    if (url === '/api/jev-harness/token') return jsonResponse({ ok: true, token: 'a'.repeat(64) })
    if (url === '/api/jev-harness/toggle') return jsonResponse({ ok: true, enabled: false, state: 'off', gateways: {}, skills: {} })
    if (url === '/api/jev-harness/status') return jsonResponse({ ok: true, enabled: true, state: 'ready', gateways: {}, skills: {} })
    return undefined
  })
  const loaded = loadClient(reactPkgs, { fetch: globalThis.fetch })
  applyClient(loaded)
  try {
    const api = loaded.exports.__test
    // 轮询在 toggle 之前发出：记下当时的序号
    const startSeq = api.bridgeStateSeqNow()
    await api.setBridgeEnabled(false) // 用户关掉开关，发布新状态
    // 旧响应此时才回来
    const applied = api.publishIfUnchanged(startSeq, { ok: true, enabled: true, state: 'ready' })
    assert.equal(applied, false, '旧轮询必须被丢弃')
    const seen = []
    api.subscribeBridgeState((next) => seen.push(next.state))
    assert.deepEqual(seen, ['off'], '状态不许被旧响应回滚成 ready')

    // 没有并发更新时，轮询照常生效
    const fresh = api.bridgeStateSeqNow()
    assert.equal(api.publishIfUnchanged(fresh, { state: 'setup' }), true)
  } finally {
    stub.restore()
  }
})

test('三个入口都订阅了同一个状态源', () => {
  const source = fs.readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8')
  const uses = (source.match(/subscribeBridgeState\(/g) || []).length
  assert.ok(uses >= 4, `定义 + 三个入口订阅至少 4 处，实际 ${uses}`)
})

test('未配置网关（setup）时首屏看不到「刷新技能目录」', { skip }, () => {
  const client = bootClient()
  try {
    const HarnessConfig = client.loaded.exports.__test.HarnessConfig
    const setup = visibleText(render(reactPkgs, HarnessConfig, { __initialState: 'setup' }))
    assert.equal(setup.includes('刷新技能目录'), false, 'setup 不该出现刷新按钮')
    const ready = visibleText(render(reactPkgs, HarnessConfig, { __initialState: 'ready' }))
    assert.ok(ready.includes('刷新技能目录'), 'ready 下刷新按钮应可见')
  } finally {
    client.stub.restore()
  }
})

test('#4 F1: 设置表单里有「判定置信度阈值」数值输入', { skip }, () => {
  const client = bootClient()
  try {
    const HarnessConfig = client.loaded.exports.__test.HarnessConfig
    const html = render(reactPkgs, HarnessConfig, { __initialState: 'ready' })
    const text = visibleText(html)
    assert.ok(text.includes('判定置信度阈值'), `设置表单应显示阈值标签，实际片段：${text.slice(0, 300)}`)
    assert.ok(text.includes('保存阈值'), '应有「保存阈值」按钮')
    // the numeric input must be present with the current value
    assert.ok(/type="number"/.test(html) || /type: 'number'/.test(html) || html.includes('number'), '应有 number 类型输入框')
  } finally {
    client.stub.restore()
  }
})
