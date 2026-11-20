/**
 * 空闲连接不许被 4 秒一刀切（issue #38）。
 *
 * 红点（修复前）：`chat()` 用全局 `fetch`（undici），默认 keepAliveTimeout 4s。
 * 判定是「一条消息一次」，间隔远超 4s，于是每一轮都重付一次 TCP + TLS 握手。
 * 实测 2026-11-20：空闲 3s 仍复用（297.6ms），空闲 4s 就新建连接（1083.9ms）。
 *
 * 这里用真实本地 HTTP 服务（不装 fetch 桩）锁两件事：
 * 1. 空闲 21s 后第二次调用，服务端只见过 1 条连接 —— 连接真的被留住了；
 * 2. 复用的连接被对端悄悄掐断时，换新连接重试一次并成功（不许把整轮判死）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { boot, makeHome, removeHome, writeStore } from './helpers/harness.js'
import { destroyGatewayAgents } from '../lib/gateway-http.js'

const IDLE_MS = 21000

function chatBody(text = '完成') {
  return JSON.stringify({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })
}

/** 起一个真实网关：handler(req, res, seq) 自己决定怎么回。 */
async function startGateway(handler) {
  const state = { connections: 0, requests: 0, sockets: new Set() }
  const server = http.createServer((req, res) => {
    state.requests += 1
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => handler(req, res, state))
  })
  // Node 服务端默认 keepAliveTimeout 是 5s：不抬起来的话，21s 空闲会被**服务端**
  // 关掉，测出来的是服务端行为，不是客户端的连接池。
  server.keepAliveTimeout = 60000
  server.headersTimeout = 65000
  server.on('connection', (socket) => {
    state.connections += 1
    state.sockets.add(socket)
    socket.on('close', () => state.sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    state,
    base: `http://127.0.0.1:${port}/v1`,
    async close() {
      for (const socket of state.sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

test('空闲 21s 后仍复用同一条连接，不新建 socket', { timeout: 90000 }, async () => {
  const gw = await startGateway((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(chatBody())
  })
  const home = makeHome('keepalive')
  writeStore(home, { dsfBaseUrl: gw.base, kimiBaseUrl: gw.base })
  const { tools, dispose } = await boot({ home })
  const call = () => tools.get('harness_call').execute({ task: '只说两个字：收到', tier: 'execution', skill: 'off' }, {})
  try {
    const first = await call()
    assert.equal(first.ok, true)
    assert.equal(gw.state.connections, 1, '第一次调用应当只建一条连接')

    await new Promise((resolve) => setTimeout(resolve, IDLE_MS))

    const second = await call()
    assert.equal(second.ok, true)
    assert.equal(gw.state.connections, 1, `空闲 ${IDLE_MS}ms 后仍是同一条连接（实际新建了 ${gw.state.connections - 1} 条）`)
    assert.equal(gw.state.requests, 2)
  } finally {
    destroyGatewayAgents()
    if (typeof dispose === 'function') dispose()
    await gw.close()
    removeHome(home)
  }
})

test('复用的连接被对端掐断：换新连接重试一次，不是整轮失败', { timeout: 30000 }, async () => {
  // 第 2 条请求故意不回包、直接断开 —— 模拟 Cloudflare 这类空闲回收。
  const gw = await startGateway((req, res, state) => {
    if (state.requests === 2) {
      req.socket.destroy()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(chatBody())
  })
  const home = makeHome('keepalive-retry')
  writeStore(home, { dsfBaseUrl: gw.base, kimiBaseUrl: gw.base })
  const { tools, dispose } = await boot({ home })
  const call = () => tools.get('harness_call').execute({ task: '只说两个字：收到', tier: 'execution', skill: 'off' }, {})
  try {
    assert.equal((await call()).ok, true)
    const second = await call()
    assert.equal(second.ok, true, '被掐断后应当重试成功，而不是把这一轮判成失败')
    assert.equal(gw.state.requests, 3, '第 2 条被掐断，第 3 条是重试')
  } finally {
    destroyGatewayAgents()
    if (typeof dispose === 'function') dispose()
    await gw.close()
    removeHome(home)
  }
})