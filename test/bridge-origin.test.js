/**
 * 设置桥的来源校验（issue #26）。
 *
 * 验收原文：
 * - 无 Origin 的 POST /save 返回 403，且不会改写任何字段
 * - 无 Origin 的 GET /status 返回 403（或脱敏）
 * - 三个合法来源（127.0.0.1 / localhost / [::1]）的自带 Origin 请求正常
 * - 有一条测试用例固定这张矩阵
 *
 * 说明：浏览器同源 GET 不带 Origin，只带 Fetch 元数据；所有写请求（POST）
 * 一律要求精确 Origin。所以「无 Origin 的 GET」分两种：带 Sec-Fetch-Site 的
 * 浏览器请求放行，裸进程（curl）一律 403。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  boot, callRoute, makeHome, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const SAVE = '/api/jev-harness/save'
const TOGGLE = '/api/jev-harness/toggle'
const STATS = '/api/jev-harness/stats'
const REFRESH = '/api/jev-harness/skills/refresh'

async function withBridge(run) {
  const home = makeHome('bridge-origin')
  const storeFile = writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    await run({ routes, storeFile })
  } finally {
    stub.restore()
    removeHome(home)
  }
}

test('无 Origin 的 POST /save：403 且一个字段都不改', async () => {
  await withBridge(async ({ routes, storeFile }) => {
    const before = fs.readFileSync(storeFile)
    const response = await callRoute(routes, SAVE, {
      method: 'POST',
      origin: null,
      body: { jev: { baseUrl: 'https://attacker.example/v1', apiKey: 'pwned' } },
    })
    assert.equal(response.status, 403)
    assert.equal(response.body.ok, false)
    assert.deepEqual(fs.readFileSync(storeFile), before, '被拒的请求不许落盘任何字段')

    // 其它写路由同样必须带 Origin
    for (const [path, opts] of [
      [TOGGLE, { method: 'POST', origin: null, body: { enabled: false } }],
      [REFRESH, { method: 'POST', origin: null }],
    ]) {
      assert.equal((await callRoute(routes, path, opts)).status, 403, `${path} 无 Origin 应 403`)
    }
  })
})

test('无 Origin 的 GET：裸进程 403，浏览器同源请求放行', async () => {
  await withBridge(async ({ routes }) => {
    const bare = await callRoute(routes, STATUS, { url: STATUS, origin: null })
    assert.equal(bare.status, 403, 'curl 这类无 Origin 无 Fetch 元数据的 GET 必须被拒')
    assert.equal(bare.body.gateways, undefined, '拒绝响应里不许回显任何来源位')

    const stats = await callRoute(routes, STATS, { url: `${STATS}?hours=24`, origin: null })
    assert.equal(stats.status, 403)

    // 浏览器同源 GET 不带 Origin，只带 Sec-Fetch-Site
    const browser = await callRoute(routes, STATUS, {
      url: STATUS,
      origin: null,
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    assert.equal(browser.status, 200, '面板的同源 GET 不能被误杀')
    assert.equal(browser.body.ok, true)
    assert.ok(browser.body.gateways, '浏览器请求仍要能看到设置')
  })
})

test('三个合法 loopback 来源：自带同源 Origin 时 GET 与写操作都通过', async () => {
  await withBridge(async ({ routes }) => {
    for (const host of ['127.0.0.1:61434', 'localhost:61434', '[::1]:61434']) {
      const status = await callRoute(routes, STATUS, { url: STATUS, headers: { host } })
      assert.equal(status.status, 200, `${host} 的 GET /status 应通过`)

      const toggle = await callRoute(routes, TOGGLE, {
        method: 'POST',
        headers: { host },
        body: { enabled: true },
      })
      assert.equal(toggle.status, 200, `${host} 的 POST /toggle 应通过`)
    }
  })
})

test('伪造来源矩阵：外来 Origin / null / 后缀 / https / 非 loopback Host 全拒', async () => {
  await withBridge(async ({ routes }) => {
    const cases = [
      ['外来 Origin', { origin: 'http://evil.example' }],
      ['Origin: null', { origin: 'null' }],
      ['后缀伪装', { origin: 'http://127.0.0.1:61434.evil.example' }],
      ['https 协议', { origin: 'https://127.0.0.1:61434' }],
      ['非 loopback Host', { headers: { host: 'evil.example:61434' }, origin: 'http://evil.example:61434' }],
      ['带路径的 Origin', { origin: 'http://127.0.0.1:61434/path' }],
    ]
    for (const [label, opts] of cases) {
      const response = await callRoute(routes, STATUS, { url: STATUS, ...opts })
      assert.equal(response.status, 403, `${label} 应被拒绝`)
    }
  })
})
