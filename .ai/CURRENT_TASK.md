# CURRENT_TASK.md

## Active task

**Wizmatch Staffing OS — Gate A/B/C and the permanent-fee/contract-margin display repair are now
deployed and smoke-tested in the isolated Railway staging environment. The next release-readiness
unit is the mandatory owner-policy workshop plus the explicit migration-owner decision on ADR-005.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

## Verified staging result

- Staging remains isolated from production: `web-staging` + `Postgres-Bhky`, migration journal
  0000–0028 applied (29 entries), Gate A/B/C on, worker/sending/paid discovery/provider calls off.
- Gate A: Company A has distinct Person A→SAP and Person B→Java source attribution, assignments,
  SLA, next action, 360 views and timelines.
- Gate B: the live exercise found that the earlier report had not persisted canonical skill rows.
  The fictional staging fixtures were corrected through the product APIs: pilot taxonomy seeded,
  requirement/candidate evidence stored, locations reconciled, four independent match pairs
  recalculated, Rahul→SAP and Priya→Java shortlisted. Cross-role pairs remain separate and score 0.
- Gate C: SAP permanent and Java contract chains both reached `placed` through exact-requirement
  consent, draft, approval, fictional manual sent record, interview, accepted offer and placement.
  Negative tests blocked wrong-requirement consent, a duplicate active submission, duplicate
  placement and unauthenticated access.
- Finance: 2 starts, 570000 invoiced, 570000 collected and 250500 stored gross margin; permanent fee
  = 250000, contract margin = 500 / 25%. Dispute, replacement and refund records were opened and
  resolved. Invoice, collection and placement remain separate records.
- Browser: live Delivery, My Work, Relationships, Requirements, Talent Matching, Placements,
  Analytics and System paths were checked. Mobile Delivery at 390×844 has no page-level overflow.
- The old Placements view misleadingly labelled a permanent fee as hourly margin. Commit `ef2112f`
  is deployed to staging as Railway deployment `52508e6f-8fdd-475c-a58e-84d31b82d142` (`SUCCESS`).
  Authenticated browser smoke verified the aggregate and cards show `₹500/hr contract margin` and
  `₹2,50,000 permanent fee(s)`, with no permanent amount shown as hourly.

## Current local verification

- `npm run build` passed.
- `npm test` passed: 44 files / 352 tests.
- `npm run admin:build` passed.
- Wizmatch Playwright passed: 16/16 Chromium scenarios.
- `git diff --check` passed.
- Staging credentials/sessions used for QA were rotated/revoked and temporary session files removed.
- One generated staging password was included in an internal browser snapshot during QA; it was
  immediately treated as compromised, rotated, revoked and cleared. Never copy it into context.

## Production and approval boundary

Production remains untouched: nothing from this branch has been pushed, deployed, migrated or
written to production. Do not push or deploy from this context alone.

Pause for a separate explicit approval immediately before each of:

1. Read production data for the count-only backfill preview.
2. Apply migrations 0025–0028 to production with all gates off.
3. Push this reviewed branch to `main` (Railway auto-deploys).
4. Enable production Gate A, Gate B or Gate C flags.
5. Import approved pilot production data.
6. Rotate any live credential, send/outreach, enable paid providers or deploy a worker.

Before production Gate C activation, the owner must still fill the mandatory role, SLA, consent,
privacy, permission and commercial-policy decisions in
`docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md`.

## Exact next action

Run the owner workshop and record explicit decisions in
`docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md`; separately obtain the migration owner's
accept/reject decision for proposed ADR-005. Do not infer either decision and do not begin a
production read, migration, push, flag change or data import from this context alone.
