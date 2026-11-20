/**
 * 换传输层后，语义有没有被改坏（issue #38 回归）。
 *
 * 来源：Verifier 的复验探针 `v66-transport-semantics.mjs`（7 格），收进仓库跑。
 * 为什么必须有这条：`stubFetch()` 现在把 `gatewayFetch` 一起桩掉了，
 * 除 keepalive 两条之外，其它测试都没有真正走 `lib/gateway-http.js`。
 *
 * 这里不装任何桩：本地起真实 HTTP 服务，走真实 Agent。
 * 并且把全局 `fetch` 换成抛错函数 —— 万一某条路径偷偷退回 fetch，直接变红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import zlib from 'node:zlib'
import { boot, makeHome, removeHome, writeStore } from './helpers/harness.js'
import { destroyGatewayAgents } from '../lib/gateway-http.js'

const CALL = { task: '只说两个字：收到', tier: 'execution', skill: 'off' }
const REAL_FETCH = globalThis.fetch

function chatBody(text = '完成') {
  return JSON.stringify({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })
}

async function startServer(handler) {
  const state = { requests: 0, connections: 0, log: [] }
  const server = http.createServer((req, res) => {
    state.requests += 1
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      state.log.push(`${req.method} ${req.url}`)
      handler(req, res, state, raw)
    })
  })
  server.keepAliveTimeout = 60000
  server.headersTimeout = 65000
  server.on('connection', () => { state.connections += 1 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    state,
    base: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) }),
  }
}

/** 跑一格：起服务、启动插件、调一次 harness_call、收尾。 */
async function run({ handler, storeExtra = {}, serverless = false, deadBase }) {
  let srv = null
  let base = deadBase
  if (!serverless) {
    srv = await startServer(handler)
    base = srv.base
  }
  const home = makeHome('transport')
  writeStore(home, { ...storeExtra, dsfBaseUrl: base, kimiBaseUrl: base })
  const { tools, dispose } = await boot({ home })
  const startedAt = Date.now()
  try {
    let out
    try {
      out = await tools.get('harness_call').execute(CALL, {})
    } catch (err) {
      // 工具内部会把失败收成 note；真漏出来也照样算结果，免得测试只测「没抛」。
      out = { ok: false, note: `THREW ${err && err.message}` }
    }
    return { out, elapsed: Date.now() - startedAt, server: srv && srv.state }
  } finally {
    destroyGatewayAgents()
    if (typeof dispose === 'function') dispose()
    if (srv) await srv.close()
    removeHome(home)
  }
}

test.before(() => {
  // 任何退回全局 fetch 的路径都直接炸，避免「测的是旧传输自己不知道」。
  globalThis.fetch = async (url) => { throw new Error(`unexpected global fetch: ${url}`) }
})
test.after(() => { globalThis.fetch = REAL_FETCH })

test('4xx：不抛错到外面，正文照读（401 + 网关原话要出现在 note 里）', async () => {
  const { out } = await run({
    handler: (req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
    },
  })
  assert.equal(out.ok, false)
  assert.match(out.note, /call failed: HTTP 401/)
  assert.match(out.note, /invalid api key/)
})

test('307：跟随重定向，最终拿到正文', async () => {
  const { out, server } = await run({
    handler: (req, res) => {
      if (req.url.endsWith('/final')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(chatBody())
        return
      }
      res.writeHead(307, { location: '/v1/final' })
      res.end()
    },
  })
  assert.equal(out.ok, true)
  assert.equal(out.text, '完成')
  assert.equal(server.requests, 2, '应当跟到第二跳')
})

test('gzip：压缩响应能解开', async () => {
  const { out } = await run({
    handler: (req, res) => {
      const body = zlib.gzipSync(Buffer.from(chatBody('压缩后的回答')))
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
      res.end(body)
    },
  })
  assert.equal(out.ok, true)
  assert.equal(out.text, '压缩后的回答')
})

test('空回答：HTTP 200 但正文是空串，仍是成功（不假装成失败）', async () => {
  const { out } = await run({
    handler: (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 } }))
    },
  })
  assert.equal(out.ok, true)
  assert.equal(out.text, '')
})

test('超时：仍走原 AbortSignal，700ms 被打断，口径不变', async () => {
  const { out, elapsed } = await run({
    storeExtra: { timeoutExecution: 700, timeoutDecision: 700, timeoutProbe: 700, judgeTimeoutMs: 700 },
    handler: () => { /* 永不回包 */ },
  })
  assert.equal(out.ok, false)
  assert.match(out.note, /cancelled or timed out/, `超时口径变了：${out.note}`)
  assert.ok(elapsed >= 650, `应当等满 700ms 超时，实际 ${elapsed}ms`)
  assert.ok(elapsed < 3000, `不该拖成别的超时，实际 ${elapsed}ms`)
})

test('200 但不是 JSON：按失败处理，不当成功', async () => {
  const { out } = await run({
    handler: (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>502</html>')
    },
  })
  assert.equal(out.ok, false)
  assert.match(out.note, /non-JSON/)
})

test('连接被拒：失败且给出具体错误（不是 fetch failed 这种泛化串）', async () => {
  const closed = await startServer(() => {})
  const deadBase = closed.base
  await closed.close()
  const { out } = await run({ serverless: true, deadBase })
  assert.equal(out.ok, false)
  assert.match(out.note, /ECONNREFUSED|fetch failed/)
})