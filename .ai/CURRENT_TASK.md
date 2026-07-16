# CURRENT_TASK.md

## Active task

**SHIPPED 2026-07-16 (`origin/main` = `d7906e0`, Railway deploy `88cd21cf` SUCCESS): comprehensive,
consistent filtering on every Wizmatch page.** A new shared filter/table system
(`admin/src/components/wizmatch/filters/`: `useTableControls` + `FilterBar` + `filterPipeline` +
`exportCsv`, plus a sortable/column-hideable `ui/DataTable`) is wired into all 10 pages: Job
Leads/Signals, Candidates, Requirements, Companies, Hiring Contacts (both tabs), Talent Matching,
Submissions/Delivery, Placements, Contact Intelligence, Reports. Every page gets type-aware filters
(search / multi-select / numeric+date ranges / toggles), active-filter chips + Clear all, **shareable
URL views** (filters/sort/columns/page in the query string), **saved presets** (localStorage per
`pageId`), **CSV export of the filtered set**, and — on the table pages — sortable headers + column
show/hide. Server-paginated pages (Signals/Candidates/Requirements) filter AND **sort globally**
server-side via a safe allowlisted ORDER BY (`wizmatchOrderBy`; the user key/dir only look up a
hard-coded column map + normalised direction + `created_at` tiebreaker), and their CSV re-fetches the
full filtered set at the backend max (200). Client pages (Companies 500-cap, Delivery, Placements,
Contact Intelligence, Hiring Contacts fan-out) filter/sort in-browser over the loaded set. Backend
changes are **read-only query params + ORDER BY only** — no schema/migration, no env var, no
auth/RBAC/Cashfree/SOD-EOD, no pilot-flag change; one CI LATERAL join added to `listCompanies`.
**Verified:** tsc clean, 446 Vitest (53 files, incl. new `wizmatchRequirementsFilters.test.ts`
asserting the ORDER BY allowlist + injection-safe fallback), admin build clean, 97 Playwright (0
failed) — the loop caught + fixed 8 regressions (FilterBar contrast a11y across 6 pages, Reports
Status control, Companies URL shape, chip/checkbox/transition edge cases). **Live-verified** on prod:
deploy SUCCESS, no boot errors from the change, zero 5xx since deploy, `api/health` 200, CRM SPA 200,
wizmatch filter routes 401 (intact) with the new `sort=`/multi-value params. **Known follow-ups (not
blockers):** the staffing-analytics *date* filter on Reports is now **SHIPPED** (`9767469`, Railway
deploy `ca1fb1f6` SUCCESS) — `analytics(tenantId, from?, to?)` scopes the funnel/revenue/time-to-
start/recruiter+source/rejection metrics by the From/To range (SLA exceptions + aging stay
current-state; clearing the range = all-time); Reports `Status` is single-select (kept a funnel spec
meaningful); Placements recruiter/prime filters need backend fields;
client pages past their cap (Companies 500, etc.) need server pagination later. Also still open from
before: the broken cold-outreach send loop; strict India-only tightening; the deferred region-column
migration.

## Prior task — India-only sourcing (SHIPPED `ade021a`)

**SHIPPED 2026-07-16 (`origin/main` = `ade021a`, Railway deploy `b508ecc1` SUCCESS): India-only
sourcing.** Behind a `WIZMATCH_INDIA_ONLY` flag (default on, no infra change): the ATS poller drops
confident-US postings at ingest (keeps India + remote/blank — neutralizes US even if a US company
keeps polling, so no `ats_type` cleanup); X-Ray seed queries are now all Indian metros; the signals
list (`GET /signals`) excludes confident-US by default (`region=all` bypass, `region=us` invert);
Job Leads has an "India only / All regions" toggle (default India) and Requirements default to India;
the misleading "Outreach" nav decoy (Growth Saleshandy dashboard) was removed. TheirStack + SearchAPI
were already India-scoped. No schema/migration; existing US rows kept (hidden), viewable via the
toggle. **Live-verified**: Job Leads default 6714→3819 (US hidden), toggle restores 6714, Outreach
gone, zero console errors / Railway 5xx. **Known limitation / recommended next step**: the rule is
"exclude confident-US, keep ambiguous", so non-US **non-India** roles (e.g. Spotify São Paulo/Korea,
Airbnb) still show in the India view; tightening to *strict* India-only means excluding all confident
non-India places (with the tradeoff that an India role labelled only "Remote/Global" could be hidden).
Also still open: the broken cold-outreach send loop; the deferred region-column migration.

## Prior task — matching reachable + discardable drafts (SHIPPED `5cb7c31`)

**SHIPPED 2026-07-16 (Railway deploy `f4274479` SUCCESS): candidate
matching is now reachable through the UI + draft requirements are discardable.** The actionable
Gate-B matcher (`POST /staffing/requirements/:id/matches/recalculate`) had no UI trigger and the
Talent Matching workspace was hidden, so a user couldn't get from a requirement to recalculated
matches. Now: a "Recalculate matches" button in the requirement drawer runs the matcher and renders
ranked candidates (score/dimensions/blockers) with Shortlist/Watch/Reject, sorted by score + a
hide-blocked toggle + an "add must-have skills first" hint; Talent Matching is in nav + Cmd-K
search; requirement `?id=` deep-links open the drawer; the signal "Create requirement draft" shows
an "Open requirement →" CTA; requirement rows show a matched-candidate count badge. Backend: a DRAFT
requirement with only undecided (algorithm-computed) matches + no submissions is now deletable,
cascading its match rows + snapshots (discard experimental drafts); non-draft/human-decided/submitted
still 409. **Live walkthrough proved it end-to-end**: seeded a disposable company+signal → qualified
→ free Find-POC (paid off, 0 contacts found, ≤2 cap honored) → promoted → **Recalculate produced 311
ranked matched candidates** → draft-cascade delete removed the requirement + all 311 matches → signal
+ company deleted. Zero console errors, zero Railway 5xx. No schema/migration/guardrail/env/pilot-flag
change. Minor follow-up: the requirement delete-dialog copy still says "no candidate matches" (stale
frontend text; backend now allows undecided matches).

