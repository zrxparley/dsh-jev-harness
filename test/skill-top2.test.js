/**
 * #11 top-2 skill routing + sibling reads + mount ledger. STUB, no live gateway.
 *
 *   - judgeOnce returns skill2 (the second candidate at a lower confidence bar);
 *   - a real call's note shows TWO skills when a second clears the bar;
 *   - /stats exposes skillMounts (per-skill mount counts + bytes);
 *   - harness_skill read with `sibling` returns the sibling document, not SKILL.md.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  boot, callRoute, chatResponse, jsonResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const usageFile = (home) => path.join(home, 'jev-harness-usage.json')

/** JEV stub: tier + skill(+probabilities) + difficulty in one merged call. */
function judgeWithProbs(skillChoice, skillProbs) {
  return (url, init) => {
    if (!url.includes('/systemone')) return undefined
    const p = JSON.parse(init.body)
    const answers = {}
    if (p.questions?.tier) answers.tier = { choice: 'execution', confidence: 0.9 }
    if (p.questions?.skill) answers.skill = { choice: skillChoice, confidence: 0.9, probabilities: skillProbs }
    if (p.questions?.difficulty) answers.difficulty = { choice: 'normal', confidence: 0.8 }
    return jsonResponse({ model: 'jev', answers, usage: { input_tokens: 5, output_tokens: 1 } })
  }
}

const chatStub = (url) => {
  if (url.includes('/chat/completions')) return chatResponse('完成')
  if (url.includes('/models')) return jsonResponse({ data: [{ id: 'm1' }] })
  // skill bodies + siblings come from raw.githubusercontent.com
  if (url.includes('raw.githubusercontent.com')) return jsonResponse({}) // not used; textResponse used in sibling test
  return undefined
}

test('#11: judgeOnce returns skill2 from probabilities at a lower confidence bar (>=0.4)', async () => {
  const home = makeHome('top2-probs')
  writeStore(home)
  const judge = judgeWithProbs('engineering/tdd', {
    'engineering/tdd': 0.9,
    'engineering/code-review': 0.5,   // second, >=0.4 -> should be picked as skill2
    'engineering/retro': 0.1,          // below 0.4 -> excluded
  })
  const stub = stubFetch((url, init) => {
    const j = judge(url, init); if (j !== undefined) return j
    if (url.includes('/chat/completions')) return chatResponse('完成')
    if (url.includes('raw.githubusercontent.com')) {
      return new Response('---\nname: x\ndescription: y\n---\n# Body\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    const res = await tools.get('harness_call').execute({ task: 'build this feature test-first', tier: 'auto' }, {})
    assert.equal(res.ok, true, res.note)
    // the note should mention BOTH the primary and the second skill
    assert.ok(res.note.includes('engineering/tdd'), `note must include primary skill: ${res.note}`)
    assert.ok(res.note.includes('engineering/code-review'), `note must include second skill: ${res.note}`)
  } finally { stub.restore(); removeHome(home) }
})

test('#11: second below 0.4 is NOT mounted (only the primary appears)', async () => {
  const home = makeHome('top2-weak')
  writeStore(home)
  const judge = judgeWithProbs('engineering/tdd', {
    'engineering/tdd': 0.9,
    'engineering/retro': 0.1,  // only weak second -> nothing mounts as skill2
  })
  const stub = stubFetch((url, init) => {
    const j = judge(url, init); if (j !== undefined) return j
    if (url.includes('/chat/completions')) return chatResponse('完成')
    if (url.includes('raw.githubusercontent.com')) {
      return new Response('---\nname: x\ndescription: y\n---\n# Body\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    const res = await tools.get('harness_call').execute({ task: 'build this feature test-first', tier: 'auto' }, {})
    assert.ok(res.note.includes('engineering/tdd'), 'primary still mounted')
    assert.ok(!res.note.includes('engineering/retro'), 'weak second must not be mounted')
  } finally { stub.restore(); removeHome(home) }
})

test('#11: /stats skillMounts records mount counts and bytes per skill', async () => {
  const home = makeHome('top2-stats')
  writeStore(home)
  const judge = judgeWithProbs('engineering/tdd', { 'engineering/tdd': 0.9, 'engineering/code-review': 0.5 })
  const stub = stubFetch((url, init) => {
    const j = judge(url, init); if (j !== undefined) return j
    if (url.includes('/chat/completions')) return chatResponse('完成')
    if (url.includes('raw.githubusercontent.com')) {
      // skill bodies: return a complete SKILL.md body
      return new Response('---\nname: x\ndescription: y\n---\n# Body\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return undefined
  })
  try {
    const { tools, routes } = await boot({ home })
    await tools.get('harness_call').execute({ task: 'build this feature test-first', tier: 'auto' }, {})
    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.ok(Array.isArray(stats.skillMounts), 'skillMounts is an array')
    const tdd = stats.skillMounts.find(m => m.id === 'engineering/tdd')
    assert.ok(tdd, 'engineering/tdd appears in skillMounts')
    assert.ok(tdd.mounts >= 1, 'mounted at least once')
    assert.ok(tdd.bytes > 0, 'mounted bytes recorded')
    const review = stats.skillMounts.find(m => m.id === 'engineering/code-review')
    assert.ok(review, 'second skill also counted in skillMounts')
  } finally { stub.restore(); removeHome(home) }
})

test('#11: harness_skill read with sibling returns the sibling document, not SKILL.md', async () => {
  const home = makeHome('sibling-read')
  writeStore(home)
  const stub = stubFetch((url) => {
    if (url.includes('raw.githubusercontent.com') && url.includes('mocking.md')) {
      return new Response('# Mocking guide\nUse fakes, not the real thing.\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    if (url.includes('raw.githubusercontent.com') && url.includes('SKILL.md')) {
      return new Response('---\nname: tdd\ndescription: Test-driven development.\n---\n# TDD\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    const res = await tools.get('harness_skill').execute({ action: 'read', id: 'engineering/tdd', sibling: 'mocking.md' }, {})
    assert.equal(res.ok, true, res.note)
    assert.ok(res.text.includes('Mocking guide'), `sibling body returned, got: ${String(res.text).slice(0, 60)}`)
    assert.ok(!res.text.includes('Test-driven development'), 'must NOT return the SKILL.md body when sibling is given')
    assert.ok(res.model.includes('mocking.md'), 'model names the sibling')
  } finally { stub.restore(); removeHome(home) }
})
