# WizMatch Outbound Operating System — status

Chat-independent status for the `ge/outbound-0X-*` stacked-PR sequence. Read this before
`docs/prd/005-wizmatch-outbound-operating-system.md` if you only need "where are we, what's next."

> **Reviewed 2026-07-26 (Opus review lead), then repaired 2026-07-26 (spec-repair pass).** Full report:
> [`docs/reviews/wizmatch-outbound-overnight-opus-review.md`](../reviews/wizmatch-outbound-overnight-opus-review.md)
> — findings in §§3–6, dispositions in **§19**.
>
> **Current verdict: PR 2 may proceed**, against the acceptance criteria in PRD-005 §22.2.
> All six CRITICAL and all twelve HIGH findings are dispositioned: six CRITICAL resolved by
> specification change, eleven HIGH resolved, one (H-9) resolved as far as a CSV model permits with
> the residual limitation stated. Two owner items remain open and **neither blocks PR 2**: U-6
> (Smartlead fixtures, blocks PR 9) and U-7 (sign-off on three shared-table indexes, blocks G1).
>
> **Only PR 1 exists** — PRs 2, 3 and 4 have still not been implemented. `0037` does not exist.

## Completed PRs

### PR 1 — `ge/outbound-01-prd-adrs` (docs only) — **complete, not merged**

