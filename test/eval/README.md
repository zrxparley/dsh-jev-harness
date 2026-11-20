# Judge regression set (#10)

Golden labels for the JEV judge: 20 hand-labelled tasks, each with the tier we
expect, the skill we expect, and a difficulty band. Used to answer one question
every time the criteria or the judge prompt changes: **did we get better or
worse?** This is the measuring stick #42 (criteria-as-code) and #38 (merged
judge) are validated against.

## File

- `judge-cases.json` — the labels. `criteriaVersion` pins the wording these
  labels were written against. Bump it (and re-label) in the same commit as any
  criteria change, or the criteria guard test fails.

## Dimensions

| field | asserted today? | notes |
|---|---|---|
| `expectTier` | **yes** | `decision` / `execution`. Live dimension of the current judge. |
| `expectSkill` | **yes** | a real id from the bundled catalog (39 skills) or `none`. Referential integrity is asserted. |
| `difficulty` | **not yet** | forward-declared for #38 (merged judge adds a `trivial`/`normal`/`hard` question). The current criteria (`1.0.0`) has no difficulty question, so the eval harness records but does not score it until #38 lands. |

## Running (manual — needs a key)

The eval hits the **real** JEV gateway, so it is **not** part of `node --test`
and **not** run in CI (no secret there; with no key it exits 1 with an
explanation rather than silently passing). Run it by hand:

```bash
JEV_BASE_URL="https://your-jev-gateway" \
JEV_API_KEY="$DSH_SECRET_JEV_API_KEY" \
node test/eval/eval-judge.js
# or, where npm exists:  npm run eval:judge
```

- Key comes only from `JEV_API_KEY` (or `DSH_SECRET_JEV_API_KEY`); it is never
  printed, never written to a file, never in the report.
- Optional env: `JEV_MODEL` (default `jev-latest`), `JEV_TIMEOUT_MS` (default 30000).
- Output: per-case ✓/✗, **tier accuracy**, **skill accuracy**, **mean
  confidence**, a **tier confusion matrix**, and a mismatch/error list.
- Exit 0 = ran and every case was answered (accuracy may still be <100% — that
  is a measurement, not a gate). Exit 1 = could not run (no key / no base URL /
  unreachable gateway / malformed golden set).

## Offline integrity test

`test/eval/integrity.test.js` runs in the normal suite (no network) and asserts:

- exactly 20 cases, unique ids;
- every `expectTier` is `decision` or `execution`;
- every `expectSkill` is `none` or an id present in the bundled catalog;
- `difficulty` is one of `trivial`/`normal`/`hard`;
- **criteria guard**: `criteriaVersion` here === `CRITERIA_VERSION` in
  `criteria.js`. If you bump the criteria version, you must re-label this set in
  the same commit — otherwise this test goes red.

## Labelling notes / known-soft labels

Labels are human judgement, not proof. The debatable ones are marked in each
case's `rationale` (e.g. `t18` prototype: deliverable is code → labelled
`execution`, though it answers a design question). When the judge disagrees with
a label, read the rationale before assuming the judge is wrong — some labels may
be the thing to fix.
