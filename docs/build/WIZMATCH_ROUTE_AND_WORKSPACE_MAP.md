# Wizmatch Route and Workspace Map

Source of truth for metadata: `admin/src/routes/wizmatchRouteRegistry.ts`.
Source of truth for which component actually renders at each path:
`admin/src/App.jsx`. This doc is a human-readable snapshot — if it drifts
from those two files, they win.

## Primary navigation (9 items)

| Label | Canonical path | Legacy alias(es) | Component (post-integration) |
|---|---|---|---|
| Today | `/wizmatch/today` | `/wizmatch/dashboard` | `WizmatchTodayPage.jsx` (new, this build) |
| Job Leads | `/wizmatch/job-leads` | `/wizmatch/signals` | `WizmatchSignalsPage.jsx` |
| Companies | `/wizmatch/companies` | `/wizmatch/relationships` | `WizmatchCompaniesPage.jsx` (new, this build) |
| Hiring Contacts | `/wizmatch/hiring-contacts` | `/wizmatch/contact-intelligence` | `WizmatchHiringContactsPage.jsx` (new, this build) |
| Roles / Requirements | `/wizmatch/requirements` | — | `WizmatchRequirementsPage.jsx` |
| Candidates | `/wizmatch/candidates` | — | `WizmatchCandidatesPage.jsx` (extended, this build) |
| Submissions | `/wizmatch/submissions` | `/wizmatch/delivery` | `WizmatchDeliveryBoardPage.jsx` (extended, this build) |
| Placements | `/wizmatch/placements` | — | `WizmatchPlacementsPage.jsx` (extended, this build) |
| Reports | `/wizmatch/reports` | `/wizmatch/analytics` | `WizmatchAnalyticsPage.jsx` (extended, this build) |

## More menu (4 sections)

**Communication:** Inbox, Outreach, Email Templates, WhatsApp Templates
**CRM Utilities:** Generic Contacts, Pipeline, Tasks, Lead Discovery
**Administration:** System, Provider Runs (aliases into System's sourcing tab), Permissions, Audit, Configuration (aliases to Pipeline Manager), AI Intelligence, Primes
**Finance:** Billing, Expenses

All unchanged from Phase 1A — this build did not modify the More menu structure.

## Pending-merge pages (routed, alias-protected, deliberately absent from nav)

My Work, Review Workbench, Client Discovery, Requirement Priority, Candidate
Intelligence, Talent Matching, Source Candidates — unchanged from Phase 1A.
Their functional overlap with the new primary pages above is real (see the
Phase 1A hardening report's cluster analysis) but this build did not attempt
a full data-model reconciliation between the "Staffing OS" and "intelligence"
backend models — see Known Limitations in the release-readiness report.

## Search coverage

`GET /api/search` (Wizmatch-tenant-gated additions, this build): Companies,
Requirements, Submissions. Contacts (covers both Hiring Contacts and
Candidates, which share the underlying `contacts` table) and Deals were
already covered.
