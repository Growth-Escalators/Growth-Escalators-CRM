# WizMatch Outbound Operating System — status

Chat-independent status for the `ge/outbound-0X-*` stacked-PR sequence. Read this before
`docs/prd/005-wizmatch-outbound-operating-system.md` if you only need "where are we, what's next."

> **Reviewed 2026-07-26 (Opus review lead).** Full report:
> [`docs/reviews/wizmatch-outbound-overnight-opus-review.md`](../reviews/wizmatch-outbound-overnight-opus-review.md).
> **Verdict: do not proceed to PR 2 as currently specified.** Six CRITICAL and twelve HIGH findings
> against the PRD/ADR specification, including one (C-2) where the `resolveCompanyStatus()`
> compatibility fallback would make the whole fail-closed design fail **open**. PR 1 itself is sound
> and should be kept. **Only PR 1 exists** — PRs 2, 3 and 4 were not implemented.

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

## Files changed (this session)

- `docs/prd/005-wizmatch-outbound-operating-system.md`
- `docs/decisions/ADR-006-company-outreach-policy.md`
- `docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md`
- `docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md` (new, this file)
- `.ai/CURRENT_TASK.md`
- `.ai/HANDOFF_LOG.md`

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

## Blockers

**PR 2 is blocked on specification fixes**, not on ratification. The 2026-07-26 review found six
CRITICAL findings that must be resolved in PRD-005/ADR-006 before any schema work starts:

- **C-2** — `resolveCompanyStatus()` legacy fallback (§11.3) is fail-**open** and contradicts §8.1/§8.2.
- **C-3** — tenant-safe composite FKs specified for 1 of ~12 cross-table FKs; `scope_ref_id` has no FK.
- **C-4** — the immutability trigger (ADR-006 D-10) cannot be produced by `db:generate`, which §10 says
  is the only permitted route. Repo has zero triggers.
- **C-5** — the existing `UNIQUE (tenant_id, email)` on `wizmatch_suppression_list` collides with §8.5's
  two-grain write model; the fix is **non-additive**.
- **C-6** — no resolver chokepoint is named; no send path is required to call the resolver.

See the review report for the full list, the twelve HIGH findings, and the six genuinely unresolved
owner decisions (notably: does `replied` hold the cold-email lock?).

PR 9 (`ge/outbound-09-smartlead-csv`) remains blocked on Smartlead CSV fixtures (`U-6`).

## Do not commit

`package-lock.json` is modified in this worktree by unrelated local `npm install` churn. Committing it
would **revert CI hotfix `492a6a8`** (it deletes the `@emnapi` entries that hotfix added) and re-break
`npm ci`. Leave it unstaged.

## Deviations from PRD-005

None. The three ratification changes applied are exactly what was specified in this session's task
brief and are recorded verbatim in PRD §25.1 A-21.

## Subagent findings used

None yet — PR 1 required no read-only investigation beyond re-reading the already-approved PRD/ADR
text in this session. Read-only Explore subagents are scoped for PR 2 (schema/migration constraints),
PR 3 (policy/suppression call-site mapping) and PR 4 (UI/routes/test-surface) per the task brief, and
will be dispatched immediately before each of those PRs starts.

## Security observations

None new. No credential, schema, auth/RBAC, Cashfree or production-data path was touched in PR 1.

## Exact next step

**Do not start PR 2 implementation.** The next unit of work is a specification pass, not code.

1. Read `docs/reviews/wizmatch-outbound-overnight-opus-review.md` §13 ("required fixes before
   pushing") and §17 ("genuinely unresolved owner decisions").
2. Get owner rulings on the six decisions in §17 — chiefly: does `replied` hold the company cold-email
   lock; how does a compliance block narrower than `entire_company` express non-overridability; do the
   three `operational` codes stop free preparation; is `admin_override` real or dead weight.
3. Apply the spec fixes to `docs/prd/005-…md` and `ADR-006` on `ge/outbound-01-prd-adrs`: C-2, C-4,
   H-1, H-2, H-3, H-7, H-8, plus L-1/L-2. The §9 taxonomy edits (H-2, H-3) must land **before** PR 2,
   because the PRD freezes those values once rows exist.
4. Decide the three architectural questions — FK tenancy pattern (C-3), immutability mechanism given
   drizzle-kit cannot emit triggers (C-4), named resolver chokepoint (C-6) — and record each as an ADR
   amendment.
5. Re-plan PR 2 against the corrected spec. Note that C-5 (the `wizmatch_suppression_list` unique
   index) makes `0037` **non-additive**, which changes its risk profile and its G1 gate.
6. Only then implement PR 2. Do **not** apply `0037` to production, run the backfill with `--apply`,
   promote enforcement to `enforce`, or connect to Railway. Run `npm run build` and `npm test` and
   report real results (see the known `lucide-react` load failures above).
