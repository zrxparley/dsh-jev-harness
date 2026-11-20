/**
 * #9 密钥存储：迁到宿主 credentials，明文只作降级路径。
 *
 * 纪律：测试用**假 credentials 服务**，不读写任何真实凭据文件；断言里不打印密钥值，
 * 只比较「有没有」「是不是同一个」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, callRoute, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const MIGRATE = '/api/jev-harness/credentials/migrate'
const CLEANUP = '/api/jev-harness/credentials/cleanup'
const SECRET = 'sk-test-secret-value'

function fakeCredentials(seed = {}) {
  const store = new Map(Object.entries(seed))
  const calls = { set: [], unset: [], resolve: [] }
  return {
    calls,
    async resolve(ref) {
      calls.resolve.push(ref)
      if (!store.has(ref)) return undefined
      return { value: store.get(ref), source: 'settings' }
    },
    async describe(ref) {
      const stored = store.has(ref)
      return { configured: stored, source: stored ? 'settings' : undefined, writable: true }
    },
    async set(ref, value) {
      calls.set.push(ref)
      store.set(ref, value)
    },
    async unset(ref) { calls.unset.push(ref); store.delete(ref) },
    peek(ref) { return store.get(ref) },
  }
}

async function waitForCredentialState(routes, timeoutMs = 1000) {
  const started = Date.now()
  for (;;) {
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    if (status.credentialStorage && status.credentialStorage.mode !== 'unknown') return status
    if (Date.now() - started > timeoutMs) return status
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('#9: 明文密钥被迁进 credentials，且迁移是幂等的', async () => {
  const home = makeHome('cred-migrate')
  writeStore(home, { kimiApiKey: SECRET, dsfApiKey: '' })
  const creds = fakeCredentials()
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home, services: { credentials: creds } })
    const status = await waitForCredentialState(routes)
    assert.equal(status.credentialStorage.mode, 'credentials')
    assert.equal(status.credentialStorage.service, true)
    assert.ok(creds.peek('JEV_HARNESS_KIMI_API_KEY') === SECRET, '密钥应写进 credentials')
    assert.ok(status.credentialStorage.migrated.includes('kimi'))
    // 明文还在：清理要用户确认，迁移本身不删
    assert.ok(status.credentialStorage.plaintextRemaining.includes('kimi'))

    // 幂等：再跑一次不应重复写入
    const before = creds.calls.set.length
    const again = (await callRoute(routes, MIGRATE, { method: 'POST', url: MIGRATE, body: {} })).body
    assert.equal(creds.calls.set.length, before, '第二次迁移不许重复 set')
    assert.equal(again.credentialStorage.mode, 'credentials')
    assert.ok(!JSON.stringify(again).includes(SECRET), '响应里不许出现密钥值')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#9: 迁移后 keySource 报 credentials，密钥可用', async () => {
  const home = makeHome('cred-source')
  writeStore(home, { kimiApiKey: SECRET, jevApiKey: '', dsfApiKey: '' })
  const creds = fakeCredentials()
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home, services: { credentials: creds } })
    await waitForCredentialState(routes)
    // 清掉明文后，密钥只能来自 credentials
    const cleaned = (await callRoute(routes, CLEANUP, { method: 'POST', url: CLEANUP, body: { confirm: true } })).body
    assert.equal(cleaned.ok, true)
    assert.deepEqual(cleaned.cleared, ['kimi'])
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.gateways.kimi.keySource, 'credentials')
    assert.equal(status.gateways.kimi.keySet, true, '清理明文后密钥仍然可用')
    const store = readJsonFile(path.join(home, 'jev-harness.json'))
    assert.ok(!store.kimiApiKey, '明文键必须被删掉')
    assert.ok(!JSON.stringify(cleaned).includes(SECRET), '清理响应里不许出现密钥')
    assert.ok(cleaned.backup && fs.existsSync(cleaned.backup), '清理前要先留备份')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#9: 清理必须显式确认，未确认时明文原样保留', async () => {
  const home = makeHome('cred-confirm')
  writeStore(home, { kimiApiKey: SECRET })
  const creds = fakeCredentials()
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home, services: { credentials: creds } })
    await waitForCredentialState(routes)
    const refused = await callRoute(routes, CLEANUP, { method: 'POST', url: CLEANUP, body: {} })
    assert.equal(refused.status, 400)
    assert.match(String(refused.body.error), /confirm/)
    const store = readJsonFile(path.join(home, 'jev-harness.json'))
    assert.equal(store.kimiApiKey, SECRET, '没确认就不许动明文')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#9: 宿主没有 credentials 服务时，明确标注明文降级与原因', async () => {
  const home = makeHome('cred-fallback')
  writeStore(home, { kimiApiKey: SECRET })
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home }) // 不注入 credentials
    const status = await waitForCredentialState(routes)
    assert.equal(status.credentialStorage.mode, 'plaintext')
    assert.equal(status.credentialStorage.service, false)
    assert.match(String(status.credentialStorage.reason), /no credentials service/)
    assert.equal(status.gateways.kimi.keySource, 'settings', '降级时仍按明文 store 工作')
    const cleanup = await callRoute(routes, CLEANUP, { method: 'POST', url: CLEANUP, body: { confirm: true } })
    assert.equal(cleanup.status, 409, '没有 credentials 时不许擦除明文')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#9: 迁移失败不影响插件启动，原因写进 /status', async () => {
  const home = makeHome('cred-broken')
  writeStore(home, { kimiApiKey: SECRET })
  const broken = {
    async resolve() { throw new Error('credentials backend exploded') },
    async describe() { return { configured: false, writable: true } },
    async set() { throw new Error('write refused') },
  }
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home, services: { credentials: broken } })
    const status = await waitForCredentialState(routes)
    assert.ok(status.gateways, '插件仍能给出状态')
    assert.equal(status.credentialStorage.mode, 'credentials')
    assert.match(String(status.credentialStorage.reason), /write refused|resolve failed/)
    assert.ok(!JSON.stringify(status).includes(SECRET), '/status 不许回显密钥')
    // 明文还在，功能不受影响
    assert.equal(status.gateways.kimi.keySource, 'settings')
  } finally {
    stub.restore(); removeHome(home)
  }
})
