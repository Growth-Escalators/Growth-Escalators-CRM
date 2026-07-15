# CURRENT_STATE.md — last-known-good snapshot

_Update this when the working state of the repo meaningfully changes. Keep it short and true._

## 2026-07-15 Entity-first UI/UX + complete-build push (current)

- `origin/main` is now at `2d8ddd6` (26 commits ahead of the prior `3211a1f` release), pushed as a
  clean fast-forward (verified via `git merge-base --is-ancestor` before pushing — no divergent
  history, no merge commit). Railway `web` deployment `baec1d83` reached `SUCCESS`.
- This release is entity-first navigation + UX/accessibility/test-coverage work layered on top of
  the provider-activation release below, not a change to pilot scope. Gate A/B/C flags, the named
  roster (Jatin/Kanishk only), sending, paid discovery, Google fallback, and legacy automation are
  all unchanged from the prior release — confirmed by diffing the full push against `origin/main`
  for those flag names (zero matches) before pushing.
- Canonical nav renames with legacy-alias redirects: `/wizmatch/dashboard→today`,
  `relationships→companies`, `contact-intelligence→hiring-contacts`, `signals→job-leads`,
  `delivery→submissions`, `analytics→reports`. New Today workspace (bucketed work queue), rebuilt
  Companies/Hiring Contacts/Candidates-360/Placements-detail/Reports-funnel pages, and every native
  `prompt()`/`alert()` on the Submissions/Delivery board replaced with accessible dialogs.
- New backend safety surface, additive to (not replacing) the existing cost-guard budget system:
  hard-delete endpoints for requirements/signals/candidates/companies (role-gated, dependency-
  checked, audited, FK-detached before delete — see `docs/build/WIZMATCH_DELETE_ARCHIVE_POLICY.md`)
  and a separate 1–5 (default 3) result-count cap on contact-discovery calls
  (`clampContactDiscoveryResultCount` in `src/services/wizmatchContactDiscovery.ts`).
- Verification: backend build + 413/413 Vitest tests; admin build; 85/85 Playwright (15 skipped for
  a missing local env var only) across desktop/tablet/mobile, including a new axe-core
  accessibility scan (0 critical/serious violations) and new coverage for the three previously-
  untested pages. Post-deploy: clean Railway boot logs, health check 200, unauthenticated browser
  smoke of the live login page clean.
- Schema/migrations, `auth.ts`, and `rbac.ts` are byte-identical to the prior release — this push
  touched none of them. Full detail: `docs/build/WIZMATCH_COMPLETE_BUILD_LOG.md`,
  `docs/release/WIZMATCH_RELEASE_READINESS.md`, `HANDOFF.md` (repo root).
- Known limitation carried forward, not addressed by this push: the two coexisting backend data
  models ("Staffing OS" in `wizmatchStaffing.ts`/`wizmatchStaffingDomain.ts` vs. the older
  "intelligence" model in `wizmatch.ts`) remain unreconciled — pre-existing architectural debt.
- Local `main` (`1cb48c9`) never shared this lineage (diverged before `origin/main`'s last 54+26
  commits) and could not fast-forward; left untouched as an orphaned local branch rather than
  force-reset, since it holds no unique work relevant to what's now live.

## 2026-07-14 Provider activation release candidate (superseded above)

- Commits `c293b88` and `142eb51` implement and harden SearchAPI.io + TheirStack provider activation
  without schema changes. SearchAPI is shared by named-POC research and requirement-first X-Ray;
  TheirStack uses free preview, credit evidence, hiring-team parsing, cursoring and seen-job IDs.
- Isolated staging deployment `d3b0e543-87db-4fe3-87e2-703bebcbc350` reached `SUCCESS`. Live provider
  validation passed: TheirStack 200 credits/free preview; SearchAPI free-credit account and public
  search; 29 distinct target-role signals; six POC candidates; 10 unreviewed requirement-linked
  X-Ray leads; ATS 10-job refresh with no errors.
- Staging responsive browser smoke passed desktop/tablet/390px with no overflow, console errors or
  5xx. Final suite passed: build; 47 files/395 tests; admin build; 22/22 Playwright; diff check.
- Production is live at `05a5c5a`; deployments `5e8d1302-2c50-4a2b-b7b3-4f3e1e160023` and
  `8d68a585-5277-4be4-8e90-cc830e1b4036` are `SUCCESS`. Source master, TheirStack, ATS and POC are
  active for the two-user pilot. X-Ray is configured/off pending a genuine accepted reviewed role.
- First production TheirStack run inserted 15 distinct genuine public signals with zero errors;
  ATS is healthy but has zero approved company boards. Production responsive browser/API smoke had
  no 5xx, console errors or layout overflow. Legacy automation/sending/paid/Google remain off.

## 2026-07-14 Results-first sourcing foundation (current)

- Commit `1112e47` is live in production through Railway deployment
  `fe6ebb85-cfe2-4a48-9d86-aa6707864e25` (`SUCCESS`). Migration `0029` applied additively; the
  journal is 28 with `0029` latest and the new 21-column `wizmatch_source_runs` table is empty.
- Production pre/post counts are identical: 2,812 contacts, 131 Wizmatch companies, 311 candidates,
  one retained requirement and 6,686 job signals. No production business record/document was
  deleted or created by the release.
- Production source controls are all off. Authenticated Kanishk smoke passed access, source status,
  desktop and 390px mobile UI with zero console/failed API requests; direct ATS execution is 403.
- Isolated staging deployment `f8f6e053-5669-40cb-8c5c-4f8f4ac3f35f` is healthy with ATS and free
  website POC discovery enabled, legacy automation off, TheirStack/X-Ray off. A controlled
  PlanetScale Greenhouse board produced 10 relevant signals; rerun produced zero inserts and 10
  updates/duplicates. Qualification, POC state, idempotent requirement promotion and responsive UI
  passed. The ephemeral pilot password/session was rotated away immediately.
- Release verification: TypeScript build; 47 files/383 Vitest tests; admin production build;
  22/22 Playwright including results-first flows plus tablet/mobile; migration SQL destructive-op
  scan; secret scan; and `git diff --check`.
- `THEIRSTACK_API_KEY` and `SERPAPI_API_KEY` are not present in Railway or macOS Keychain. The
  sequential live TheirStack and requirement-first X-Ray gates are blocked on secure key supply.
  ATS/POC production activation remains intentionally off until TheirStack's capped live gate passes.

