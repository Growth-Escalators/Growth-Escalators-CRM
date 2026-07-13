# ADR-004: Wizmatch Staffing Domain Spine

- **Status:** Proposed — owner and schema approval required
- **Date:** 2026-07-13
- **Product contract:** `docs/prd/004-wizmatch-staffing-operating-system.md`
- **Implementation plan:** `docs/prd/004-phase-01-core-staffing-domain-spine.md`

## Context

The current foundation has tenant-scoped companies, CRM contacts, requirements, candidates,
placements, tasks, events, and Contact Intelligence records. It cannot yet answer the core operating
questions safely:

- Which named person supplied or manages this exact requirement?
- Did Person A supply SAP while Person B supplied Java at the same company?
- Who owns the account and delivery work, what happened last, and what must happen next?
- Which candidate was reviewed for which requirement, and what was later submitted?
- Can a placement be traced back through submission, requirement, candidate, company, and contact?

The missing relationships must not be hidden in JSON fields or inferred from tenant-wide contacts.
The existing `events` table references only contacts/deals, and `tasks` references only
contacts/deals with a string assignee. They cannot provide foreign-key-backed requirement and future
submission timelines without either cross-cutting shared-table changes or a staffing-specific link.

This ADR is a proposal only. It records the recommended architecture before any guarded edit to
`src/db/schema.ts` or migration generation.

## Decision proposal

Build the staffing model additively in three schema gates. Approve and implement one gate at a time.

### Gate A — Phase 1 attribution, ownership, activity, and next action

Add these tenant-scoped entities:

1. `wizmatch_company_contacts`
   - One durable relationship between a Wizmatch company and an approved canonical CRM contact.
   - Fields: tenant, company, contact, relationship stage, business unit, seniority, owner user,
     discovery/source provenance, confidence, last activity, next action text/date, timestamps.
   - Unique `(tenant_id, company_id, contact_id)`.

2. `wizmatch_company_contact_roles`
   - One row per role on the relationship: TA, hiring manager, coordinator, approver, interviewer,
     procurement, vendor manager, source, or other.
   - Unique `(tenant_id, company_contact_id, role)`; roles remain auditable instead of overwriting one
     string when a person serves several functions.

3. `wizmatch_requirement_contacts`
   - Many-to-many requirement attribution through a company-contact relationship.
   - Fields: tenant, requirement, company contact, role, `is_primary_source`, received channel,
     notes, actor, timestamps.
   - Unique `(tenant_id, requirement_id, company_contact_id, role)`.
   - A partial unique constraint permits at most one active primary source contact per requirement.

4. `wizmatch_requirement_assignments`
   - Account owner, delivery owner, and recruiter assignments without flattening several people into
     one requirement column.
   - Fields: tenant, requirement, user, assignment role, active flag, assigned/unassigned timestamps,
     assigning actor.
   - Partial uniqueness prevents duplicate active assignment rows for the same role/user pair.

5. `wizmatch_staffing_events`
   - Append-only staffing timeline with explicit Phase 1 foreign keys for company, CRM contact,
     company-contact relationship, and requirement; later gates add candidate/match/submission/
     interview/offer/placement links.
   - Fields: tenant, actor, event type, channel, direction, source/source ID, payload, occurred/created
     timestamps.
   - It complements raw `messages`; it does not copy message content unnecessarily.

6. `wizmatch_task_links`
   - Keeps the existing `tasks` UI/assignee/due/status behavior while linking a task to a company,
     contact, and/or requirement with explicit tenant scoping.
   - Future gates add candidate/submission links additively.

Add nullable/backward-compatible fields to `wizmatch_requirements`:

- `attribution_status`: `needs_attribution | attributed`
- `stage`: PRD state machine (`draft | qualifying | accepted | sourcing | covered | submitted |
  interviewing | offer | filled | on_hold | closed_lost | cancelled`)
- `stage_entered_at`, `received_at`, `accepted_at`
- `last_activity_at`
- `next_action`, `next_action_due_at`, `sla_due_at`
- `closure_reason`

Keep the existing `status` field during compatibility rollout. Domain services write both until all
readers use `stage`; do not rename/drop it in the first migration.

### Gate B — Phase 2 canonical skills and persistent decisions

Proposed entities:

- `wizmatch_skills`: family, specialization, platform/version, canonical label, active state.
- `wizmatch_skill_aliases`: reviewed raw alias → canonical skill mapping with provenance.
- `wizmatch_requirement_skills`: mandatory/preferred requirement evidence.
- `wizmatch_candidate_skills`: experience, last used, evidence, confidence, verification.
- `wizmatch_candidate_requirement_matches`: one current row per evaluated pair, version pointer,
  explainable dimensions, blockers, human decision, reviewer, and timestamps.
- `wizmatch_match_snapshots`: immutable versioned score/input/output evidence.

Uniqueness must ensure one pair row per `(tenant, requirement, candidate)`. Java and JavaScript, and
SAP ABAP and SAP FICO, remain distinct specializations unless an explicitly broad family rule is
being evaluated and shown as such.

