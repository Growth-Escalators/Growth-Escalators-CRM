# WizMatch Outbound Operating System — status

Chat-independent status for the `ge/outbound-0X-*` stacked-PR sequence. Read this before
`docs/prd/005-wizmatch-outbound-operating-system.md` if you only need "where are we, what's next."

## Completed PRs

### PR 1 — `ge/outbound-01-prd-adrs` (docs only) — **IN PROGRESS, not merged**

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
- **Not pushed. Not merged.**

### PR 2 — `ge/outbound-02-policy-schema-service` — not started
### PR 3 — `ge/outbound-03-policy-enforcement` — not started
### PR 4 — `ge/outbound-04-policy-ui-backfill` — not started

## Current branch

`ge/outbound-01-prd-adrs`, worktree `/Users/jatinagrawal/repo-comparison/v2-outbound-os`, cut clean
from `origin/main` = `1e74812`.

## Commit SHAs

- `687b8a0` — PRD-005 + ADR-006/007 initial commit (prior session).
- Taxonomy-ratification commit — see `git log` on this branch after this session's commit lands.

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

None applicable — no code changed in PR 1. `npm run build` / `npm test` are PR 2+ gates.

## Failed tests

None.

## Blockers

None for PR 1. PR 2 is now unblocked (taxonomy ratified). PR 9 (`ge/outbound-09-smartlead-csv`, outside
this session's authorized stack of PR 1–4) remains blocked on Smartlead CSV fixtures (`U-6`).

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

1. Commit this PR 1 documentation change on `ge/outbound-01-prd-adrs` (docs only — no push, no merge).
2. Create `ge/outbound-02-policy-schema-service` from the completed PR 1 branch.
3. Before writing any PR 2 code, dispatch a read-only Explore subagent to inspect the current
   migration journal / next migration number, `schema.ts` conventions, tenant-safe FK patterns,
   partial-index conventions and trigger conventions — restating the read-only restriction in its
   task brief (no edits, no branches, no commits, no migrations applied, no production/Railway access,
   must not touch Growth/SEO/n8n/legacy-outreach code).
4. Implement PR 2 per PRD-005 §10–§11 and ADR-006/007: schema updates, migration `0037` (generated via
   `npm run db:generate`, never hand-written), policy resolver, scope-key builder, duplicate-suspect
   table, reply-mailbox registry, outreach batches/enrolments/events, suppression-list additions,
   tenant-safe account owner + composite FK, focused unit tests. Do **not** apply `0037` to production
   or connect to Railway. Run `npm run build` and `npm test` and report real results.