## 2026-07-14 Controlled production launch (current)

- Commit `187c741` is live in production through Railway deployment
  `cd9c71ec-2f77-4a5d-b583-cdf3a55be9f5` (`SUCCESS`). The branch is synchronized with
  `origin/main` at that commit before this context-only update.
- Reviewed additive migrations `0025`–`0028` applied successfully. Production journal count is 27
  with `0028` latest; the historical database was already missing two old journal rows, so the
  expected current count is 27 rather than the scratch-database count of 29. Staffing schema,
  constraints and tenant boundaries passed verification; baseline CRM counts did not fall.
- Gate A/B/C server and UI access are live only for Jatin and Kanishk. Both are existing admins;
  pilot-all remains false and direct non-roster access fails closed. No extra users were created.
- The idempotent pilot taxonomy contains four canonical skills and eight reviewed aliases. Legacy
  candidates remain unreviewed/excluded until evidence is validated by a human.
- Private document storage now requires a dedicated `R2_PRIVATE_BUCKET_NAME`. A retained labelled
  non-PII QA PDF proved `r2://` storage, public/unsigned denial and a 300-second signed URL. The
  original harmless QA upload in the legacy bucket remains unreferenced because production
  deletion was forbidden.
- Staffing reminders are enabled in the single web process at 09:17 IST Monday–Saturday. Logs show
  one schedule. Legacy Wizmatch automation, sending, paid discovery and Google fallback are off;
  provider-backed X-Ray sourcing is now rejected server-side and disabled honestly in the UI.
- Final verification passed: build; 46 files / 372 Vitest tests; admin build; 17/17 Playwright;
  fresh 29-entry migration apply (81 public/31 Wizmatch tables); gates-off bundle; secret scan;
  diff check. Production browser QA covered 35 routes at desktop, 768px tablet and 390px mobile.
- Production health/database, runtime staffing navigation, My Work and the final sourcing guard
  passed authenticated retest. No production business record/document was deleted and no
  fictional consent, submission, interview, offer, placement, invoice or collection was created.
- The controlled launch is live. The only active release task is the 48-hour read-only observation
  window. A thread heartbeat owns the 15-minute/one-hour follow-ups and the temporary
  `wizmatch-48-hour-pilot-monitor` automation runs every six hours through the deadline; do not
  expand the roster or activate excluded automation during it.

## 2026-07-14 Safe staffing automation release candidate (historical pre-launch)

- Commit `1ceada3` is the current reviewed candidate. It leaves all non-Wizmatch Growth jobs
  unchanged, defaults legacy Wizmatch sourcing/enrichment/scrapers/importers/digests off, and
  allows only Gate-C-dependent deterministic staffing reminders behind a separate default-off flag.
- Verification passed: TypeScript build; 46 files / 368 Vitest tests; admin production build;
  16/16 Playwright; fresh 29-entry migration apply with 81 public/31 Wizmatch tables; production
  router contains no demo paths; `git diff --check` clean.
- Isolated staging deployments `a5ed6f3c-dccb-4add-86e2-17ec9046f204` and
  `9f20e84c-952e-4f48-9f2e-8373528144b7` reached `SUCCESS`. Health/database are green. Logs show
  exactly one in-process staffing schedule, legacy automation skipped and no separate worker.
- Authenticated staging browser QA passed the high-value A–C workspaces and System/Readiness with
  no console errors or 390px overflow. Readiness reports web-in-process, staffing reminders on,
  legacy automation off, sending off and 09:17 IST Monday–Saturday. Ephemeral QA credentials and
  sessions were removed/signed out.
- Production read-only preflight remains healthy on old `b05ac015`; journal latest timestamp is
  `1783420000004`, so only 0025–0028 are pending. Counts are 2,812 contacts, 131 companies,
  311 unvetted candidates and one retained audit-test requirement. No production write/deletion
  occurred.
- The old build logged 18 new GitHub-mined candidates today, explaining the earlier 293→311 rise.
  This legacy block remains active until the reviewed release is deployed; those rows stay excluded
  from matching until individually reviewed.
- Jatin and Kanishk are the only production pilot users and remain admins. No additional user is to
  be provisioned. The next action is separate approval for additive production migrations
  0025–0028 with gates and staffing automation off.

## 2026-07-14 Authenticated production QA and final staging repair (historical pre-launch)

- Production `web` safety variables are now hardened under explicit approval: Jatin/Kanishk named
  roster, pilot-all=false, all Gate A/B/C server+Vite flags=false, sending=false, paid discovery
  and Google fallback=false, and TLS verification=1.
- The variable change redeployed the unchanged old production commit `b05ac015` as deployment
  `346618d7-cc5a-4dbb-9225-684768801e10`; Railway reached terminal `SUCCESS`. Health is green,
  database is `ok`, CRM/ecom return 200, authenticated readiness returns real counts, and the cost
  controls report paid discovery and Google fallback disabled.
- No production user, migration, application push, feature activation, staffing record, document,
  or pilot data was created or changed in this unit.

- Kanishk's Keychain-held Wizmatch admin credential authenticated successfully without exposing the
  password or JWT. Production navigation, direct routes, refreshes, contact details, System tabs,
  and representative tablet/mobile layouts passed read-only browser QA.
- A rapid-navigation browser artifact briefly reported missing lazy chunks; clean-tab retries and
  direct HTTP checks proved the assets were present and all affected routes mounted. This was not
  classified as an application defect.
- The release candidate had one real P2 UX defect: authenticated Readiness linked to development
  preview routes that production correctly removes. Commit `1bea426` hides the card outside Vite
  development mode and adds a helper regression test.
- Post-fix suite is green: build; 45 files / 361 tests; admin build; 16/16 Wizmatch Playwright;
  diff check. Staging deployment `52b4a0f3-5ac2-4882-aad8-2674d0fabeec` is `SUCCESS`; browser
  verification confirmed zero preview links and a safe Dashboard redirect for a demo deep link.
- No production environment, schema, user, document, staffing record, send, provider, or deployment
  was changed by this QA unit.

## 2026-07-14 Final access-policy staging qualification

