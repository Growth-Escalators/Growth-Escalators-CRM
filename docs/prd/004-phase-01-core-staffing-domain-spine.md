# PRD 004 Phase 1 Plan: Core Staffing Domain Spine

- **Status:** Proposed; blocked on ADR-004/owner/schema approval
- **Date:** 2026-07-13
- **Parent PRD:** `docs/prd/004-wizmatch-staffing-operating-system.md`
- **Architecture:** `docs/decisions/ADR-004-wizmatch-staffing-domain-spine.md`

## Outcome

An operator can open a requirement and see, without inference:

- the company;
- the named source/TA/hiring contacts and each role;
- whether Person A supplied SAP while Person B supplied Java;
- account owner, delivery owner, and recruiters;
- stage, received/accepted dates, SLA, last activity, next action, and due date;
- an append-only activity timeline and linked team tasks.

This phase does not yet create canonical skill passports, submissions, interviews, offers, or
finance records. Those remain Phase 2/3 contracts.

## Approval gate

Before editing `src/db/schema.ts`, obtain an explicit decision for ADR-004 Gate A and record it in
`docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md`. Then follow `ge-add-migration`: edit schema,
run `npm run db:generate`, inspect generated SQL for drops/unsafe constraints, and keep schema and
migration together. Do not hand-write or edit an already-applied migration.

## Vertical slices

### 1. Migration and compatibility types

- Add Gate A tables/nullable requirement fields exactly as approved.
- Generate one additive Drizzle migration.
- Add domain enums/constants and tenant-integrity helpers.
- Do not backfill production or enforce accepted-stage constraints yet.

Acceptance:

- Generated SQL contains no drop/rename/destructive statement.
- Every new table has `tenant_id`, FKs, and tenant-leading indexes.
- Existing build/tests and requirement endpoints remain green.

### 2. Company ↔ hiring contact relationships

- Link only approved canonical CRM contacts to Wizmatch companies.
- Manage relationship roles and provenance.
- Surface verified channels through existing contact channels rather than copying mutable values.
- Add Company 360 / Hiring Contact 360 read models incrementally.

Acceptance:

- Same contact may serve several roles without overwriting history.
- Cross-tenant links are rejected.
- Contact normalization and `lastActivityAt` remain correct.
- Discovery provenance remains available after CRM linking.

### 3. Requirement attribution

- Add/select primary source contact and additional participant roles in requirement create/edit.
- Drafts may be `needs_attribution`; confirmed/accepted transitions cannot silently guess a person.
- Show source contact in list/detail/priority views.

Acceptance scenario:

1. Create Company A.
2. Link Person A (TA) and Person B (Hiring Manager).
3. Attribute SAP ABAP requirement to Person A.
4. Attribute Java Backend requirement to Person B.
5. Search/filter Company A and see two distinct requirements and people.
6. Changing Person B's participation never changes Person A's SAP history.

### 4. Ownership, SLA, and next action

- Add account owner, delivery owner, and recruiter assignments.
- Record stage/entered date, SLA due date, last activity, next action, and next-action due date.
- Link existing tasks to the relevant requirement/company/contact.
- Implement `My Work` read model only after assignment/task links are reliable.

Acceptance:

- Every accepted requirement has the approved required roles, SLA, and dated next action.
- Reassignment preserves the previous assignment row.
- Overdue/stale work is queryable without inspecting JSON.

### 5. Timeline and 360 read models

- Append a staffing event for attribution, assignment, stage, next-action, and meaningful
  communication decisions.
- Build Company 360, Hiring Contact 360, and Requirement 360 APIs/read models.
- Keep message bodies in `messages`; timeline events reference non-sensitive summaries/IDs.

Acceptance:

- Requirement timeline explains who changed what and when.
- Company/contact views show their requirements without tenant-wide leakage.
- Current state can be reconstructed from domain rows while history stays immutable.

### 6. Historical dry-run and rollout

- Produce a count-only/dry-run backfill report.
- Mark unattributed requirements `needs_attribution`.
- Do not infer people, owners, or recruiters.
- Apply production backfill only through the approved production-data mutation workflow.

Acceptance:

- Pre/post counts reconcile.
- No existing requirement disappears or changes company.
- Unknown facts remain explicitly unknown.
- Rollback is application revert; additive schema remains harmless.

## API proposal

Exact response shapes should be specified in the implementation slice, but the resource boundaries
are:

```text
GET/POST /api/wizmatch/companies/:companyId/contacts
PUT/DELETE /api/wizmatch/companies/:companyId/contacts/:relationshipId

GET/POST /api/wizmatch/requirements/:requirementId/contacts
PUT/DELETE /api/wizmatch/requirements/:requirementId/contacts/:relationshipId

GET/POST /api/wizmatch/requirements/:requirementId/assignments
PUT/DELETE /api/wizmatch/requirements/:requirementId/assignments/:assignmentId

POST /api/wizmatch/requirements/:requirementId/transition
POST /api/wizmatch/requirements/:requirementId/next-action
GET  /api/wizmatch/requirements/:requirementId/timeline
GET  /api/wizmatch/staffing/my-work
```

Every mutation validates tenant ownership server-side and appends the approved timeline event in the
same transaction.

## UI proposal

Start with the existing Requirements page rather than building all 360 pages at once:

- Company selector using existing Wizmatch company records.
- Primary source contact selector filtered to approved contacts for that company.
- Additional contact-role rows.
- Owner/recruiter assignment panel.
- Stage/SLA/next-action strip.
- Timeline tab.

Then reuse the same read models in Company 360, Hiring Contact 360, and My Work. Keep every new nav
entry explicitly `product: 'wizmatch'`.

## Verification matrix

- Unit: transitions, minimum facts, role uniqueness, tenant validation, SLA calculations.
- Route: happy path, missing facts, wrong tenant, duplicate primary source, reassignment history.
- Database: generated migration SQL review and scratch-DB apply if available.
- Admin: create/edit two contacts and two requirements at one company; empty/error/retry states.
- Regression: `npm run build`, `npm test`, `npm run admin:build`, `git diff --check`.
- Manual: Wizmatch user sees new fields; Growth user cannot see the page/nav/data.

## Explicit non-goals

- No automatic client outreach.
- No candidate submission.
- No paid-provider enablement or cap change.
- No canonical SAP/Java skill migration yet.
- No consent/RTR/interview/offer schema yet.
- No production backfill or deployment without separate approval.
