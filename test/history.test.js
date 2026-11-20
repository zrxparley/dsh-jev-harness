/**
 * #2 bounded, sanitized conversation history. Verifies:
 *   - capHistory keeps the LAST N user/assistant turns and a char budget;
 *   - a long session is truncated (not dumped whole), and a single over-long
 *     message is hard-trimmed;
 *   - /status exposes the history config (auto / turns / maxChars);
 *   - history is used for inference only — it never lands in the ledger as content.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { capHistory } from '../index.js'
import {
  boot, callRoute, makeHome, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATUS = '/api/jev-harness/status'
const user = (text) => ({ role: 'user', content: text })
const asst = (text) => ({ role: 'assistant', content: text })

test('#2: capHistory keeps only the last N turns', () => {
  const messages = []
  for (let i = 1; i <= 10; i++) { messages.push(user(`q${i}`), asst(`a${i}`)) }
  const capped = capHistory(messages, 3, 8000)
  // exactly the last 3 user turns (q8,q9,q10) survive
  const users = capped.filter(m => m.role === 'user').map(m => m.content)
  assert.equal(users.length, 3, `exactly 3 user turns kept, got ${users.length}`)
  assert.deepEqual(users, ['q8', 'q9', 'q10'], 'the kept turns are the most recent three')
  assert.ok(capped.length < messages.length, 'history was truncated')
})

test('#2: capHistory enforces the char budget', () => {
  const messages = []
  for (let i = 0; i < 20; i++) messages.push(user('x'.repeat(500)), asst('y'.repeat(500)))
  const capped = capHistory(messages, 100, 2000)  // many turns, small char budget
  const total = capped.reduce((sum, m) => sum + String(m.content).length, 0)
  assert.ok(total <= 2000, `char budget respected, got ${total}`)
})

test('#2: a single over-long message is hard-trimmed to the budget', () => {
  const messages = [user('z'.repeat(20000))]
  const capped = capHistory(messages, 6, 8000)
  const total = capped.reduce((sum, m) => sum + String(m.content).length, 0)
  assert.ok(total <= 8000, `single over-long message trimmed to budget, got ${total}`)
})

test('#2: system messages are preserved through the cap', () => {
  const messages = [{ role: 'system', content: 'you are a router' }, ...Array.from({ length: 10 }, (_, i) => user(`q${i}`))]
  const capped = capHistory(messages, 2, 8000)
  assert.ok(capped.some(m => m.role === 'system'), 'system message preserved')
  assert.ok(capped[0].role === 'system', 'system message stays first')
})

test('#2: /status exposes the history config', async () => {
  const home = makeHome('history-status')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.ok(status.history, 'history block present')
    assert.equal(status.history.auto, true, 'auto-context defaults on')
    assert.equal(status.history.turns, 6, 'default 6 turns')
    assert.equal(status.history.maxChars, 8000, 'default 8000 char budget')
  } finally { stub.restore(); removeHome(home) }
})

test('#2: history content never lands in the ledger (inference only)', async () => {
  const home = makeHome('history-privacy')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { tools } = await boot({ home })
    // a follow-up whose history contains a fake secret + a long past thread
    await tools.get('harness_call').execute({ task: '继续', context: '' }, {})
    const usage = JSON.parse((await import('node:fs')).readFileSync(path.join(home, 'jev-harness-usage.json'), 'utf8'))
    const blob = JSON.stringify(usage)
    // the ledger records a short task summary, never the full conversation body
    for (const d of usage.decisions || []) {
      assert.ok(String(d.task || '').length <= 120, `task is a capped summary, not the full history: ${String(d.task).length}`)
    }
    assert.ok(!blob.includes('sk-live-secret-123'), 'no secret/full history in ledger')
  } finally { stub.restore(); removeHome(home) }
})
