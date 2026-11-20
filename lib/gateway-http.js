/**
 * 网关请求的传输层（issue #38）。
 *
 * 为什么需要它：`chat()` 原来用全局 `fetch`（undici），默认 `keepAliveTimeout`
 * 是 4 秒。判定是「一条消息一次」，两次之间远超 4 秒，于是每一轮都在重付一次
 * TCP + TLS 握手 —— 实测 2026-11-20：空闲 4s 起就新建连接，单次 973–1295ms；
 * 换成常驻 Agent 后同一台机器空闲 20s 仍是 310ms、80s 仍是 398ms。
 * 见 `docs/adr/measurements/jev-latency-breakdown-20261120.md`。
 *
 * 只换传输层，不换任何语义：
 * - 超时仍由调用方传进来的 AbortSignal 决定（本文件不新增任何超时/阈值）；
 * - 返回对象对齐用到的 fetch 子集：`ok` / `status` / `text()` / `json()` / `arrayBuffer()`；
 * - 4xx/5xx 不抛错，正文照读（调用方要拿它拼错误信息）；
 * - 跟随重定向、解 gzip/deflate/br，与 fetch 的行为对齐。
 *
 * 测试接缝：`setGatewayFetch()` 让测试把传输换成假的（见 test/helpers/harness.js），
 * 生产环境不装 override，走真实 Agent。
 */
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'

/**
 * `keepAliveMsecs` 是 TCP 保活**探测间隔**，不是「空闲多久后关连接」——
 * Node 的 Agent 没有 keepAliveTimeout（实测 undefined），空闲 socket 40s 后仍复用，
 * 保留多久交给 Node 默认策略。这个数字不参与请求超时，也不进判定预算。
 */
const KEEP_ALIVE_PROBE_MSECS = 30000
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: KEEP_ALIVE_PROBE_MSECS, maxSockets: 8, maxFreeSockets: 8 }

export const GATEWAY_AGENTS = {
  'http:': new http.Agent(AGENT_OPTIONS),
  'https:': new https.Agent(AGENT_OPTIONS),
}

/** 这些错误发生在「复用的连接其实已经被对端关掉」时，可以换新连接重试一次。 */
const STALE_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT', 'ERR_STREAM_DESTROYED'])
const MAX_REDIRECTS = 5

let override = null

/** 测试用：把传输整体换成假的（参数与全局 fetch 相同）。 */
export function setGatewayFetch(fn) {
  override = typeof fn === 'function' ? fn : null
}

/** 测试用：恢复真实传输。 */
export function resetGatewayFetch() {
  override = null
}

/** 真实传输用的 fetch 形状。 */
export async function gatewayFetch(url, init = {}) {
  if (override) return override(String(url), init)
  return requestFollowing(url, init, 0, 0)
}

function abortError() {
  const err = new Error('This operation was aborted')
  err.name = 'AbortError'
  return err
}

function decodeBody(encoding, buffer) {
  const kind = String(encoding || '').trim().toLowerCase()
  try {
    if (kind === 'gzip' || kind === 'x-gzip') return zlib.gunzipSync(buffer)
    if (kind === 'deflate') return zlib.inflateSync(buffer)
    if (kind === 'br') return zlib.brotliDecompressSync(buffer)
  } catch {
    // 解不开就把原始字节交回去：让上层按「非 JSON」失败，而不是在这里假装成功。
  }
  return buffer
}

function mockResponse(status, headers, buffer) {
  const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ''), 'utf8')
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String((headers && headers[':status-text']) || ''),
    headers: {
      get: (name) => {
        const value = headers ? headers[String(name).toLowerCase()] : undefined
        return Array.isArray(value) ? value.join(', ') : (value === undefined ? null : value)
      },
    },
    async text() { return payload.toString('utf8') },
    async json() { return JSON.parse(payload.toString('utf8')) },
    async arrayBuffer() { return payload },
  }
}

/** 一次请求，不重试、不跟随重定向。 */
function requestOnce(url, { method, headers, body, signal, agent }) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      reject(new TypeError(`invalid URL: ${url}`))
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new TypeError(`unsupported protocol: ${parsed.protocol}`))
      return
    }
    if (signal && signal.aborted) {
      reject(abortError())
      return
    }
    const lib = parsed.protocol === 'https:' ? https : http
    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      agent,
    }
    if (signal) options.signal = signal
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      reject(err)
    }
    const req = lib.request(options, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('aborted', () => fail(abortError()))
      res.on('error', fail)
      res.on('end', () => {
        if (settled) return
        settled = true
        resolve({
          status: res.statusCode || 0,
          headers: res.headers || {},
          buffer: decodeBody(res.headers && res.headers['content-encoding'], Buffer.concat(chunks)),
          reused: req.reusedSocket === true,
        })
      })
    })
    req.on('error', (err) => {
      // 记下这条连接是不是复用的：只有复用的连接断了才值得换新连接重试一次。
      try { err.reusedSocket = req.reusedSocket === true } catch { /* 只读属性，忽略 */ }
      fail(err)
    })
    if (body !== undefined && body !== null && body !== '') req.write(body)
    req.end()
  })
}

/** 请求 + 重定向 + 复用连接掐断后重试一次。 */
async function requestFollowing(url, init, redirects, attempt) {
  const method = String(init.method || 'GET').toUpperCase()
  const headers = { accept: 'application/json', 'accept-encoding': 'identity', ...(init.headers || {}) }
  let body = init.body
  if (body !== undefined && body !== null && body !== '' && !Buffer.isBuffer(body)) body = String(body)
  if (body !== undefined && body !== null && body !== '' && method !== 'GET' && method !== 'HEAD') {
    const hasLength = Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')
    if (!hasLength) headers['content-length'] = Buffer.byteLength(body)
  }
  const agent = attempt > 0 ? false : (GATEWAY_AGENTS[String(new URL(url).protocol)] || undefined)

  let result
  try {
    result = await requestOnce(url, { method, headers, body, signal: init.signal, agent })
  } catch (err) {
    // 复用连接被对端悄悄关掉（Cloudflare 这类空闲回收）：换一条新连接再发一次。
    // 只在「原来那条是复用的」时重试，避免把真正发出去的请求重复扣费。
    const code = String(err && err.code || '')
    if (attempt === 0 && err && err.reusedSocket === true && STALE_CODES.has(code)) {
      return requestFollowing(url, init, redirects, attempt + 1)
    }
    throw err
  }

  const location = result.headers && result.headers.location
  if (location && [301, 302, 303, 307, 308].includes(result.status) && redirects < MAX_REDIRECTS) {
    const next = new URL(location, url).toString()
    const toGet = result.status === 303 || ((result.status === 301 || result.status === 302) && method === 'POST')
    const nextInit = { ...init, method: toGet ? 'GET' : method }
    if (toGet) delete nextInit.body
    return requestFollowing(next, nextInit, redirects + 1, 0)
  }

  return mockResponse(result.status, result.headers, result.buffer)
}
/**
 * 关掉常驻连接池里的 socket。测试收尾必须调用：一条空闲 keep-alive socket
 * 会让进程的事件循环一直有活，`node --test` 会卡住不退出。
 * 调用后 Agent 仍可继续用（下一次请求会重新建连）。
 */
export function destroyGatewayAgents() {
  for (const agent of Object.values(GATEWAY_AGENTS)) {
    try { agent.destroy() } catch { /* best effort */ }
  }
}
