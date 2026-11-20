/**
 * #34 补测：调用与路由层（T14、T17–T19、T21–T23）。
 *
 * 只补断言，不改行为。T15/T16 的期望（失败要 fail+1）与当前实现不一致，
 * 已单独报给 Chief，不在这里写成「通过」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, callRoute, chatResponse, jsonResponse, makeHome, readJsonFile, removeHome,
  stubFetch, textResponse, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const STATUS = '/api/jev-harness/status'
const SAVE = '/api/jev-harness/save'

test('#34 T14: temperature 被网关拒绝时去掉参数重试一次，只记 1 次成功', async () => {
  const home = makeHome('spec-t14')
  writeStore(home)
  const chatBodies = []
  const stub = stubFetch((url, init) => {
    if (!String(url).includes('/chat/completions')) return undefined
    const body = init && init.body ? JSON.parse(init.body) : {}
    chatBodies.push(body)
    if ('temperature' in body) return textResponse("Parameter 'temperature'=0.2 is not supported", 400)
    return chatResponse('无温度参数也能答')
  })
  try {
    const { tools, routes } = await boot({ home })
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    assert.equal(out.ok, true, '去掉 temperature 后应成功')
    assert.equal(out.text, '无温度参数也能答')
    assert.equal(chatBodies.length, 2, '必须是一次带参数 + 一次不带参数的两次请求')
    assert.ok('temperature' in chatBodies[0], '第一次带 temperature')
    assert.ok(!('temperature' in chatBodies[1]), '重试必须去掉 temperature')

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.totals.dsf.calls, 1, '重试只算 1 次调用')
    assert.equal(stats.totals.dsf.fail, 0, '重试成功不算失败')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T17: 执行层超时按 timeoutExecution 走，500ms 内返回而不是挂到生成超时', async () => {
  const home = makeHome('spec-t17')
  writeStore(home, { timeoutExecution: 50, timeoutDecision: 50 })
  let aborted = 0
  const stub = stubFetch((url, init) => {
    if (!String(url).includes('/chat/completions')) return undefined
    return new Promise((_resolve, reject) => {
      const signal = init && init.signal
      const onAbort = () => { aborted += 1; reject(new Error('The operation was aborted')) }
      if (signal && signal.aborted) return onAbort()
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
    })
  })
  const startedAt = Date.now()
  try {
    const { tools, routes } = await boot({ home })
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    const elapsed = Date.now() - startedAt
    assert.ok(elapsed < 500, `必须在 500ms 内返回，实际 ${elapsed}ms`)
    assert.equal(out.ok, false, '两个网关都超时时应失败')
    assert.equal(aborted, 2, '主备各被 abort 一次（说明都用了短超时）')
    assert.ok(!/non-JSON|undefined/.test(String(out.note)), `note 应是超时原因：${out.note}`)

    // #34 T17 的最后一格：超时不是「返回了就算」，账本里必须真的记成失败。
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    const fails = Object.values(stats.totals).reduce((sum, entry) => sum + entry.fail, 0)
    assert.equal(fails, 2, `超时必须记失败（主备各 1 条），实际 ${fails}`)
    assert.equal(stats.recent.length, 2, '两条超时都要出现在 recent 里')
    assert.ok(stats.recent.every((row) => row.ok === false), 'recent 行必须是失败')
    assert.ok(stats.recent.every((row) => row.status === 0), '没拿到响应：status 记 0')
    assert.ok(stats.recent.every((row) => String(row.error).length > 0), '失败记录要带原因原文')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T18: 总开关 OFF 时 harness_call 零 fetch', async () => {
  const home = makeHome('spec-t18')
  writeStore(home, { enabled: false })
  const urls = []
  const stub = stubFetch((url) => { urls.push(String(url)); return undefined })
  try {
    const { tools } = await boot({ home })
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution' }, {})
    assert.equal(out.ok, false)
    assert.match(String(out.note), /OFF|关闭/, `应返回 DISABLED note：${out.note}`)
    assert.deepEqual(urls, [], '关掉开关后一个请求都不许发')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T19: 模型 id 404 时报出 model id + provider + 404，且不重试', async () => {
  const home = makeHome('spec-t19')
  writeStore(home)
  const chatCalls = []
  const modelCalls = []
  const stub = stubFetch((url) => {
    if (String(url).includes('/chat/completions')) {
      chatCalls.push(String(url))
      return textResponse('{"error":"model not found"}', 404)
    }
    if (String(url).includes('/models')) {
      modelCalls.push(String(url))
      return jsonResponse({ data: [{ id: 'real-model-a' }, { id: 'real-model-b' }] })
    }
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    assert.equal(out.ok, false)
    const note = String(out.note)
    assert.match(note, /404/, 'note 要带 HTTP 状态')
    assert.match(note, /dsf/, 'note 要说明是哪个 provider')
    assert.match(note, /deepseek-v4\.1-flash-1017/, 'note 要带出错的那个 model id')
    assert.match(note, /real-model-a/, 'note 要给可用模型 id 示例')
    assert.equal(chatCalls.length, 1, '4xx 是配置错误，不许重试')
    assert.equal(modelCalls.length, 1, '回捞模型列表只做一次')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T21: GET /save 405、坏 JSON 400、70KB body 400', async () => {
  const home = makeHome('spec-t21')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const getSave = await callRoute(routes, SAVE, { method: 'GET', url: SAVE })
    assert.equal(getSave.status, 405)
    const big = JSON.stringify({ enabled: true, pad: 'x'.repeat(70 * 1024) })
    assert.ok(Buffer.byteLength(big) > 65536)
    const tooBig = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: big })
    assert.equal(tooBig.status, 400, '超过 64KB 的 body 必须 400，不许吞掉')
    const malformed = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: '{not json' })
    assert.equal(malformed.status, 400)
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T22: /save 三态——空串保留、null 清空、baseUrl 空串删 override、响应无明文', async () => {
  const home = makeHome('spec-t22')
  writeStore(home)
  const storeFile = path.join(home, 'jev-harness.json')
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const before = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(before.gateways.kimi.keySet, true, '前置：fixture 里 kimi key 已设置')
    assert.equal(before.gateways.kimi.baseFromSettings, true, '前置：fixture 里 kimi base 在 store')

    // 1) 空串 = 保留已有密钥
    const keep = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { kimi: { apiKey: '' } } })
    assert.equal(keep.status, 200)
    assert.equal(readJsonFile(storeFile).kimiApiKey, 'test-kimi-key', '空串不许清掉密钥')
    assert.ok(!JSON.stringify(keep.body).includes('test-kimi-key'), '响应里不许出现明文密钥')

    // 2) null = 清空
    const cleared = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { dsf: { apiKey: null } } })
    assert.equal(cleared.status, 200)
    assert.ok(!readJsonFile(storeFile).dsfApiKey, 'null 必须清空（writeStore 对空值删键，缺键即清空）')
    const afterClear = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(afterClear.gateways.dsf.keySet, false)

    // 3) baseUrl 空串 = 删掉 store 里的 override
    const removed = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { jev: { baseUrl: '' } } })
    assert.equal(removed.status, 200)
    assert.ok(!readJsonFile(storeFile).jevBaseUrl, 'baseUrl 空串要删掉 store 里的 override')
    const afterBase = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(afterBase.gateways.jev.baseFromSettings, false, 'baseFromSettings 必须变 false')
    assert.equal(afterBase.gateways.jev.baseUrl, '', '没有 config 兜底时 baseUrl 为空')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T23: 只有 config 提供 baseUrl 时，/save 之后 baseFromSettings 仍为 false（不冻结 config）', async () => {
  const home = makeHome('spec-t23')
  writeStore(home, { kimiBaseUrl: '' }) // store 里没有 kimi base
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home, config: { kimiBaseUrl: 'https://config-only.test/v1' } })
    const before = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(before.gateways.kimi.baseUrl, 'https://config-only.test/v1')
    assert.equal(before.gateways.kimi.baseFromSettings, false, 'config 来源不算 settings')

    // 只改别的东西：不碰 kimi base，也不该把 config 值「冻结」进 store。
    const saved = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { enabled: true, kimi: { apiKey: 'new-key' } } })
    assert.equal(saved.status, 200)
    const store = readJsonFile(path.join(home, 'jev-harness.json'))
    assert.ok(!store.kimiBaseUrl, 'config 的 baseUrl 不许被写进 store')
    const after = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(after.gateways.kimi.baseFromSettings, false, '/save 之后仍是 config 来源')
    assert.equal(after.gateways.kimi.baseUrl, 'https://config-only.test/v1')
    assert.equal(after.gateways.kimi.keySet, true, '这次真的改了 key')
    assert.equal(store.kimiApiKey, 'new-key')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T21: POST /status 405（#34 期望，已修）', async () => {
  const home = makeHome('spec-t21-post')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const postStatus = await callRoute(routes, STATUS, { method: 'POST', url: STATUS, body: {} })
    assert.equal(postStatus.status, 405, '/status 只接受 GET')
    assert.equal(postStatus.body.ok, false)
    const getStatus = await callRoute(routes, STATUS, { url: STATUS })
    assert.equal(getStatus.status, 200, 'GET 仍然正常')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T15: 网关回非 JSON（200 + <html>502</html>）→ ok:false 且账本记失败', async () => {
  const home = makeHome('spec-t15')
  writeStore(home)
  const stub = stubFetch((url) => (String(url).includes('/chat/completions') ? textResponse('<html>502</html>', 200) : undefined))
  try {
    const { tools, routes } = await boot({ home })
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    assert.equal(out.ok, false)
    assert.match(String(out.note), /non-JSON response/)
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    const fails = Object.values(stats.totals).reduce((sum, entry) => sum + entry.fail, 0)
    // 主备各试一次（#3 降级链），每次真正发出去的请求各记一条失败。
    assert.equal(fails, 2, `失败必须可见（主备各 1 条），实际 ${fails}`)
    assert.equal(stats.recent.length, 2, '两条失败都要出现在 recent 里')
    for (const row of stats.recent) {
      assert.equal(row.ok, false)
      assert.match(String(row.error), /non-JSON response/, `失败记录要带 error 原文：${row.error}`)
    }
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#34 T16: 执行层 fetch reject → ok:false 且账本记失败并带原文', async () => {
  const home = makeHome('spec-t16')
  writeStore(home)
  const stub = stubFetch((url) => {
    if (String(url).includes('/chat/completions')) throw new Error('ECONNRESET boom')
    return undefined
  })
  try {
    const { tools, routes } = await boot({ home })
    const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution', skill: 'off' }, {})
    assert.equal(out.ok, false)
    assert.match(String(out.note), /ECONNRESET boom/, 'note 要带网络错误原文')
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    const fails = Object.values(stats.totals).reduce((sum, entry) => sum + entry.fail, 0)
    assert.equal(fails, 2, `失败必须可见（主备各 1 条），实际 ${fails}`)
    assert.equal(stats.recent.length, 2)
    assert.ok(stats.recent.every((row) => /ECONNRESET boom/.test(String(row.error))), '每条都要带原文')
    assert.ok(stats.recent.every((row) => row.status === 0), '状态 0 = 发出去了但没拿到响应，不伪造成 200')
  } finally {
    stub.restore(); removeHome(home)
  }
})
