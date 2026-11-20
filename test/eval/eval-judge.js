#!/usr/bin/env node
/**
 * eval:judge — run the 20 golden cases (#10) against the REAL JEV gateway and
 * print tier + skill accuracy, a confusion matrix, and mean confidence.
 *
 * This is a MANUAL tool. It needs a live gateway + a secret key, so it is NOT
 * part of `node --test` and NOT run in CI. Run it by hand (see test/eval/README.md):
 *
 *   JEV_BASE_URL="https://your-gateway" JEV_API_KEY="..." \
 *     node test/eval/eval-judge.js
 *
 * Security contract (per Chief):
 *   - key comes ONLY from process.env.JEV_API_KEY (inject via $DSH_SECRET_JEV_API_KEY);
 *   - the key is never written to any file, never printed, never in the report;
 *   - base URL is echoed (it is not a secret) but the Authorization header is not.
 *
 * Exit codes: 0 = ran and every case answered (accuracy may still be <100% —
 * that is a MEASUREMENT, not a failure); 1 = could not run (no key, no base URL,
 * gateway unreachable, malformed golden set).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKILLS } from '../../skills.js'
import { TIER_CRITERIA, TIER_INSTRUCTIONS } from '../../criteria.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const set = JSON.parse(fs.readFileSync(path.join(here, 'judge-cases.json'), 'utf8'))

const BASE = String(process.env.JEV_BASE_URL || '').trim().replace(/\/+$/, '')
const KEY = String(process.env.JEV_API_KEY || process.env.DSH_SECRET_JEV_API_KEY || '').trim()
const MODEL = String(process.env.JEV_MODEL || 'jev-latest').trim()
const TIMEOUT_MS = Number(process.env.JEV_TIMEOUT_MS || 30000)

function die(msg) {
  console.error(`\n[eval:judge] cannot run: ${msg}`)
  console.error('See test/eval/README.md for how to run this manually.')
  process.exit(1)
}

if (!BASE) die('JEV_BASE_URL is not set.')
if (!KEY) die('JEV_API_KEY is not set (inject it via your secret store; never hardcode it).')

const url = /\/v1$/.test(BASE) ? `${BASE}/systemone` : `${BASE}/v1/systemone`
const SKILL_NONE = 'none'
const catalogIds = new Set(SKILLS.map((s) => s.id))

/** Build the skill criteria the same way pickSkill() does: none + every catalog description. */
function skillCriteria() {
  const criteria = { [SKILL_NONE]: 'None of the skills applies, or the task is too small to need one.' }
  for (const skill of SKILLS) criteria[skill.id] = `${skill.description.slice(0, 240)}`
  return criteria
}

async function ask(questions) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        state: { task: currentTask },
        questions,
      }),
      signal: controller.signal,
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 160)}`)
    return JSON.parse(raw)
  } finally {
    clearTimeout(timer)
  }
}

let currentTask = ''

async function judgeTier(task) {
  currentTask = task
  const body = await ask({
    tier: { type: 'choice', instructions: TIER_INSTRUCTIONS, criteria: { ...TIER_CRITERIA } },
  })
  const ans = body?.answers?.tier
  const choice = ans && (ans.choice || ans.noul)
  const tier = choice === 'decision' || choice === 'execution' ? choice : undefined
  const conf = Number(ans?.confidence)
  return { tier, confidence: Number.isFinite(conf) ? conf : undefined }
}

async function judgeSkill(task) {
  currentTask = task
  const body = await ask({
    skill: {
      type: 'choice',
      instructions: 'Pick the single agent skill whose instructions would most improve how this task is executed. Choose none when no skill clearly applies.',
      criteria: skillCriteria(),
    },
  })
  const ans = body?.answers?.skill
  const choice = ans && (ans.choice || ans.noul)
  const id = choice && (choice === SKILL_NONE || catalogIds.has(choice)) ? choice : SKILL_NONE
  const conf = Number(ans?.confidence)
  return { skill: id, confidence: Number.isFinite(conf) ? conf : undefined }
}

function pct(n, d) { return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%` }

