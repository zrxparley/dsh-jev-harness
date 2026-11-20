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
import { jsonResponse, stubFetch } from './helpers/harness.js'

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
    const mainText = visibleText(render(reactPkgs, main.comp, {}))
    const seatText = visibleText(render(reactPkgs, seat.comp, { view: 'page' }))
    assert.ok(mainText.includes('Base URL'), '主面板要有完整表单')
    assert.equal(seatText.includes('Base URL'), false, '同一屏里表单只能出现一次')
  } finally {
    client.stub.restore()
  }
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