- Commit `687b8a0` — initial PRD-005 + ADR-006 + ADR-007 (taxonomy proposed, not ratified).
- Follow-up commit (this session) — final taxonomy ratification applied:
  - `policy_accepts_external_vendors` now requires evidence (`Evid` ⬜ → ✅, PRD §9.1).
  - `contact_role_mismatch` replaced by two codes (PRD §9.4):
    `contact_role_uncertain` (review, no evidence, never permanent) and
    `contact_role_confirmed_mismatch` (deny contact, evidence required, permanent only for the
    applicable employment relationship, learning label).
  - `docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md` §1 (verdict row 7) and §4
    ("All-domains-unhealthy Slack alert") annotated **superseded 2026-07-26** — the "keep sending"
    half of that decision is reversed by ADR-006 D-11 (fail closed). The alert-on-degradation half is
    unaffected.
  - PRD status header, §9 heading, ADR-006 status header and approval-question #1 updated from
    "awaiting ratification" to **ratified 2026-07-26**; §25.1 gained `A-21` recording the exact
    ratified changes; §25.2 now carries only `U-6` (Smartlead fixtures, blocks PR 9 only).
  - Consistency pass: full re-read of PRD-005 (all 26 sections) + ADR-006 + ADR-007 end-to-end;
    no other reference to `contact_role_mismatch` or to the un-ratified taxonomy status found outside
    §9 itself. `ge-add-ensure-table` skill (A-7/A-11) is still factually wrong
    (`.claude/skills/ge-add-ensure-table/SKILL.md` still claims "all ~12 Wizmatch tables use this
    pattern" and cites a non-existent `wizmatchOutreachTemplates.ts`) — **left untouched**, because its
    fix is scoped to the independent `ge/fix-ensure-table-skill` branch (§22), not this stack.
- **Push state (corrected 2026-07-26):** `687b8a0` **is pushed** — it exists on
  `origin/ge/outbound-01-prd-adrs`. Only `bbe881c` (ratification) is unpushed. An earlier version of
  this file and of `.ai/CURRENT_TASK.md` claimed "Not pushed", which was wrong; treat the remote branch
  as existing and do not rewrite its history. **Not merged.**

### PR 2 — `ge/outbound-02-policy-schema-service` — **not started**

Branch was created from PR 1 but has **zero commits** — it points at `bbe881c`, identical to
`ge/outbound-01-prd-adrs`. No `schema.ts` change, no migration `0037`, no resolver, no tests.

### PR 3 — `ge/outbound-03-policy-enforcement` — **not started** (branch does not exist)
### PR 4 — `ge/outbound-04-policy-ui-backfill` — **not started** (branch does not exist)

## Current branch

`ge/outbound-01-prd-adrs`, worktree `/Users/jatinagrawal/repo-comparison/v2-outbound-os`, cut clean
from `origin/main` = `1e74812`.

## Commit SHAs

- `687b8a0` — PRD-005 + ADR-006/007 initial commit (prior session). **On `origin`.**
- `bbe881c` — taxonomy ratification + this status doc. Local only.
- Review commit — this session's review report + handoff correction. Local only.

## Files changed (spec-repair session, 2026-07-26)

- `docs/prd/005-wizmatch-outbound-operating-system.md`
- `docs/decisions/ADR-006-company-outreach-policy.md`
- `docs/decisions/ADR-007-outreach-provider-boundary.md`
- `docs/reviews/wizmatch-outbound-overnight-opus-review.md` (new §19, findings preserved verbatim)
- `docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md` (this file)
- `.ai/CURRENT_TASK.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/OUTBOUND_PR2_SPEC_READY` (new marker)

Documentation and context layer only. No `src/`, no `admin/`, no `client/`, no migration, no config.

## Migration generated

None. PR 1 is documentation only. `0037` is reserved (next free migration number per the journal) but
not generated until PR 2.

## Tests run and results

No code changed in PR 1. Baseline measured during the 2026-07-26 review:

```
npm test       →  Test Files  2 failed | 91 passed (93)
                       Tests  781 passed (781)
npm run build  →  tsc, exit 0
```

## Failed tests

`src/__tests__/adminFrontendHelpers.test.js` and `src/__tests__/wizmatchRouteRegistry.test.js` — both
fail to **load** with `Cannot find package 'lucide-react'`. Zero assertion failures. Cause is
environmental: `admin/node_modules` does not exist in this worktree. Run `npm run admin:install` before
using a green suite as a PR 2 gate.

### Spec-repair pass — 2026-07-26 (docs only)

Applied on `ge/outbound-01-prd-adrs`. Eight owner decisions D-1 … D-8, recorded as PRD-005 §25.1
A-22 … A-30. Three read-only Explore subagents produced the evidence (schema/tenancy, chokepoint
callers, states/suppression/taxonomy); the main session owned every edit.

| Decision | Effect | Resolves |
|---|---|---|
| D-1 | Missing root policy → `deny` / `policy_missing_root`. Legacy-status fallback **deleted**. New gate **L0**. Legacy intelligence status is display-only | C-2 |
| D-2 | All **22** entity references become composite `(tenant_id, ref_id)` FKs. `scope_ref_id` **deleted**, replaced by typed `signal_id` / `requirement_id`. Signals table named as `wizmatch_job_signals` | C-3, H-5 |
| D-3 | Raw SQL approved for the immutability trigger only, in a marked guard block, six-step process. `admin_override` **deleted** | C-4, H-8, M-9 |
| D-4 | `suppression_scope` **deleted**; `UNIQUE (tenant_id, email)` **retained** → `0037` is additive again. Three grains, three homes, append-only `wizmatch_suppression_events` | C-5 |
| D-5 | `evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed` named; branded `PolicyDecision`; **31-row caller-migration checklist** with `file:line` | C-6, H-9 |
| D-6 | A reply does **not** release the cold-email lock. 15 enrolment states: 8 live, 7 terminal. All four lock predicates amended together | H-6 |
| D-7 | Evidence required for every permanent **or** non-overridable block, CHECK-enforced. New gate **L1c**. Taxonomy corrected; §9.11 gains invariant 5 | H-2, H-7 |
| D-8 | Taxonomy correctable until PR 2; after PR 2 a rename needs a migration plus compatibility mapping | — |

**Two schema facts the audit corrected that PR 2 must not get wrong:** the signals table is
`wizmatch_job_signals` — the table named `signals` is Growth's and has **no `tenant_id` at all**; and
adopting drizzle's `check()` for the first time may make drizzle-kit propose **dropping** the three
pre-existing CHECK constraints on Growth's `prospects` / `signals` tables (`0017:32-63`), which is the
concrete way an "additive" migration could damage Growth. §10.11.3 makes catching that a blocking gate.

## Blockers

**PR 2 is unblocked.** Build against PRD-005 §22.2 (twenty acceptance criteria). PR 3 builds against
§22.3, whose acceptance evidence is the §8.10.1 caller checklist.

Still open, neither blocking PR 2:

- **U-6** — sanitised Smartlead CSV fixtures. Blocks **PR 9** only.
- **U-7** — owner sign-off on the additive `(tenant_id, id)` unique indexes on `users`, `contacts` and
  `contact_channels`, which are core CRM tables shared with the Growth tenant. The indexes cannot fail
  or reject a write, but the build takes a brief write lock on another product's tables. Blocks **G1**
  only; PR 2 writes the schema and measures the lock.

Note the C-5 status change: the handoff previously recorded the suppression fix as **non-additive**.
Under D-4 it is **additive** — no index is dropped and no production dedup dry-run is needed.

## Do not commit

`package-lock.json` is modified in this worktree by unrelated local `npm install` churn. Committing it
would **revert CI hotfix `492a6a8`** (it deletes the `@emnapi` entries that hotfix added) and re-break
`npm ci`. Leave it unstaged.

## Deviations from PRD-005

None. The three ratification changes applied are exactly what was specified in this session's task
brief and are recorded verbatim in PRD §25.1 A-21.

## Subagent findings used

**Spec-repair pass, 2026-07-26** — three read-only Explore subagents run in parallel, each restricted
from editing, committing, branch changes, production, Railway and migration application. The main
session owned every edit.

1. **Schema + tenant references** — produced the 22-row tenant-reference matrix; confirmed 0 composite
   FKs, 0 `check()` and 0 triggers in the repo today; established that composite FKs, partial unique
   indexes and CHECKs **are** emittable at `drizzle-kit@0.31.10` / `drizzle-orm@0.45.2` and only
   triggers are not; identified the `wizmatch_job_signals` vs Growth `signals` naming trap and the
   `0017` CHECK-drift risk.
2. **Chokepoint callers** — audited every send-capable function, route, worker and suppression
   read/write site in `src/`, producing the 31-row caller-migration checklist and the four real
   `contacts` → `wizmatch_companies` link mechanisms. Found four defects the review had not: the
   un-normalised `classify-reply` suppression write, the broken unsubscribe HMAC for mixed-case
   addresses, warm-up ignoring domain health, and four send paths honouring neither kill-switch.
3. **States, locks, suppression, evidence** — enumerated every doc line carrying an enrolment-state
   list or lock predicate (four copies, all amended), classified every suppression statement against
   D-4, and produced the exhaustive evidence-invariant and preparation-flag contradiction lists.

## Security observations

None new. No credential, schema, auth/RBAC, Cashfree or production-data path was touched in PR 1.

## Exact next step

**Start PR 2**, on a branch cut from `ge/outbound-01-prd-adrs`.

1. Read PRD-005 §0.3 in order, then §22.2 — the twenty acceptance criteria are the contract. Then
   §10.1–§10.11, ADR-006 D-1 … D-18, ADR-007.
2. Confirm `.ai/OUTBOUND_PR2_SPEC_READY` exists and its `commit=` matches this branch tip. If it does
   not, the spec has moved and §22.2 must be re-read before writing code.
3. Run `npm run admin:install` first — two suites fail to **load** on `lucide-react` in a fresh
   worktree, and a red baseline cannot gate anything.
4. Write `schema.ts` + generate `0037` + build the resolver and the gate module. **No callers migrate
   in PR 2.**
5. Run all ten §10.11.4 verification requirements and put the **real output** in the PR — fresh
   `0000→0037` replay, incremental apply, re-apply no-op, journal `when` > `1784464092263`, production
   `information_schema` drift diff, destructive-statement scan, guard-block audit, `check()`/`foreignKey()`
   round-trip proof, index lock measurement, trigger test.
6. Do **not** apply `0037` to production (that is G1, and it also needs U-7), run the backfill with
   `--apply`, promote enforcement to `enforce`, touch Railway, or push without explicit confirmation.
7. Do not stage `package-lock.json`.
