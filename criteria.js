/**
 * JEV judge criteria, as code. (#42)
 *
 * These are the exact request-body `criteria`/`instructions` sent to the JEV
 * gateway (POST /v1/systemone). They live in ONE file so the tool-level judge
 * (`decideTier`/`pickSkill`) and the provider adapter (#37, `jev/auto`) share a
 * single source of truth instead of drifting copies.
 *
 * Change discipline (full process in docs/adr/0004-criteria-as-code.md):
 *   - bump CRITERIA_VERSION (semver) whenever a criteria string changes;
 *   - re-label the regression set (#10, test/eval/judge-cases.json) in the SAME
 *     commit, or the criteria guard test fails;
 *   - ledger entries record `criteriaVersion` so a decision is traceable to the
 *     exact wording that produced it.
 *
 * Scope notes:
 *   - `tier` and `skill` are live dimensions of today's judge.
 *   - `difficulty` is FORWARD-DECLARED for #38 (merged judge). It is not asked
 *     until that issue lands; the constants are here so #38 does not fork a
 *     second criteria file.
 *   - `en` and `zh` are kept in parallel (#42 requirement 4). `en` is the
 *     production wording (what decideTier/pickSkill send today). `zh` is a
 *     candidate set whose discrimination power MUST be measured against the 20
 *     golden cases before it can replace `en` — that experiment needs a live
 *     gateway and is recorded in docs/. Do NOT switch the default to `zh`
 *     without that measurement.
 *   - Per-skill descriptions are NOT here: they are generated at runtime from
 *     the catalog (pickSkill slices each skill's description). Only the fixed
 *     `none` criterion and the question instructions are criteria; the catalog
 *     text is data, not a criterion.
 */

/** Semver of the criteria wording. Bump on any criteria text change. */
export const CRITERIA_VERSION = '1.1.0'

/** Which language set is sent to the gateway. Switch only after a measured zh/en comparison. */
export const CRITERIA_LANG = 'en'

/* ------------------------------------------------------------------ tier */

const TIER_EN = Object.freeze({
  decision:
    'Requires human-level judgment: evaluation, trade-offs, review, architecture, risk, strategy, or quality calls.',
  execution:
    'Mechanical work: implementation, transformation, formatting, extraction, bulk generation, or translation.',
})

const TIER_ZH = Object.freeze({
  decision:
    '需要人类层级判断的工作：评估、权衡取舍、评审、架构设计、风险判断、战略决策或质量把关。',
  execution:
    '机械性工作：具体实现、格式转换、排版整理、信息提取、批量生成或翻译。',
})

/* ------------------------------------------------------------------ skill */

/** The fixed `none` option criterion (the per-skill criteria come from the catalog at runtime). */
const SKILL_NONE_EN = 'None of the skills applies, or the task is too small to need one.'
const SKILL_NONE_ZH = '没有任何技能适用，或任务太小不需要技能。'

const TIER_INSTRUCTIONS_EN = 'Decide which tier should handle this task.'
const TIER_INSTRUCTIONS_ZH = '判断这个任务该由哪一层来处理。'

const SKILL_INSTRUCTIONS_EN =
  'Pick the single agent skill whose instructions would most improve how this task is executed. Choose none when no skill clearly applies.'
const SKILL_INSTRUCTIONS_ZH =
  '挑选最能提升本任务执行质量的单个技能。没有明显适用的技能时选择 none。'

/* ------------------------------------------------------------------ difficulty (#38 forward-declared) */

const DIFFICULTY_EN = Object.freeze({
  trivial: 'A single obvious step; no judgment, no ambiguity, mechanical.',
  normal: 'Some structure or a few decisions, but a clear path; routine for the tier.',
  hard: 'Multi-step, ambiguous, or high-stakes; needs decomposition or careful judgment.',
})

const DIFFICULTY_ZH = Object.freeze({
  trivial: '单一且明确的步骤，无需判断、没有歧义，纯机械操作。',
  normal: '有一定结构或少量决策点，但路径清晰，属于该层级的常规工作。',
  hard: '多步骤、有歧义或高风险，需要拆解或谨慎判断。',
})

const DIFFICULTY_INSTRUCTIONS_EN = 'Rate how hard this task is to complete well.'
const DIFFICULTY_INSTRUCTIONS_ZH = '评估把这项任务做好的难度。'

/* ------------------------------------------------------------------ assembled sets */

/** The full criteria payload, per language. `version` travels with each set. */
export const CRITERIA = {
  en: {
    version: CRITERIA_VERSION,
    tier: TIER_EN,
    tierInstructions: TIER_INSTRUCTIONS_EN,
    skillNone: SKILL_NONE_EN,
    skillInstructions: SKILL_INSTRUCTIONS_EN,
    difficulty: DIFFICULTY_EN,
    difficultyInstructions: DIFFICULTY_INSTRUCTIONS_EN,
  },
  zh: {
    version: CRITERIA_VERSION,
    tier: TIER_ZH,
    tierInstructions: TIER_INSTRUCTIONS_ZH,
    skillNone: SKILL_NONE_ZH,
    skillInstructions: SKILL_INSTRUCTIONS_ZH,
    difficulty: DIFFICULTY_ZH,
    difficultyInstructions: DIFFICULTY_INSTRUCTIONS_ZH,
  },
}

/** The active set, selected by CRITERIA_LANG. This is what callers use. */
export const ACTIVE = CRITERIA[CRITERIA_LANG]

/* ------------------------------------------------------------------ back-compat exports (decideTier / adapter import these) */

/** Tier criteria in the active language. Keys are the exact `choice` values the gateway returns. */
export const TIER_CRITERIA = ACTIVE.tier
export const TIER_INSTRUCTIONS = ACTIVE.tierInstructions

/** Skill question pieces in the active language. (`SKILL_NONE_CRITERIA` is the
 *  none-option's description text, NOT the 'none' key — index.js owns that key.) */
export const SKILL_NONE_CRITERIA = ACTIVE.skillNone
export const SKILL_INSTRUCTIONS = ACTIVE.skillInstructions

/** Difficulty question pieces (#38). */
export const DIFFICULTY_CRITERIA = ACTIVE.difficulty
export const DIFFICULTY_INSTRUCTIONS = ACTIVE.difficultyInstructions
