/**
 * 测试夹具：临时 DSH_HOME、假插件 ctx（tools / webServer）、假 req/res、离线 fetch stub。
 *
 * 约定（见 issue #1）：
 * - 全部路径都从 import.meta.url 或 os.tmpdir() 推导，测试里不出现写死的绝对路径。
 * - 任何未被 stub 命中的网络请求都会抛错，测试因此失败 —— 这是「CI 不发起真实网络请求」的锁。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setGatewayFetch, resetGatewayFetch } from '../../lib/gateway-http.js'

/** 仓库根目录（test/helpers/ 往上两层）。 */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const ENTRY = path.join(REPO, 'index.js')
export const CLIENT = path.join(REPO, 'lib', 'client.js')
export const FIXTURES = path.join(REPO, 'test', 'fixtures')

const REAL_FETCH = globalThis.fetch
let homeSeq = 0

/* ------------------------------------------------------------------ 文件 */

export function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))
}

/** 临时 DSH_HOME：每个用例一份，跑完由调用方删除。 */
export function makeHome(tag = 'case') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `jev-${tag}-${process.pid}-${homeSeq++}-`))
}

export function removeHome(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响断言 */ }
}

/** 把 fixtures/store.json 写进临时 home；extra 覆盖其中的字段。 */
export function writeStore(home, extra = {}) {
  const target = path.join(home, 'jev-harness.json')
  const store = { ...readFixture('store.json'), ...extra }
  fs.writeFileSync(target, JSON.stringify(store), { mode: 0o600 })
  return target
}

export function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 })
  return file
}

export function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function fileExists(file) {
  try { fs.accessSync(file); return true } catch { return false }
}

/* ------------------------------------------------------------- fetch stub */

/** 200 JSON 响应，形状对齐全局 fetch 的 Response 子集。 */
export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body) },
    async json() { return body },
    async arrayBuffer() { return Buffer.from(JSON.stringify(body)) },
  }
}

/** 纯文本 / HTML 响应（用来测「网关返回登录页」这类非 JSON）。 */
export function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body },
    async json() { throw new Error('not json') },
    async arrayBuffer() { return Buffer.from(body) },
  }
}

/** 二进制响应（GitHub tarball）。 */
export function bufferResponse(buffer, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return buffer.toString('utf8') },
    async json() { throw new Error('not json') },
    async arrayBuffer() { return buffer },
  }
}

/**
 * 装上全局 fetch stub。handler 返回 undefined 表示「这条请求没被授权」，
 * 直接抛错让测试变红，而不是悄悄走真网络。
 */
export function stubFetch(handler) {
  const seen = []
  const install = async (url, init = {}) => {
    const href = String(url)
    seen.push({ url: href, method: init.method || 'GET', body: init.body, headers: init.headers || {} })
    const response = handler(href, init, seen)
    if (response === undefined) throw new Error(`unstubbed network request: ${href}`)
    return response
  }
  globalThis.fetch = install
  // #38：网关请求改走 lib/gateway-http.js（常驻 Agent）。同一个 stub 也要装到
  // 那条传输上，否则测试会绕过桩、真的发网络请求。
  setGatewayFetch(install)
  return {
    seen,
    urls: () => seen.map((entry) => entry.url),
    restore() {
      globalThis.fetch = REAL_FETCH
      resetGatewayFetch()
    },
  }
}

/** JEV 判定器 stub：按题目名回答 tier / skill 两个 choice。 */
export function jevAnswer({ tier = 'execution', skill = 'none', model = 'jev-1.14.0' } = {}) {
  return (url, init) => {
    if (!url.includes('/systemone')) return undefined
    const payload = init.body ? JSON.parse(init.body) : {}
    const name = Object.keys(payload.questions || {})[0]
    const choice = name === 'skill' ? skill : tier
    return jsonResponse({
      model,
      answers: { [name]: { choice, confidence: 0.9 } },
      usage: { input_tokens: 5, output_tokens: 1 },
    })
  }
}

