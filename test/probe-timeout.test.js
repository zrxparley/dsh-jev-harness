/**
 * #33 harness_probe OFF semantics + timeoutMs not a registration snapshot.
 *
 * Decision (Chief): probe is ALLOWED when the switch is OFF, but must be clearly
 * labelled "仅探测，不接管" — it is the tool you use to find out WHY the switch
 * can't be turned on, so forbidding it when OFF would kill the diagnostic.
 *
 *   - OFF: probe still answers, and its note says "仅探测，不接管" (asserted);
 *   - timeoutMs can be saved via /save, and the save response warns that the
 *     tool-registration timeout is a snapshot needing a reload (the gateway-call
 *     timeout itself is dynamic via refresh());
 *   - the saved value persists to the store file and is echoed by /status.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  boot, callRoute, jsonResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATS_SAVE = '/api/jev-harness/save'
const STATS_STATUS = '/api/jev-harness/status'
const storeFile = (home) => path.join(home, 'jev-harness.json')

const modelsStub = (url) => {
  if (url.includes('/models')) return jsonResponse({ data: [{ id: 'kimi-k3.1-pro' }] })
  if (url.includes('/chat/completions')) return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
  return undefined
}

test('#33: OFF 时 probe 仍允许，但 note 明确「仅探测，不接管」', async () => {
  const home = makeHome('probe-off')
  writeStore(home, { enabled: false })
  const stub = stubFetch((url) => modelsStub(url))
  try {
    const { tools } = await boot({ home })
    const res = await tools.get('harness_probe').execute({ provider: 'kimi' }, {})
    assert.equal(res.ok, true, 'probe must still run when OFF (it is the diagnostic for why OFF cannot be lifted)')
    assert.ok(/仅探测|不接管/.test(res.note || ''), `OFF note must say 仅探测/不接管, got: ${res.note}`)
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#33: probe 工具 description 也声明 OFF 时仅探测不接管', async () => {
  const home = makeHome('probe-desc')
  writeStore(home)
  const stub = stubFetch((url) => modelsStub(url))
  try {
    const { tools } = await boot({ home })
    const desc = tools.get('harness_probe').description || ''
    assert.ok(/仅探测|不接管|OFF|关闭/.test(desc), `probe description must state the OFF semantics, got: ${desc}`)
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#33: /save 接受 timeoutMs 并持久化，响应提示工具注册超时需重载', async () => {
  const home = makeHome('timeout-save')
  writeStore(home)
  const stub = stubFetch((url) => modelsStub(url))
  try {
    const { routes } = await boot({ home })
    const saved = (await callRoute(routes, STATS_SAVE, { method: 'POST', url: STATS_SAVE, body: { timeoutMs: 30000 } })).body
    // response warns about the registration-snapshot timeout
    assert.ok(/重载|重新加载|reload/i.test(JSON.stringify(saved)), 'save response must warn that the tool-registration timeout needs a reload')
    // echoed in the (re-read) status
    const status = (await callRoute(routes, STATS_STATUS, { url: STATS_STATUS })).body
    assert.equal(status.timeoutMs, 30000, '/status echoes the new timeoutMs')
    // persisted to the store file
    assert.equal(readJsonFile(storeFile(home)).timeoutMs, 30000, 'timeoutMs persisted to store')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#33: timeoutMs 拒绝非法值（负数 / 非数）', async () => {
  const home = makeHome('timeout-invalid')
  writeStore(home)
  const stub = stubFetch((url) => modelsStub(url))
  try {
    const { routes } = await boot({ home })
    const res = await callRoute(routes, STATS_SAVE, { method: 'POST', url: STATS_SAVE, body: { timeoutMs: -5 } })
    assert.equal(res.status, 400, 'negative timeoutMs rejected')
    // fixture starts at 2000; an invalid save must NOT overwrite it
    assert.equal(readJsonFile(storeFile(home)).timeoutMs, 2000, 'invalid value must not overwrite the existing timeoutMs')
  } finally {
    stub.restore(); removeHome(home)
  }
})
