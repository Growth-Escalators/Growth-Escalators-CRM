# Wizmatch Delete / Archive Policy

This is the actual, implemented policy — not an aspiration. Update this file
whenever a delete/archive endpoint changes.

## Principle

Two tiers only:

1. **Permanent delete** — allowed only for draft/unlinked records with zero
   protected downstream dependencies. Requires an eligible role
   (`admin`/`team_lead`), a required reason, and (in the UI) typed-name
   confirmation for anything user-facing-destructive.
2. **Archive / deactivate / withdraw / cancel / close** — the only path for
   anything with real operational history. No hard delete exists for these,
   anywhere in the codebase, by design.

Every hard-delete endpoint is tenant-scoped (`WHERE tenant_id = $n`), role-gated,
and detaches (nulls) any `wizmatch_staffing_events` / `wizmatch_task_links` /
`wizmatch_discovery_runs` / `wizmatch_source_runs` foreign keys **before**
removing the row, so activity history that referenced the deleted record is
kept — unlinked, not lost, not cascaded.

## Entity-by-entity

| Entity | Permanent delete | Condition | Archive/status path |
|---|---|---|---|
| Job Leads (signals) | `DELETE /api/wizmatch/signals/:id` | Not promoted into a requirement; status not `placed` | `POST /signals/:id/reject` (sets a rejected/dead-equivalent status) |
| Companies | `DELETE /api/wizmatch/staffing/companies/:companyId` | Zero signals, requirements, hiring contacts | No dedicated archive — an empty company has nothing to archive; qualification/rejection state lives on `wizmatch_company_intelligence`, deleted alongside |
| Hiring Contacts (`wizmatch_contact_candidates`, pre-CRM-link) | `DELETE /api/wizmatch/contact-intelligence/contacts/:candidateId` | Not yet linked to a CRM contact | `POST .../review` with a reject action (do-not-contact/rejected status) |
| Hiring Contacts (`wizmatch_company_contacts`, linked) | none | — | `DELETE /api/wizmatch/companies/:companyId/contacts/:companyContactId` — soft, sets `relationship_stage='inactive'`, blocked (409) if an active requirement attribution exists |
| Roles/Requirements | `DELETE /api/wizmatch/requirements/:id` | `status='draft'`; zero matches, zero submissions | `PUT .../:id {status:'closed'}` or `POST .../:id/transition` into `on_hold`/`closed_lost`/`cancelled` (full stage machine, see `REQUIREMENT_STAGES` in `wizmatchStaffingDomain.ts`) |
| Candidates (pool) | `DELETE /api/wizmatch/candidates/:id` | Zero requirement matches, zero submissions | `PUT /candidates/:id {availability_status:'benched'}` |
| Consents | none | — | `POST /staffing/consents/:id/revoke` |
| Submissions | none | — | `POST /staffing/submissions/:id/withdraw` |
| Interviews | none | — | `PUT /staffing/interviews/:id` (status update) |
| Offers | none | — | `PUT /staffing/offers/:id/status` |
| Placements | none, never | — | Status transitions only; invoices/adjustments/collections tracked separately, never deleted |

## What every hard-delete endpoint does, in order

1. Role check (`admin`/`team_lead` — `403 delete_requires_lead` otherwise).
2. Row lookup, tenant-scoped (`404` if not found or wrong tenant).
3. Status/condition check (`409` with a human-readable `message` if not eligible).
4. Dependency count check against protected child tables (`409` with `dependencies: [...]` listing exactly what's blocking).
5. Insert an audit event into `wizmatch_staffing_events` (`*.deleted`, with actor, entity id in the payload, and the optional caller-supplied reason) — **before** detaching FKs, while the row still exists to satisfy the FK.
6. Detach (null) any `wizmatch_staffing_events`/`wizmatch_task_links`/`wizmatch_discovery_runs`/`wizmatch_source_runs` rows still pointing at the entity.
7. Delete genuinely dependent-but-non-protected child rows (e.g. `wizmatch_requirement_skills`, `wizmatch_candidate_skills`).
8. Delete the row itself, tenant-scoped.
9. Return `{deleted: true, id}`.

## Reference frontend implementation

`admin/src/components/ConfirmDialog.jsx` + its usage in
`admin/src/pages/WizmatchRequirementsPage.jsx` (`RequirementDetailDrawer`) is
the canonical pattern: accessible modal (focus trap, Escape-to-close, no
native `confirm()`), `requireTypedName` for permanent deletes,
`requireReason` always, honest error display on the `409` case, loading
state on the confirm button.

## Known gaps (see the release-readiness report for current status)

- Secondary records (notes, documents, contact-detail-level removal) are not
  yet audited/implemented in this pass.
- Not every entity above necessarily has the UI wired to its backend
  endpoint yet — check the release-readiness report's product-completion
  matrix for exact per-entity UI status.
