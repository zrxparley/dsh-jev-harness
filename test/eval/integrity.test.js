/**
 * Offline integrity test for the judge regression set (#10).
 *
 * Runs in the normal `node --test` suite with NO network. Guards two things:
 *   1. the golden set is well-formed and every expected skill id really exists
 *      in the bundled catalog (no invented skills, no drift);
 *   2. the criteria guard (#42): if CRITERIA_VERSION in criteria.js is bumped
 *      but judge-cases.json is not re-labelled in the same commit, this fails.
 *
 * The actual accuracy eval against the live gateway is separate (manual, needs
 * a key) and is NOT here — see test/eval/README.md.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKILLS } from '../../skills.js'
import { CRITERIA_VERSION } from '../../criteria.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const casesPath = path.join(here, 'judge-cases.json')
const raw = fs.readFileSync(casesPath, 'utf8')
const set = JSON.parse(raw)

const VALID_TIERS = new Set(['decision', 'execution'])
const VALID_DIFFICULTY = new Set(['trivial', 'normal', 'hard'])
const catalogIds = new Set(SKILLS.map((s) => s.id))

test('judge-cases.json parses and has exactly 20 cases', () => {
  assert.ok(Array.isArray(set.cases), 'cases must be an array')
  assert.equal(set.cases.length, 20, `expected 20 cases, got ${set.cases.length}`)
})

test('case ids are unique', () => {
  const ids = set.cases.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate case ids')
})

test('every case has a non-empty task and a rationale', () => {
  for (const c of set.cases) {
    assert.ok(typeof c.task === 'string' && c.task.trim().length > 0, `${c.id}: empty task`)
    assert.ok(typeof c.rationale === 'string' && c.rationale.length > 0, `${c.id}: missing rationale`)
  }
})

test('every expectTier is decision or execution', () => {
  for (const c of set.cases) {
    assert.ok(VALID_TIERS.has(c.expectTier), `${c.id}: bad expectTier "${c.expectTier}"`)
  }
})

test('every expectSkill is "none" or a real catalog id (no invented skills)', () => {
  for (const c of set.cases) {
    if (c.expectSkill === 'none') continue
    assert.ok(
      catalogIds.has(c.expectSkill),
      `${c.id}: expectSkill "${c.expectSkill}" is not in the bundled catalog (39 skills)`,
    )
  }
})

test('difficulty is one of trivial/normal/hard (forward-declared for #38)', () => {
  for (const c of set.cases) {
    assert.ok(VALID_DIFFICULTY.has(c.difficulty), `${c.id}: bad difficulty "${c.difficulty}"`)
  }
})

test('tier labels are not degenerate (both tiers represented)', () => {
  const tiers = new Set(set.cases.map((c) => c.expectTier))
  assert.ok(tiers.has('decision') && tiers.has('execution'), 'golden set must cover both tiers')
})

test('CRITERIA GUARD (#42): judge-cases criteriaVersion matches criteria.js', () => {
  assert.equal(
    set.criteriaVersion,
    CRITERIA_VERSION,
    `criteria.js is at ${CRITERIA_VERSION} but judge-cases.json is pinned to ${set.criteriaVersion}. `
      + 'Bumping the criteria version REQUIRES re-labelling the golden set in the same commit.',
  )
})