## Prior task — signal-500 fix + manual delete + candidate max-detail (SHIPPED `3b1dd05`)

**SHIPPED 2026-07-16 (Railway deploy `0e45691d` SUCCESS): signal-detail
500 fix + manual-delete for every entity + candidate max-detail.** The tenant-wide 500 on
`GET /api/wizmatch/signals/:id` (drafts sub-query used `messages.created_at`; that table only has
`sent_at`) is fixed and verified live (200, no console/Railway 5xx). New manual-delete affordances:
Job Signals "Delete permanently" (existing backend, new UI); Hiring-contact/POC **hard** delete
(new `deleteCompanyContact` — relationship-only, keeps the CRM contact + history, blocks on active
attribution/submission/interview); company/candidate/discovered-contact delete surfaced
consistently. Candidate 360 now returns + renders submission history. Both residual
`PROD_SMOKE_WIZMATCH_20260715221717` records (signal + company) were deleted live via the new UI.
POC hard-delete UI/route is unit+e2e-tested and deployed but wasn't exercised live (production has
zero linked hiring contacts to click). No schema/migration/guardrail/env/pilot-flag change.

## Prior active task — entity-first UI/UX push

**Entity-first UI/UX + complete-build push is live (commit `2d8ddd6`, Railway deployment
`baec1d83`, `SUCCESS`) — a navigation/UX/safety-tooling release, not a pilot-scope change. The
Wizmatch results-first sourcing pilot task below is still the substantive product work in front of
Jatin/Kanishk; this push doesn't change what they need to do next.**

Work directly in `/Users/jatinagrawal/repo-comparison/v2` on `main` (now equal to `origin/main`).
The `v2-wizmatch-phase0-trust` worktree referenced below may be stale relative to `main` post-push —
re-verify its branch position before resuming work there.

## Prior active task (still relevant — pilot data review)

**Wizmatch results-first sourcing — provider release is live for the Jatin/Kanishk production
pilot. Review genuine signals and configure approved ATS boards; enable X-Ray only after the first
genuine accepted, skill-reviewed requirement exists.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

## Verified release candidate

- `c293b88` adds SearchAPI.io public research, shared POC/X-Ray allowance, provider-account status,
  real free TheirStack preview, hiring-team evidence, requirement-specific X-Ray queries and honest
  provider UI.
- `142eb51` handles free-credit account reporting, excludes up to 500 seen TheirStack job IDs before
  paid retrieval, and retries one transient SearchAPI timeout/429/5xx response.
- No schema or migration changed. No credential value entered Git, docs, `.ai`, screenshots or
  command output.
- Final local suite: TypeScript build; 47 files / 395 Vitest tests; admin production build; 22/22
  Wizmatch Playwright scenarios; `git diff --check` clean.

## Isolated staging evidence

- Deployment `d3b0e543-87db-4fe3-87e2-703bebcbc350` is `SUCCESS`; health/database are green.
- Supplied temporary credentials validate: TheirStack reports 200 credits; SearchAPI.io reports
  100 starting free credits. Values remain secret.
- TheirStack imported 29 public India target-role signals across two capped runs: all 29 have
  distinct provider IDs and matching SAP/Java/JavaScript/frontend title evidence. One provider
  repeat updated the existing row rather than creating a duplicate; the release now excludes seen
  IDs before retrieval.
- ATS refreshed 10 controlled Greenhouse jobs with no new duplicates or errors.
- POC research produced six named public candidates and correctly left them
  `identified_channel_pending`; no email/phone was guessed.
- Requirement-first X-Ray produced 10 requirement-linked leads. All 10 remain unreviewed and cannot
  enter canonical matching until a recruiter validates evidence.
- Authenticated live Signals UI passed desktop, tablet and 390px mobile with all provider cards,
  shared allowance, no horizontal overflow, no console errors and no 5xx responses.
- Legacy Wizmatch automation, sending, paid discovery and Google fallback remain off. No outreach,
  consent, submission or production business record was created.

## Production activation

- `05a5c5a` is live. Code deployment `5e8d1302-2c50-4a2b-b7b3-4f3e1e160023` and provider-flag
  deployment `8d68a585-5277-4be4-8e90-cc830e1b4036` both reached `SUCCESS`.
- Source master, TheirStack, ATS and POC discovery are active. SearchAPI/TheirStack accounts validate;
  X-Ray is configured but off. Legacy automation, sending, paid discovery and Google fallback are off.
- The first production TheirStack run fetched/inserted 15 genuine public target-role signals with no
  errors or duplicates. Their 15 provider IDs are distinct. ATS ran safely but polled zero companies
  because no production company has an approved ATS board yet.
- Production Signals UI passed desktop/tablet/390px with no overflow, console errors or 5xx. Health
  and database are green; sampled traffic had zero 5xx, p95 73 ms and healthy CPU/memory.

## Exact next action

Jatin/Kanishk review the 15 signals in Job Signals, qualify useful ones, run Find POC, verify a genuine
contact channel and promote only real demand. Configure ATS type/slug/board URL on approved Company
360 records. Once one genuine requirement is accepted and has reviewed mandatory skills, enable
`WIZMATCH_XRAY_CANDIDATE_ENABLED=true` and run one manual requirement-first search.

Never add users, enable pilot-all, sending, paid discovery, Google fallback, legacy automation,
automatic requirements, outreach, consent, shortlist or submission. Never delete production data.
