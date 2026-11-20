/**
 * #2 security: a REAL secret placed in the conversation history must NOT reach
 * the gateway request body or the ledger. This is the case the earlier "privacy"
 * assertion failed to actually exercise (it never injected a secret).
 *
 *   - capHistory redacts sk-…, Bearer …, apiKey/token key-values, 32+ hex runs;
 *   - the ledger's task summary is redacted too;
 *   - /save accepts the history switch + caps and persists them (save→status→disk).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { capHistory } from '../index.js'
import {
  boot, callRoute, chatResponse, jsonResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const SAVE = '/api/jev-harness/save'
const usageFile = (home) => path.join(home, 'jev-harness-usage.json')

test('#2 security: a real sk-… secret in history is redacted before reaching the gateway', () => {
  const secret = 'sk-live-secret-123'
  const messages = [
    { role: 'user', content: `我的密钥是 ${secret}，帮我看看这段代码` },
    { role: 'assistant', content: '好的' },
    { role: 'user', content: '继续' },
  ]
  const capped = capHistory(messages, 6, 8000)
  const blob = JSON.stringify(capped)
  assert.ok(!blob.includes(secret), `secret must NOT appear in the history sent to the gateway: ${blob.slice(0, 200)}`)
  assert.ok(blob.includes('[REDACTED]'), 'the secret is replaced with [REDACTED], not just shortened')
})

test('#2 security: Bearer tokens, apiKey values and 32+ hex are all redacted', () => {
  const messages = [
    { role: 'user', content: 'Authorization: Bearer abcdef1234567890' },
    { role: 'user', content: 'apiKey: sk-live-secret-123' },
    { role: 'user', content: 'token=abcdef1234567890abcdef1234567890' },
    { role: 'user', content: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8' },
  ]
  const capped = capHistory(messages, 6, 8000)
  const blob = JSON.stringify(capped)
  assert.ok(!blob.includes('abcdef1234567890'), 'Bearer token value redacted')
  assert.ok(!blob.includes('sk-live-secret-123'), 'sk-… key redacted')
  assert.ok(!blob.includes('abcdef1234567890abcdef1234567890'), 'token= value redacted')
  assert.ok(!blob.includes('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8'), '32+ hex run redacted')
})

test('#2 security: the ledger task summary is redacted too', async () => {
  const home = makeHome('sec-ledger')
  writeStore(home)
  const stub = stubFetch((url) => {
    if (url.includes('/chat/completions')) return chatResponse('完成')
    if (url.includes('/models')) return jsonResponse({ data: [{ id: 'm1' }] })
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    // a follow-up whose task carries a secret
    await tools.get('harness_call').execute({ task: '我的 sk-live-secret-123 怎么用？', tier: 'execution', skill: 'off' }, {})
    const usage = readJsonFile(usageFile(home))
    const blob = JSON.stringify(usage)
    assert.ok(!blob.includes('sk-live-secret-123'), 'secret must NOT appear in the ledger task summary')
  } finally { stub.restore(); removeHome(home) }
})

test('#2 fix: /save accepts historyAuto/historyTurns and persists them (save→status→disk)', async () => {
  const home = makeHome('sec-save')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const saved = (await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { historyAuto: false, historyTurns: 3 } })).body
    assert.equal(saved.history.auto, false, 'save response echoes historyAuto=false')
    assert.equal(saved.history.turns, 3, 'save response echoes historyTurns=3')
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.history.auto, false, '/status reflects historyAuto=false')
    assert.equal(status.history.turns, 3, '/status reflects historyTurns=3')
    const onDisk = readJsonFile(path.join(home, 'jev-harness.json'))
    assert.equal(onDisk.historyAuto, false, 'historyAuto persisted to the store file')
    assert.equal(onDisk.historyTurns, 3, 'historyTurns persisted to the store file')
  } finally { stub.restore(); removeHome(home) }
})