/** OpenAI 兼容 chat/completions 响应。 */
export function chatResponse(content = '完成', { prompt = 100, completion = 40 } = {}) {
  return jsonResponse({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
  })
}

/** GET /models 响应。 */
export function modelsResponse(ids = ['m1']) {
  return jsonResponse({ data: ids.map((id) => ({ id })) })
}

/* --------------------------------------------------------------- req/res */

/**
 * 造一个请求。默认带 Host 与同源 Origin（#26 之后桥路由会校验 Origin）。
 *   origin: null      → 不带 Origin（模拟 curl / 本地裸进程）
 *   origin: '<value>' → 用给定 Origin（伪造来源、null、后缀等负例）
 *   headers 里显式给 origin 时不覆盖。
 */
export function makeReq({ method = 'GET', url = '/', headers = {}, body, origin } = {}) {
  const text = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
  const chunks = text === '' ? [] : [Buffer.from(text)]
  const merged = { host: '127.0.0.1:61434', 'content-type': 'application/json', ...headers }
  if (origin === null) delete merged.origin
  else if (typeof origin === 'string') merged.origin = origin
  else if (merged.origin === undefined) merged.origin = `http://${merged.host}`
  return {
    method,
    url,
    headers: merged,
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
}

export function makeRes() {
  const out = { status: 0, headers: null, body: null, raw: '' }
  return {
    out,
    writeHead(status, headers) { out.status = status; out.headers = headers; return this },
    end(chunk) {
      out.raw = chunk === undefined || chunk === null ? '' : String(chunk)
      try { out.body = JSON.parse(out.raw) } catch { out.body = out.raw }
      return this
    },
  }
}

/**
 * 走真实 route.handler，返回 { status, body, headers }。
 *
 * #26 part 2 起桥路由要求 Bearer token：boot() 会先做一次 bootstrap，把 token
 * 挂在 routes.bridgeToken 上，这里自动带上。要测未授权分支时：
 *   token: null    → 不带 Authorization
 *   token: '<x>'   → 用指定（错误）token
 */
export async function callRoute(routes, pathname, opts = {}) {
  const route = routes.get(pathname)
  if (!route) throw new Error(`route not registered: ${pathname} (have: ${[...routes.keys()].join(', ')})`)
  const { token, ...rest } = opts
  const headers = { ...(rest.headers || {}) }
  if (token === null) { /* 故意不带 */ }
  else if (typeof token === 'string') headers.authorization = `Bearer ${token}`
  else if (routes.bridgeToken) headers.authorization = `Bearer ${routes.bridgeToken}`
  const res = makeRes()
  await route.handler(makeReq({ url: pathname, ...rest, headers }), res)
  return res.out
}

/* ------------------------------------------------------------------ 启动 */

/**
 * 以假 ctx 启动 index.js。config 形如 { jevBaseUrl, ... }，缺省走临时 home 里的 store。
 * 每次 boot 用带 query 的动态 import，避免模块级状态在不同用例间串味。
 */
export async function boot({ home, config = {}, services = {} } = {}) {
  if (home) process.env.DSH_HOME = home
  const routes = new Map()
  const tools = new Map()
  const server = {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  const ctx = {
    tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name) } },
    effect(fn) { return fn() },
    get(name) { return name === 'webServer' ? server : services[name] },
    inject(_names, cb) { cb(ctx) },
  }
  const specifier = `${pathToFileURL(ENTRY).href}?boot=${process.pid}-${homeSeq++}`
  const mod = await import(specifier)
  const dispose = mod.apply(ctx, config)

  // 模拟客户端 bootstrap：浏览器同源 GET 不带 Origin，只带 Fetch 元数据。
  if (routes.has('/api/jev-harness/token')) {
    const handshake = await callRoute(routes, '/api/jev-harness/token', {
      origin: null,
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    if (handshake.status === 200 && handshake.body && typeof handshake.body.token === 'string') {
      routes.bridgeToken = handshake.body.token
    }
  }

  return { mod, routes, tools, server, dispose, home }
}

/** 等一轮 microtask + 一个 macrotask，供「注册是异步发生的」这类断言使用。 */
export function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}