async function main() {
  console.log(`[eval:judge] gateway: ${url}`)
  console.log(`[eval:judge] model: ${MODEL} · cases: ${set.cases.length} · criteriaVersion: ${set.criteriaVersion}`)
  console.log(`[eval:judge] running against the LIVE gateway; this is a measurement, not a pass/fail gate.\n`)

  const rows = []
  let tierCorrect = 0, skillCorrect = 0
  let tierConfSum = 0, tierConfN = 0, skillConfSum = 0, skillConfN = 0
  const tierMatrix = { decision: { decision: 0, execution: 0 }, execution: { decision: 0, execution: 0 } }
  let failures = 0

  for (const c of set.cases) {
    let gotTier, gotSkill, terr, serr
    try { gotTier = await judgeTier(c.task) } catch (e) { terr = e.message }
    try { gotSkill = await judgeSkill(c.task) } catch (e) { serr = e.message }

    const tOk = gotTier?.tier === c.expectTier
    const sOk = gotSkill?.skill === c.expectSkill
    if (tOk) tierCorrect++
    if (sOk) skillCorrect++
    if (gotTier?.confidence != null) { tierConfSum += gotTier.confidence; tierConfN++ }
    if (gotSkill?.confidence != null) { skillConfSum += gotSkill.confidence; skillConfN++ }
    if (gotTier?.tier && c.expectTier in tierMatrix && gotTier.tier in tierMatrix[c.expectTier]) {
      tierMatrix[c.expectTier][gotTier.tier]++
    }
    if (!tOk || !sOk || terr || serr) failures++

    rows.push({
      id: c.id,
      expectTier: c.expectTier, gotTier: gotTier?.tier || (terr ? 'ERR' : '?'), tOk,
      expectSkill: c.expectSkill, gotSkill: gotSkill?.skill || (serr ? 'ERR' : '?'), sOk,
      tierConf: gotTier?.confidence, skillConf: gotSkill?.confidence,
      err: terr || serr || '',
    })
    console.log(
      `${c.id}  tier ${tOk ? '✓' : '✗'} ${c.expectTier}→${rows.at(-1).gotTier}` +
      `  skill ${sOk ? '✓' : '✗'} ${c.expectSkill}→${rows.at(-1).gotSkill}` +
      (terr || serr ? `  ERR: ${(terr || serr).slice(0, 80)}` : ''),
    )
  }

  const n = set.cases.length
  console.log('\n================ ACCURACY ================')
  console.log(`tier  accuracy: ${tierCorrect}/${n} = ${pct(tierCorrect, n)}`)
  console.log(`skill accuracy: ${skillCorrect}/${n} = ${pct(skillCorrect, n)}`)
  console.log(`mean tier confidence:  ${tierConfN ? (tierConfSum / tierConfN).toFixed(3) : '—'} (n=${tierConfN})`)
  console.log(`mean skill confidence: ${skillConfN ? (skillConfSum / skillConfN).toFixed(3) : '—'} (n=${skillConfN})`)

  console.log('\n================ TIER CONFUSION MATRIX (rows=expected, cols=got) ================')
  console.log('              decision  execution')
  for (const exp of ['decision', 'execution']) {
    console.log(`${exp.padEnd(12)}  ${String(tierMatrix[exp].decision).padStart(8)}  ${String(tierMatrix[exp].execution).padStart(9)}`)
  }

  if (failures > 0) {
    console.log(`\n================ MISMATCHES / ERRORS (${failures}) ================`)
    for (const r of rows.filter((x) => !x.tOk || !x.sOk || x.err)) {
      console.log(`- ${r.id}: tier ${r.expectTier}→${r.gotTier} ${r.tOk ? '' : '(MISMATCH)'} | skill ${r.expectSkill}→${r.gotSkill} ${r.sOk ? '' : '(MISMATCH)'}${r.err ? ` | ${r.err}` : ''}`)
    }
  }

  console.log(`\n[eval:judge] done. tier ${pct(tierCorrect, n)}, skill ${pct(skillCorrect, n)}. Compare before/after any criteria change.`)

  // #41: persist the result so /stats can surface "golden-set accuracy + when".
  // Written to <DSH_HOME>/jev-harness-eval.json (default ~/.dsh). No key is ever
  // written — only accuracy numbers and the timestamp.
  try {
    const home = String(process.env.DSH_HOME || '').trim() || path.join(process.env.HOME || '', '.dsh')
    fs.mkdirSync(home, { recursive: true })
    const out = {
      at: new Date().toISOString(),
      criteriaVersion: set.criteriaVersion,
      cases: n,
      tierAccuracy: n ? Number((tierCorrect / n).toFixed(4)) : null,
      skillAccuracy: n ? Number((skillCorrect / n).toFixed(4)) : null,
      tierCorrect, skillCorrect,
      meanTierConfidence: tierConfN ? Number((tierConfSum / tierConfN).toFixed(4)) : null,
      meanSkillConfidence: skillConfN ? Number((skillConfSum / skillConfN).toFixed(4)) : null,
      model: MODEL,
    }
    fs.writeFileSync(path.join(home, 'jev-harness-eval.json'), JSON.stringify(out, null, 2), { mode: 0o600 })
    console.log(`[eval:judge] result written to ${path.join(home, 'jev-harness-eval.json')} (read by /stats as judgeAccuracy)`)
  } catch (e) {
    console.error(`[eval:judge] could not write result file: ${e.message}`)
  }
}

main().catch((e) => die(e.message || String(e)))
