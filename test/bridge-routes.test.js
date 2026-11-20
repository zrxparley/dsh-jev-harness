/**
 * 设置桥五条路由（对应旧的临时脚本 test-bridge.mjs，并按 issue #1 补齐 /stats 与 /test）。
 *
 * 走的是插件真实注册的 route.handler，不绕开任何分支：
 * status 读状态、save 落盘、toggle 改开关、stats 出账、test 探连通。
 * 断言用真实的 <DSH_HOME>/jev-harness.json 校验「用户点保存后确实写进去了」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  boot, callRoute, chatResponse, jsonResponse, makeHome, modelsResponse, readJsonFile,
  removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const SAVE = '/api/jev-harness/save'
const TOGGLE = '/api/jev-harness/toggle'
const STATS = '/api/jev-harness/stats'
const TEST_ROUTE = '/api/jev-harness/test'

test('status / save / toggle / stats / test 五条路由都通，且写盘真的生效', async () => {
  const home = makeHome('bridge')
  const storeFile = writeStore(home)
  const stub = stubFetch((url) => {
    if (url.includes('/chat/completions')) return chatResponse('完成')
    if (url.includes('/models')) return modelsResponse(['m1', 'kimi-k3.1-pro'])
    return undefined
  })
  try {
    const { routes, tools } = await boot({ home })
    assert.deepEqual(
      [...routes.keys()].sort(),
      [
        '/api/jev-harness/dsh/catalog',
        '/api/jev-harness/dsh/models',
        '/api/jev-harness/save',
        '/api/jev-harness/skills/refresh',
        '/api/jev-harness/stats',
        '/api/jev-harness/status',
        '/api/jev-harness/test',
        '/api/jev-harness/toggle',
        '/api/jev-harness/token',
      ],
      '注册的路由集合变了',
    )

    // ---- status：读的是临时 home 里的 store
    const status = await callRoute(routes, STATUS, { url: STATUS })
    assert.equal(status.status, 200)
    assert.equal(status.body.ok, true)
    assert.equal(status.body.enabled, true)
    assert.equal(status.body.file, storeFile, 'status.file 必须指向本次的 DSH_HOME')
    assert.equal(status.body.gateways.jev.baseUrl, 'https://jev.test/v1')
    assert.equal(status.body.gateways.jev.keySet, true)
    assert.equal(status.body.gateways.jev.keyFromSettings, true)
    assert.deepEqual(status.body.tiers, { decision: 'kimi', execution: 'dsf' })

    // ---- save：只提交 kimi.model，其余字段（尤其密钥）不能被抹掉
    const saved = await callRoute(routes, SAVE, { method: 'POST', body: { enabled: true, kimi: { model: 'kimi-k3.1-pro' } } })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.ok, true)
    assert.equal(saved.body.enabled, true)
    const afterSave = readJsonFile(storeFile)
    assert.equal(afterSave.kimiModel, 'kimi-k3.1-pro')
    assert.equal(afterSave.jevApiKey, 'test-jev-key', '没提交的密钥必须原样保留')
    assert.equal(afterSave.jevBaseUrl, 'https://jev.test/v1')

    // ---- save 的校验分支
    const badMode = await callRoute(routes, SAVE, { method: 'POST', body: { routeMode: 'sideways' } })
    assert.equal(badMode.status, 400)
    const badBody = await callRoute(routes, SAVE, { method: 'POST', body: 'not json' })
    assert.equal(badBody.status, 400)

    // ---- toggle：关掉后工具必须让位，且状态落盘
    const off = await callRoute(routes, TOGGLE, { method: 'POST', body: { enabled: false } })
    assert.equal(off.status, 200)
    assert.equal(off.body.enabled, false)
    assert.equal((await callRoute(routes, STATUS, { url: STATUS })).body.enabled, false)
    assert.equal(readJsonFile(storeFile).enabled, false, '开关必须写盘')

    const callWhileOff = await tools.get('harness_call').execute({ task: 'x', tier: 'execution', skill: 'off' }, {})
    assert.equal(callWhileOff.ok, false)
    assert.ok(String(callWhileOff.note).includes('switch is OFF'), `关闭时 harness_call 的说明不对：${callWhileOff.note}`)
    const classifyWhileOff = await tools.get('harness_classify').execute({ task: '评审方案' }, {})
    assert.equal(classifyWhileOff.ok, false)

    const on = await callRoute(routes, TOGGLE, { method: 'POST', body: { enabled: true } })
    assert.equal(on.status, 200)
    assert.equal(on.body.enabled, true)
    assert.equal((await callRoute(routes, STATUS, { url: STATUS })).body.enabled, true)

    const badToggle = await callRoute(routes, TOGGLE, { method: 'POST', body: { enabled: 'maybe' } })
    assert.equal(badToggle.status, 400, 'enabled 不是布尔就该 400')

    // ---- stats：空账本也要有 24 个桶
    const stats = await callRoute(routes, STATS, { url: `${STATS}?hours=24` })
    assert.equal(stats.status, 200)
    assert.equal(stats.body.grain, 'hour')
    assert.equal(stats.body.buckets.length, 24)
    assert.equal(stats.body.totals.jev.calls, 0)
    assert.equal(stats.body.file, path.join(home, 'jev-harness-usage.json'))

    // ---- test：三个网关各探一次 /models
    const probeAll = await callRoute(routes, TEST_ROUTE, { method: 'POST' })
    assert.equal(probeAll.status, 200)
    assert.equal(probeAll.body.ok, true)
    assert.deepEqual(probeAll.body.results.map((entry) => entry.key), ['jev', 'kimi', 'dsf'])
    assert.ok(probeAll.body.results.every((entry) => entry.ok === true), '三个网关都应探测成功')
    assert.ok(probeAll.body.results[1].models.includes('kimi-k3.1-pro'), '探测应回显真实提供的模型 id')
    const modelCalls = stub.urls().filter((url) => url.endsWith('/models'))
    assert.equal(modelCalls.length, 3, `应只探 3 次 /models，实际 ${modelCalls.length}`)

    // ---- 方法护栏
    assert.equal((await callRoute(routes, SAVE, { method: 'GET' })).status, 405)
    assert.equal((await callRoute(routes, TOGGLE, { method: 'GET' })).status, 405)
    assert.equal((await callRoute(routes, STATS, { method: 'POST', body: {}, url: STATS })).status, 405)
    assert.equal((await callRoute(routes, TEST_ROUTE, { method: 'GET' })).status, 405)

    // ---- 非本机 Host 一律拒绝（浏览器里别的站点不该能改这套设置）
    const evil = await callRoute(routes, STATUS, { url: STATUS, headers: { host: 'evil.example:61434' } })
    assert.equal(evil.status, 403)
    assert.equal(evil.body.ok, false)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('没有 store 文件时也能起来，status 给出未配置的诚实状态', async () => {
  const home = makeHome('bridge-empty')
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home, config: { jevBaseUrl: '', jevApiKey: '', kimiBaseUrl: '', kimiApiKey: '', dsfBaseUrl: '', dsfApiKey: '' } })
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.ok, true)
    assert.equal(status.gateways.jev.baseUrl, '')
    assert.equal(status.gateways.jev.keySet, false)
    assert.equal(status.gateways.jev.baseFromSettings, false)

    const probe = await callRoute(routes, TEST_ROUTE, { method: 'POST' })
    assert.equal(probe.status, 200)
    assert.equal(probe.body.ok, false, '什么都没配的时候探测不该报成功')
    assert.ok(probe.body.results.every((entry) => entry.ok === false))
    assert.deepEqual(stub.urls(), [], '没配置 base URL 时不该发请求')
  } finally {
    stub.restore()
    removeHome(home)
  }
})