/**
 * 状态真实化（issue #13）：/status 计算 state，客户端只渲染。
 *
 * 验收原文：
 * - 全新安装无配置时，芯片与面板同显「JEV 还差一步」，任何位置不出现「接管中」
 * - same state 下模型选择器可用（seat 只在 ready 占）
 * - /status 失败显示「状态未知 · 点击重试」，不显示成「已让位」
 * - 切换失败 toast 带原因与重试入口
 * - /status 返回 state，客户端不再从 enabled 推断
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  REACT_MISSING, applyClient, findSlot, loadClient, render, requireReactOrSkip, resolveReact, visibleText,
} from './helpers/client.js'
import {
  boot, callRoute, makeHome, removeHome, stubFetch, writeJsonFile, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const { pkgs: reactPkgs, skip: reactSkip } = requireReactOrSkip()

async function stateOf(home, store = {}) {
  writeStore(home, store)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    return (await callRoute(routes, STATUS, { url: STATUS })).body
  } finally {
    stub.restore()
  }
}

test('/status.state：ready / setup / off / degraded 四态由宿主计算', async () => {
  const home = makeHome('state-matrix')
  try {
    const ready = await stateOf(home)
    assert.equal(ready.state, 'ready', '配齐两个网关且没有失败调用时应为 ready')
    assert.equal(ready.enabled, true)

    const setup = await stateOf(home, { kimiBaseUrl: '' })
    assert.equal(setup.state, 'setup', '缺网关地址时必须是 setup，不能显示成 ready')

    const off = await stateOf(home, { enabled: false })
    assert.equal(off.state, 'off')

    // 最近一次调用失败 → degraded（读同一份账本）
    writeStore(home)
    writeJsonFile(path.join(home, 'jev-harness-usage.json'), {
      version: 1,
      hours: {},
      days: {},
      recent: [{ t: new Date().toISOString(), g: 'kimi', m: 'kimi-k3.1-pro', tool: 'call', ok: false, status: 500, ms: 10, pt: 0, ct: 0 }],
      decisions: [],
    })
    const stub = stubFetch(() => undefined)
    try {
      const { routes } = await boot({ home })
      const degraded = (await callRoute(routes, STATUS, { url: STATUS })).body
      assert.equal(degraded.state, 'degraded', '最近一次调用失败应标 degraded')
    } finally {
      stub.restore()
    }
  } finally {
    removeHome(home)
  }
})

test('客户端文案映射：setup 是「JEV 还差一步」，只有 ready 才出现「接管中」', { skip: reactSkip }, () => {
  const loaded = loadClient(reactPkgs)
  const { stateBadge } = loaded.exports.__test
  const labels = {}
  for (const state of ['ready', 'setup', 'off', 'degraded', 'unknown']) labels[state] = stateBadge(state).label
  assert.equal(labels.ready, 'JEV 接管中')
  assert.equal(labels.setup, 'JEV 还差一步')
  assert.equal(labels.off, 'JEV 已让位')
  assert.equal(labels.degraded, 'JEV 异常')
  assert.equal(labels.unknown, '状态未知')
  assert.ok(!labels.setup.includes('接管中'), 'setup 不许出现「接管中」')
  assert.ok(!labels.off.includes('接管中'))
  assert.ok(!labels.unknown.includes('已让位'), '读取失败不能显示成已让位')
})

test('面板首帧（未读到状态）显示「状态未知」，不显示「接管中」', { skip: reactSkip }, () => {
  const loaded = loadClient(reactPkgs)
  const { registrations } = applyClient(loaded)
  const main = findSlot(registrations, 'main')
  const text = visibleText(render(reactPkgs, main.comp, {}))
  assert.ok(text.includes('状态未知'), '首帧应显示状态未知')
  assert.ok(!text.includes('接管中'), '未读到状态时不许显示「接管中」')
  assert.ok(text.includes('JEV 未就绪，模型选择已临时恢复'), '未就绪时要说明模型选择已恢复')
})