- Read-only production qualification is complete: production is healthy on old commit `b05ac015`,
  topology is web+Postgres with no worker, and the Drizzle journal has 23 entries with exactly
  additive `0025`–`0028` pending. The branch is 0 behind `origin/main`; use `git log` or AI_BRIEF
  for the current ahead count.
- Current release verification passed again: backend build, 45 files/360 Vitest tests, admin
  production build, 16/16 Playwright and `git diff --check`. Existing rankTracking mock warnings
  and missing-SERPER test noise are unchanged.
- Production R2 credentials exist and a verified-TLS read-only list succeeds, but the bucket has no
  Wizmatch object to sign. TLS verification is now on; paid discovery, Google fallback, sending and
  all staffing gates are off; the named roster contains only Jatin and Kanishk.
- Production Wizmatch users: Jatin admin, Kanishk admin, Deck Sync viewer; no recruiter/lead/ops.
  Data: 131 companies, one retained unattributed audit-test requirement, 293 unvetted GitHub
  candidates; 64 look Java-related, none look SAP-related, and previewed experience is missing.
  No company/signal/candidate is treated as an accepted requirement or vetted profile.
- With explicit approval, the production Wizmatch admin credential for the documented operator
  account was rotated transactionally. The exact tenant-scoped preflight matched one Wizmatch row
  (and separately observed a same-email Growth account, which was excluded and untouched). The
  historical plaintext already failed hash verification before the change; it remains rejected.
  The replacement verifies, token version advanced 3→4, and exactly one production row changed.
  The replacement value exists only in macOS Keychain under `Wizmatch Production Admin (rotated
  2026-07-14)`; no value entered Git, files, Railway variables, terminal output or context.
- Commit `9f4c0f4` implements the final pilot authorization policy. Production fails closed without
  a named roster or explicit all-users switch; viewers are excluded; staff/sales access is scoped
  to assigned requirements; submission approval/offers are lead/admin operations; placements and
  finance mutations are admin-only; commercial analytics are lead/admin-only.
- The isolated staging service was redeployed after setting its fictional named roster. Railway
  deployment `54b9ff52-8fed-43eb-974c-bb2ddaab72f6` reached `SUCCESS`; health is HTTP 200 and the
  isolated database is `ok`. Sending, paid discovery, Google fallback and background jobs remain
  disabled; no worker or R2 configuration exists.
- A direct-API role matrix passed 15/15 assertions, including pilot/non-pilot admission, viewer
  exclusion, assigned/unassigned recruiter isolation, recruiter submission/commercial denial,
  lead commercial-read/finance-write separation and admin finance access.
- Read-only reconciliation passed after deployment: Person A→SAP and Person B→Java are distinct;
  both exact-consent chains reach accepted offer and started placement; permanent fee = INR 250000;
  contract bill/cost/margin = INR 2000/1500/500 (25%); invoice linkage is separate; adjustments are
  traceable. R2 remained intentionally unset, so no private-document upload was attempted.
- Current release suite: backend build passed; 45 Vitest files / 360 tests passed; admin production
  build passed; Wizmatch Playwright 16/16 passed; `git diff --check` passed. ADR-005 is accepted and
  the provisional pilot policy pack is recorded.
- Production application/schema/staffing data remain on the prior main release. Apart from the
  earlier approved one-row credential rotation, this qualification performed reads only: no
  migration, push, environment change, import or deletion occurred. The next gate is the explicit
  production safety-variable change described in CURRENT_TASK.

## 2026-07-14 Staging Gate C and browser-QA snapshot (superseded where noted above)

- The complete fictional Gate A→B→C workflow now passes on isolated Railway staging. SAP permanent
  and Java contract both reached placement; live analytics reported 2 starts, 570000 invoiced,
  570000 collected and 250500 gross margin. Wrong-requirement consent, duplicate active submission,
  duplicate placement and unauthenticated access were rejected.
- The live run corrected missing staging Gate B evidence through the tenant-scoped APIs. Canonical
  SAP ABAP, SAP FICO, Java and JavaScript taxonomy rows exist; requirement/candidate evidence is
  persisted; Rahul→SAP and Priya→Java are shortlisted; cross-role pairs remain separate and blocked.
- Live browser QA covered My Work, Relationships, Requirements, Talent Matching, Delivery,
  Placements, Analytics and System. Delivery at 390×844 had no page-level overflow. No console
  errors were observed on the verified high-value pages.
- Browser QA found one honest defect: the legacy Placements page labelled permanent fees as hourly
  margin. The repair in `ef2112f` is now live on isolated staging via Railway deployment
  `52508e6f-8fdd-475c-a58e-84d31b82d142` (`SUCCESS`). Authenticated Placements smoke returned page
  and API HTTP 200, rendered 2 started placements, `₹500/hr contract margin` and `₹2,50,000
  permanent fee(s)`, and contained neither the old permanent `/hr` label nor the legacy USD label.
- Current verification: backend build passed; 44 Vitest files / 352 tests passed; admin production
  build passed; Wizmatch Playwright 16/16 passed; `git diff --check` passed.
- A generated staging browser password appeared in an internal automation snapshot. It was
  immediately treated as compromised: password rotated, token version bumped, browser/session
  revoked, in-memory value cleared and temporary files removed. No credential value is retained.
- The smoke-test login was generated in memory, used only against staging, then rotated/revoked;
  all temporary session and screenshot files were removed. Production remains untouched and
  continues on the old `main` release. Mandatory owner policies and the proposed ADR-005
  migration-owner decision are next; production read/migration/push/flags/data remain separately
  approval-gated.

## 2026-07-13 Staffing OS three-phase snapshot (superseded where noted above)

- Clean worktree `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust`, branch
  `codex/wizmatch-phase0-trust`; original dirty workspace preserved. It is 0 commits behind and
  ahead of `origin/main` by the scoped implementation commits plus context/evidence commits (see
  `git log`). **Production is untouched**: no push to a remote, no production deployment, no
  production migration or data write, no sending, no paid call. An ISOLATED Railway `staging`
  environment (separate from production) HAS been created, migrated, deployed and populated with
  fictional pilot data, and the staging pilot login password was rotated — none of which affects
  production. Details below.
- Phase 0 + Gate A are committed as `1997e31`; Gate B as `a5ac3e8`; Gate C as `48b1a88`.
- Release review repair `605d6cd` validates linked recipients/participants against the actor tenant
  and requirement company, blocks duplicate placement creation, reconciles invoice/client/payment
  references, requires private consent-document references and serializes versioned delivery events.
