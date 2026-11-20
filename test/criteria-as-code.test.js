/**
 * Criteria-as-code guards (#42). No network.
 *
 * Asserts the criteria module is the single source of truth for all three judge
 * dimensions, that a zh/en pair exists for each, and that index.js no longer
 * hardcodes the criteria strings (they must live only in criteria.js).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CRITERIA, CRITERIA_VERSION, CRITERIA_LANG,
  TIER_CRITERIA, SKILL_NONE_CRITERIA, SKILL_INSTRUCTIONS,
  DIFFICULTY_CRITERIA,
} from '../criteria.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const indexSrc = fs.readFileSync(path.join(here, '..', 'index.js'), 'utf8')

test('criteria exposes tier / skill / difficulty for BOTH en and zh', () => {
  for (const lang of ['en', 'zh']) {
    const c = CRITERIA[lang]
    assert.ok(c, `missing language set ${lang}`)
    assert.equal(c.version, CRITERIA_VERSION, `${lang}: version not pinned`)
    // tier
    assert.ok(c.tier.decision && c.tier.execution, `${lang}: tier criteria incomplete`)
    assert.ok(c.tierInstructions, `${lang}: missing tier instructions (switching lang must not mix EN instructions into ZH criteria)`)
    // skill (fixed none criterion + instructions)
    assert.ok(c.skillNone, `${lang}: missing skill none criterion`)
    assert.ok(c.skillInstructions, `${lang}: missing skill instructions`)
    // difficulty (forward-declared for #38)
    assert.ok(c.difficulty.trivial && c.difficulty.normal && c.difficulty.hard, `${lang}: difficulty criteria incomplete`)
    assert.ok(c.difficultyInstructions, `${lang}: missing difficulty instructions`)
  }
})

test('the active language is one of the defined sets', () => {
  assert.ok(['en', 'zh'].includes(CRITERIA_LANG), `unexpected CRITERIA_LANG ${CRITERIA_LANG}`)
})

test('en tier criteria are byte-identical to the production wording (behaviour unchanged)', () => {
  assert.equal(
    CRITERIA.en.tier.decision,
    'Requires human-level judgment: evaluation, trade-offs, review, architecture, risk, strategy, or quality calls.',
  )
  assert.equal(
    CRITERIA.en.tier.execution,
    'Mechanical work: implementation, transformation, formatting, extraction, bulk generation, or translation.',
  )
})

test('index.js no longer hardcodes the tier/skill criteria strings (single source)', () => {
  assert.ok(
    !indexSrc.includes('Requires human-level judgment: evaluation, trade-offs'),
    'tier decision criterion is still hardcoded in index.js',
  )
  assert.ok(
    !indexSrc.includes('Mechanical work: implementation, transformation'),
    'tier execution criterion is still hardcoded in index.js',
  )
  assert.ok(
    !indexSrc.includes('None of the skills applies, or the task is too small'),
    'skill none criterion is still hardcoded in index.js',
  )
  assert.ok(
    !indexSrc.includes('Pick the single agent skill whose instructions'),
    'skill instructions are still hardcoded in index.js',
  )
})

test('difficulty is a 3-level choice set (trivial/normal/hard), matching #38', () => {
  assert.deepEqual(Object.keys(DIFFICULTY_CRITERIA).sort(), ['hard', 'normal', 'trivial'])
})

test('every dimension has instructions in BOTH languages (no EN/ZH mixing on switch)', () => {
  for (const lang of ['en', 'zh']) {
    const c = CRITERIA[lang]
    for (const key of ['tierInstructions', 'skillInstructions', 'difficultyInstructions']) {
      assert.ok(typeof c[key] === 'string' && c[key].length > 0, `${lang}.${key} missing`)
    }
  }
  // en and zh instructions must actually differ (not a copy-paste of English into zh)
  assert.notEqual(CRITERIA.en.tierInstructions, CRITERIA.zh.tierInstructions, 'zh tier instructions must not be the English text')
})
