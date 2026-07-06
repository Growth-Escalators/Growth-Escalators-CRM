# ADR-003: Contact Intelligence Review Persistence

Status: Accepted for local implementation
Date: 2026-07-06
Owner: Growth Escalators / Wizmatch

## Context

The first Contact Intelligence build added deterministic scoring, a read-only Command Center,
and a local admin demo. The next approved slice is the first persistence foundation:

1. Review action model.
2. Schema plan.
3. Database migration.

This ADR records those three decisions before any writable API, admin action button, worker, paid
enrichment integration, or outreach sending change.

## Decision

Add the three MVP persistence entities from the hardened PRD:

- `wizmatch_company_intelligence`
- `wizmatch_contact_candidates`
- `wizmatch_discovery_runs`

Do not add a separate relationship-edge table or review-audit table yet. Review state is captured
inside the three approved MVP entities so the initial database model stays small.

## Review Action Model

The canonical Phase 2 review actions are:

- `approve_company`
- `reject_company`
- `watchlist_company`
- `request_internal_reuse`
- `request_paid_discovery`
- `approve_contact`
- `reject_contact`
- `mark_do_not_contact`

Rules:

- Company approval moves a qualified company into an internal-reuse/manual-review path.
- Company rejection skips discovery.
- Internal reuse can be queued at zero cost.
- Contact approval only prepares the next manual outreach step; it does not send outreach.
- Marking do-not-contact prevents the contact candidate from entering outreach.
- Paid discovery remains blocked by caps.

## Schema Plan

`wizmatch_company_intelligence` stores durable company qualification and review state:

- qualification tier/score
- target region
- IT staffing fit
- status and review status
- reviewer/action/rejection/notes fields
- qualification/discovery timestamps
- zero-cost tracking and metadata

`wizmatch_contact_candidates` stores reviewable contact recommendations:

- company and optional CRM contact link
- person/channel/source fields
- deliverability/ranking/relationship/confidence scores
- approval/rejection/do-not-contact status
- reviewer/action metadata

`wizmatch_discovery_runs` stores discovery audit/cost rows:

- company and optional company-intelligence link
- run type/source/status
- `cost_cents`
- `paid_provider`
- request/start/finish metadata
- result/error payloads

## Migration

Create migration:

- `src/db/migrations/0021_contact_intelligence_phase2.sql`

The migration creates only the three MVP tables and supporting indexes/FKs. It does not backfill
data, call providers, schedule jobs, create routes, or change deployment config.

## Guardrails

- No paid enrichment in this slice.
- `paid_provider` should remain `false` and `cost_cents` should remain `0` for Phase 1/2 internal
  reuse.
- No automatic outreach sending.
- Manual approval remains required before any outreach-preparation workflow.
- No worker/cron automation.
- No schema expansion beyond the three MVP entities until reviewed.
- No relationship-edge table until the first persistence usage proves it is needed.

## Consequences

Benefits:

- Contact Intelligence can persist reviewable state in a small, PRD-approved shape.
- Future writable API routes and admin buttons have a stable table contract.
- Cost and provider guardrails are visible in the schema.

Trade-offs:

- No full review-event audit trail yet.
- No contact-company relationship graph yet.
- No automatic creation/linking of CRM contacts yet.
- No paid discovery or provider telemetry beyond future run rows.

Those trade-offs are intentional. They preserve speed while keeping the dangerous parts behind the
next explicit approval.
