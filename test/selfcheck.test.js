/**
 * #7 启动自检：slot / 工具注册失败必须可见，不许白板 + console.warn 了事。
 *
 * 两层分工：#16 的 Error Boundary 管「渲染时抛错」，这里管「注册时就没成功」。
 * 本文件覆盖宿主侧：工具逐个注册的记账、/status.selfCheck、客户端 slot 上报路由。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  boot, callRoute, makeHome, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const SELFCHECK = '/api/jev-harness/selfcheck'
const ENTRY = path.join(import.meta.dirname, '..', 'index.js')

/** 自定义 ctx：让指定工具的注册抛错，验证「失败也可见、也不阻塞」。 */
async function bootWithToolFailure(home, failName) {
  process.env.DSH_HOME = home
  const routes = new Map()
  const tools = new Map()
  const server = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
  const ctx = {
    tools: {
      register(definition) {
        if (definition.name === failName) throw new Error('host refused to register this tool')
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    effect(fn) { return fn() },
    get(name) { return name === 'webServer' ? server : undefined },
    inject(_names, cb) { cb(ctx) },
  }
  const mod = await import(`${pathToFileURL(ENTRY).href}?selfcheck=${process.pid}-${Math.random()}`)
  const dispose = mod.apply(ctx, {})
  if (routes.has('/api/jev-harness/token')) {
    const handshake = await callRoute(routes, '/api/jev-harness/token', {
      origin: null, headers: { 'sec-fetch-site': 'same-origin' },
    })
    if (handshake.status === 200 && handshake.body && handshake.body.token) routes.bridgeToken = handshake.body.token
  }
  return { routes, tools, dispose }
}

test('#7: 正常启动时 /status.selfCheck.ok === true，工具全登记', async () => {
  const home = makeHome('selfcheck-ok')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.ok(status.selfCheck, '/status 必须带 selfCheck')
    assert.equal(status.selfCheck.ok, true)
    assert.equal(status.selfCheck.tools.ok, true)
    assert.deepEqual(status.selfCheck.tools.failures, [])
    for (const name of ['harness_call', 'harness_review', 'harness_skill', 'harness_probe', 'harness_classify']) {
      assert.ok(status.selfCheck.tools.registered.includes(name), `工具 ${name} 未登记`)
    }
    // 客户端还没上报 slot：诚实标 null + reported:false，不假装通过。
    assert.equal(status.selfCheck.slots.ok, null)
    assert.equal(status.selfCheck.slots.reported, false)
    assert.equal(status.selfCheck.slots.failures.length, 0)
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#7: 工具注册失败 → selfCheck 报告具体项与原因，且不阻塞加载', async () => {
  const home = makeHome('selfcheck-tool-fail')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes, tools } = await bootWithToolFailure(home, 'harness_call')
    // apply() 本身不抛就说明「失败不阻塞加载」；宿主侧的清理是 ctx.effect 的职责。
    assert.ok(!tools.has('harness_call'), '坏掉的工具确实没注册上')
    assert.ok(tools.has('harness_review'), '其它工具不受影响')

    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.selfCheck.ok, false, '有失败时 ok 必须是 false')
    assert.equal(status.selfCheck.tools.ok, false)
    assert.equal(status.selfCheck.tools.failures.length, 1)
    assert.equal(status.selfCheck.tools.failures[0].name, 'harness_call')
    assert.match(status.selfCheck.tools.failures[0].error, /refused to register/)
    assert.ok(status.selfCheck.tools.registered.includes('harness_review'))
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#7: 客户端上报 slot 失败 → /status 能读到，红条数据齐全', async () => {
  const home = makeHome('selfcheck-slot-fail')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const report = {
      ok: false,
      total: 7,
      registered: ['main', 'sidebar.panellist', 'conversation.input.left'],
      failures: [{ name: 'plugins.bundle.config', error: 'slot key not found in this host' }],
    }
    const posted = await callRoute(routes, SELFCHECK, { method: 'POST', url: SELFCHECK, body: { slots: report } })
    assert.equal(posted.status, 200)
    assert.equal(posted.body.selfCheck.ok, false)

    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.selfCheck.ok, false, 'slot 失败要拖垮整体 ok')
    assert.equal(status.selfCheck.slots.reported, true)
    assert.equal(status.selfCheck.slots.ok, false)
    assert.equal(status.selfCheck.slots.failures[0].name, 'plugins.bundle.config')
    assert.match(status.selfCheck.slots.failures[0].error, /not found/)
    assert.ok(status.selfCheck.slots.registered.includes('main'))
    assert.ok(status.selfCheck.slots.at, '上报时间要能追溯')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#7: 上报路由的方法与入参校验', async () => {
  const home = makeHome('selfcheck-route-guard')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const get = await callRoute(routes, SELFCHECK, { url: SELFCHECK })
    assert.equal(get.status, 405, '只接受 POST')
    const empty = await callRoute(routes, SELFCHECK, { method: 'POST', url: SELFCHECK, body: {} })
    assert.equal(empty.status, 400, '缺 slots 要 400')
    const noAuth = await callRoute(routes, SELFCHECK, { method: 'POST', url: SELFCHECK, body: { slots: { ok: true } }, token: null })
    assert.equal(noAuth.status, 401, '缺少 bridge token 要 401')
  } finally {
    stub.restore(); removeHome(home)
  }
})