# CURRENT_TASK.md

## Active task

**Growth + Wizmatch tenant-separated CRM correction** — make Wizmatch a full CRM profile that
reuses the shared Growth CRM modules while showing only Wizmatch tenant data, plus Wizmatch-specific
staffing pages.

Scope is **routing, navigation, tenant-aware product shell, Wizmatch dashboard, manual
Wizmatch AI Intelligence, generated admin bundle, tests, and AI context**. This task does not add
schema, migrations, auto-outreach, automatic candidate submission, worker/cron automation, package,
or deployment config changes.

## Definition of done

- [x] Keep Growth routes as-is for Growth Escalators users.
- [x] Add Wizmatch-prefixed routes for shared modules:
  `/wizmatch/dashboard`, `/wizmatch/contacts`, `/wizmatch/pipeline`, `/wizmatch/tasks`,
  `/wizmatch/inbox`, `/wizmatch/billing`, `/wizmatch/finance`, `/wizmatch/emails`,
  `/wizmatch/whatsapp-templates`, `/wizmatch/discover`, `/wizmatch/outreach`,
  `/wizmatch/intelligence`, `/wizmatch/settings/permissions`, `/wizmatch/settings/audit`,
  and `/wizmatch/pipelines/settings`.
- [x] Route Wizmatch home to `/wizmatch/dashboard`.
- [x] Redirect Wizmatch users from shared Growth paths to matching `/wizmatch/*` paths.
- [x] Keep Growth-only marketing modules out of the Wizmatch sidebar by default.
- [x] Keep Wizmatch staffing pages visible in the Wizmatch profile.
- [x] Add a live Wizmatch dashboard summary endpoint/page.
- [x] Add manual Claude-powered Wizmatch AI Intelligence endpoint/page focused on staffing data.
- [x] Preserve tenant separation through existing authenticated tenant-scoped backend routes.
- [x] Run backend build, full Vitest suite, admin build, and refresh AI brief.

## Next task

- [x] Browser-smoke the Wizmatch shared routes with mocked authenticated sessions.
- [x] Confirm Wizmatch users redirect from Growth shared routes to matching `/wizmatch/*` paths in
  the frontend route guard.
- [x] Confirm Growth users do not enter `/wizmatch/*`; a Growth-only session now redirects to
  `/dashboard`.
- [x] Fix shared internal links found during smoke so Wizmatch search/contact/pipeline/discovery
  links stay on `/wizmatch/*`.
- [x] Browser-smoke the new Wizmatch shared/staffing routes after latest verification: 24
  Wizmatch authenticated routes rendered with mocked API payloads, 15 Growth shared routes
  redirected to matching `/wizmatch/*` paths for Wizmatch users, and Growth-only sessions were
  blocked from `/wizmatch/dashboard` back to `/dashboard`.
- [x] Confirm production Wizmatch data shape from a read-only Railway/Postgres aggregate query.
  Production has real GitHub-sourced candidate/contact rows, but it does not yet have usable
  business operating data across pipeline, inbox, tasks, templates, billing, finance, companies,
  job signals, requirements, or contact-intelligence review tables.
- [x] Create a canonical shareable product/system brief at `docs/PRODUCT_SYSTEM_BRIEF.md` so any
  future agent, AI tool, designer, operator, or business collaborator can quickly understand what
  the whole software system is and what must stay updated.
- [ ] Log in with real Growth and Wizmatch users on localhost/live and manually confirm shared
  modules show the correct tenant data in both profiles once this branch is deployed to a
  production-like environment.
- [ ] Review Wizmatch AI Intelligence output after the missing production Wizmatch tables are
  present and real requirements/client signals/contact candidates exist.

## Production data verification on 2026-07-08 IST

Read-only Railway/Postgres aggregate inspection found:

- `wizmatch` tenant exists and is active.
- Contacts: 192 rows, all `source = wizmatch_github`, `status = lead`.
- Contact channels: 192 rows, all email, unverified.
- Candidates: 192 rows, all `source = github`, `availability_status = available`, latest update
  `2026-07-06T22:00:30.683Z`.
- Domain health: 3 rows from the bootstrap seed.
- Pipeline: 1 bootstrap pipeline.
- Deals, messages/inbox, tasks, email templates, WhatsApp templates, billing clients, invoices,
  payments, companies, job signals, placements, suppression list: 0 rows for Wizmatch.
- Newer branch tables were missing in production: `wizmatch_requirements`,
  `wizmatch_company_intelligence`, `wizmatch_contact_candidates`, and
  `wizmatch_discovery_runs`.
- Demo/test indicators were low in existing production rows: 1 contact matched demo/test text,
  0 `example.*` contact channels, 0 demo candidate sources.

Conclusion: production Wizmatch is not just dummy data because the 192 GitHub-sourced
candidate/contact rows look like real sourced data, but it is not yet business-ready/client-ready.
The CRM operating modules that drive clients and revenue are effectively empty, and the newest
contact-intelligence/requirements persistence tables are not applied in production.
