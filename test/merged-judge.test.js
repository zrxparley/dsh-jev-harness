/**
 * #38 merged judge: tier + skill + difficulty in ONE HTTP request.
 *
 * All assertions here use a STUB gateway. They verify the things that are
 * deterministic without a live gateway:
 *   - a single auto harness_call makes exactly ONE /systemone request (not two);
 *   - that one request asks tier AND skill AND difficulty together;
 *   - the request body is < 12 KB and does NOT grow when the catalog grows
 *     (candidates are slimmed to top-8 before sending);
 *   - one decision row carries tier + skill + difficulty + confidence;
 *   - when JEV is unreachable the judge falls back to source:'heuristic'.
 *
 * What is NOT here (needs JEV_API_KEY): real p50/p95 latency, the P95<400ms
 * target, and merged-vs-separate tier agreement >=90% on the golden set. Those
 * are recorded as "not yet measured" in docs/ and the delivery note.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  boot, chatResponse, jsonResponse, makeHome, removeHome, stubFetch, writeStore, readJsonFile,
} from './helpers/harness.js'
import path from 'node:path'
import fs from 'node:fs'

/** Stub that answers ALL THREE questions in one /systemone call (the merged judge). */
function mergedAnswer({ tier = 'execution', skill = 'none', difficulty = 'normal', model = 'jev-1.14.0', onBody } = {}) {
  return (url, init) => {
    if (!url.includes('/systemone')) return undefined
    const payload = init.body ? JSON.parse(init.body) : {}
    if (onBody) onBody(payload, init)
    const answers = {}
    if (payload.questions?.tier) answers.tier = { choice: tier, confidence: 0.9 }
    if (payload.questions?.skill) answers.skill = { choice: skill, confidence: 0.85 }
    if (payload.questions?.difficulty) answers.difficulty = { choice: difficulty, confidence: 0.8 }
    return jsonResponse({ model, answers, usage: { input_tokens: 5, output_tokens: 1 } })
  }
}

const USAGE = () => path.join(process.env.DSH_HOME, 'jev-harness-usage.json')

