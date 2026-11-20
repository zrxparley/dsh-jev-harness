/**
 * 默认模型 id 与「营销名 404」的人话错误（issue #29）。
 *
 * 红命令（修复前实测）：store 里填 `kimiModel: 'K3.1Pro'` 调 harness_call →
 * 只有 `HTTP 404 from kimi: {"error":{"message":"model 'K3.1Pro' not found"}}`，
 * 用户不知道真实 id 是什么。
 *
 * 这里锁四件事：
 * - 默认就是真实 id，且与 cordis.patch.yml 一致
 * - 营销名触发 404 时，错误里带「可用模型 id 示例」（从 /models 回捞）
 * - 正确 id + 只填 base/密钥时，probe 三个网关全通
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  REPO, boot, callRoute, jsonResponse, makeHome, readFixture, removeHome,
  stubFetch, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const TEST_ROUTE = '/api/jev-harness/test'

/** 全新安装：只填 base URL 与密钥，不写 model 字段。 */
function storeWithOnlyCredentials(home) {
  const base = readFixture('store.json')
  const store = { ...base }
  for (const key of ['kimiModel', 'dsfModel', 'jevModel']) delete store[key]
  fs.writeFileSync(path.join(home, 'jev-harness.json'), JSON.stringify(store), { mode: 0o600 })
}

function patchDefaults() {
  const text = fs.readFileSync(path.join(REPO, 'cordis.patch.yml'), 'utf8')
  const pick = (key) => {
    const match = text.match(new RegExp(`^\\s*${key}:\\s*'([^']*)'`, 'm'))
    return match ? match[1] : null
  }
  return { kimiModel: pick('kimiModel'), dsfModel: pick('dsfModel'), jevModel: pick('jevModel') }
}

test('默认模型 id 是真实 id，并与 cordis.patch.yml 一致', async () => {
  const home = makeHome('model-defaults')
  storeWithOnlyCredentials(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    const patch = patchDefaults()

    assert.equal(status.gateways.kimi.model, 'kimi-k3.1-pro')
    assert.equal(status.gateways.dsf.model, 'deepseek-v4.1-flash-1017')
    assert.equal(status.gateways.jev.model, 'jev-latest')

    assert.equal(status.gateways.kimi.model, patch.kimiModel, '代码默认值与 cordis.patch.yml 不一致')
    assert.equal(status.gateways.dsf.model, patch.dsfModel, '代码默认值与 cordis.patch.yml 不一致')
    assert.equal(status.gateways.jev.model, patch.jevModel, '代码默认值与 cordis.patch.yml 不一致')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('全新安装只填 base URL 与密钥：probe 三个网关全通', async () => {
  const home = makeHome('model-probe')
  storeWithOnlyCredentials(home)
  const stub = stubFetch((url) => (String(url).includes('/models')
    ? jsonResponse({ data: [{ id: 'kimi-k3.1-pro' }, { id: 'deepseek-v4.1-flash-1017' }, { id: 'jev-latest' }] })
    : undefined))
  try {
    const { routes } = await boot({ home })
    const probe = await callRoute(routes, TEST_ROUTE, { method: 'POST' })
    assert.equal(probe.status, 200)
    assert.equal(probe.body.ok, true)
    assert.deepEqual(probe.body.results.map((entry) => entry.key), ['jev', 'kimi', 'dsf'])
    assert.ok(probe.body.results.every((entry) => entry.ok === true))
    assert.ok(probe.body.results.every((entry) => entry.models.length > 0), '每个网关都要回显可用 id')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('故意填营销名：错误里给出「可用模型 id 示例」', async () => {
  const home = makeHome('model-marketing')
  writeStore(home, { kimiModel: 'K3.1Pro', dsfModel: 'DeepSeek4.1Flash101' })
  const stub = stubFetch((url) => {
    if (String(url).includes('/models')) {
      return jsonResponse({ data: [{ id: 'kimi-k3.1-pro' }, { id: 'qwen3.8-max' }, { id: 'deepseek-v4.1-flash-1017' }] })
    }
    if (String(url).includes('/chat/completions')) {
      return jsonResponse({ error: { message: "model 'K3.1Pro' not found" } }, 404)
    }
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    const result = await tools.get('harness_call').execute({ task: '评审这个方案', tier: 'decision', skill: 'off' }, {})
    assert.equal(result.ok, false)
    assert.match(String(result.note), /不认识模型 id「K3\.1Pro」/)
    assert.match(String(result.note), /可用模型 id 示例/)
    assert.match(String(result.note), /kimi-k3\.1-pro/)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('/models 不可用时也给出人话，不吞掉原始错误', async () => {
  const home = makeHome('model-no-list')
  writeStore(home, { kimiModel: 'K3.1Pro' })
  const stub = stubFetch((url) => {
    if (String(url).includes('/models')) return jsonResponse({ error: 'nope' }, 500)
    if (String(url).includes('/chat/completions')) return jsonResponse({ error: { message: "model 'K3.1Pro' not found" } }, 404)
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    const result = await tools.get('harness_call').execute({ task: '评审', tier: 'decision', skill: 'off' }, {})
    assert.equal(result.ok, false)
    assert.match(String(result.note), /不认识模型 id「K3\.1Pro」/)
    assert.match(String(result.note), /测试连通/)
  } finally {
    stub.restore()
    removeHome(home)
  }
})
