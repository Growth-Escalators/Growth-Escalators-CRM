# CURRENT_TASK.md

## Active task

**Wizmatch Staffing OS — read-only production qualification is complete and the release candidate
is green. The next unit is the separately approved production environment hardening with all
staffing gates kept off, followed by pilot-account provisioning and migrations under later gates.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

## Verified release candidate

- Final hardening commit `9f4c0f4` enforces a production-fail-closed named roster, excludes viewers,
  scopes recruiters/account owners to assigned requirements, separates recruiter/lead/admin
  capabilities, filters recruiter workspaces, and restricts commercial visibility/mutations.
- `GET /api/wizmatch/staffing/access` reports the caller's phase/role/access/capabilities without
  exposing the roster. Admin navigation uses the same server-resolved pilot decision.
- Consent defaults to a maximum 30 days. Permanent placement requires a positive fee. Contract
  placement requires bill amount and loaded cost; margin below 20% requires an admin exception.
- The approved provisional role/SLA/privacy/commercial policy pack is recorded in owner inputs and
  ADR-005 accepts only the one-time `a810d08` fresh-install migration exception. Neither is push or
  production-action approval.
- Staging remains isolated: `web-staging` + `Postgres-Bhky`, migration journal 0000–0028 applied
  (29 entries), Gate A/B/C on, worker/sending/paid discovery/Google fallback/provider calls off.
- Railway CLI is 5.26.1. Exact commit `9f4c0f4` was deployed after the pilot roster was set;
  deployment `54b9ff52-8fed-43eb-974c-bb2ddaab72f6` reached terminal `SUCCESS`; `/health` is 200
  with database `ok`.
- Direct-API access smoke passed every case: pilot admin/lead/recruiter admitted; viewer and
  non-pilot users rejected; assigned recruiter SAP access allowed but unassigned Java access
  rejected; recruiter approval/commercial access rejected; lead finance mutation rejected; admin
  commercial access allowed; legacy commercial endpoints also reject viewers.
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

## Current verification

- `npm run build` passed.
- `npm test` passed: 45 files / 360 tests.
- `npm run admin:build` passed.
- Wizmatch Playwright passed: 16/16 Chromium scenarios.
- `git diff --check` passed.
- Post-deploy read-only reconciliation passed: Person A/SAP and Person B/Java have distinct primary
  contacts; both consent→submission→offer→placement chains are complete; permanent fee is INR
  250000; contract economics are INR 2000 bill / 1500 loaded cost / 500 margin / 25%; invoice links
  remain separate from placements; three resolved SAP adjustment records remain traceable.
- R2 is intentionally absent on staging. Private-document configuration failure remains honest;
  no document upload/provider call was attempted in this qualification.
- Staging credentials/sessions used for QA were rotated/revoked and temporary session files removed.
- One generated staging password was included in an internal browser snapshot during QA; it was
  immediately treated as compromised, rotated, revoked and cleared. Never copy it into context.

## Production and approval boundary

Production application/schema/staffing data remain untouched: nothing from this branch has been
pushed, deployed or migrated, and no staffing record was written. The separately approved security
operation changed exactly one Wizmatch-tenant admin credential row and bumped its token version;
the Growth-tenant account sharing the email was untouched. Do not push or deploy from this context.

Pause for a separate explicit approval immediately before each of:

1. Read production data for the count-only backfill preview.
2. Apply migrations 0025–0028 to production with all gates off.
3. Push this reviewed branch to `main` (Railway auto-deploys).
4. Enable production Gate A, Gate B or Gate C flags.
5. Import approved pilot production data.
6. Rotate any live credential, send/outreach, enable paid providers or deploy a worker.

The provisional role, SLA, consent, privacy, permission and commercial-policy pack required for the
controlled pilot is approved and recorded. Named human owners, the production roster and reviewed
pilot import manifest still must be supplied before their dependent launch steps.

## Read-only production qualification — 2026-07-14

- Production health is HTTP 200 with database `ok`; API/CRM/ecom endpoints are live. The known stale
  WhatsApp inbound timestamp remains unrelated. Production holds only `web` + Postgres, no worker.
- `web` remains on commit `b05ac015` / deployment `b004daa8-904c-4f15-87e5-932ecfe032c6`.
- Drizzle has 23 applied entries. The only pending entries are reviewed additive migrations
  `0025`, `0026`, `0027` and `0028`.
- R2 credentials are present for bucket `ge-media`, but no `wizmatch/` object exists for a read-only
  signed-access smoke. Uploading one retained non-PII QA object needs a later write approval.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` is set in production. An isolated read-only R2 list passed with
  verification forced on, so the environment-hardening proposal sets it to `1`; do not silently
  remove the variable.
- Staffing gate flags and pilot roster are absent. `WIZMATCH_PAID_DISCOVERY_ENABLED=true` and
  `WIZMATCH_GOOGLE_FALLBACK_ENABLED=true` conflict with the approved pilot policy; sending is absent.
- Wizmatch has only two active admins (Jatin and Kanishk) plus one viewer. No lead/recruiter/ops
  account exists. Suggested new Wizmatch pilot users from the existing Growth roster are Sneha
  (`team_lead`), Keshav (`staff`) and Nimisha (`staff`); account creation is not approved yet.
- Data: 131 companies, one unattributed audit-test requirement (retained and excluded), and 293
  available GitHub candidates. Legacy evidence suggests 64 Java profiles but no SAP profiles; all
  previewed Java rows lack experience evidence and are not vetted. Demand-signal companies are not
  accepted clients and cannot be promoted automatically.
- The official backfill script depends on Gate A columns/tables, so its exact count-only run occurs
  immediately after migration `0025` while all gates remain off. Pre-migration projection: one row
  needs company, source contact, owner, recruiter, SLA/next action and attribution; do not alter it.

## Exact next action

Obtain explicit approval to change only production `web` environment safety variables while all
staffing gates remain off: roster = existing Jatin/Kanishk Wizmatch admin IDs, pilot-all=false,
Gate A/B/C server+Vite=false, sending=false, paid discovery=false, Google fallback=false and
TLS verification=`1`. Then verify redeployment/health and stop for separate approval to provision
Sneha/Keshav/Nimisha as Wizmatch pilot users. Migration, push, gate activation and data import remain
their own later gates.