test('#38: one auto call makes exactly ONE /systemone request asking tier+skill+difficulty', async () => {
  const home = makeHome('merged-one')
  writeStore(home)
  let captured = null
  const stub = stubFetch((url, init) => {
    const m = mergedAnswer({ tier: 'execution', skill: 'none', difficulty: 'normal', onBody: (p) => { captured = p } })(url, init)
    if (m !== undefined) return m
    if (url.includes('/chat/completions')) return chatResponse('完成')
    if (url.includes('/models')) return jsonResponse({ data: [{ id: 'm1' }] })
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    const res = await tools.get('harness_call').execute({ task: '把这句话翻成英文：你好世界', tier: 'auto' }, {})
    assert.equal(res.ok, true, `call failed: ${res.note}`)

    const systemoneCalls = stub.urls().filter(u => u.includes('/systemone'))
    assert.equal(systemoneCalls.length, 1, `expected exactly 1 /systemone request, got ${systemoneCalls.length}`)

    assert.ok(captured, 'captured the merged request body')
    assert.ok(captured.questions.tier, 'merged request must ask tier')
    assert.ok(captured.questions.skill, 'merged request must ask skill')
    assert.ok(captured.questions.difficulty, 'merged request must ask difficulty')
    assert.deepEqual(Object.keys(captured.questions.difficulty.criteria).sort(), ['hard', 'normal', 'trivial'])
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('#38: merged request body is < 12 KB with the 39-skill catalog', async () => {
  const home = makeHome('merged-size')
  writeStore(home)
  let bodyBytes = 0
  const stub = stubFetch((url, init) => {
    if (url.includes('/systemone')) {
      bodyBytes = Buffer.byteLength(init.body || '', 'utf8')
    }
    const m = mergedAnswer({})(url, init)
    if (m !== undefined) return m
    if (url.includes('/chat/completions')) return chatResponse('完成')
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: '重构这个模块', tier: 'auto' }, {})
    assert.ok(bodyBytes > 0, 'captured a request body')
    assert.ok(bodyBytes < 12 * 1024, `request body ${bodyBytes}B must be < 12KB (12288B)`)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('#38: skill candidates are slimmed to none+8 regardless of catalog size', async () => {
  const home = makeHome('merged-slim')
  writeStore(home)
  let captured = null
  const stub = stubFetch((url, init) => {
    const m = mergedAnswer({ onBody: (p) => { captured = p } })(url, init)
    if (m !== undefined) return m
    if (url.includes('/chat/completions')) return chatResponse('完成')
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: '把这个类拆成深模块', tier: 'auto' }, {})
    const skillCriteria = captured.questions.skill.criteria
    const count = Object.keys(skillCriteria).length
    assert.ok('none' in skillCriteria, 'must include the none option')
    assert.ok(count <= 9, `expected none + at most 8 candidates, got ${count}`)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('#38: one decision row carries tier + skill + difficulty + confidence + criteriaVersion', async () => {
  const home = makeHome('merged-ledger')
  writeStore(home)
  const stub = stubFetch((url, init) => {
    const m = mergedAnswer({ tier: 'decision', skill: 'none', difficulty: 'hard' })(url, init)
    if (m !== undefined) return m
    if (url.includes('/chat/completions')) return chatResponse('完成')
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: '评审这个架构方案的风险', tier: 'auto' }, {})
    const usage = readJsonFile(USAGE())
    const decisions = usage.decisions || []
    assert.ok(decisions.length >= 1, 'a decision row was written')
    const d = decisions.at(-1)
    assert.equal(d.tier, 'decision')
    assert.equal(d.difficulty, 'hard', 'decision row must carry difficulty')
    assert.equal(d.confidence, 0.9, 'decision row must carry confidence')
    assert.ok('skill' in d, 'decision row must carry skill')
    assert.ok(d.criteriaVersion, 'decision row must carry criteriaVersion (#42)')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('#38: JEV unreachable -> merged judge falls back to source:heuristic, still answers', async () => {
  const home = makeHome('merged-fallback')
  writeStore(home)
  const stub = stubFetch((url, init) => {
    if (url.includes('/systemone')) throw new Error('connect ECONNREFUSED')
    if (url.includes('/chat/completions')) return chatResponse('完成')
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    const res = await tools.get('harness_call').execute({ task: '翻译这段文字', tier: 'auto' }, {})
    assert.equal(res.ok, true, `call should still succeed via heuristic: ${res.note}`)
    const usage = readJsonFile(USAGE())
    const d = (usage.decisions || []).at(-1)
    assert.equal(d.source, 'heuristic', 'ledger must mark source:heuristic when JEV is down')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('#38: request body does NOT grow significantly when the catalog grows to 200 skills', async () => {
  const home = makeHome('merged-grow')
  writeStore(home)
  // Write a refreshed catalog.json with 200 skills so skillCatalog() picks it up.
  const skills = []
  for (let i = 0; i < 200; i++) {
    skills.push({ id: `engineering/skill-${i}`, name: `skill-${i}`, description: `A generated skill number ${i} for load testing the judge body size.`, path: `skills/engineering/skill-${i}/SKILL.md` })
  }
  const catalogDir = path.join(process.env.DSH_HOME || home, 'jev-harness-skills')
  fs.mkdirSync(catalogDir, { recursive: true })
  fs.writeFileSync(path.join(catalogDir, 'catalog.json'), JSON.stringify({ skills, source: 'refreshed' }))

  let bodyBytes = 0
  let candidateCount = 0
  const stub = stubFetch((url, init) => {
    const m = mergedAnswer({ onBody: (p) => {
      bodyBytes = Buffer.byteLength(init.body || '', 'utf8')
      candidateCount = Object.keys(p.questions.skill.criteria).length
    } })(url, init)
    if (m !== undefined) return m
    if (url.includes('/chat/completions')) return chatResponse('完成')
    return undefined
  })
  try {
    const { tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: '把这段文字翻成英文', tier: 'auto' }, {})
    assert.ok(candidateCount <= 9, `200-skill catalog must still slim to none+8, got ${candidateCount}`)
    assert.ok(bodyBytes < 12 * 1024, `200-skill body ${bodyBytes}B must still be < 12KB`)
  } finally {
    stub.restore()
    removeHome(home)
  }
})