### Gate C — Phase 3 consent and delivery

Proposed entities:

- `wizmatch_candidate_consents`
- `wizmatch_submissions`
- `wizmatch_submission_recipients`
- `wizmatch_interview_rounds`
- `wizmatch_interview_participants`
- `wizmatch_offers` with revision numbering
- Explicit `requirement_id` and `submission_id` links added to `wizmatch_placements`

One active submission is allowed per `(tenant, requirement, candidate)`; resends create immutable
events/revisions, not duplicate active submissions. A placement cannot be treated as traceable until
its submission and requirement links are present.

## Tenant and integrity rules

- Every new table includes non-null `tenant_id` referencing `tenants.id`.
- Every route scopes every read/write by the authenticated tenant, even when a UUID is supplied.
- Application/domain services verify that referenced company/contact/requirement/candidate/user rows
  belong to the same tenant before insert/update.
- Foreign keys use UUIDs; indexes begin with `tenant_id` for operational queries.
- Historical attribution/assignment/event rows are not deleted when a role changes.
- Contact creation/reuse continues through `findOrCreateContact`; email/phone normalization and
  `lastActivityAt` invariants remain load-bearing.

## Backfill proposal

Gate A is additive and must not invent people or ownership:

1. Existing requirements keep their company link when present.
2. Existing requirements receive `attribution_status='needs_attribution'`; no source contact row is
   manufactured from a company-wide or tenant-wide contact.
3. Map legacy `status` conservatively to `stage` (`draft→draft`, `sheet_ready/shared→qualifying`,
   `closed→closed_lost`) and retain the original status. The owner must approve this mapping before
   a production backfill.
4. `created_by` is provenance, not automatically an account owner or recruiter assignment.
5. Existing contacts become company relationships only through explicit review or reliable existing
   company-link evidence; unknowns stay unlinked.
6. Production backfill is a separate count-first, dry-run, approval-gated operation after the schema
   and dual-read code deploy safely.

## API and compatibility proposal

Add tenant-scoped APIs in vertical slices, using existing `/api/wizmatch` RBAC:

- `GET/POST /companies/:companyId/contacts`
- `GET/POST /requirements/:requirementId/contacts`
- `GET/POST /requirements/:requirementId/assignments`
- `GET /requirements/:requirementId/timeline`
- `POST /requirements/:requirementId/next-action`
- `GET /staffing/my-work`

Existing requirement list/create/edit endpoints continue working. The new fields are optional for
drafts, but transition to `accepted` must enforce the approved minimum facts, primary source contact,
owner/recruiter coverage, SLA, and dated next action.

## Rollout and rollback

- Use feature flags/dual reads only if the owner approves the proposed compatibility approach.
- Deploy additive nullable schema first; deploy new writes/read models second; backfill third; enforce
  stricter constraints only after production evidence is clean.
- Roll back application code by reverting the feature commit. Leave additive unused tables/columns in
  place; do not issue destructive down migrations during incident response.
- No migration or production backfill may be executed from this ADR alone.

## Required tests

- Tenant A cannot read/link Tenant B company/contact/requirement rows.
- The same company can have Person A as SAP source and Person B as Java source.
- One person can participate in several requirements with different roles.
- A confirmed/accepted requirement cannot lack its approved source/owner/SLA/next-action facts.
- Reassignment closes the old assignment without erasing history.
- Every material mutation appends a staffing event and updates the applicable last activity.
- Existing requirement list/create/edit behavior remains compatible.
- Backfill produces `needs_attribution`, never a guessed person.

## Approval questions

The owner must confirm in `WIZMATCH_STAFFING_OS_OWNER_INPUTS.md` before Gate A schema edits:

1. Approve PRD 004 product direction and Phase 1 as the active schema phase?
2. Approve the company-contact + role-table + requirement-contact model?
3. Approve a dedicated staffing event table plus links to existing tasks?
4. Approve the requirement stage set and legacy mapping?
5. Approve the minimum facts and roles required for `accepted`?
6. Name the schema/migration and deployment approvers.

## Consequences

Benefits:

- Directly supports named-person-to-role attribution and the SAP/Java example.
- Preserves history, tenant isolation, ownership, next actions, and future delivery traceability.
- Avoids JSON shortcuts and keeps existing pages compatible during rollout.

Trade-offs:

- More relational tables and explicit domain services than the current JSON/array-heavy model.
- Requires careful migration, backfill, UI, permissions, and operator adoption work.
- Phases 2 and 3 remain unavailable until their own gates are approved and implemented.

## Alternatives considered

### Store attribution and pipeline state in requirement JSON

Rejected. It weakens referential integrity, indexing, uniqueness, history, and future reporting.

### Treat a placement row as a submission

Rejected. A match, shortlist, submission, interview, offer, and start are different business facts.

### Route-flip or full rewrite

Rejected. Additive vertical slices preserve the working CRM and allow independent rollback.
