/**
 * 判定超时独立于生成超时（issue #39 验收第 4 条）。
 *
 * 红点（修复前）：判定用的是生成超时 `timeoutMs`（默认 120s），等于判定可以挂 2 分钟，
 * 正好是「判定慢拖死整轮」。
 *
 * 这里锁：默认 800、`/status` 回显、`/save` 校验与持久化、以及**行为上真的读新字段**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, callRoute, jsonResponse, makeHome, removeHome, stubFetch, textResponse, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const SAVE = '/api/jev-harness/save'

test('/status 默认回显 judgeTimeoutMs=800，与生成超时分开', async () => {
  const home = makeHome('judge-timeout-default')
  writeStore(home, { timeoutMs: 120000 })
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.judgeTimeoutMs, 800, '判定超时默认必须是 800ms')
    assert.equal(status.timeoutMs, 120000, '生成超时保持独立')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('/save 接受 100–60000 的 judgeTimeoutMs 并持久化；越界 400', async () => {
  const home = makeHome('judge-timeout-save')
  const storeFile = writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })

    const saved = await callRoute(routes, SAVE, { method: 'POST', body: { judgeTimeoutMs: 1200 } })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.judgeTimeoutMs, 1200)

    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.judgeTimeoutMs, 1200)
    const onDisk = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
    assert.equal(onDisk.judgeTimeoutMs, 1200, '必须是 number，不是被 trim 掉的字符串')
    assert.equal(typeof onDisk.judgeTimeoutMs, 'number')

    for (const bad of [50, 70000, 'abc', -1]) {
      const rejected = await callRoute(routes, SAVE, { method: 'POST', body: { judgeTimeoutMs: bad } })
      assert.equal(rejected.status, 400, `${bad} 应被拒绝`)
    }
    assert.equal(JSON.parse(fs.readFileSync(storeFile, 'utf8')).judgeTimeoutMs, 1200, '拒绝后旧值保留')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('判定超时真的读 judgeTimeoutMs：50ms 就兜底，不等 5s 的生成超时', async () => {
  const home = makeHome('judge-timeout-behavior')
  writeStore(home, { timeoutMs: 5000, judgeTimeoutMs: 50 })
  const stub = stubFetch((url, init) => {
    if (String(url).includes('/systemone')) {
      return new Promise((_resolve, reject) => {
        const signal = init && init.signal
        if (!signal) return
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      })
    }
    if (String(url).includes('/chat/completions')) {
      return jsonResponse({ choices: [{ message: { content: '兜底答出来了' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    }
    return undefined
  })
  try {
    const { tools, routes } = await boot({ home })
    const startedAt = Date.now()
    const result = await tools.get('harness_call').execute({ task: '评审这个方案', tier: 'auto', skill: 'off' }, {})
    const elapsed = Date.now() - startedAt
    assert.equal(result.ok, true)
    assert.equal(result.text, '兜底答出来了')
    assert.ok(elapsed < 1500, `判定应在 50ms 左右超时，实际 ${elapsed}ms（说明读的是 timeoutMs 而不是 judgeTimeoutMs）`)

    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    const decision = status.decisions[status.decisions.length - 1]
    assert.equal(decision.degraded, true)
    assert.equal(decision.source, 'heuristic')
  } finally {
    stub.restore()
    removeHome(home)
  }
})
