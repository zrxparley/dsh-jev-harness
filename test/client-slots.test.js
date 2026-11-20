/**
 * slot 注册集合（对应旧的临时脚本 test-client-sidebar.mjs）。
 *
 * 这条守住 issue #1 点名的坑：假 register 必须写成 register(def, comp)。
 * 只取第一个参数时，组件是 undefined，渲染会报 "Element type is invalid"，
 * 而注册断言却「通过」了 —— 那种绿是假的。
 *
 * 本文件刻意不依赖 react：注册只用到 react.createElement 这个名字，
 * 用一个最小替身即可，这样在没有 profile 的机器 / CI 里也能跑。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyClient, findSlot, loadClient, resolveReact } from './helpers/client.js'
import { jsonResponse, nextTick, stubFetch } from './helpers/harness.js'

const FALLBACK_REACT = {
  Component: class { constructor(props) { this.props = props || {} } setState() {} },
  createElement() { return null },
  useState() { return [undefined, () => {}] },
  useEffect() {},
  useCallback(fn) { return fn },
  useRef() { return { current: null } },
}

function reactPkgs() {
  const resolved = resolveReact()
  if (resolved) return resolved
  return { react: FALLBACK_REACT, server: null, jsx: {} }
}

function bootClient({ state = 'off' } = {}) {
  const stub = stubFetch((url) => {
    if (url === '/api/jev-harness/token') return jsonResponse({ ok: true, token: 'a'.repeat(64) })
    if (url === '/api/jev-harness/status') {
      return jsonResponse({ ok: true, enabled: state !== 'off', state, gateways: {}, skills: {} })
    }
    return undefined
  })
  const loaded = loadClient(reactPkgs(), { fetch: globalThis.fetch })
  const applied = applyClient(loaded, { messages: { 'jev.panel': 'JEV 分级调度' } })
  return { ...applied, loaded, stub }
}

const EXPECTED = [
  { name: 'main', key: 'jev-harness-workbench' },
  { name: 'sidebar.panellist', id: 'jev-harness-workbench' },
  { name: 'conversation.input.left', id: 'jev-harness' },
  { name: 'plugins.bundle.config', key: '@local/jev-harness' },
  { name: 'plugins.bundle.config', key: '@zrxparley/dsh-jev-harness' },
]

test('注册 5 个 slot（入口收敛后不再注册 row.config）', async () => {
  const { registrations, stub } = bootClient({ state: 'off' })
  await nextTick()

  assert.equal(registrations.length, 5, `入口收敛后 slot 注册数应为 5（main/sidebar/composer + 两个 bundle 卡），实际 ${registrations.length}`)
  for (const [index, expected] of EXPECTED.entries()) {
    const actual = registrations[index].def
    assert.equal(actual.name, expected.name, `第 ${index + 1} 个注册的 slot 名不对`)
    if (expected.key) assert.equal(actual.key, expected.key, `${expected.name} 的 key 不对`)
    if (expected.id) assert.equal(actual.id, expected.id, `${expected.name} 的 id 不对`)
    assert.equal(typeof registrations[index].comp, 'function', `${expected.name} 没有组件：register 的第二参数必须被取到`)
  }

  const main = findSlot(registrations, 'main')
  assert.equal(main.def.locale, 'jev-harness')
  assert.equal(typeof main.def.inject, 'function')

  const sidebar = findSlot(registrations, 'sidebar.panellist')
  assert.equal(sidebar.def.order, 12)
  assert.equal(typeof sidebar.def.label, 'function')
  assert.equal(sidebar.def.label(), 'JEV 分级调度')

  assert.equal(loadClient(reactPkgs(), { fetch: globalThis.fetch }).id, '@local/jev-harness')
  stub.restore()
})

test('inject 覆盖面板、侧边栏、输入区与两个插件配置席位', async () => {
  const { injections, stub } = bootClient({ state: 'off' })
  await nextTick()
  assert.deepEqual(injections, [
    'main',
    'sidebar.panellist',
    'conversation.input.left',
    'conversation.input.model',
    'plugins.bundle.config',
    'plugins.bundle.config',
  ])
  stub.restore()
})

test('开关打开时抢占模型选择器席位，关闭时保持释放', async () => {
  const on = bootClient({ state: 'ready' })
  await nextTick()
  await nextTick()
  await nextTick()
  assert.equal(on.registrations.length, 6, '开关打开时应多注册 conversation.input.model')
  const seat = on.registrations[5]
  assert.equal(seat.def.name, 'conversation.input.model')
  assert.equal(seat.def.order, 0)
  assert.equal(typeof seat.comp, 'function')
  assert.deepEqual(on.stub.urls(), ['/api/jev-harness/token', '/api/jev-harness/status'], '先取 token，再问一次状态')
  on.stub.restore()

  const off = bootClient({ state: 'off' })
  await nextTick()
  await nextTick()
  assert.equal(off.registrations.length, 5, '开关关闭时不该占模型选择器席位')
  off.stub.restore()
})

test('setup / degraded / unknown 三态不抢占模型选择器席位', async () => {
  for (const state of ['setup', 'degraded', 'unknown']) {
    const booted = bootClient({ state })
    await nextTick()
    await nextTick()
    await nextTick()
    assert.equal(booted.registrations.length, 5, `${state} 下不应注册 conversation.input.model`)
    assert.equal(booted.registrations.some((entry) => entry.def.name === 'conversation.input.model'), false)
    booted.stub.restore()
  }
})

test('状态读取失败时席位保持释放（不因 enabled 默认值占座）', async () => {
  const stub = stubFetch((url) => {
    if (url === '/api/jev-harness/token') return jsonResponse({ ok: true, token: 'a'.repeat(64) })
    if (url === '/api/jev-harness/status') throw new Error('boom')
    return undefined
  })
  const loaded = loadClient(reactPkgs(), { fetch: globalThis.fetch })
  const applied = applyClient(loaded, { messages: { 'jev.panel': 'JEV 分级调度' } })
  await nextTick()
  await nextTick()
  await nextTick()
  assert.equal(applied.registrations.some((entry) => entry.def.name === 'conversation.input.model'), false, '读不到状态时必须释放席位')
  stub.restore()
})

test('apply 返回的销毁函数可调用且不抛错', async () => {
  const { dispose, stub } = bootClient({ state: 'off' })
  await nextTick()
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
  stub.restore()
})