- Additive schema now covers the complete traceable chain from named hiring contact and requirement
  through canonical candidate matching, consent/RTR, submission, interviews, offers, placement,
  invoice linkage, collection reporting and gross margin. Legacy requirement status and existing
  finance records remain compatible; unknown historical attribution stays unknown.
- New production-off UI/API flags are `WIZMATCH_STAFFING_GATE_A/B/C_ENABLED` and matching build-time
  `VITE_WIZMATCH_STAFFING_GATE_A/B/C_ENABLED`. All outreach and actual submission sending remains
  manual and separately gated.
- Private R2 references plus short-lived signed access cover requirement and consent documents.
  System diagnostics expose document policy, phase status, observed demand-source row counts, and
  DKIM as pass/fail only when selectors are configured; otherwise DKIM is `unknown`.
- Deterministic Gate C automation creates idempotent shared tasks for overdue requirement SLAs,
  overdue submission next actions and candidate availability evidence older than 30 days. It is
  Gate-C-controlled, $0, and performs no communication.
- Migration `0028_strong_cammi.sql` passed production-shaped scratch application on the committed
  Gate B schema. Nine Gate C tables, staffing event/task trace links and journal advancement were
  verified. The pre-existing "fresh full historical chain" defects (bare re-creates in `0008`;
  `ON CONFLICT ON CONSTRAINT` in `0014`) were later RESOLVED for empty-DB apply in commit `a810d08`
  (see below) and the full journal now applies cleanly to a fresh database (verified on staging).
- Verification: TypeScript build passed; 43 Vitest files / 349 tests passed; admin production build
  passed; 16/16 local mocked Chromium scenarios passed through placement; `git diff --check` was
  clean. A headless check against the production admin bundle with all Vite staffing flags absent
  redirected `/wizmatch/talent-matching` to Dashboard and confirmed Gate A/B/C nav labels were absent.
- Railway project `GE-Backend-Server` (id `eef927aa-8e3a-4515-85fd-781b7d1d95c1`) now has two
  environments: `production` (unchanged, id `81b087de-6c7d-493c-94f0-50c8180c47da`) and a new
  isolated `staging` (id `6aa742f6-38c1-4c3e-8471-6ec5fecea027`) created 2026-07-13 without
  forking from production. Production continues to hold `web`
  (id `0ee1b243-97c1-4239-9016-fb7e1578b3d6`) and the original managed `Postgres`
  (id `0c31ec38-0433-46c6-9fbb-5dd2859d1a08`); staging holds only a managed Postgres
  `Postgres-Bhky` (id `a78f7108-45b1-46c8-bd8e-682edae2ff1f`) with its own dedicated volume
  `postgres-volume-STmx` (id `da958ec3-a5d8-46d3-bf7e-b494f5617450`) and its own private domain
  `postgres-bhky.railway.internal`. The full migration journal (0000–0028, 29 entries) has been
  applied to `Postgres-Bhky` and verified (`drizzle.__drizzle_migrations` = 29 rows, 81 public base
  tables, 31 wizmatch tables, all Gate A/B/C tables present); it now holds fictional pilot data (see
  Gate A/B below). At migration time staging had no `web` service; `web-staging` was added afterward
  (deployment paragraph below). No worker service exists in either environment; production has no
  Gate A/B/C flags (staging does — see below). No production database URL or data is referenced from
  staging. Production `web` remains on commit `b05ac015eff8444edc217563fdb93ac5ef836639`; its latest
  deployment reported `SUCCESS` and its timestamp is unchanged since before the staging creation.
  Deployment docs reference `railway.worker.json`, but that file is absent from this worktree and
  worker deployment is post-pilot.
- Two committed migrations were edited to be idempotent for a fresh (empty-DB) apply, which the
  staging migration required; production was migrated incrementally and is unaffected, and both
  edits are prod-safe (won't re-run on a prod deploy; no-ops if they did; no resulting schema
  change). `src/db/migrations/0008_great_romulus.sql` now guards the 8 statements `0007` already
  performs (2 CREATE TABLE, 3 ADD COLUMN, 3 social FK constraints);
  `src/db/migrations/0014_brevo_email_templates_seed.sql` now uses `ON CONFLICT (tenant_id, name)`
  instead of `ON CONFLICT ON CONSTRAINT` on a unique index. Both files were committed to the branch
  as `a810d08` (not pushed). `0009` and `0020_wizmatch_gin_indexes` were verified already-idempotent
  and untouched.
- This clean worktree is deployed to a staging `web` service `web-staging`
  (id `e7f073ec-4835-4fbb-ad1c-17f0f5bb17f6`) via `railway up` (deployment
  `964770e6-a8cf-4f9f-840a-670e13b1d7a4`, status `SUCCESS`) at
  https://web-staging-staging-1d24.up.railway.app — no `main` push, production `web` untouched.
  Staging-only env: `DATABASE_URL` references `Postgres-Bhky`; a fresh `JWT_SECRET` was generated
  and set via stdin (value never stored); `NODE_ENV=production`; `DISABLE_BACKGROUND_JOBS=true`;
  Gate A/B/C server+Vite flags ON (staging only); sending, paid discovery and Google fallback OFF;
  `CRM_EXTRA_HOST` set so the admin SPA serves on the staging domain. Verified `/health`=200
  `database:ok` `env:production`, and the CRM admin SPA is built and served. No production secret
  was copied; no sending, paid call, production data access, or push occurred.
- `CORS_EXTRA_ORIGIN=https://web-staging-staging-1d24.up.railway.app` is set on `web-staging`
  (deploying this app on any host other than `crm.growthescalators.com` requires it, else the SPA's
  own crossorigin asset/API requests are CORS-rejected with a 500). A fictional `wizmatch` staging
  tenant + admin (`pilot@wizmatch.test`, role admin) were bootstrapped for the pilot; the pilot
  password was later ROTATED (new value never printed or stored; `token_version` bumped so old
  sessions are revoked; the previously-exposed password now 401s).
