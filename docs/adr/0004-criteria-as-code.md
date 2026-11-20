# ADR 0004: Judge criteria as code

- Status: Accepted
- Date: 2026-11-19
- Issue: #42 (paired with #10 regression set, consumed by #38 merged judge and #37 adapter)

## Context

The judge's decision quality depends entirely on the wording of the `criteria`
sent to the JEV gateway (`POST /v1/systemone`). That wording used to live as
string literals inside `index.js`, next to the fetch call. Consequences:

- Tuning the judge was guesswork — there was no way to tell whether a wording
  change made decisions better or worse.
- Two callers (`decideTier` and the #37 provider adapter) would drift into
  divergent copies of the same criteria.
- A decision in the ledger could not be traced back to the exact wording that
  produced it.

## Decision

Criteria are code, versioned, single-sourced, and guarded.

1. **One module** — `criteria.js` exports `{ version, tier, skill, difficulty }`
   for each supported language. `decideTier`, `pickSkill`, and the adapter all
   import from it. No criteria string is hardcoded anywhere else (a guard test
   fails if one reappears in `index.js`).
2. **Semantic version** — `CRITERIA_VERSION` bumps on any wording change.
3. **Ledger traceability** — every `recordDecision` entry writes
   `criteriaVersion`, so a past decision can be re-read against the wording that
   produced it.
4. **Regression-gated change** — the golden set (#10, `test/eval/judge-cases.json`)
   is pinned to a `criteriaVersion`. Bumping the version without re-labelling the
   golden set in the same commit fails the criteria guard test.
5. **zh / en in parallel** — both language sets ship. `en` is the production
   wording (what is sent today). `zh` is a candidate that may only replace `en`
   after a measured comparison on the 20 golden cases shows it discriminates at
   least as well. That measurement needs a live gateway; until it is recorded in
   `docs/`, `CRITERIA_LANG` stays `en`.

## Process for changing criteria

1. Edit the wording in `criteria.js`; bump `CRITERIA_VERSION` (semver).
2. In the **same commit**, re-label `test/eval/judge-cases.json` and update its
   `criteriaVersion`. The guard test enforces this pairing.
3. Record the reason for the change and the expected effect in the commit body.
4. Run `eval:judge` against the live gateway before and after; put the accuracy
   / confusion-matrix delta in `docs/` (needs `JEV_API_KEY`; CI skips it).
5. For a language switch, attach the zh/en comparison numbers — a switch without
   data is not accepted.

## Consequences

- Good: criteria changes are auditable, reversible, and measured; adapter and
  tool judge can never diverge; every decision is traceable to a wording version.
- Cost: changing wording now also means re-labelling 20 cases and (ideally) a
  live eval run. That friction is intentional — it is what stops silent judge
  regressions.

## Out of scope here / dependencies

- The `difficulty` criteria are forward-declared; they become a live question in
  #38 (merged judge).
- The zh/en accuracy comparison and the first live accuracy baseline both need
  `JEV_API_KEY`. Until that key is authorised for the eval runner, those two
  numbers are recorded as **not yet measured**, not assumed.
