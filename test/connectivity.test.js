/**
 * #19 「测试连通」：测的是表单当前值、结果分级、进度与取消。
 *
 * 三条关键回归：
 *   1. 单个网关探测（进度与「1/3」计数靠它）；
 *   2. 未保存的表单值只用于这次探测，不写 store；
 *   3. Kimi 挂 / JEV 通 → 琥珀 warn，不再整体绿色。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  boot, callRoute, jsonResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'
import { applyClient, loadClient, requireReactOrSkip } from './helpers/client.js'

const TEST_ROUTE = '/api/jev-harness/test'
const { pkgs: reactPkgs, skip } = requireReactOrSkip()

function stubGateways({ failing = [] } = {}) {
  const hits = []
  const stub = stubFetch((url) => {
    hits.push(String(url))
    const bad = failing.some((key) => String(url).includes(`${key}.test`))
    return jsonResponse({ data: [{ id: bad ? 'x' : 'real-model' }] }, bad ? 401 : 200)
  })
  return { stub, hits }
}

test('#19: 单网关探测只打一个网关，并带上 total=3', async () => {
  const home = makeHome('probe-one')
  writeStore(home)
  const { stub, hits } = stubGateways()
  try {
    const { routes } = await boot({ home })
    const body = (await callRoute(routes, TEST_ROUTE, { method: 'POST', url: TEST_ROUTE, body: { gateway: 'kimi' } })).body
    assert.equal(body.results.length, 1, '只返回一个网关的结果')
    assert.equal(body.results[0].key, 'kimi')
    assert.equal(body.total, 3, '总网关数仍是 3，客户端才能算 1/3')
    assert.equal(body.partial, true)
    assert.equal(hits.filter((url) => url.includes('/models')).length, 1, '只发一次探测请求')
    assert.ok(hits[0].includes('kimi.test'), '打的是 kimi 的地址')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#19: 未保存的表单值参与探测，但不写进 store', async () => {
  const home = makeHome('probe-override')
  writeStore(home)
  const { stub, hits } = stubGateways()
  try {
    const { routes } = await boot({ home })
    const body = (await callRoute(routes, TEST_ROUTE, {
      method: 'POST',
      url: TEST_ROUTE,
      body: { gateway: 'kimi', overrides: { kimi: { baseUrl: 'https://draft.example/v1', apiKey: 'sk-draft', model: 'draft-model' } } },
    })).body
    assert.equal(body.usedOverrides, true)
    assert.ok(hits.some((url) => url.includes('draft.example')), '探测必须打表单里刚填的地址')
    const store = readJsonFile(path.join(home, 'jev-harness.json'))
    assert.ok(!JSON.stringify(store).includes('draft.example'), '没点保存就不许落盘')
    assert.ok(!JSON.stringify(store).includes('sk-draft'), '草稿密钥不许落盘')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#19: 结果分级——部分失败是琥珀，全失败才是红', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { probeSummary } = loaded.exports.__test

  const partial = probeSummary([{ key: 'jev', ok: true }, { key: 'kimi', ok: false }, { key: 'dsf', ok: false }], 3)
  assert.equal(partial.ok, 1)
  assert.equal(partial.total, 3)
  assert.equal(partial.tone, 'warn', 'Kimi 挂了、JEV 通 → 琥珀，不是绿')
  assert.deepEqual(partial.failed, ['kimi', 'dsf'])

  const allDead = probeSummary([{ key: 'jev', ok: false }, { key: 'kimi', ok: false }, { key: 'dsf', ok: false }], 3)
  assert.equal(allDead.tone, 'bad')

  const allGood = probeSummary([{ key: 'jev', ok: true }, { key: 'kimi', ok: true }, { key: 'dsf', ok: true }], 3)
  assert.equal(allGood.tone, 'good')
})

test('#19: 逐个探测有进度、取消后不再发请求', { skip }, async () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { runProbes, PROBE_ORDER } = loaded.exports.__test
  assert.deepEqual(JSON.parse(JSON.stringify(PROBE_ORDER)), ['jev', 'kimi', 'dsf'], '进度顺序：JEV → Kimi → Flash')

  const seen = []
  const res = await runProbes({
    gateways: PROBE_ORDER,
    call: async (key) => { seen.push(key); return { results: [{ key, ok: key !== 'kimi' }] } },
    onProgress: ({ index, total, key }) => seen.push(`progress:${key}:${index}/${total}`),
  })
  assert.deepEqual(seen, [
    'progress:jev:1/3', 'jev', 'progress:kimi:2/3', 'kimi', 'progress:dsf:3/3', 'dsf',
  ])
  assert.equal(res.cancelled, false)
  assert.equal(res.results.length, 3)

  // 取消：第一次探测后置位，后续不再发请求。
  let cancelled = false
  const afterCancel = []
  const stopped = await runProbes({
    gateways: PROBE_ORDER,
    call: async (key) => { afterCancel.push(key); cancelled = true; return { results: [{ key, ok: true }] } },
    isCancelled: () => cancelled,
  })
  assert.deepEqual(afterCancel, ['jev'], '取消后只发了第一个请求')
  assert.equal(stopped.cancelled, true)
  assert.equal(stopped.results.length, 1)
})
