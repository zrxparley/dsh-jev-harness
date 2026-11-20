/**
 * 设置桥的 token 机制（issue #26 part 2）。
 *
 * 需求原文：每会话生成随机 token（启动时写进内存）、经 bootstrap 交给自己的
 * 客户端、桥路由要求 `Authorization: Bearer <token>`、token 不进 URL。
 *
 * 验收矩阵：
 * - bootstrap（GET /token）：带浏览器 Fetch 元数据 → 200；裸进程 → 403；外来 Origin → 403
 * - 除 bootstrap 外的所有路由：不带 token → 401；token 错 → 401；token 对 → 正常
 * - 无 token 的 POST /save 不改任何字段
 * - token 每个进程一份（两次 boot 不同），且不出现在 /status 响应里
 *
 * 注意：bootstrap 本身仍靠 Origin / Sec-Fetch 闸放行——本地进程可以伪造这些头，
 * 因此 token 挡的是「不知道要伪造的脚本」，不是有决心的本机攻击者。真正的修法需要
 * 宿主提供「页面能读、本机进程读不到」的通道，DSH 目前没有（__DSH_BOOT__ 条目只有
 * id/url/rev/inject/external/immediately）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  boot, callRoute, makeHome, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const TOKEN = '/api/jev-harness/token'
const STATUS = '/api/jev-harness/status'
const SAVE = '/api/jev-harness/save'
const STATS = '/api/jev-harness/stats'
const TOGGLE = '/api/jev-harness/toggle'

async function withBridge(run) {
  const home = makeHome('bridge-token')
  const storeFile = writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const booted = await boot({ home })
    await run({ ...booted, storeFile })
  } finally {
    stub.restore()
    removeHome(home)
  }
}

test('bootstrap：浏览器同源请求拿到 64 位十六进制 token，裸进程与外来来源拿不到', async () => {
  await withBridge(async ({ routes }) => {
    const browser = await callRoute(routes, TOKEN, {
      origin: null,
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    assert.equal(browser.status, 200)
    assert.match(browser.body.token, /^[0-9a-f]{64}$/)
    assert.equal(browser.body.ok, true)

    const bare = await callRoute(routes, TOKEN, { origin: null })
    assert.equal(bare.status, 403, '无 Origin 无 Fetch 元数据的裸请求不该拿到 token')

    const foreign = await callRoute(routes, TOKEN, { origin: 'http://evil.example' })
    assert.equal(foreign.status, 403)

    const post = await callRoute(routes, TOKEN, { method: 'POST', body: {} })
    assert.equal(post.status, 405)
  })
})

test('除 bootstrap 外全部要求 Bearer：缺 token / 错 token 都是 401', async () => {
  await withBridge(async ({ routes }) => {
    for (const path of [STATUS, STATS]) {
      const missing = await callRoute(routes, path, { url: path === STATS ? `${STATS}?hours=24` : path, token: null })
      assert.equal(missing.status, 401, `${path} 缺 token 应 401`)
      const wrong = await callRoute(routes, path, { url: path === STATS ? `${STATS}?hours=24` : path, token: 'deadbeef' })
      assert.equal(wrong.status, 401, `${path} 错 token 应 401`)
      assert.equal(missing.body.gateways, undefined, '401 响应不许回显任何设置')
    }

    const malformed = await callRoute(routes, STATUS, { url: STATUS, headers: { authorization: 'Basic abc' }, token: null })
    assert.equal(malformed.status, 401, '非 Bearer 方案应 401')
  })
})

test('正确 token 下一切照常；无 token 的写请求不改任何字段', async () => {
  await withBridge(async ({ routes, storeFile, token }) => {
    const before = fs.readFileSync(storeFile)

    const denied = await callRoute(routes, SAVE, {
      method: 'POST',
      token: null,
      body: { jev: { baseUrl: 'https://attacker.example/v1', apiKey: 'pwned' } },
    })
    assert.equal(denied.status, 401)
    assert.deepEqual(fs.readFileSync(storeFile), before, '未授权写请求不许落盘')

    const status = await callRoute(routes, STATUS, { url: STATUS })
    assert.equal(status.status, 200)
    assert.equal(status.body.ok, true)

    const toggle = await callRoute(routes, TOGGLE, { method: 'POST', body: { enabled: false } })
    assert.equal(toggle.status, 200)
    assert.equal(toggle.body.enabled, false)

    // token 不许出现在 /status 的任何字段里
    assert.equal(JSON.stringify(status.body).includes(token), false, 'token 泄漏进了 /status')
  })
})

test('token 每个进程一份：两次 boot 的 token 不同且都不等于空串', async () => {
  const homeA = makeHome('token-a')
  const homeB = makeHome('token-b')
  writeStore(homeA)
  writeStore(homeB)
  const stub = stubFetch(() => undefined)
  try {
    const a = await boot({ home: homeA })
    const b = await boot({ home: homeB })
    assert.match(a.routes.bridgeToken, /^[0-9a-f]{64}$/)
    assert.match(b.routes.bridgeToken, /^[0-9a-f]{64}$/)
    assert.notEqual(a.routes.bridgeToken, b.routes.bridgeToken)

    // A 的 token 不能读 B 的路由
    const cross = await callRoute(b.routes, STATUS, { url: STATUS, token: a.routes.bridgeToken })
    assert.equal(cross.status, 401, '一个进程的 token 不能跨进程使用')
  } finally {
    stub.restore()
    removeHome(homeA)
    removeHome(homeB)
  }
})