- **Gate A is COMPLETE on staging with REAL records and DB-verified:** `Company A (Pilot)` seeded
  (deterministic score 54/watch); two distinct requirements `SAP ABAP Consultant (Person A)` +
  `Java Backend Developer (Person B)` both attributed to one `company_id`; hiring contacts Person A +
  Person B linked (roles hiring_manager, source); SAP→Person A and Java→Person B primary-source
  attribution; account-owner + recruiter assignments per requirement; dated next action + SLA per
  requirement; both moved draft→`qualifying` (draft→accepted correctly blocked). DB truth:
  `wizmatch_requirement_contacts=2` (one distinct source contact each), `wizmatch_requirement_assignments=4`,
  `wizmatch_staffing_events=14`. Company 360 / Hiring Contact 360 / Requirement 360 / timelines /
  isolation all verified in the UI (Person A's history shows only SAP; Person B's only Java).
- **Gate B is exercised and DB-verified:** 2 fictional candidates imported (preview scored without
  persisting — a score is not a shortlist); deterministic matching routed Rahul→SAP(Person A) and
  Priya→Java(Person B); Rahul shortlisted while `wizmatch_submissions/placements/offers = 0` (a
  shortlist is not a submission).
- Requirement-sheet PDFs and private consent/RTR uploads need R2 (intentionally unset in staging →
  honest "R2 not configured" error). Manual requirement-specific consent evidence does not require
  R2 and was used for the fictional Gate C exercise. "Parse with AI" needs Anthropic and stayed off.
- Done on staging (separately approved, isolated): staging create + empty Postgres, full migration,
  deploy, fictional Gate A/B/C pilot data + exercise, staging pilot login rotation. Still gated and
  NOT done: optional staging R2 document smoke, production migrations, production data access/write, the
  exact push of any branch to a remote (and thus `main` auto-deploy), and enabling Gate A/B/C in
  PRODUCTION — each needs its own explicit approval.
- The owner selected a controlled Gate A–C pilot and required Claude to pause at every guarded
  action. Named pilot users may begin after Gate C smoke; unrestricted team-wide use still requires
  48 hours of stable monitoring.

## 2026-07-13 snapshot (historical — before completed Gate C exercise)

- **Deployed baseline for this worktree:** rebased `origin/main` at `b05ac01`; branch
  `codex/wizmatch-phase0-trust`. No branch change has been pushed, deployed, sent, spent, migrated,
  or written to production.
- **Local Phase 0 candidate bundle:**
  - D-1 canonical Contact Intelligence now combines company/contact review, manual add, CRM linking,
    Pipeline handoff, read-only discovery preview, explicit cost acknowledgement, and confirmed
    manual discovery. Authenticated API failure shows an honest empty/error/Retry state, not demo
    companies. No real provider run was executed and Apollo/Snov/env/budgets remain unchanged.
  - D-2 requirement parsing delegates FormData to canonical tenant-aware `apiFetch`; validation and
    request failures render separately and request errors offer Retry.
  - D-9/D-10/D-11 classify linked hiring contacts consistently, search CRM contacts by full name or
    tenant-scoped channel, and keep non-executable blocker outcomes out of the action queue while
    retaining them in the Safety Center.
  - D-12/D-14/D-20/D-21/D-23 correct misleading handoff copy, empty-state guidance, unrelated task
    helper copy, dashboard work order, and raw CRM-link identifiers.
  - Authenticated failure states are honest across the core pages; Pipeline recovers with Retry;
    demo routes are development-only; current admin build is mandatory; login preserves Wizmatch;
    role scoring rejects known false positives and keeps company evidence separate; manual seeds are
    deterministically scored; queue totals and readiness semantics are truthful; AI is bounded.
  - Full local verification passed: TypeScript build, **38 Vitest files / 318 tests**, admin
    production build, **10/10** mocked Chromium paths, production-bundle demo-route absence, and
    `git diff --check`, all without external provider or production calls.
- **Local Phase 1 Gate A bundle:**
  - Six additive tenant-scoped tables model company-contact relationships and roles, requirement
    attribution, assignments, append-only staffing events and shared-task links. Requirements gain
    additive attribution/stage/SLA/activity/next-action fields while legacy status remains.
  - Transactional APIs power Company, Hiring Contact and Requirement 360 plus My Work. Every write
    validates tenant ownership and records the business mutation and staffing event together.
  - Admin pages require company selection, show Person A→SAP versus Person B→Java, manage source/
    team/next action/stage, and expose recruiter work without widening legacy send/spend routes.
  - Generated migration `0025_cynical_brother_voodoo.sql` contains no destructive statement and
    applied cleanly over an `origin/main` schema in a disposable local Postgres database. The
    actual deployment entry point, `src/scripts/migrate.ts`, also applied only 0025 when seeded with
    the production-shaped prior migration timestamp and recorded the new journal timestamp.
  - Verification: **40 Vitest files / 325 tests**, backend/admin builds, **14/14 Playwright** paths,
    authenticated scratch HTTP workflow, relationship uniqueness/history checks and `git diff --check`.
- **Persistent context:** PRD 004 direction and ADR-004 Gate A are approved for local phased
  implementation. Migration apply, production data, push/deploy and Gate B/C schema work remain
  separately gated in the owner-input file.
- **Deep local QA:** the complete source route matrix (57 Wizmatch routes) mounted without an
  ErrorBoundary crash under mocked APIs; all 17 redirects and 29 unauthenticated auth boundaries
  resolved. The visible browser walked all 10 primary demo modules and exercised prospect intake,
  candidate preview/import, workbench actions/filters, requirement planning, discovery preview,
  blocked states, refresh controls, product selection, and password-recovery navigation. Builds,
  304 tests, and 5 authenticated mocked Chromium paths passed again.
- **Remaining gated/external work:** D-17/D-22/D-24/D-25 require storage, schema or commercial
  model work; D-18 needs live Dice/TheirStack evidence. Phase 0 code/release validation is locally
  green. Gate B canonical skills/matching is the next proposed product phase after Gate A rollout.
- **Security:** plaintext credential values were removed from the current versions of the handoff,
  operator docs, playbook, and onboarding script; the script now requires secure environment
  injection and does not print the value. The credential remains exposed in Git history and has not
  been rotated. Rotation and any history rewrite require separate explicit approval.
- **Original dirty workspace:** preserved at `/Users/jatinagrawal/repo-comparison/v2`. This clean
  worktree intentionally excludes its unrelated package/SEO/n8n/seed and guarded-file WIP.
