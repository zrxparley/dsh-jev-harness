/**
 * JEV judge criteria, as code. (#42, step 1)
 *
 * These strings are the exact request-body `criteria` sent to the JEV gateway
 * (POST /v1/systemone, a `choice` question). They were extracted verbatim out
 * of index.js so that the provider adapter (#37, `jev/auto`) and the tool-level
 * judge (`decideTier`) share ONE source of truth instead of drifting copies.
 *
 * Change discipline (full process in docs/adr/0004-criteria-as-code.md):
 *   - bump CRITERIA_VERSION (semver) whenever a criteria string changes;
 *   - update the regression fixtures (#10, test/fixtures/judge-cases.json) in
 *     the same commit, or the criteria guard test fails;
 *   - ledger entries record `criteriaVersion` so a decision is traceable to
 *     the exact wording that produced it.
 *
 * Scope of this extraction: ONLY the tier (decision/execution) criteria, which
 * is what the adapter needs. The skill-pick criteria, the difficulty criteria
 * (#38) and the zh/en parallel set (#42) are intentionally NOT here yet — they
 * land in their own issues. Do not treat this file as the finished #42.
 */

/** Semver of the criteria wording. Bump on any criteria text change. */
export const CRITERIA_VERSION = '1.0.0'

/**
 * Tier criteria: which tier should handle a task.
 *   decision  -> quality tier (routed to Kimi): human-level judgment.
 *   execution -> execution tier (routed to DeepSeek Flash): mechanical work.
 * Keys are the exact `choice` values the JEV gateway may return.
 */
export const TIER_CRITERIA = Object.freeze({
  decision:
    'Requires human-level judgment: evaluation, trade-offs, review, architecture, risk, strategy, or quality calls.',
  execution:
    'Mechanical work: implementation, transformation, formatting, extraction, bulk generation, or translation.',
})

/** Instruction line that accompanies the tier question. */
export const TIER_INSTRUCTIONS = 'Decide which tier should handle this task.'