- Git remote now points at the canonical `Growth-Escalators/Growth-Escalators-CRM` (repo was renamed
  from `growth-escalators-backend-v2`; same owner, Railway auto-deploy unaffected). No more "repository moved" push warnings.
- **`npm run db:generate` works normally again** (was emitting destructive migrations from a drifted
  snapshot baseline; fixed in PR #42 by adding `meta/0024_snapshot.json`). Deploy still auto-runs
  `node dist/scripts/migrate.js && node dist/index.js`, so keep migrations additive/idempotent.
- Wizmatch client-acquisition funnel is substantially built out: Review Workbench, Client Discovery,
  Signals, Contact Intelligence, Requirement Priority + Requirements (filters/edit drawer/find-candidates/
  tier-weighted priority), Candidates (filters/pagination/experience), Source Candidates (on-demand),
  Placements, Analytics, AI Intelligence (row-level context), and a consolidated `/wizmatch/system`
  diagnostics page. Contact drawer shows full candidate/client-lead/company detail.
- Dated dataflow reference: `docs/wizmatch/DATAFLOW.md` (corrected through 2026-07-13 for schema
  authority, in-process signal scoring, topology uncertainty, and supply/demand separation).
  Re-verify it before production-sensitive work. Client-funnel test plan:
  `docs/wizmatch/CLIENT_FUNNEL_TEST_PLAN.md`.
- **Not yet done:** real Wizmatch data still needs loading before client-facing use (scrapers return 0;
  use manual intake / Source Candidates). Sending stays gated (`WIZMATCH_SENDING_ENABLED`).

## What works (baseline)

- CRM + API live on Railway. Repo-local docs describe a single Express + Socket.io + node-cron
  process (`DISABLE_BACKGROUND_JOBS=true` for API-only mode); production may run this split
  across separate `web` + `worker` Railway services if configured that way in the Railway UI —
  **verify actual topology before changing deployment/worker assumptions**, don't assume two services.
- `docs/PRODUCT_SYSTEM_BRIEF.md` is the canonical shareable product/system brief. Update it on
  meaningful runs when product scope, modules, routes, production data reality, deployment
  assumptions, or guardrails change.
- D2C landing on Vercel (`ecom.growthescalators.com`).
- `npm run build` and `npm test` pass on `main`.
- Facebook Lead Forms now have a safe ingestion path:
  `GET/POST /webhooks/meta-leads`, Meta signature verification using the raw request body,
  connected-page token lookup via `social_accounts`, CRM contact create/reuse via
  `findOrCreateContact`, `facebook_lead` / `meta_lead_form` tagging, `lastActivityAt` bumping,
  and Slack notifications to the existing BD/Sales channel. The Social Accounts page exposes
  webhook/config status and a protected page-subscribe action for `leadgen` webhooks.
- Growth Escalators and Wizmatch are now tenant-separated CRM profiles. Growth keeps the classic
  shared CRM routes, while Wizmatch has `/wizmatch/*` equivalents for Dashboard, Contacts,
  Pipeline, Tasks, Inbox, Billing, Finance, Email Templates, WhatsApp Templates, Lead Discovery,
  Outreach, AI Intelligence, Permissions, Audit, and Pipeline Settings. The same shared modules
  use the logged-in tenant token, so Growth data and Wizmatch data stay separated.
- CRM portal hardening now supports both classic string pipeline stages and Wizmatch object stages
  like `{ id, name, color }`. Shared admin pages coerce display/search values before calling string
  helpers, and the route error boundary resets on navigation instead of trapping the full SPA.
- Current branch pipeline follow-ups harden that stage model further: normalized stages now persist
  as `{ id, name, color, outcome }`, Pipeline Manager edits full stage objects without flattening
  Wizmatch metadata, deal closing and pipeline analytics consume normalized `outcome`, Wizmatch
  optional-schema fallbacks are allowlisted to known optional tables, and tenant resolution is
  path-first to avoid stale cross-tab localStorage redirects.
- Wizmatch operational-readiness prep now documents the migration-journal gap for skipped
  `0020`/`0021` Wizmatch SQL files, provides a read-only `npm run wizmatch:env-check` command,
  and keeps Dice/Naukri-style GitHub Actions scrapers manual-dispatch only until schedule approval.
- Local `main` integration on 2026-07-08 merged both pipeline-stage hardening and Wizmatch
  operational-readiness prep, then passed `npm run build`, `npm test` (27 files, 236 tests),
  `npm run admin:build`, and `git diff --check` before the live push.
- Live deploy on 2026-07-08 IST pushed `main` commit `7951c28` and Railway `web` deployment
  `9a253c24-f400-4c33-ae88-2ddc35000bbd` reached `SUCCESS`. Live checks after deploy:
  `https://api.growthescalators.com/health` responded with database `ok` and status `degraded`
  only because `lastWebhook` was stale from 2026-06-29; `https://crm.growthescalators.com`
  returned HTTP 200.

## In progress

- **Wizmatch intelligence operating layer**: local implementation now includes Contact
  Intelligence manual review/persistence, Client Discovery deterministic scoring + handoff,
  Candidate Intelligence deterministic readiness/matching + persisted review intent, Requirement
  Priority scoring, a unified Review Workbench, Guardrail Center, Local Demo Flow, and deterministic
  Analytics / ROI. It now also includes a read-only Data Readiness API/page that checks required
  table presence, tenant-scoped counts, latest activity, module status, empty-state reasons,
  operator notes, and guarded blocked items. Contact Intelligence now has a preview-first manual
  discovery layer for Apollo/Snov/Reacher and controlled Google fallback, gated by env flags,
  eligibility rules, hard-blocking budget/rate caps, provider-env checks, advisory-lock
  duplicate protection, cooldown, and explicit `confirmPreview=true`. Admin classic pages,
  CRM-styled V2 pages, and the new operating pages exist.
  `/wizmatch` now lands on the Wizmatch Dashboard. The visible Wizmatch sidebar includes shared
  CRM modules plus the primary staffing operating/V2 pages: Review Workbench, Data Readiness,
  Client Discovery, Contact Intelligence, Candidate Intelligence, Requirement Priority,
  Guardrails, and Analytics. Duplicated old frontend routes still redirect to their new pages.
  Frontend route smoke on 2026-07-07 covered 26 mocked authenticated routes/redirects:
  all Wizmatch shared/staffing routes rendered, Wizmatch users redirected from `/contacts` to
  `/wizmatch/contacts`, `/` resolved to `/wizmatch/dashboard`, and Growth-only users visiting
  `/wizmatch/contacts` redirected to `/dashboard`. `/wizmatch/emails` and `/wizmatch/discover`
  now render inside the Wizmatch app shell. Shared internal links in global search, contact drawer,
  pipeline settings, and lead-discovery import success now resolve through product-aware paths.
  The operating frontend has module/priority
  filters, readiness strips, richer CRM-style action cards, guardrail/cost panels, preview links,
  Contact Intelligence discovery preview/run controls, budget/provider-env visibility, and
  requirement review-plan feedback. Candidate Intelligence V2 now includes the manual Candidate
  Profile Intake panel and authenticated `POST /api/wizmatch/candidate-intelligence/intake`
  endpoint for preview-first CSV/profile imports. Intake creates/reuses CRM contacts and Wizmatch
  candidate records only after explicit confirmation; it scores profiles deterministically and does
  not send outreach, submit candidates, call providers, or update placements.
  Paid discovery defaults off unless env-enabled and manually run after preview. Still no outreach
  sending, candidate auto-submission, worker/cron automation, package, or deployment changes.
  The new `/api/wizmatch/dashboard` endpoint powers the Wizmatch Dashboard with live tenant-scoped
  requirements, candidates, signals, contacts, placements, inbox, tasks, review, readiness, and
  guardrail summaries. `/api/wizmatch/intelligence` and
  `POST /api/wizmatch/intelligence/generate` provide manual Claude-powered staffing analysis
  over Wizmatch data only; they do not analyze Growth marketing/SEO/ads data and do not trigger
  outreach or submissions.
  Verification on 2026-07-08 IST found production Railway currently has only partial Wizmatch
  data: 192 GitHub-sourced contacts/candidates, 192 email channels, 1 bootstrap pipeline, and 3
  bootstrap domain-health rows. Production Wizmatch has 0 deals, messages/inbox rows, tasks,
  email templates, WhatsApp templates, billing clients, invoices, payments, companies, job
  signals, placements, suppression rows, and is missing the newer `wizmatch_requirements`,
  `wizmatch_company_intelligence`, `wizmatch_contact_candidates`, and `wizmatch_discovery_runs`
  tables. That means existing production Wizmatch data is not pure dummy data, but it is not yet
  client-ready operating data.
  Portal hardening on 2026-07-08 IST also made Wizmatch dashboard/workbench/readiness/cost
  surfaces degrade to zeroed `needs_migration_check` readiness/cost data when optional/newer
  Wizmatch tables are absent, instead of surfacing a generic internal-server-error fallback.

## Recently landed (context)

- Wizmatch Requirement Sheets + India-relevance foundation (region-aware scoring/matching,
  branded requirement PDFs, candidate ingest endpoint, Naukri job-signal scraper rewrite).
- Wizmatch placements wired into the CRM deals/pipeline layer.

## Known issues / watch-outs

- `contacts` shares column names (`tenant_id`, `status`, `source`, `score`) with several
  Wizmatch tables → JOIN queries must alias filter columns or Postgres throws 42702.
- If the worker runs as a separate Railway service, it serves only a health probe, not the API →
  worker crons must call `WIZMATCH_API_BASE_URL` (public `web` URL), not `localhost`.
- Duplicated old demo routes now redirect to the relevant new demo pages. Local V2 demo routes
  `/wizmatch/command-center-new-demo`, `/wizmatch/contact-intelligence-new-demo`,
  `/wizmatch/client-discovery-new-demo`, `/wizmatch/candidate-intelligence-new-demo`, and
  `/wizmatch/analytics-new-demo` work without DB/login. New operating demo routes
  `/wizmatch/review-workbench-demo`, `/wizmatch/requirement-priority-new-demo`,
  `/wizmatch/guardrails-new-demo`, `/wizmatch/readiness-demo`, and
  `/wizmatch/local-demo-flow-demo` work without DB/login. Authenticated routes need a healthy
  local API/database and CRM auth token.
- Classic pages with unique operational workflows remain direct-access fallbacks, but are no
  longer in the Wizmatch sidebar: requirements, signals, candidate pool, domains, compliance,
  placements, and primes. Do not delete them until matching V2 workflows exist.
- Contact Intelligence persistence/API/UI are local-only until reviewed and migrated in the
  intended environment. Paid discovery is manual-only, preview-first, and disabled by default via
  `WIZMATCH_PAID_DISCOVERY_ENABLED=false`; Google fallback is disabled by default via
  `WIZMATCH_GOOGLE_FALLBACK_ENABLED=false`. Cost guard defaults are conservative:
  ₹5,000/month, ₹500/day, 20 tenant runs/day, 5 user runs/day, and provider daily caps. Confirmed
  blocked discovery attempts are audited as zero-cost `blocked_by_cap` rows.
- `fix/wizmatch-cost-safety` resolves the two P0 cost-safety audit items locally: the generic
  `findEmail` cascade defaults Apollo/Snov off unless explicitly opted in, Wizmatch signal
  enrichment passes the free-only option, and domain-health checks now warn on SPF/DMARC failure or
  low reply rate. If all non-paused domains are degraded, the worker posts an actionable
  `WIZMATCH_SYSTEM_CHANNEL` alert once per 24 hours via an append-only `events` marker while
  preserving the mailer's fallback-to-all sending behavior.
- **RESOLVED 2026-07-09**: the missing-migration gap diagnosed on 2026-07-08 was fixed. Root cause
  confirmed: `0020_wizmatch_gin_indexes`, `0020_curvy_silverclaw`, and
  `0021_contact_intelligence_phase2` SQL files existed on `main` but were never listed in
  `src/db/migrations/meta/_journal.json`, so Drizzle's journal-based migrator silently never
  applied them across every prior deploy. Fix: three journal entries appended with `when`
  timestamps greater than the already-applied `0022` entry (Drizzle only compares each entry's
  `when` against the single most-recent applied migration's `created_at`, not per-migration hash
  presence, so timestamps had to sort after `0022` regardless of array position). Verified locally
  (build/test/admin-build/diff-check), pushed as commit `0f313ba` with explicit human approval,
  Railway deploy `e23a4c03` reached `SUCCESS`, and `/wizmatch/readiness` confirmed all 4 tables now
  exist (`ready`/`needs data`, 0 missing, score 40 → 81). `wizmatch_requirements`,
  `wizmatch_company_intelligence`, `wizmatch_contact_candidates`, and `wizmatch_discovery_runs` are
  now live schema in production, currently empty (0 rows) and ready for real data.
- **2026-07-09**: `WIZMATCH_PHYSICAL_ADDRESS`, `WIZMATCH_LEADS_CHANNEL`, `WIZMATCH_DAILY_CHANNEL`,
  and `WIZMATCH_SYSTEM_CHANNEL` are now set on Railway (all three channel vars point at the
  existing BD/Sales Slack channel to start; can be split into separate channels later with no code
  change). Authenticated smoke check of `/api/wizmatch/readiness`, `/client-discovery/queue`,
  `/candidate-intelligence/queue`, and `/review-workbench` confirmed all 4 return 200 post-deploy.
- **Scraper CI crash fixed, but scrapers still return 0 rows**: `wizmatch-dice.yml` and
  `wizmatch-jobspy.yml` previously crashed with `MODULE_NOT_FOUND` on every manual dispatch because
  `npx playwright install --with-deps chromium` never installed the `playwright` npm package
  itself. Fixed by pinning `npm install --no-save playwright@1.59.1` (matching the version already
  locked via `@playwright/test`) — both workflows now complete successfully. However, both still
  return 0 job signals: Dice.com and Naukri.com's live search-result page markup no longer matches
  the `page.evaluate()` CSS selectors in these workflows. This is a separate, unresolved issue —
  the scrapers are not currently a usable real-data source until someone inspects the live DOM of
  both sites and rewrites the selectors.
- GitHub Actions scraper workflows are intentionally manual-dispatch only in the readiness branch.
  They require `RAILWAY_INTERNAL_API_URL` and `INTERNAL_API_TOKEN` GitHub secrets and call the
  existing protected `POST /api/wizmatch/signals/ingest` endpoint. Do not enable schedules without
  explicit approval.
- To get real Wizmatch data flowing from the next business day without adding new automation:
  first get explicit approval for applying required migrations/deploying the branch, then load
  5-10 real requirements and 20-30 vetted candidate profiles manually, dispatch existing
  scraper/import flows only after secrets are confirmed, review Client Discovery and Contact
  Intelligence queues manually, and keep outreach/candidate submissions manual-only.
- Candidate Intelligence review now persists reviewer intent into
  `wizmatch_candidates.india_specific.candidateIntelligenceReview`; it still does not create
  submissions, send outreach, or change placement state.
- Candidate Profile Intake accepts up to 50 manually vetted profiles per request, defaults to
  dry-run preview, skips duplicate candidate records by CRM contact, and writes only confirmed
  imports. Operators should follow `docs/wizmatch-daily-operations.md` for the daily loop.
- Analytics / ROI and daily digest are read-only and deterministic. They degrade gracefully to
  zeroed optional metrics when newer Wizmatch tables/columns are missing in an environment; they
  do not create schema, write snapshots, send outreach, or call providers.
- Requirement Priority and Review Workbench are deterministic/manual-action layers. Requirement
  review-plan endpoints are planning-only; live workbench safe actions call existing approved
  endpoints and preserve manual review gates.
- The latest operating UI polish was verified against `/wizmatch/review-workbench-demo`,
  `/wizmatch/requirement-priority-new-demo`, `/wizmatch/guardrails-new-demo`,
  `/wizmatch/readiness-demo`, `/wizmatch/local-demo-flow-demo`, and `/wizmatch-demo`; module
  filtering, safe action feedback, requirement review-plan feedback, and readiness table/module
  displays work in demo mode.
- Phase 3 preview-first discovery tests cover Tier A eligibility, Tier B manual approval, disabled
  env, cooldown/caps, Apollo/Snov/Google fallback order, Reacher invalid handling, provider
  failures, max-3 candidate cap, dedupe, cost guard budget/provider/user caps, provider-env
  blocks, no-provider-without-token behavior, and route registration.
- Pipeline Stage Hardening Follow-ups were verified locally with `npm run build`, `npm test`,
  `npm run admin:build`, and `git diff --check`. Manual smoke against a real local/staging
  database and authenticated Growth/Wizmatch users is still pending.
- Combined live-push verification on 2026-07-08 passed locally before deployment: `npm run build`,
  `npm test` (27 files, 236 tests), `npm run admin:build`, and `git diff --check`.
- Post-deploy Railway env readiness check showed all required Wizmatch env vars present and one
  recommended Wizmatch env var missing: `WIZMATCH_PHYSICAL_ADDRESS`. Optional Slack channels are
  also missing: `WIZMATCH_LEADS_CHANNEL`, `WIZMATCH_DAILY_CHANNEL`, and
  `WIZMATCH_SYSTEM_CHANNEL`. GitHub Actions secrets still need human confirmation:
  `RAILWAY_INTERNAL_API_URL` and `INTERNAL_API_TOKEN`.
- Direct read-only table/count verification could not be completed from local Codex because
  Railway injected only the internal Postgres hostname (`postgres.railway.internal`) and no
  `DATABASE_PUBLIC_URL`; run the `psql` checks in Railway shell next.
- Railway boot logs after deploy showed existing Wizmatch worker crons scheduled in-process
  because `WIZMATCH_TENANT_ID` is set. This was not newly added by the readiness work, but it is
  live operating behavior to keep in mind before loading real data or enabling scraper schedules.
- Railway boot logs still warn about legacy/automation env aliases:
  `SNOVIO_API_KEY`, `SALESHANDY_API_KEY`, `SALESHANDY_SEQUENCE_ID`, and
  `PURELYMAIL_PASS_1..6`. The new readiness checker sees the newer Snov and
  `PURELYMAIL_SMTP_*` variables present, so review whether the warnings are legacy alias noise or
  truly needed for active flows.

## How to rebuild context fast

`git branch --show-current` + `git status --short` → `git fetch origin` (pull `main` only if
intentionally on it with a clean tree) → read `.ai/CURRENT_TASK.md` → `npm run ai:brief` → read `AGENTS.md`.
