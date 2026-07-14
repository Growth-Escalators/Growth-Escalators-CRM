# HANDOFF_LOG.md

Immutable completed-unit log. Newest entries are inserted below this header. Existing entries are
not rewritten except to redact exposed sensitive values. One entry per coherent change.
Format: `## YYYY-MM-DD — <title> — <agent>` then a few bullets (what changed, how to verify, what's next).

---

## 2026-07-14 — Results-first sourcing Phase 1 — Codex — STAGING + PRODUCTION

- Implemented independent default-off TheirStack, ATS, requirement-first X-Ray and free POC controls;
  audited source runs; PostgreSQL source locks; shared tenant-scoped ingestion/dedupe; source health;
  signal qualification/rejection; POC tasks; idempotent requirement promotion; ATS confirmation;
  and candidate-lead evidence that remains excluded from canonical matching until human review.
- Generated additive migration `0029`; no destructive SQL or production data deletion.
- Passed build, 47/383 Vitest, admin build, 22/22 Playwright, responsive source paths, secret/diff
  checks and provider fixtures for Greenhouse, Lever, Ashby, TheirStack contract and X-Ray queries.
- Staging deployment `f8f6e053-5669-40cb-8c5c-4f8f4ac3f35f` reached `SUCCESS`. Controlled ATS run
  inserted 10 relevant signals; rerun inserted zero and deduplicated 10. POC discovery truthfully
  returned `generic_contact_only`; repeated signal promotion reused the same draft requirement.
- Pushed `1112e47` to `main`. Production deployment `fe6ebb85-cfe2-4a48-9d86-aa6707864e25`
  reached `SUCCESS`; journal advanced 27→28 and all five legacy count baselines remained unchanged.
  Production source flags remain off and authenticated desktop/mobile smoke passed.
- Blocker: `THEIRSTACK_API_KEY` and `SERPAPI_API_KEY` are absent from Railway/Keychain. No provider
  call, paid action, send, submission, fictional production business row or deletion was performed.

## 2026-07-14 — Controlled Staffing OS production launch — Codex — LIVE PRODUCTION

- Applied only additive migrations `0025`–`0028` with gates off. Production advanced from 23 to
  27 journal rows with `0028` latest; scratch remains 29 because two historical journal entries
  were already absent in production. Staffing constraints/tenant boundaries passed and legacy CRM
  baseline counts did not fall. The official backfill preview remained count-only and preserved
  the audit-test requirement without guessed attribution.
- Pushed and deployed the reviewed release, progressively enabled Gate A/B/C for the two-ID
  Jatin/Kanishk roster, seeded four canonical SAP/Java skills plus eight aliases, and enabled the
  safe in-process reminder. Pilot-all, legacy automation, sending, paid discovery and Google
  fallback remain off; no worker exists.
- Closed three launch defects through regression tests, isolated staging and production retest:
  `e38bdb9` requires a dedicated private document bucket; `9bbb570` uses runtime staffing access
  for UI navigation/routes; `187c741` blocks provider-backed X-Ray sourcing when provider controls
  are off. Final deployment `cd9c71ec-2f77-4a5d-b583-cdf3a55be9f5` reached `SUCCESS`.
- Retained one labelled non-PII QA PDF in the dedicated private bucket. It persists as `r2://`,
  public and unsigned access fail, and five-minute signed access succeeds. No production object or
  row was deleted.
- Final suite passed: build; 46/372 Vitest; admin build; 17/17 Playwright; fresh 29-entry migration
  apply (81 public/31 Wizmatch tables); production gates-off bundle; secret scan; diff check.
- Authenticated production QA used Kanishk's Keychain credential without exposing it. All 35
  visible/direct routes passed desktop, tablet and 390px mobile coverage; direct access, readiness,
  empty states and unauthorized controls passed. No fictional production commercial outcome was
  created.
- Production is live for Jatin and Kanishk. The next unit is read-only monitoring through the
  48-hour restricted-pilot window. A thread heartbeat owns the 15-minute/one-hour checks and
  temporary automation `wizmatch-48-hour-pilot-monitor` runs every six hours through
  `2026-07-16T06:12:00Z`; do not add users or expand product automation.

## 2026-07-14 — Safe staffing automation and final staging qualification — Codex — LOCAL + LIVE STAGING

- Committed `1ceada3`: separated legacy Wizmatch automation from deterministic staffing reminders,
  defaulted both controls off, required Gate C for reminders, and exposed non-sensitive automation
  state in System/Readiness. Existing non-Wizmatch Growth CRM schedules were unchanged.
- Added regression coverage for flag defaults/dependencies, zero-work runs, open-task deduplication
  and absence of communication/provider SQL. Full verification passed: build; 46/368 Vitest;
  admin build; 16/16 Playwright; fresh 29-entry migration apply (81 public/31 Wizmatch tables);
  gates-off production-router check; diff check.
- Deployed exact `1ceada3` only to isolated `web-staging`. Deployments
  `a5ed6f3c-dccb-4add-86e2-17ec9046f204` and tenant-config redeploy
  `9f20e84c-952e-4f48-9f2e-8373528144b7` reached terminal `SUCCESS`; health/database are green.
- Staging logs prove one in-process staffing schedule, legacy automation skipped and no worker.
  Authenticated browser QA passed all high-value A–C workspaces, System/Readiness, console checks
  and 390px layouts. The ephemeral staging credential/session was removed/signed out.
- Read-only production preflight found production healthy on old `b05ac015`, with only additive
  0025–0028 pending. Counts are 2,812 contacts, 131 companies, 311 candidates and one requirement.
  The old build logged 18 new GitHub-mined candidates; the reviewed release stops that legacy block.
- Production was not changed or deleted. Exact next gate: approve applying only migrations
  0025–0028 with all staffing gates and staffing automation off. Push and activation remain later
  separate approvals.

## 2026-07-14 — Read-only production launch qualification — Codex — PRODUCTION READS ONLY

- Under the owner's standing read-only authorization, verified production health, topology,
  deployment, migration journal, non-secret env presence, R2 listing, Wizmatch users and aggregate
  staffing data. No row, object, flag, schema or deployment was changed or deleted.
- Production is healthy on `b05ac015`; only web+Postgres exist. Drizzle has 23 applied entries and
  exactly reviewed additive `0025`–`0028` pending. R2 is configured but contains no Wizmatch object.
- Found environment corrections required before launch: staffing flags/roster absent; paid
  discovery and Google fallback enabled; global TLS verification disabled. Verified R2 listing
  succeeds when TLS verification is forced on.
- Found roster blocker: Wizmatch has only Jatin/Kanishk admins and a viewer. Suggested pilot account
  additions from the existing Growth roster are Sneha=team_lead, Keshav=staff and Nimisha=staff;
  no account was copied or created.
- Found data-readiness limits: 131 companies are mostly signal-derived, the sole requirement is a
  retained unattributed audit-test row, and 293 GitHub candidates are unvetted. The preview found
  64 Java-like profiles, zero SAP profiles and missing experience evidence. No fact was inferred.
- Release verification passed: backend build, 45/360 Vitest, admin build, 16/16 Playwright and diff
  check. Pre-existing rankTracking warnings/test noise remain unrelated.
- Exact next gate: approve the production `web` safety-variable bundle with all staffing gates off.
  Then stop for separate pilot-account, migration, push, gate and data approvals.

---

## 2026-07-14 — Production Wizmatch admin credential rotation — Codex — APPROVED PRODUCTION SECURITY MUTATION

- Under the user's exact approval, ran a tenant-scoped preflight for the documented Wizmatch
  operator email. Two tenants contain that email, so the mutation filter was narrowed to tenant
  slug `wizmatch`; it then matched exactly one active admin row. The Growth-tenant row was untouched.
- In one transaction, replaced only that Wizmatch user's password hash and advanced token version
  3→4, invalidating prior sessions. Before/after hash verification proved the historical plaintext
  was already not live, remains rejected, and the replacement verifies. Exactly one row changed.
- Stored the replacement only in the local macOS Keychain item `Wizmatch Production Admin (rotated
  2026-07-14)`. No credential value was printed, logged, written to a file/repo/Railway variable or
  included in context. Ephemeral `/tmp` rotation/preflight scripts were removed.
- No other production action occurred: no application/staffing-data read or write, migration,
  deploy, environment/flag change, Git push, import, provider call, sending or worker operation.
- Exact next gate: separately approve read-only production health/topology inspection and the
  count-only staffing backfill preview. Migration, push, flags and imports remain separate gates.

---

## 2026-07-14 — Final named-pilot access hardening and staging qualification — Codex — LIVE STAGING + LOCAL

- Added and committed the fail-closed named-pilot policy as `9f4c0f4`: role capabilities, assigned-
  requirement isolation, restricted commercial data/actions, `/staffing/access`, 30-day consent,
  required permanent/contract economics and below-20%-margin admin exceptions.
- Recorded the approved provisional policy pack and accepted ADR-005's one-time `a810d08`
  exception. This does not approve a push or any production operation.
- Verification passed locally: backend build; 45 files / 360 Vitest tests; admin production build;
  16/16 Wizmatch Playwright scenarios; `git diff --check`.
- Upgraded Railway CLI to 5.26.1 and redeployed exact commit `9f4c0f4` to isolated `web-staging`
  after its fictional named roster was configured. Deployment
  `54b9ff52-8fed-43eb-974c-bb2ddaab72f6` reached terminal `SUCCESS`; health returned database `ok`.
- Direct-API access qualification passed all 15 assertions: pilot admin/lead/recruiter admitted;
  non-pilot/viewer denied; assigned recruiter isolation held; recruiter approval/commercial and
  lead finance writes were denied; admin commercial access succeeded.
- Read-only staging reconciliation confirmed distinct Person A/SAP and Person B/Java attribution,
  complete consent→submission→offer→placement traces, INR 250000 permanent fee, INR 500/25%
  contract margin, separate invoice links and traceable adjustments. R2 remained intentionally
  unset; sending, paid providers, Google fallback, background jobs and production stayed untouched.
- Exact next gate: separately approve rotation of the previously exposed live credential. Then
  stop again for production read/count-only preview approval; migrations, push, flags and imports
  remain separately gated.

---

## 2026-07-14 — Staging deployment and Placements commercial-label smoke — Codex — LIVE STAGING

- With explicit staging-only approval, deployed exact commit `ef2112f` directly to Railway
  `web-staging`; deployment `52508e6f-8fdd-475c-a58e-84d31b82d142` reached terminal `SUCCESS`.
- Verified `GET /health` returned HTTP 200 with `status: healthy` and `database: ok`.
- Authenticated browser smoke loaded `/wizmatch/placements` and its API at HTTP 200, rendered two
  started fictional placements, and confirmed `₹500/hr contract margin`, `₹2,50,000 permanent
  fee(s)`, and the absence of the incorrect permanent `/hr` and legacy USD labels. Visual layout
  matched the assertions.
- Used an in-memory staging-only password and a mode-0600 temporary session for QA. Immediately
  rotated the pilot account again, bumped token version, and removed all temporary session and
  screenshot files. No credential value entered the repo or handoff.
- Production was not accessed or changed: no remote Git push, production deployment, database
  read/write, migration, flag, sending, provider, worker or production-data operation occurred.
- Exact next unit: mandatory owner-policy workshop plus explicit accept/reject decision for
  proposed ADR-005. Production read/migration/push/flags/import remain separate approval gates.

---

## 2026-07-14 — Full staging Gate C, browser QA and commercial-label repair — Codex — LIVE STAGING + LOCAL

- Corrected missing fictional Gate B evidence through tenant-scoped APIs, then proved four separate
  candidate/requirement pairs: Rahul→SAP and Priya→Java shortlisted; cross-role pairs blocked.
- Exercised exact-requirement consent → draft → approval → fictional manual delivery record →
  interview → accepted offer → placement for SAP permanent and Java contract. Negative checks
  blocked wrong consent, duplicate submission, duplicate placement and unauthenticated access.
- Linked fictional staging invoices/payments and reconciled 2 starts, 570000 invoiced, 570000
  collected and 250500 gross margin. Opened/resolved dispute, replacement and refund records.
- Live browser QA covered the high-value staffing workspaces and 390×844 Delivery layout. Found the
  legacy Placements page labelling a permanent fee as hourly margin; added a local formatter that
  separates permanent fees from contract hourly margins plus three regression tests.
- Verification: build passed; 44/352 Vitest passed; admin build passed; Playwright 16/16 passed;
  `git diff --check` passed. Staging sending/provider/R2/AI/background jobs remained off.
- Credential hygiene: an ephemeral staging password appeared in an internal browser snapshot and
  was immediately rotated/revoked; temporary session artifacts and the in-memory value were removed.
- Production untouched. Exact next gate: approve one isolated-staging deployment for the display
  repair, then smoke Placements. Production policies/migrations/push/flags/data remain separately gated.

---

## 2026-07-13 — Staging login rotated + Gate A completed with real records + a810d08 guardrail review — Claude — LIVE STAGING

- **Rotated the exposed staging pilot login:** generated a new password in-memory, updated the hash,
  bumped `token_version` (revokes old sessions), minted a fresh session via `/auth/login`. New
  password was never printed or stored. Verified the previously-exposed password now returns 401.
  Browser re-auth used the freshly-minted session (injected into `localStorage`); that staging
  session token is disposable and the DB rows are fictional.
- **Completed Gate A on staging with REAL company-contact + attribution records (fictional data):**
  created hiring contacts Person A (SAP) + Person B (Java) as CRM contacts; linked both to
  `Company A (Pilot)` (roles hiring_manager, source); set SAP→Person A and Java→Person B primary
  source; assigned account-owner + recruiter on each; set a dated next action + SLA on each; moved
  both draft→`qualifying`. The `draft→accepted` transition was correctly blocked by the state
  machine (honest guard).
- **Verified (Task 3/4):** Requirements table shows real Source person + Assigned team for both (no
  "Needs attribution"/"Unassigned"); Company 360 (2 contacts, 2 roles, 10+ events), Hiring Contact
  360 (Person A shows only SAP; Person B only Java — isolation), Requirement 360, and timelines all
  render. DB truth: `wizmatch_requirement_contacts=2` (distinct source contact each),
  `wizmatch_requirement_assignments=4`, `wizmatch_staffing_events=14`, each event scoped to its own
  requirement. Screenshots recorded under `docs/reviews/wizmatch-staging-pilot-2026-07-13/`.
- **Reviewed commit `a810d08` against the `src/db/migrations/` guardrail** →
  `docs/reviews/wizmatch-migration-guardrail-review-2026-07-13.md`. It edits already-applied
  migrations (guardrail violation by the letter) but is very likely prod-safe (won't re-run; no-op
  if it did; verified on fresh staging). Decision needed from the migration owner: documented
  exception (keep) vs safer replacement (revert + baseline-dump for fresh installs). **`a810d08`
  stays UNPUSHED** until that decision.
- **Reconciled context files** (`CURRENT_TASK`, `CURRENT_STATE`) so "production untouched" is stated
  separately from the isolated staging work (created/migrated/deployed/populated + login rotated),
  and the migration fixes are recorded as committed-but-unpushed under review.
- Guardrails intact: no production push/deploy/data, no sending, no paid/AI/R2 call. Gate C remains
  NOT authorized (needs staging R2). Only fictional rows exist in the staging DB.
- Exact next step: await the migration-owner decision on `a810d08`, and separate approval for
  staging R2 before any Gate C work.

---

## 2026-07-13 — Gate B exercised on staging (matching + shortlist, DB-verified) — Claude — LIVE STAGING

- Continued the live pilot (no R2 needed for Gate B). Candidate Intelligence → pasted 2 fictional
  vetted profiles (Priya Sharma/Java, Rahul Verma/SAP) via the manual CSV intake.
- **Preview scores** ran deterministically (both 73) with `Inserted 0` — a score is not a shortlist;
  nothing persisted on preview. **Import candidates** then created 2 candidate records
  (`Inserted 2`), banner: "No outreach, submission, placement, provider enrichment, or paid action
  was performed."
- Deterministic matching routed each candidate to its DISTINCT requirement: Rahul → SAP ABAP
  Consultant (Person A), Priya → Java Backend Developer (Person B), each with an explainable
  component breakdown + reasons. Rahul's per-requirement fit panel showed matched SAP skills AND
  "missing Java/Spring Boot/Microservices" against Person B's role — the two requirements are scored
  separately.
- **Shortlisted Rahul** (explicit action). UI: "review intent was persisted. No outreach,
  submission, or placement state was changed." DB-verified:
  `wizmatch_candidates=2`; Rahul's `india_specific.candidateIntelligenceReview` =
  `{action:"shortlist", score:73, topRequirementId:<SAP req>, guardrails.submissions:
  "no_automatic_submission", reviewedBy:<pilot admin>}`; and `wizmatch_submissions=0`,
  `wizmatch_placements=0`, `wizmatch_offers=0` — a shortlist is not a submission.
- Screenshot: `wizmatch-staging-gateB-match-shortlist.png`. No sending/paid/prod action; guardrails intact.
- Next (out of scope for the chosen "Gate B, no R2" leg): Gate C (consent/RTR → submission →
  interview → offer → placement → invoice → collection) needs R2 for documents; provision staging R2
  (+ optionally Anthropic) to exercise it.

---

## 2026-07-13 — Staging CORS fix + login bootstrap + Gate A exercised (invariant proven) — Claude — LIVE STAGING

- **CORS gotcha fixed:** the SPA on the staging host 500'd on its own assets/API because `index.ts`
  rejects any `Origin` not in the allowlist (`crm.growthescalators.com` + `CORS_EXTRA_ORIGIN`), and
  the SPA's `<script crossorigin>`/`fetch` send `Origin: <staging host>`. Set
  `CORS_EXTRA_ORIGIN=https://web-staging-staging-1d24.up.railway.app`; redeploy `4e48cd0f` SUCCESS;
  SPA now loads. (Reusable lesson: deploying this app on any host other than crm.* requires
  `CORS_EXTRA_ORIGIN` = that host.)
- **Login bootstrap (staging-only):** created a fictional `wizmatch` tenant (`Wizmatch (Staging
  Pilot)`) + admin user `pilot@wizmatch.test` (role `admin`) via a one-off script over the public
  proxy (argon2 hash; generated throwaway password, not stored in repo/context). Verified
  `POST /auth/login` → 200 with a JWT, and the browser login via the Product=Wizmatch toggle.
- **Gate A exercised end-to-end in the live UI (fictional data):**
  - Client Discovery → "Seed prospect hiring company" created `Company A (Pilot)` with the SAP ABAP
    role. Deterministic score 54 (watch tier), explainable components + reasons + guardrails shown;
    "Send to Contact Intel" correctly disabled at watch tier (a signal is not a requirement).
  - Requirements → created TWO distinct requirements at Company A: `SAP ABAP Consultant (Person A)`
    (SAP ABAP/FICO) and `Java Backend Developer (Person B)` (Java/Spring Boot). The form enforces
    company-first attribution ("Add or qualify the company before creating its requirement").
  - **DB-verified invariant:** `wizmatch_companies`=1 (Company A `8139544b`), `wizmatch_requirements`
    =2, both with the same `company_id`, distinct titles — Person A's SAP and Person B's Java stay
    distinct at the same company. Screenshot: `wizmatch-staging-two-distinct-requirements.png`.
- **Honest failure mode confirmed (expected):** "Save & Generate Sheet" returns
  "Sheet generation failed: R2 not configured…" because R2 is intentionally unset; the requirement
  RECORD still persists (save is separate from PDF generation). Requirement-sheet PDFs and Gate C
  consent/RTR documents both need R2, so the full document chain is not exercisable in this staging
  config until R2 is provisioned. "Parse with AI" was avoided (needs Anthropic, intentionally off).
- Guardrails intact throughout: sending/paid/background-jobs OFF; no outreach, no paid call, no
  production access, no push. Only the staging DB gained fictional pilot rows.
- Exact next options: (a) provision staging R2 (+ optionally Anthropic) to exercise sheets/consent
  docs and the rest of Gate C; (b) continue Gate B (candidate intake → deterministic matching →
  shortlist — no R2 needed) and the non-document parts of Gate C; or (c) stop at Gate-A-proven.

---

## 2026-07-13 — Staging web deployed (Gate A/B/C on, sending/paid off) — Claude — LIVE STAGING DEPLOY

- Created staging `web` service `web-staging` (id `e7f073ec-4835-4fbb-ad1c-17f0f5bb17f6`) in the
  `staging` environment and deployed THIS clean worktree to it via `railway up --detach`
  (deployment `964770e6-a8cf-4f9f-840a-670e13b1d7a4`). No `main` push; production `web` untouched.
- Provisioned staging-only env (no production secret copied): `DATABASE_URL` = Railway reference
  `${{Postgres-Bhky.DATABASE_URL}}`; a FRESH `JWT_SECRET` generated via `openssl` and set through
  `railway variable set --stdin` (value never printed/stored); `NODE_ENV=production`;
  `DISABLE_BACKGROUND_JOBS=true` (no crons in staging); Gate flags ON in staging — server
  `WIZMATCH_STAFFING_GATE_A/B/C_ENABLED=true` and build `VITE_WIZMATCH_STAFFING_GATE_A/B/C_ENABLED=true`;
  `WIZMATCH_SENDING_ENABLED=false`, `WIZMATCH_PAID_DISCOVERY_ENABLED=false`,
  `WIZMATCH_GOOGLE_FALLBACK_ENABLED=false`. Later set `CRM_EXTRA_HOST=web-staging-staging-1d24.up.railway.app`
  so the admin SPA serves on the staging domain (redeploy triggered).
- Build ran the repo's real pipeline (nixpacks: `npm run admin:build && npm run build`), so the
  admin SPA was built WITH the Vite gate flags. Start command `node dist/scripts/migrate.js &&
  node dist/index.js` re-ran the migrator on boot against the staging DB (idempotent no-op — all 29
  already applied) then started the API.
- Verified: deployment status `SUCCESS`; `GET /health` → HTTP 200 `status: healthy`, `env:
  production`, `database: ok`, uptime ~95s; `GET /` with `Host: crm.growthescalators.com` returns
  the CRM SPA `index.html` (Vite bundle `/assets/index-DVW92tHe.js`), i.e. admin bundle built and
  served — not the D-29 503. Domain: https://web-staging-staging-1d24.up.railway.app
- Nothing sent, no paid/provider call, no production data read/write, no `main` push. Background
  jobs off; sending/paid off.
- Exact next step: exercise the fictional Gate A–C workflow (Company A / Person A-SAP / Person
  B-Java → attribution → matching → consent → approval → manual sent-record → interview → offer →
  placement → invoice link → collection). Prerequisite: a fictional staging admin login/tenant —
  bootstrap approach is a decision (no login/tenant exists in the staging DB yet).

---

## 2026-07-13 — Staging migration journal applied + 2 fresh-apply migration fixes — Claude — LIVE STAGING DB CHANGE

- Applied the complete migration journal (0000–0028, 29 entries) to the empty staging Postgres
  `Postgres-Bhky` (staging env `6aa742f6-38c1-4c3e-8471-6ec5fecea027`) using the drizzle
  node-postgres `migrate()` — the same migrator as `src/scripts/migrate.ts`, run locally against
  the staging PUBLIC proxy with a longer connection timeout and resume-on-drop retry (the 2s pool
  timeout + proxy instability in the real migrator/first attempts were transport issues, not
  migration errors). Credentials were injected via `railway run` and never printed or written.
- Verified: `drizzle.__drizzle_migrations` = **29 rows**; **81** public base tables; **31**
  `wizmatch_*` tables; Gate A/B/C tables present — `wizmatch_requirements`, `wizmatch_placements`,
  `wizmatch_requirement_contacts`, `wizmatch_staffing_events`, `wizmatch_task_links` (plus
  `social_accounts`/`social_posts`/`email_templates`). Phase flags remain off (no `web` service,
  no env vars in `staging`). No application/tenant data was loaded.
- A fresh from-scratch apply exposed two pre-existing, from-scratch-ONLY defects in the committed
  chain (production is migrated incrementally and is unaffected). Both fixed additively and
  prod-safe (the migrator compares each journal entry's `when` only against the newest applied
  migration's `created_at`, so neither re-runs on a prod deploy; both are no-ops if they did; no
  resulting schema/snapshot change):
  - `src/db/migrations/0008_great_romulus.sql` — guarded the 8 statements `0007` already performs
    idempotently (2× `CREATE TABLE IF NOT EXISTS`, 3× `ADD COLUMN IF NOT EXISTS`, 3× social FK
    constraints wrapped in `DO $$ … pg_constraint …$$`, matching `0009`'s existing pattern).
  - `src/db/migrations/0014_brevo_email_templates_seed.sql` — replaced 5× `ON CONFLICT ON
    CONSTRAINT email_templates_tenant_name_idx` (that name is a unique INDEX, not a constraint)
    with `ON CONFLICT (tenant_id, name)`, the column-inference form its own comment documented.
  - `git diff` on both files shows ONLY these idempotency changes; `0009` and
    `0020_wizmatch_gin_indexes` were confirmed already-idempotent (DO-block guards / DROP IF EXISTS)
    and were NOT touched. A full static scan (CREATE TABLE / ADD COLUMN / ADD CONSTRAINT / CREATE
    INDEX / CREATE TYPE) found no other duplicate-object conflicts in the chain.
- These two migration files are MODIFIED but NOT committed. No push, no deploy, no production DB
  read/write, no env var change, no credential rotation.
- Exact next gate (separate approval): deploy this worktree to the `staging` `web` service — which
  first needs a staging env/secret provisioning decision (fresh JWT vs reused secret; R2/AI/Slack
  handling; which Gate A/B/C flags to enable in staging). Per the kickoff, stop here after journal
  verification for the separate application-deployment approval. Also decide whether to commit the
  two migration fixes to the branch (do not push without approval).

---

## 2026-07-13 — Isolated Railway staging environment + empty Postgres created — Claude — LIVE INFRA CHANGE

- Created Railway environment `staging` (id `6aa742f6-38c1-4c3e-8471-6ec5fecea027`) in existing
  project `GE-Backend-Server` (id `eef927aa-8e3a-4515-85fd-781b7d1d95c1`). Not forked from
  `production`; no production variables or database reference imported.
- Added a managed Postgres service `Postgres-Bhky` (id `a78f7108-45b1-46c8-bd8e-682edae2ff1f`) in
  the `staging` environment via `railway add --database postgres`. Fresh dedicated volume
  `postgres-volume-STmx` (id `da958ec3-a5d8-46d3-bf7e-b494f5617450`). Credential values are
  Railway-injected and are intentionally not recorded here.
- No code deployed to `staging`: no `web` service in the `staging` environment. No migrations
  applied. No Gate A/B/C server or Vite flags set. No paid-provider or sending flags set. No
  public domain generated.
- `production` remained untouched: `web` still on deployment `b004daa8-904c-4f15-87e5-932ecfe032c6`
  (deployed 2026-07-13 05:46:29 UTC; identical to pre-work read); original `Postgres`
  (id `0c31ec38-0433-46c6-9fbb-5dd2859d1a08`) unchanged; production environment id unchanged.
- No push, no code change, no production data read/mutation, no credential rotation, no history
  rewrite.
- Verification: `mcp__railway__environment_status` on both environments confirms `staging` holds
  only `Postgres-Bhky` and `production` still holds only `web` + original `Postgres` with
  unchanged timestamps; `mcp__railway__list_services` shows the three services;
  `mcp__railway__list_variables` on `Postgres-Bhky` shows the new service's own scoped connection
  values (private domain `postgres-bhky.railway.internal`), none referencing the production
  Postgres.
- Exact next gate: separately approved application of the complete migration journal to
  `Postgres-Bhky` via the real deployment migrator (`src/scripts/migrate.ts`). Deployment of the
  `web` service to `staging` remains a further, separate approval.

---

## 2026-07-13 — Same-day Claude release handoff prepared — Codex — LOCAL ONLY

- Reframed the completed local release candidate for a controlled same-day Gate A–C pilot from the
  clean `codex/wizmatch-phase0-trust` worktree; the original dirty workspace remains excluded.
- Recorded the verified baseline (43 Vitest files / 349 tests, admin/API builds, 16/16 Chromium),
  branch position (0 behind / 25 ahead), production-only Railway topology and absent worker config.
- Updated the canonical Claude kickoff so it resumes at staging creation rather than repeating the
  already-completed release-integrity review.
- Recorded only explicit owner intent: full A–C pilot target, mandatory business-policy sign-off and
  a pause immediately before every guarded migration, environment, credential, production-data,
  push/deployment or feature-flag action.
- No Railway state, production data, secret, migration, flag, deployment or remote Git state was
  changed. Exact next gate: explicit approval to create isolated staging and empty staging Postgres.

---

## 2026-07-13 — Wizmatch release-readiness integrity review — Codex — VERIFIED LOCALLY

- Reviewed Gate A/B/C tenant isolation, transactionality, consent, duplicate protection, delivery
  traceability, migrations and finance linkage. Migrations remained untouched and non-destructive.
- Fixed linked submission-recipient and interview-participant tenant/company validation, duplicate
  placement creation, invoice/billing-client mismatch, payment/invoice mismatch, public consent
  references and concurrent versioned delivery-event locking in commit `605d6cd`.
- Verification: backend build passed; 43 Vitest files / 349 tests passed; admin build passed; 16/16
  mocked Chromium scenarios passed; production-off bundle redirected Gate B to Dashboard and hid
  Gate A/B/C navigation; `git diff --check` passed.
- Read-only Railway inspection confirmed production-only topology (`web` + Postgres), no staging or
  worker, and absent Gate A/B/C server/Vite variables. No Railway state, data or secrets changed.
- Exact next gate: explicit approval to create an isolated Railway staging environment and empty
  Postgres. Staging deployment and migration application remain separately approval-gated.

---

## 2026-07-13 — Wizmatch Staffing OS Gates B/C and release hardening — Codex — VERIFIED LOCALLY

- Implemented canonical skill evidence, deterministic/explainable matching, immutable snapshots,
  persistent shortlist/watch/reject decisions and recruiter/Candidate 360 workspaces (Gate B).
- Implemented exact-requirement consent/RTR with private signed documents, submission approval and
  recipient/resend history, interviews, offer revisions, traceable placement, permanent/contract
  economics, invoice/payment analytics, disputes/replacements/refunds and delivery exceptions
  (Gate C). No code path automatically sends a candidate.
- Added production-off API/UI Gate A/B/C flags, source-count/System evidence, selector-backed DKIM
  with explicit unknown state, provider/fingerprint signal dedupe, and read-only pilot backfill
  preview tooling.
- Added feature-gated deterministic task automation for overdue requirement SLAs, overdue
  submission follow-ups and availability evidence older than 30 days. It creates tasks/events only,
  is $0, and never contacts anyone.
- Generated additive `0027_brainy_orphan.sql` and `0028_strong_cammi.sql`. A disposable Postgres
  production-shaped apply verified 0028 on the committed Gate B schema: all nine Gate C tables,
  event/task trace links and journal advancement passed; no destructive SQL was found.
- Verification: `npm run build` passed; `npm test` passed 43 files / 344 tests; `npm run
  admin:build` passed; local mocked Chromium passed 16/16 including Person A/SAP vs Person B/Java
  and draft→approval→manual sent record→interview→offer→acceptance→placement. Existing rank-tracking
  mock warnings/noisy missing-SERPER logs remain pre-existing and unrelated. The production bundle,
  with all Vite staffing flags absent, redirected a direct Gate B URL to Dashboard and omitted all
  Gate A/B/C navigation entries.
- Commits present: `1997e31` (Phase 1 hardening), `a5ac3e8` (Gate B), and `48b1a88` (Gate C). No
  push, deployment, production migration/data write, real R2/AI/
  provider/payment call, sending, outreach, credential rotation or history rewrite occurred.
- Exact next gate: review the three local commits, then request separate approval for staging migration
  application. Production migration, count-only data access, feature flags, push/deploy and
  credential rotation each remain separately gated.

---

## 2026-07-13 — Wizmatch deep local browser and route-matrix QA — Codex — COMPLETED LOCALLY

- Walked all 10 primary public demo modules in the visible local browser and exercised safe controls:
  prospect intake, candidate sample/preview/import, Review Workbench handoff/approval/review/priority
  actions and filters, requirement review plan, contact discovery preview, blocked states, refresh,
  tenant selector, and password-recovery navigation. Demo writes remained simulated and discovery
  stayed disabled where its guardrail said disabled.
- Exercised all 57 Wizmatch source routes with local mocked APIs: 29 authenticated routes, 11 demo
  routes, and 17 redirects. No ErrorBoundary route-mount crash; all redirects/auth boundaries
  resolved. Pipeline produced one unhandled load rejection when `/api/pipelines` failed.
- Forced API outage exposed a release-blocking cross-page trust defect: several authenticated live
  routes substitute plausible demo records and retain action controls. Added D-26–D-31 to the
  canonical register; D-26 honest failure handling is now the next safe slice.
- Verification rerun: `npm run build` exit 0; `npm test` 37 files / 304 tests; `npm run admin:build`
  exit 0 / 1,937 modules; local authenticated Playwright 5/5. Browser console had no application
  errors; only repeated React Router v7 future-flag warnings.
- No production login, data, outreach, provider, AI/R2, payment, environment, deploy, commit, push,
  or guarded schema/auth/RBAC action was performed.

---

## 2026-07-13 — PRD 004 Phase 0 trust bundle + durable Claude handoff — Codex — VERIFIED LOCALLY, NOT COMMITTED

This entry supersedes the implementation details in the immediately following D-2 intermediate
handoff. That earlier draft used raw fetch/direct token handling; the final local candidate uses the
canonical `apiFetch(FormData)` path and adds focused/browser coverage.

**Phase 0 product repairs:**

- **D-1 Contact Intelligence:** merged read-only discovery preview and explicit confirmed manual
  discovery into the canonical live page without route-flipping away company/contact review,
  manual-add, CRM-link, or Pipeline handoff. The preview shows eligibility, provider order, budget,
  caps, configuration, blockers, and estimated cost. A separate checkbox is required before the
  run button enables. Authenticated load failure now clears live data and shows Error + Retry rather
  than plausible demo companies. No provider call, environment, budget, or cap change was made.
- **D-2 requirement parse:** `WizmatchRequirementsPage` now sends FormData through tenant-aware
  `apiFetch`, preserving multipart boundaries and canonical 401 cleanup. Missing input is a status
  message without Retry; real request failure is an alert with Retry; feedback clears on edit/mode.
- **D-9 linked hiring contacts:** new `wizmatchClientLeadLink` service normalizes channels, uses
  `findOrCreateContact`, and classifies new/deduplicated/existing links with `Client Lead`, company
  name, provenance metadata, tenant-scoped update, and `last_activity_at` bump.
- **D-10 contact search:** shared Contacts search matches combined full name plus tenant-scoped
  email/phone/WhatsApp channels through a correlated EXISTS.
- **D-11 action queue:** non-executable qualification/safety outcomes no longer consume Review
  Workbench cards; blockers remain visible in Safety Center.
- **D-12/D-14/D-20/D-21/D-23:** truthful handoff result, Requirement Priority zero-state/add link,
  Open Tasks helper, canonical dashboard work order, and plain-language CRM-link result.

**Persistent context and architecture:**

- Added canonical D-1–D-25 defect/remediation register.
- Corrected DATAFLOW schema authority, in-process scoring, topology uncertainty, and supply/demand
  separation; corrected the product brief's source/table statements.
- Added proposed ADR-004 and Phase 1 plan for company-contact roles, requirement attribution,
  assignments, timeline/task links, canonical skills/matches, and delivery records. This is a
  proposal only; no schema/migration edit was made by this task.
- Updated AGENTS/CLAUDE/kickoff/index/owner inputs/current task/state/generator so a future agent
  resumes from repo context, not chat history.

**Security remediation:**

- Removed plaintext credential values from the current working versions of the handoff, playbook,
  operator guide, and onboarding script. The script now requires secure environment injection and
  does not print the value. Added a repository-wide rule prohibiting credentials/PII/private
  payloads in code or context.
- The credential remains exposed in committed Git history and was not rotated. Live rotation needs
  explicit production-mutation approval. History rewriting is a separate disruptive approval gate.

**Verification:**

- `npm run build` — exit 0.
- `npm test` — **37 files, 304/304 passed**. Existing non-top-level `vi.mock` warnings in
  `rankTracking.test.ts` remain pre-existing; no new failing test.
- `npm run admin:build` — exit 0; 1,937 modules transformed.
- `npx playwright test --config=playwright.wizmatch-local.config.ts` — **5/5 passed** against local
  Vite with mocked APIs only; no production, AI, R2, provider, sending, or data mutation.
- `git diff --check` — clean across the worktree.

**Known limits / gates:**

- All work is local, uncommitted, unpushed, undeployed, and not production-smoked.
- A real requirement upload may call AI/write R2; a real confirmed discovery may spend configured
  provider budget. Neither was executed.
- D-8 truthful totals is the next safe Phase 0 design/implementation slice.
- Person A→SAP / Person B→Java and the first-class delivery chain require ADR-004 Gate A owner/schema
  approval before editing guarded schema/migration paths.
- During this task another process modified guarded schema/auth/RBAC/permissions files. Those edits
  are not part of this unit and must not be staged or reverted with it.

---

## 2026-07-13 — PRD 004 Phase 0 slice 1: Wizmatch "Parse with AI" 401 fix (D-2) — Claude — VERIFIED LOCALLY, NOT COMMITTED

Smallest safe Phase 0 vertical slice from PRD 004 (`docs/prd/004-wizmatch-staffing-operating-system.md`
§14 "Requirement parsing using the canonical tenant-aware authentication helper" and §10.8 UX trust
requirements). Directly addresses P0 defect **D-2** in `docs/reviews/wizmatch-client-funnel-audit-2026-07-12.md`.

**What changed** — one file, `admin/src/pages/WizmatchRequirementsPage.jsx`:
- Import `getAuthToken` from `../lib/auth.js`.
- `parseRequirementApi()` now reads the token via `getAuthToken()` instead of the hard-coded
  `localStorage.getItem('ge_crm_token')`. Sends the header only when a token is present. Surfaces the
  server's `error.message` (matches `apiFetch`'s dual-shape handling in `lib/api.js`).
- `runParse()` replaces three blocking `alert()` calls (empty-text, empty-file, parse-failure) with
  an inline `parseError` state rendered next to the "Parse with AI" button, with a Retry affordance.
  The rest of the drawer stays interactive.

**Why this fixes the bug** — `admin/src/lib/auth.js:9-15` gives Wizmatch tenants storage prefix
`wizmatch_crm` (so the token lives at `wizmatch_crm_token`); Growth uses `ge_crm`. The canonical
`getAuthToken()` at `auth.js:95-97` resolves the correct key per tenant, and this is exactly what
`apiFetch` at `lib/api.js:14` already does for every other authenticated call. Wizmatch-tenant
"Parse with AI" was sending `Authorization: Bearer null` and 100%-401'ing; Growth was fine but the
same helper handles both, so no Growth regression.

**Guardrails** — nothing in the "do not touch without approval" list was edited: no schema,
migrations, `auth.ts`, `rbac.ts`, `cashfree.ts`, `sodEodService.ts` Slack logic, deployment config,
env vars, prod data mutation, sending, paid-provider, or Cashfree code. Admin SPA only. No API
contract or backend behavior changed; endpoint `POST /api/wizmatch/requirements/parse` unchanged.

**Verification (local)**:
- `git diff --check` — clean.
- `git diff --stat admin/src/pages/WizmatchRequirementsPage.jsx` — 1 file, +40/-8.
- `npm run build` — exit 0 (tsc no errors).
- `npm run admin:build` — exit 0, `WizmatchRequirementsPage-*.js` rebuilt (32.49 kB).
- `npm test` — 35 files, 292/292 tests pass.
- Automated coverage note: the JSX component has no existing unit tests in the suite; the change is
  a single-branch swap of one helper and one alert-→-state replacement. A live authenticated smoke
  in a Wizmatch session is the required user-path verification and is **not** performed here (no
  deploy this session).

**What was preserved** — every other feature of the file:
requirement list/filters, `RequirementDetailDrawer`, `CandidateMatchesModal`, sheet generation,
`Save & Generate Sheet` path. The multipart bypass of `apiFetch` remains (its reason for existing is
that `apiFetch` forces JSON content-type — reaffirmed in the code comment).

**Not committed, not pushed, not deployed.** Only file modified in this session:
`admin/src/pages/WizmatchRequirementsPage.jsx`. All other dirty-worktree changes belong to prior
sessions (SEO WIP, `.ai/` planning updates, seed-script edits, PRD/handoff files) — untouched.

**Next Phase 0 candidate slice** — recommend **D-12** next: the "Send to Contact Intelligence"
success banner reads *"decision-maker discovery is queued"* but nothing is queued
(`admin/src/pages/WizmatchOperatingPages.jsx:630` per the audit). Fix is a copy change in one file
that doesn't touch any guarded path. **Do not** attempt D-1 (Contact Intelligence route
consolidation — larger and risks losing manual-add / CRM-link / cost-guard functionality per PRD §14)
or D-3 (signal scoring + hardcoded manual-signal score — backend behavior + analytics denominators;
needs a scoped plan first) without a proposal.

---

## 2026-07-10 — Wizmatch hardening bundle (RBAC + perf + SSRF/HMAC + panel) — Claude + 3 sub-agents — PR OPEN, MERGE HELD

Branch `feat/wizmatch-hardening` (off `main` @ `ea1c86e`). Driven by an in-depth
frontend-capability + performance + security review. **Not merged — PR opened, merge held for a
human go** (contains an auth/RBAC access-control change; `main` auto-deploys).

Workstreams (each built in an isolated git worktree, then integrated + re-verified by Claude):
- **S1 (Claude — `src/index.ts` + `src/routes/wizmatch.ts`):** `/api/wizmatch` now requires
  `admin`/`team_lead` (same tier gate as `/api/outbound`), applied *after* the internal-token POST
  bypass, plus a new public lane for `GET /unsubscribe`. Added `WIZMATCH_SENDING_ENABLED` master
  kill-switch on the cold-send route — sending is a code-level no-op unless it is `'true'`.
- **#2/#5 (perf agent):** new `src/services/wizmatchSignalPipeline.ts` holds `scoreSignalById` /
  `enrichSignalById` / `matchSignalById`; the score/enrich/match route handlers are now thin
  wrappers (still `requireInternalToken`) and the worker crons call these **in-process** instead of
  per-signal HTTPS self-calls (`WIZMATCH_API_BASE_URL` removed from `worker.ts`). `command-center`
  N+1 collapsed ~100 queries → 5 set-based; response shape unchanged. Extraction verified
  byte-identical vs `main` (status transitions, `candidate_match` insert, Slack alerts, `safeCron` +
  batch caps preserved).
- **#3/#6 (secure agent):** unsubscribe HMAC fails closed (no `'default-secret'` fallback) + uses
  length-guarded `crypto.timingSafeEqual`; new `src/utils/ssrfGuard.ts` blocks
  private/loopback/link-local/metadata/obfuscated-IP hosts in `normalizeDomain` + at fetch time in
  the discovery/enrichment scrapers. 14 new SSRF unit tests.
- **#4 (panel agent — `admin/src/` only):** Contact Intelligence route repointed to the
  previously-dead action-capable page (approve/reject/link-CRM/manual-contact); Dashboard step-4
  label corrected; 7 orphaned pages surfaced in the sidebar
  (Signals/Candidates/Requirements/Placements/Primes/Domains/Compliance).

**Verification (integrated tree):** `npm run build` exit 0 · `npm test` 292/292 (incl. 14 new) ·
`npm run admin:build` exit 0. Guardrail files untouched. No prod writes, no emails sent.

**Before enabling sending:** set `WIZMATCH_UNSUBSCRIBE_HMAC_SECRET` in Railway (HMAC now fail-closed)
*before* flipping `WIZMATCH_SENDING_ENABLED=true`. Post-deploy: 30-sec live smoke check of
`command-center` (the one endpoint without route-handler test coverage).

---

## 2026-07-10 — Step 33: Wizmatch demand-sourcing pipeline unblocked + new sources — Claude — DONE

Turned the "fix scrapers" ask into a minimum-cost demand-sourcing pipeline. Plan +
asset in `docs/wizmatch/DEMAND-SOURCING-PLAN.md`.

**Keystone fix (PR #30, deployed):** the worker's score/enrich/match crons AND CI scrapers POST to
the six `requireInternalToken` endpoints with only `x-internal-secret`, but the whole `/api/wizmatch`
router was behind the JWT `requireAuth` wall → every internal call 401'd, stalling the ENTIRE
pipeline (not just Dice). Carved those six POST routes past the JWT wall (`index.ts`); hardened
`requireInternalToken` to `crypto.timingSafeEqual`. Aligned CI token: set GH secret
`INTERNAL_API_TOKEN` = server `OUTREACH_INTERNAL_SECRET`. **Validated:** Dice now ingests
(`{inserted:78}`).

**New sources (this branch):**
- RemoteOK importer (`wizmatchRemoteOkImporter.ts`) — daily cron, $0 free JSON. **Validated live: 47
  signals ingested.**
- TheirStack importer (`wizmatchTheirStackImporter.ts`) — weekly cron, **dormant until
  `THEIRSTACK_API_KEY` set** (India/Naukri demand at $0, 200 free credits/mo). Field mapping is
  defensive — verify against a live payload on first run.
- Shared `wizmatchIngestClient.postSignals()` (reuses the ingest endpoint's dedup + company resolve).
- C2C scorer: `wizmatchScoring.ts` now scans job **title + description** (not just keywords) and
  flags `c2cFriendly` (corp-to-corp / 1099 / visa-open) without changing the score>=7 gate. +3 tests.

**Prod data mutation (count-first, transactional):** seeded **26 ATS boards** (24 Greenhouse + 2
Lever, all validated to return jobs) into `wizmatch_companies` via
`scripts/onboarding/wizmatch-seed-ats-boards.ts` → the existing ATS poller (daily 6 AM IST) harvests
them. Also earlier (Step 32 follow-up): reset wizmatch Kanishk password + seeded 3 templates.

**State:** prod now has Dice (78) + RemoteOK (47) demand signals; ATS boards harvest at 6 AM.
Contact discovery (free-first pattern-guess + Reacher, paid gated) auto-runs on score>=7 via the
hourly enrich cron. `npm run build` + `npm test` 278/278 green.

**Next:** user provides `THEIRSTACK_API_KEY` to wake the India importer; extend the ATS board seed
list with real client-type companies.

---

## 2026-07-10 — Step 32: Wizmatch go-live prep (access, templates, scraper truth) — Claude — DONE

**Decisions:** outreach stays manual (sending gated off); demand sourcing "fix scrapers first".

**Prod data mutations (via `railway run --service Postgres` + public DB URL, transactional, count-first):**
- Rotated the password for the existing Wizmatch-tenant admin account. The credential value is intentionally omitted; the Growth-tenant account was untouched.
- Seeded **3 starter outreach email templates** into `email_templates` for the wizmatch tenant
  (`wizmatch-intro-role`, `wizmatch-followup`, `wizmatch-value`; idempotent on (tenant_id, name)).
- One-off mutation scripts were deleted after running. This log records the action and outcome only; credential values must never be stored in repository context.

**Read-only findings (prod):** wizmatch tenant `4b3dd3e2…`; 260 candidates loaded, but demand is
thin (2 companies, 0 requirements, 2 job signals — both `scored`, scoring pipeline healthy, nothing
stuck at `new`). Pipeline "Wizmatch Placements" exists (6 stages). WhatsApp inbound **stopped
2026-06-29** (real webhook break; email replies unaffected).

**Scraper truth (dispatched both workflows):**
- **Naukri** (`wizmatch-jobspy.yml`, run 29076439988): Akamai **IP-blocks CI** — every request →
  "Access Denied / errors.edgesuite.net" before any HTML. NOT a selector bug; unfixable without a
  residential proxy / licensed feed. Header comment corrected to say so.
- **Dice** (`wizmatch-dice.yml`, run 29076678934): page renders (60 title links) but extracted 0 —
  real bug: `title = a.textContent` is empty on Dice's job-detail anchors. **Fixed**: derive title
  from anchor text → aria-label/title → nearest heading; added sharper 0-result diagnostics.
  (Validation dispatch pending on the branch.)

**Deliverable:** `docs/wizmatch/GO-LIVE-PLAYBOOK.md` — the operator SOP for Kanishk.

**Next:** validate the Dice fix via a branch dispatch; if >0 real jobs ingest, merge. Manual demand
seeding is the day-1 floor regardless.

---

## 2026-07-10 — Step 31: Wizmatch staged full-detail admin flow (Hybrid) — Claude — VERIFIED LOCALLY

**What was done**
- Replaced the compact "co-pilot / command center" theme with a staged, one-section-per-screen
  flow. Restored the orphaned full pages (routes previously redirected away from them):
  Client Discovery, Candidate Intelligence, Analytics.
- `admin/src/App.jsx`: base routes `/wizmatch/client-discovery`, `/candidate-intelligence`,
  `/analytics` now render the restored full pages (in `AppLayout`); their `-new` routes redirect
  back to base; `/wizmatch/command-center-new` redirects to `/wizmatch/dashboard`.
- `admin/src/components/navEntries.js`: the three sidebar entries repointed to the clean base
  routes.
- `admin/src/pages/WizmatchOperatingPages.jsx`: `WizmatchDashboardPage` (Home) gains a "Wizmatch
  funnel" stage-navigator card linking each stage in order — same Tailwind `card` / `primary-*`
  design system, no new frameworks.
- Contact Intelligence deliberately left on the newer `WizmatchContactIntelligenceNewPage` so the
  just-built compose + throttled/compliant send last-mile UI is preserved.
- Design decision recorded in `docs/design/wizmatch-staged-flow.md`.

**Guardrails preserved**
- Admin-UI only. No backend / `schema.ts` / migrations / auth / RBAC / Cashfree / SOD-EOD /
  deployment changes.
- Old compact `-new` pages remain in the tree (still used by `-demo` showcase routes); nothing
  deleted — can be pruned later once the staged flow is confirmed in use.

**Verification**
- API-drift check before repointing: every endpoint the restored pages call still exists in
  `src/routes/wizmatch.ts`.
- `npm run admin:build` clean; `npm test` passed: 35 files, 282 tests.

**Next**
- User reviews the restored flow in the live admin, then merge `feat/wizmatch-staged-flow`
  (stacked on `feat/wizmatch-sending`).

---

## 2026-07-09 — Step 30: Wizmatch P0 cost-safety fixes — Codex — VERIFIED LOCALLY

**What was done**
- Fast-forwarded local `main` to `origin/main` (`453b7fa`) and created
  `fix/wizmatch-cost-safety`.
- Made `findEmail` paid-provider opt-in with `opts?: { allowPaidProviders?: boolean }`; omitted
  options now skip Apollo/Snov and continue through scrape, MX guess, Reacher, and Google.
- Updated Wizmatch signal enrichment to call `findEmail` with `allowPaidProviders: false`
  explicitly, so the hourly/internal enrich route cannot drain the shared Apollo/Snov quota used by
  the manually gated paid discovery path.
- Extracted the worker domain-health cron body into `runWizmatchDomainHealthCheck`.
- Domain health now records `warn` for SPF failure, DMARC failure, or low reply rate; no
  `unhealthy` status was introduced.
- Added an all-domains-degraded Slack alert to `WIZMATCH_SYSTEM_CHANNEL`, throttled once per
  tenant per 24 hours by append-only `events.event_type = 'wizmatch_all_domains_unhealthy_alert'`.
  The marker is inserted only after Slack returns success.
- Preserved `multiDomainMailer` fallback-to-all behavior when no healthy domains match.
- Added focused regression tests for the email cascade, domain-health alert/throttle/statuses, and
  mailer fallback sending.

**Guardrails preserved**
- No schema or migration edits.
- No auth/RBAC, Cashfree, SOD/EOD Slack-DM, deployment config, or workflow schedule edits.
- Paid Contact Intelligence discovery and `wizmatchCostGuard.ts` were not changed.
- Mailer send behavior still keeps sending via configured inbox fallback when no healthy domains
  match.
- No production DB writes, no deploy, no push to `main`.

**Verification**
- `npm test -- src/__tests__/emailExtractorService.test.ts src/__tests__/wizmatchDomainHealthService.test.ts src/__tests__/multiDomainMailer.test.ts` passed: 3 files, 6 tests.
- `npm run build` passed.
- `npm test` passed: 30 files, 242 tests. Existing nested `vi.mock` warnings in
  `rankTracking.test.ts` remain.
- `git diff --check` passed.

**Next**
- Commit the branch, push `fix/wizmatch-cost-safety`, and open the PR against `main`.
- After merge/deploy, watch the next Wizmatch domain-health run for one alert if all configured
  domains are degraded; sending should continue by design.

---

## 2026-07-09 — Step 29: Wizmatch cost-leakage & relevance audit — Claude — DOCS ONLY

**What was done**
- Verified an external "Cost Leakage & Relevance Audit" brief against the actual source
  (read-only): all 9 claimed leaks + 6 open questions.
- Wrote `docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md` — graded verdicts
  (CONFIRMED / MITIGATED / REFUTED / MODEL-CORRECTION), answers to the 6 questions, a corrected
  tunable-variables reference sourced from `wizmatchCostGuard.ts`, and a prioritized P0–P2 backlog.
- Key findings: the paid Contact-Intelligence path is well-defended (cost guard + advisory lock +
  preview→confirm); the real *unmetered* spend surface is the FREE enrich Apollo/Snov cascade in
  `emailExtractorService`, which shares the paid accounts with no counter; no alert fires when all
  sending domains degrade and the mailer keeps sending anyway; the double-spend race is already
  mitigated except a narrow cross-user residual (lock key includes userId); match-cost,
  requirement-priming, draft-on-load, and env-check-ordering claims were refuted/overstated.
- User decision recorded for the domain backlog item: **alert + keep sending**.

**Guardrails preserved**
- Docs only — no product code, schema, migrations, crons, mailer, or cost-guard changes.
- No git push, no deploy, no Railway variable changes.
- Backlog items are recommendations only; nothing was implemented.

**How to verify**
- `docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md` exists; every verdict cites a
  `file:line` traceable in the doc's Evidence index.
- `git status --short` shows the new doc + `.ai/` trail edits only; unrelated dirty files
  (`.ai/AI_BRIEF.md`, `package-lock.json`) left untouched.

**What's next**
- User pulls items off the P0/P1/P2 backlog when ready. P0s: (1) meter/remove the free enrich
  Apollo/Snov cascade; (2) add an all-domains-unhealthy Slack alert.

---

## 2026-07-09 — Step 27: Wizmatch migration-journal repair + deploy — Claude — DEPLOYED

**What was done**
- Verified via authenticated `/wizmatch/readiness` that `wizmatch_requirements`,
  `wizmatch_company_intelligence`, `wizmatch_contact_candidates`, and `wizmatch_discovery_runs`
  were genuinely missing in production (matches Codex's Step 24/26 diagnosis).
- Traced `node_modules/drizzle-orm/pg-core/dialect.js`'s `migrate()` implementation directly to
  confirm the exact repair mechanics: it compares each journal entry's `when` timestamp only
  against the single most-recent applied migration's `created_at` (not per-migration hash), so a
  naive chronologically-ordered insert with earlier timestamps than the already-applied `0022`
  entry would have been silently skipped again.
- Appended three entries to `src/db/migrations/meta/_journal.json`
  (`0020_wizmatch_gin_indexes`, `0020_curvy_silverclaw`, `0021_contact_intelligence_phase2`) with
  `when` values greater than `0022_tenant_scoped_user_emails`'s, after checking the three SQL
  files for cross-dependencies (none — safe in any order).
- Verified locally: `npm run build`, `npm test` (27 files, 236 tests), `npm run admin:build`,
  `git diff --check`, `git status` confirmed diff scoped to exactly one file.
- Got explicit human approval before editing (guardrailed path) and again before pushing.
- Committed as `0f313ba` and pushed to `main`; Railway deployment `e23a4c03` reached `SUCCESS`;
  deploy logs showed `[migrate] Migration complete` with no errors.
- Re-checked `/wizmatch/readiness`: all 4 tables now show `ready`/`needs data`, 0 missing tables,
  overall status `needs migration check` → `needs data`, score 40 → 81.

**Guardrails preserved**
- Explicit human confirmation obtained before touching `src/db/migrations/` and again before push.
- No schema hand-edits — only the journal metadata file, no SQL content changed.
- No outreach sending, candidate submission, or worker/cron automation touched.
- Full local verification suite passed before push.

**Files changed**
- `src/db/migrations/meta/_journal.json`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md` regenerated

**Verification**
- `npm run build` passed.
- `npm test` passed: 27 files, 236 tests.
- `npm run admin:build` passed.
- `git diff --check` passed.
- Railway deployment `e23a4c03` reached `SUCCESS`; deploy logs showed clean migration completion.
- `/wizmatch/readiness` (authenticated, live) confirmed all 4 tables present post-deploy.

**Next**
- Set `WIZMATCH_PHYSICAL_ADDRESS`, `WIZMATCH_LEADS_CHANNEL`, `WIZMATCH_DAILY_CHANNEL`,
  `WIZMATCH_SYSTEM_CHANNEL` on Railway once values are provided.
- Run authenticated Growth/Wizmatch smoke checks with real users (still pending from Step 23/26).
- Load real requirements, vetted candidate profiles, and dispatch scrapers per
  `docs/wizmatch-daily-operations.md` now that the underlying tables exist.

## 2026-07-09 — Step 28: Env vars set + scraper CI crash fixed + smoke check — Claude — VERIFIED LIVE

**What was done**
- Set `WIZMATCH_PHYSICAL_ADDRESS` and all three Wizmatch Slack channel vars (`WIZMATCH_LEADS_CHANNEL`,
  `WIZMATCH_DAILY_CHANNEL`, `WIZMATCH_SYSTEM_CHANNEL`) on Railway's `web` service, all pointed at the
  existing BD/Sales channel (`C0AMPEF302G`) per human decision to start with one channel and split
  later if it gets noisy. Confirmed via redeploy logs: no new missing-env warnings for any of the 4.
- Ran the authenticated smoke check via direct API calls (logged in as `jatin@wizmatch.com` with
  `tenantSlug: "wizmatch"`, discarded the session token after use): `/api/wizmatch/readiness`
  (score 81, `needs_data`), `/client-discovery/queue`, `/candidate-intelligence/queue`, and
  `/review-workbench` all returned 200 with well-formed bodies. Nothing regressed post-deploy.
- Dispatched both Wizmatch scraper GitHub Actions workflows manually (as designed, manual-dispatch
  only) and found a real crash bug: `require("playwright")` failed with `MODULE_NOT_FOUND` because
  `npx playwright install --with-deps chromium` only downloads the browser, never the npm package.
  Fixed in three iterations (see CURRENT_TASK.md for full root-cause trail): missing `npm install`
  step, then an npx/local-bin version-resolution mismatch, then finally pinning to the exact
  `playwright@1.59.1` already locked elsewhere in the repo via `@playwright/test`. Both workflows
  now complete successfully.
- Found a second, separate, NOT-fixed issue: both scrapers run cleanly now but return 0 results —
  Dice and Naukri's live page selectors appear stale against current site markup. Documented as a
  known issue; not attempted this session (needs live DOM inspection of two external sites).

**Guardrails preserved**
- Explicit human approval obtained before every push (4 pushes: journal-fix docs, playwright fix
  attempt 1, attempt 2, attempt 3) and before setting Railway variables.
- Wizmatch login credentials used once via direct API call, session token discarded immediately
  after, never persisted to disk beyond a scratch temp file that was deleted.
- No schema, auth/RBAC, or Cashfree changes. No `package.json`/`package-lock.json` changes (all
  playwright installs used `--no-save`). No new automation — both scrapers remain
  `workflow_dispatch`-only; no `schedule:` trigger was added or uncommented.
- No outreach sending or candidate submission triggered by any of the above.

**Files changed**
- `.github/workflows/wizmatch-dice.yml`
- `.github/workflows/wizmatch-jobspy.yml`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md` regenerated

**Verification**
- Railway redeploy after setting env vars reached `SUCCESS`; deploy logs showed no new missing-env
  warnings for the 4 newly-set variables.
- `wizmatch-dice.yml` run `28992915263`: `SUCCESS`, logged "No Dice jobs found" (selector issue, not
  a crash).
- `wizmatch-jobspy.yml` run `28992916211`: `SUCCESS`, logged "0 jobs" for all 8 skill/city queries
  (selector issue, not a crash).
- Direct API smoke check (4 endpoints) all returned 200 with well-formed JSON.

**Next**
- Manually load real requirements + candidate profiles via the existing Candidate Profile Intake
  CSV flow (`docs/wizmatch-daily-operations.md`) — the reliable path right now, independent of the
  scraper selector issue.
- Separately, someone needs to inspect Dice.com's and Naukri.com's current search-result page DOM
  and rewrite the `page.evaluate()` selectors in both workflow files before the scrapers become a
  usable data source.

## 2026-07-07 — Step 23: Growth + Wizmatch tenant-separated CRM profile — Codex — VERIFIED LOCALLY

**What was done**
- Converted Wizmatch from a mostly separate operating surface into a tenant-separated CRM profile.
- Added Wizmatch-prefixed routes for shared CRM modules:
  Dashboard, Contacts, Pipeline, Tasks, Inbox, Billing, Finance, Email Templates, WhatsApp
  Templates, Lead Discovery, Outreach, AI Intelligence, Permissions, Audit, and Pipeline Settings.
- Changed Wizmatch home from `/wizmatch/review-workbench` to `/wizmatch/dashboard`.
- Redirected Wizmatch users who open shared Growth paths to the matching `/wizmatch/*` path.
- Kept Growth-only marketing modules out of the Wizmatch sidebar by default.
- Kept Wizmatch staffing pages visible alongside the shared CRM modules.
- Added `GET /api/wizmatch/dashboard` and the `/wizmatch/dashboard` page for live Wizmatch
  tenant summaries.
- Added `GET /api/wizmatch/intelligence` and `POST /api/wizmatch/intelligence/generate` plus the
  `/wizmatch/intelligence` page for manual Claude-powered staffing analysis.

**Guardrails preserved**
- Shared modules continue to rely on the authenticated token's `tenantId`.
- No schema, migration, package, deployment config, auto-outreach, automatic candidate submission,
  or worker/cron changes.
- Wizmatch AI Intelligence is manual-only and analyzes staffing data, not Growth marketing/SEO/ads.

**Files changed**
- `admin/src/App.jsx`
- `admin/src/lib/auth.js`
- `admin/src/components/navEntries.js`
- `admin/src/pages/WizmatchOperatingPages.jsx`
- `src/routes/wizmatch.ts`
- `public/admin/` rebuilt by `npm run admin:build`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md` regenerated

**Verification**
- `npm run build` passed.
- `npm test` passed: 24 files, 222 tests.
- `npm run admin:build` passed.

**Next**
- Manual browser validation with real Growth and Wizmatch logins: confirm shared modules show the
  correct tenant data in both profiles and that Wizmatch-specific staffing modules remain available.

## 2026-07-07 — Step 22: Facebook Lead Forms -> CRM + Slack — Codex — VERIFIED LOCALLY

**What was done**
- Added public Meta Lead Ads webhook routes:
  `GET /webhooks/meta-leads` for verification and `POST /webhooks/meta-leads` for Page
  `leadgen` events.
- Added raw-body Meta signature verification for `X-Hub-Signature-256` using `META_APP_SECRET`.
- Added `src/services/facebookLeadForms.ts` to:
  - parse leadgen webhook changes,
  - fetch lead details from Meta with the connected Facebook Page token,
  - map standard/custom lead fields,
  - create/reuse CRM contacts with `findOrCreateContact`,
  - tag contacts as `facebook_lead` and `meta_lead_form`,
  - store Facebook source metadata,
  - bump `lastActivityAt`,
  - send Slack notifications to the existing BD/Sales channel.
- Added protected Social endpoints for lead-form setup visibility and page subscription:
  `GET /api/social/lead-forms/status` and
  `POST /api/social/lead-forms/accounts/:id/subscribe`.
- Extended Facebook OAuth scopes with `pages_manage_metadata` and `leads_retrieval`.
- Added a Facebook Lead Forms setup/status card to the Social Accounts page.

**Guardrails preserved**
- No schema, migration, auto-outreach, sequence enrollment, candidate submission, paid enrichment,
  worker/cron automation, package, or deployment config changes.
- Slack failure does not block webhook success.
- Duplicate successful lead events are deduped through `processed_events`.

**Files changed**
- `src/services/facebookLeadForms.ts`
- `src/routes/webhooks.ts`
- `src/routes/social.ts`
- `src/index.ts`
- `src/__tests__/facebookLeadForms.test.ts`
- `src/__tests__/facebookLeadRoutes.test.ts`
- `admin/src/pages/SocialPage.jsx`
- `public/admin/` rebuilt by `npm run admin:build`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md` regenerated

**Verification**
- `npm test -- facebookLead` passed: 2 files, 9 tests.
- `npm run build` passed.
- `npm test` passed: 24 files, 221 tests.
- `npm run admin:build` passed.

**Next**
- Configure the Meta app webhook callback to `/webhooks/meta-leads`, subscribe selected Facebook
  Pages from the Social page, and submit one Meta Lead Ads test lead to confirm CRM contact
  creation plus Slack notification.

## 2026-07-07 — Step 21: Wizmatch page cleanup — Codex — VERIFIED LOCALLY

**What was done**
- Cleaned the Wizmatch sidebar so operators only see the newer operating/V2 pages:
  Review Workbench, Data Readiness, Client Discovery, Contact Intelligence, Candidate Intelligence,
  Requirement Priority, Guardrails, and Analytics.
- Redirected duplicated old frontend routes to the new operating pages:
  `/wizmatch/client-discovery`, `/wizmatch/contact-intelligence`,
  `/wizmatch/candidate-intelligence`, `/wizmatch/analytics`, and `/wizmatch/queue`.
- Kept `/wizmatch` routing to `/wizmatch/review-workbench`.
- Moved Candidate Profile Intake into Candidate Intelligence V2 so the manual CSV/profile intake
  workflow remains available after the classic candidate-intelligence route is hidden.
- Removed V2 page links that pointed users back to classic pages.
- Preserved direct-access classic pages that still have unique workflows: requirements, signals,
  candidate pool, domains, compliance, placements, and primes.

**Guardrails preserved**
- No backend API routes were removed.
- No database schema, migration, provider, outreach-send, candidate-submission, worker/cron, package,
  or deployment config changes.
- Paid discovery remains manual, preview-first, env-gated, and cost-guarded.

**Files changed**
- `admin/src/App.jsx`
- `admin/src/components/navEntries.js`
- `admin/src/pages/WizmatchNewPages.jsx`
- `public/admin/` rebuilt by `npm run admin:build`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md` regenerated

**Verification**
- `npm run build` passed.
- `npm test` passed: 22 files, 212 tests.
- `npm run admin:build` passed.
- Local Vite route smoke passed with HTTP 200 for:
  `/wizmatch`, `/wizmatch/readiness`, `/wizmatch/review-workbench`,
  `/wizmatch/client-discovery-new`, `/wizmatch/contact-intelligence-new`,
  `/wizmatch/candidate-intelligence-new`, `/wizmatch/requirement-priority-new`,
  `/wizmatch/guardrails-new`, `/wizmatch/analytics-new`, and redirected old routes
  `/wizmatch/client-discovery`, `/wizmatch/contact-intelligence`,
  `/wizmatch/candidate-intelligence`, `/wizmatch/analytics`, `/wizmatch/queue`.

**Next**
- If the team wants old direct-access pages fully removed later, first build V2 replacements for
  requirements CRUD/sheets, signal detail/drafting, candidate pool CRUD, domain pause/resume,
  suppression/compliance, placements/RTR, and primes.

## 2026-07-06 — Step 19: Wizmatch API cost protection — Codex — VERIFIED LOCALLY

**What was done**
- Added a reusable cost guard for paid Contact Intelligence discovery:
  - ₹5,000/month default pilot budget,
  - ₹500/day default budget,
  - 20 tenant paid runs/day,
  - 5 user paid runs/day,
  - provider daily caps for Apollo, Snov, Reacher, and Google fallback,
  - provider-env checks for Apollo/Snov/Reacher and SERPER when Google fallback is enabled.
- Cost guard reads existing `wizmatch_discovery_runs` rows; no new ledger table or migration was
  added.
- Discovery preview now includes budget readiness, remaining caps, provider env status, and exact
  blocked reasons.
- Confirmed discovery rechecks budget immediately before provider calls, requires a cost-guard
  token, and uses a Postgres advisory lock to avoid double-click duplicate provider runs.
- Confirmed blocked attempts are persisted as zero-cost `blocked_by_cap` audit rows with
  cost-guard metadata.
- Contact Intelligence V2, Guardrail Center, and Data Readiness now expose cost-control status.
- Added env knobs to `.env.example` for budget, run caps, provider caps, and provider cost
  estimates.

**Guardrails preserved**
- No automatic outreach sending.
- No automatic candidate submissions.
- No worker/cron automation changes.
- No new tables, schema edits, or migrations.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.

**Files changed**
- `src/services/wizmatchCostGuard.ts`
- `src/services/wizmatchContactDiscovery.ts`
- `src/services/wizmatchContactDiscoveryProviders.ts`
- `src/routes/wizmatch.ts`
- `src/__tests__/wizmatchCostGuard.test.ts`
- `src/__tests__/wizmatchContactDiscovery.test.ts`
- `admin/src/pages/WizmatchNewPages.jsx`
- `admin/src/pages/WizmatchOperatingPages.jsx`
- `.env.example`
- `public/admin/` rebuilt by `npm run admin:build`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md` regenerated

**Verification**
- `npx vitest run src/__tests__/wizmatchCostGuard.test.ts src/__tests__/wizmatchContactDiscovery.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
  passed: 3 files, 13 tests.
- `npm run build` passed.
- `npm run admin:build` passed.
- `npm test` passed: 21 files, 206 tests.

**Next**
- Push/deploy only after explicit approval.
- Before enabling paid discovery in any live Railway environment, validate `/wizmatch/readiness`,
  confirm Cost Controls show the expected budget/provider-env state, and run one controlled Tier A
  preview/discovery.

## 2026-07-06 — Step 18: Contact Intelligence Phase 3 preview-first discovery — Codex — VERIFIED LOCALLY

**What was done**
- Added preview-first manual paid discovery for Contact Intelligence:
  - `POST /api/wizmatch/contact-intelligence/companies/:companyId/discovery-preview`,
  - `POST /api/wizmatch/contact-intelligence/companies/:companyId/discover`,
  - dedicated provider adapters for Apollo, Snov, Reacher verification, and controlled
    SERPER-backed Google fallback,
  - eligibility/cap/cooldown logic that blocks Tier C/Reject/suppressed/cooldown/missing-domain
    companies and requires Tier B manual approval.
- Discovery execution requires `confirmPreview=true`, writes an audit row to
  `wizmatch_discovery_runs`, writes at most 3 reviewable candidates to
  `wizmatch_contact_candidates`, and updates existing company intelligence metadata/cost totals.
- Updated Contact Intelligence V2 UI with Discovery Preview, Run discovery, provider order,
  estimated cost, cap status, blocked reasons, deliverability status, and provider-result labels.
- Added env switches to `.env.example`, defaulting paid discovery and Google fallback off.
- Updated readiness/guardrail language: paid discovery is gated/manual, while auto-send,
  auto-submit, and worker/cron automation remain blocked.

**Guardrails preserved**
- No automatic outreach sending.
- No automatic candidate submissions.
- No worker/cron automation changes.
- No new tables, schema edits, or migrations.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.

**Files changed**
- `src/services/wizmatchContactDiscovery.ts`
- `src/services/wizmatchContactDiscoveryProviders.ts`
- `src/routes/wizmatch.ts`
- `src/services/wizmatchReadiness.ts`
- `src/__tests__/wizmatchContactDiscovery.test.ts`
- `src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
- `admin/src/pages/WizmatchNewPages.jsx`
- `admin/src/pages/WizmatchOperatingPages.jsx`
- `.env.example`
- `public/admin/` rebuilt by `npm run admin:build`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md` regenerated

**Verification**
- `npx vitest run src/__tests__/wizmatchContactDiscovery.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts src/__tests__/contactIntelligence.test.ts src/__tests__/wizmatchReadiness.test.ts`
  passed: 4 files, 17 tests.
- `npm run build` passed.
- `npm test` passed: 20 files, 201 tests.
- `npm run admin:build` passed.

**Next**
- Validate authenticated live `/wizmatch/readiness` and `/wizmatch/contact-intelligence-new`.
- Set provider env vars only in the intended Railway environment, then enable
  `WIZMATCH_PAID_DISCOVERY_ENABLED=true` for one controlled Tier A manual discovery.
- Keep auto-send, auto-submit, and worker/cron automation out of scope.

## 2026-07-06 — Step 17: Wizmatch data readiness + real-data UX — Codex — VERIFIED LOCALLY

**What was done**
- Added a read-only Wizmatch Data Readiness layer:
  - `GET /api/wizmatch/readiness`,
  - deterministic readiness evaluation for database connectivity, table presence, tenant-scoped
    counts, latest activity, module status, empty-state reasons, operator notes, and guarded
    blocked items,
  - authenticated `/wizmatch/readiness`,
  - no-login `/wizmatch/readiness-demo`,
  - Wizmatch sidebar entry for Data Readiness.
- Surfaced readiness status inside Review Workbench and Guardrail Center so operators can tell
  whether a page is empty because of missing data, migration state, auth/API issues, or guarded
  workflows.
- Preserved old/classic pages and all existing demo routes.

**Guardrails preserved**
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation.
- No database schema or migration changes.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.

**Files changed**
- `src/services/wizmatchReadiness.ts`
- `src/routes/wizmatch.ts`
- `src/__tests__/wizmatchReadiness.test.ts`
- `src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
- `admin/src/pages/WizmatchOperatingPages.jsx`
- `admin/src/App.jsx`
- `admin/src/components/navEntries.js`
- `public/admin/` rebuilt by `npm run admin:build`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md` regenerated

**Verification**
- `npx vitest run src/__tests__/wizmatchReadiness.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts src/__tests__/wizmatchReviewWorkbench.test.ts`
  passed: 3 files, 7 tests.
- `npm run build` passed.
- `npm test` passed: 19 files, 194 tests.
- `npm run admin:build` passed.
- Browser smoke passed for `/wizmatch-demo`, `/wizmatch/review-workbench-demo`,
  `/wizmatch/readiness-demo`, `/wizmatch/client-discovery-new-demo`,
  `/wizmatch/contact-intelligence-new-demo`, `/wizmatch/candidate-intelligence-new-demo`,
  `/wizmatch/requirement-priority-new-demo`, `/wizmatch/guardrails-new-demo`, and
  `/wizmatch/analytics-new-demo`.
- Browser interaction checks passed for Review Workbench filtering/safe action feedback,
  Requirement Priority review-plan feedback, and Data Readiness table/module content.

**Next**
- Validate the authenticated live pages against real CRM/Wizmatch records.
- Production migration/deploy decisions remain separate guarded work.

## 2026-07-06 — Contact Intelligence Phase 1 architecture ADR — Codex — READY FOR REVIEW

**What was done**
- Added `docs/decisions/ADR-002-contact-intelligence-phase1-architecture.md`.
- ADR-002 proposes the smallest safe Phase 1 implementation shape: a pure deterministic
  TypeScript service plus unit tests, with no database writes, schema changes, API routes,
  admin/client UI, worker/cron changes, provider integrations, outreach sending, package changes,
  or deployment config changes.
- The ADR keeps paid discovery disabled (`maxPaidDiscoveryPerCompany = 0`), caps visible contact
  candidates at 3, and requires explainable scoring outputs.

**Files created:** `docs/decisions/ADR-002-contact-intelligence-phase1-architecture.md`.
**Files modified:** `.ai/CURRENT_TASK.md`, `.ai/HANDOFF_LOG.md`, `.ai/AI_BRIEF.md` (regenerated).

**Not changed by this task:** no `src/`, `admin/`, `client/`, `src/db/`, API routes, schema,
migrations, Railway/Vercel config, production logic, `package.json`, or `package-lock.json`.

**Verify:** `PATH="../v2/node_modules/.bin:$PATH" npm run ai:brief` should pass. Review ADR-002
before authorizing the first code PR.
**Next:** If ADR-002 is accepted, implement only `src/services/wizmatch/contactIntelligenceService.ts`
and its unit tests in a later PR.

## 2026-07-06 — Wizmatch Contact Intelligence Phase 1 plan — Codex — READY FOR REVIEW

**What was done**
- Created a docs-only Phase 1 implementation plan for Wizmatch Contact Intelligence.
- The plan covers deterministic company qualification, zero-paid-enrichment rules, internal CRM
  reuse, manual review workflow, exact scoring components/weights, exact status transitions,
  proposed service functions, proposed tests, likely later file touchpoints, risks/guardrails,
  Codex-safe work while Claude is unavailable, and Claude-gated work.
- After the Contact Intelligence PRD branch landed on `main`, this branch was rebased onto
  `origin/main` and the `.ai/AI_BRIEF.md` / `.ai/CURRENT_TASK.md` conflicts were resolved.

**Files created:** `docs/prd/001-contact-intelligence-phase1-plan.md`.
**Files modified:** `.ai/CURRENT_TASK.md`, `.ai/HANDOFF_LOG.md`, `.ai/AI_BRIEF.md` (regenerated).

**Not changed by this task:** no `src/`, `admin/`, `client/`, `src/db/`, API routes, schema,
migrations, Railway/Vercel config, production logic, `package.json`, or `package-lock.json`.

**Verify:** `PATH="../v2/node_modules/.bin:$PATH" npm run ai:brief` should pass. Review the plan
against the hardened PRD before any implementation work.
**Next:** human/Claude review; schema, migrations, paid enrichment, API, UI, worker/cron, and
outreach changes must wait for explicit approval.

## 2026-07-06 — Step 1: AI collaboration layer setup — Claude — READY FOR CODEX REVIEW

**What was done**
- Added `AGENTS.md` (universal agent instructions) and made `CLAUDE.md` import it via `@AGENTS.md`
  plus a Claude-specific responsibilities section.
- Created the `.ai/` context layer: `AI_BRIEF.md` (auto-generated), `CURRENT_TASK.md`,
  `CURRENT_STATE.md`, `HANDOFF_LOG.md`, `TOOL_ROLES.md`, `REVIEW_CHECKLIST.md`.
- Created `docs/prd/`, `docs/decisions/`, `docs/reviews/` (each with `.gitkeep`).
- Added `scripts/generate-ai-brief.ts` and the `ai:brief` npm script (local-repo-only, no network).

**Files created:** `AGENTS.md`, `.ai/AI_BRIEF.md`, `.ai/CURRENT_TASK.md`, `.ai/CURRENT_STATE.md`,
`.ai/HANDOFF_LOG.md`, `.ai/TOOL_ROLES.md`, `.ai/REVIEW_CHECKLIST.md`,
`docs/prd/.gitkeep`, `docs/decisions/.gitkeep`, `docs/reviews/.gitkeep`, `scripts/generate-ai-brief.ts`.
**Files modified:** `CLAUDE.md` (added import + section, prior content intact), `package.json` (added `ai:brief` script).

**Not changed by this task:** no `src/`, `admin/`, `client/`, `src/db/`, `.github/`, `railway.json`,
`Procfile`, or Vercel config. No DB schema, API route, frontend UI, or business logic touched.
(Note: `src/db/migrations/meta/_journal.json` + `0020_snapshot.json` show as dirty in the tree, but
those are pre-existing uncommitted artifacts from the 2026-07-05 Wizmatch `db:generate`, unrelated to Step 1.)

**Verify:** `npm run ai:brief` regenerates `.ai/AI_BRIEF.md` successfully (exit 0).
**Next:** Codex review against `.ai/REVIEW_CHECKLIST.md`; then adopt the role loop in `.ai/TOOL_ROLES.md`.

## 2026-07-06 — Step 2/3: collaboration-protocol fixes from Codex review — Claude — READY FOR CODEX RE-REVIEW

**What was done**
Codex reviewed commit `d0ab81c` and flagged the collaboration protocol itself (not production
code) as unsafe in a few places: an unconditional `git pull origin main` startup instruction,
no explicit dirty-worktree protection, an unqualified "commit and push after each unit" default,
an overstated Railway two-service claim, and an `.ai/AI_BRIEF.md` "Current task" section that
only echoed the file's own H1 title instead of the actual task content. All five were fixed:

1. `AGENTS.md` — replaced the unconditional `git pull origin main` step with: check
   `git branch --show-current` + `git status --short` first, `git fetch origin` for freshness,
   only pull `main` when intentionally on it with a clean tree, never pull/merge/rebase over
   unrelated dirty files.
2. `AGENTS.md` — added an explicit "Dirty-worktree protection" section: preserve unrelated
   changes, never stage/commit/delete/reformat files outside the task, never run
   `git reset --hard` / `git clean` / `checkout -- .` without explicit instruction, every commit
   scoped to task-relevant files only (staged by path, not `git add -A`).
3. `CLAUDE.md` — removed the unconditional `git pull origin main` session-start line and the
   "commit and push after each coherent unit" default; replaced with: check branch/status first,
   commit only when explicitly asked or task scope calls for it, never push without explicit
   human confirmation, never push to `main` unless explicitly approved — production deploys are
   sensitive. Folded the equivalent commit-discipline bullet into `AGENTS.md`'s working agreement
   too (removed the duplicate section that edit briefly introduced).
4. `AGENTS.md` and `.ai/CURRENT_STATE.md` — reworded the Railway deployment claim from an
   assertion of two dedicated services (`web` + `worker`) to a verified/conditional statement:
   repo docs describe a single Express + Socket.io + node-cron process that can run standalone
   (`DISABLE_BACKGROUND_JOBS=true` for API-only mode); production *may* split this across
   separate Railway services if configured in the Railway UI; agents must verify actual topology
   before changing deployment/worker assumptions.
5. `scripts/generate-ai-brief.ts` — replaced `firstHeadingLines()` (which just returned the
   file's first heading, i.e. literally "CURRENT_TASK.md") with `sectionBody()`, which extracts
   the text under the `## Active task` heading in `.ai/CURRENT_TASK.md` up to the next heading.
   `.ai/AI_BRIEF.md`'s "Current task" section now shows the real task summary.

**Files modified:** `AGENTS.md`, `CLAUDE.md`, `.ai/CURRENT_STATE.md`, `scripts/generate-ai-brief.ts`,
`.ai/AI_BRIEF.md` (regenerated).

**Not changed by this task:** no `src/` (other than the pre-existing, unrelated
`src/db/migrations/meta/*` dirt already noted in the Step 1 entry above — still untouched by
this task), `admin/`, `client/`, `src/db/schema.ts`, `.github/`, `railway.json`, `Procfile`,
Vercel config, or any production logic/database schema/UI file.

**Verify:** `npm run ai:brief` ran successfully (exit 0); `.ai/AI_BRIEF.md`'s "Current task"
section now shows the actual active-task summary instead of the file title.
**Next:** Codex re-review; not pushed, not deployed.

## 2026-07-06 — Step 4: Wizmatch Contact Intelligence PRD — Codex — READY FOR REVIEW

**What was done**
- Created the first product planning artifact for the next Wizmatch build:
  `docs/prd/001-contact-intelligence.md`.
- Captured the AI collaboration workflow decision in
  `docs/decisions/ADR-001-ai-collaboration-workflow.md`.
- Saved the Codex review of the AI collaboration setup in
  `docs/reviews/codex-ai-collaboration-review.md`.
- Updated `.ai/CURRENT_TASK.md` for the Contact Intelligence PRD task.

**Planning decisions captured**
- Wizmatch Contact Intelligence remains internal-only for Growth Escalators.
- Scope is IT/Tech staffing only.
- Priority is India 80% / US 20%.
- Company qualification must happen before contact discovery.
- Paid enrichment is limited to qualified/high-priority companies.
- Manual approval remains required before outreach.
- Data model, API, and UI are proposals only; no schema, route, or UI changes were made.

**Files created:** `docs/prd/001-contact-intelligence.md`,
`docs/decisions/ADR-001-ai-collaboration-workflow.md`,
`docs/reviews/codex-ai-collaboration-review.md`.

**Files modified:** `.ai/CURRENT_TASK.md`, `.ai/HANDOFF_LOG.md`, `.ai/AI_BRIEF.md` (regenerated).

**Not changed by this task:** no `src/`, `admin/`, `client/`, `src/db/`, API routes, database
schema, migrations, Railway/Vercel config, production logic, `package.json`, or `package-lock.json`.

**Verify:** run `npm run ai:brief` (or `PATH="../v2/node_modules/.bin:$PATH" npm run ai:brief`
in a fresh worktree without `node_modules`) and review the docs/context-only diff.

**Next:** review the PRD, then create a follow-up implementation ADR before any schema/API/UI work.

## 2026-07-06 — Step 5: Contact Intelligence PRD hardening — Codex — READY FOR REVIEW

**What was done**
- Hardened `docs/prd/001-contact-intelligence.md` before any implementation work.
- Replaced the unapproved Hunter fallback with the approved/known provider order:
  Apollo -> Snov -> Reacher/email verification -> website/manual pattern -> Google fallback.
- Made Phase 1 explicitly zero-paid-enrichment: deterministic company qualification, internal CRM
  reuse, and manual review planning only.
- Reduced the MVP data model to `wizmatch_company_intelligence`, `wizmatch_contact_candidates`,
  and `wizmatch_discovery_runs`; moved relationship edges to a future enhancement.
- Added explicit status enums for company intelligence, contact candidates, and discovery runs.
- Added exact MVP cost caps and a Phase 1 MVP Build Boundary for what Codex can safely do while
  Claude is unavailable.

**Files modified:** `docs/prd/001-contact-intelligence.md`, `.ai/CURRENT_TASK.md`,
`.ai/HANDOFF_LOG.md`, `.ai/AI_BRIEF.md` (regenerated).

**Not changed by this task:** no `src/`, `admin/`, `client/`, `src/db/`, API routes, database
schema, migrations, Railway/Vercel config, production logic, `package.json`, or `package-lock.json`.

**Verify:** `PATH="../v2/node_modules/.bin:$PATH" npm run ai:brief` and review the docs/context-only
diff.

**Next:** review the hardened PRD; create an implementation ADR before schema/API/UI/worker or paid
enrichment work.

## 2026-07-06 — Step 8: Wizmatch Intelligence Command Center local build — Codex — LOCALHOST READY

**What was done**
- Built a broad read-only Phase 1 Wizmatch operating layer for local review.
- Added deterministic Command Center scoring for:
  - Client Discovery / Company Signals.
  - Contact Intelligence.
  - Candidate Intelligence.
  - Requirement Intake / fill priority.
  - Module health and manual-review command queue.
- Added a read-only `/api/wizmatch/command-center` endpoint that aggregates existing Wizmatch
  tables only.
- Added an admin Command Center page plus demo route:
  `/wizmatch/command-center-demo`.
- Preserved Phase 1 guardrails: no schema changes, no migrations, no paid enrichment, no
  auto-sending, no worker/cron changes, no package/deployment changes.

**Files changed**
- `src/services/wizmatchContactIntelligence.ts`
- `src/services/wizmatchCommandCenter.ts`
- `src/routes/wizmatch.ts`
- `src/__tests__/contactIntelligence.test.ts`
- `src/__tests__/wizmatchCommandCenter.test.ts`
- `admin/src/App.jsx`
- `admin/src/components/navEntries.js`
- `admin/src/pages/WizmatchContactIntelligencePage.jsx`
- `admin/src/pages/WizmatchCommandCenterPage.jsx`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/AI_BRIEF.md` regenerated

**Verification**
- `npx vitest --run src/__tests__/contactIntelligence.test.ts src/__tests__/wizmatchCommandCenter.test.ts`
  passed: 2 files, 9 tests.
- `npm run build` passed.
- `npm test` passed: 13 files, 177 tests.
- `npm run build` in `admin/` passed.
- `curl -I http://localhost:5174/wizmatch/command-center-demo` returned HTTP 200.

**Not changed**
- No `src/db/schema.ts`, migrations, Railway/Vercel config, `package.json`, `package-lock.json`,
  paid provider integration, worker/cron automation, or outreach send behavior changed.

**Next**
- Review localhost demo at `http://localhost:5174/wizmatch/command-center-demo`.
- If accepted, decide whether to push this local branch. Persistence/schema-backed approval
  workflow should be planned separately before any migration.

## 2026-07-06 — Step 9: Contact Intelligence review persistence slice — Codex — VERIFIED LOCALLY

**What was done**
- Started the first schema-backed Contact Intelligence persistence slice after explicit approval
  to complete items 1, 2, and 3 together.
- Added ADR-003 for the review action model, schema plan, and migration boundary.
- Added the three hardened-PRD MVP tables to `src/db/schema.ts`:
  `wizmatch_company_intelligence`, `wizmatch_contact_candidates`, and `wizmatch_discovery_runs`.
- Added SQL migration `src/db/migrations/0021_contact_intelligence_phase2.sql`.
- Added review-action transition helper in `src/services/wizmatchContactIntelligence.ts`.
- Added focused tests proving manual review transitions stay safe and paid discovery remains
  blocked by caps.

**Guardrails preserved**
- No paid enrichment/provider calls.
- No outreach sending.
- No worker/cron automation.
- No writable API routes or admin action buttons yet.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.

**Verification**
- `npx vitest --run src/__tests__/contactIntelligence.test.ts` passed: 1 file, 6 tests.
- `npm run build` passed.
- `npm test` passed: 13 files, 179 tests.
- `PATH="../v2/node_modules/.bin:$PATH" npm run ai:brief` passed.

**Next**
- Build writable API routes for manual review actions, still without paid enrichment, worker/cron
  automation, or outreach sending.

## 2026-07-06 — Step 10: Contact Intelligence points 1-11 + module plans — Codex — VERIFIED LOCALLY

**What was done**
- Completed the pending Contact Intelligence workflow through point 11:
  - reviewed current local branch and kept work local,
  - kept the approved three-table migration as the persistence boundary,
  - added persisted snapshot wiring from deterministic scoring into Contact Intelligence tables,
  - added writable manual review API routes,
  - added manual contact candidate import,
  - added explicit CRM contact linking after candidate approval,
  - updated the Contact Intelligence admin page with live review actions,
  - added an API route registration test.
- Created planning docs for the next two modules:
  - `docs/prd/002-client-discovery-plan.md`
  - `docs/prd/003-candidate-intelligence-plan.md`

**Guardrails preserved**
- No paid enrichment/provider calls.
- No outreach sending.
- No worker/cron automation.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.
- Production DB was not touched; the migration remains local until explicitly applied in an
  intended environment.

**Verification**
- `npx vitest --run src/__tests__/contactIntelligence.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
  passed: 2 files, 7 tests.
- `npm run build` passed.
- `npm run build` in `admin/` passed.
- `npm test` passed: 14 files, 180 tests.
- `PATH="../v2/node_modules/.bin:$PATH" npm run ai:brief` passed.

**Next**
- Build Client Discovery / Company Signals from `docs/prd/002-client-discovery-plan.md`, feeding
  qualified companies into Contact Intelligence.

## 2026-07-06 — Step 11: Client Discovery + Candidate Intelligence implementation — Codex — VERIFIED LOCALLY

**What was done**
- Implemented Client Discovery / Company Signals from `docs/prd/002-client-discovery-plan.md`:
  deterministic scoring service, exact Phase 1 component weights, hard blockers, queue/detail/
  qualify/handoff API routes, admin page, demo route, and tests.
- Implemented Candidate Intelligence from `docs/prd/003-candidate-intelligence-plan.md`:
  deterministic readiness/matching service, exact Phase 1 component weights, hard blockers,
  queue/detail/requirement-match/review-plan API routes, admin page, demo route, and tests.
- Wired both modules into Wizmatch navigation and React routes.
- Updated the two module PRDs with implementation status.

**Guardrails preserved**
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.
- Candidate Intelligence review remains planning-only; it does not persist candidate review state.
- Client Discovery handoff only creates/refreshes the already-approved Contact Intelligence
  snapshot/review state for hot/warm qualified companies.

**Files changed**
- `src/services/wizmatchClientDiscovery.ts`
- `src/services/wizmatchCandidateIntelligence.ts`
- `src/routes/wizmatch.ts`
- `src/__tests__/clientDiscovery.test.ts`
- `src/__tests__/candidateIntelligence.test.ts`
- `src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
- `admin/src/pages/WizmatchClientDiscoveryPage.jsx`
- `admin/src/pages/WizmatchCandidateIntelligencePage.jsx`
- `admin/src/App.jsx`
- `admin/src/components/navEntries.js`
- `docs/prd/002-client-discovery-plan.md`
- `docs/prd/003-candidate-intelligence-plan.md`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/AI_BRIEF.md`
- `.ai/HANDOFF_LOG.md`

**Verification**
- `npx vitest --run src/__tests__/clientDiscovery.test.ts src/__tests__/candidateIntelligence.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts src/__tests__/wizmatchCommandCenter.test.ts`
  passed: 4 files, 12 tests.
- `npm run build` passed.
- `npm run build` in `admin/` passed.
- `npm test` passed: 16 files, 186 tests.

**Next**
- Verify the two new localhost demo pages:
  `/wizmatch/client-discovery-demo` and `/wizmatch/candidate-intelligence-demo`.
- The next major build should be Analytics / ROI feedback loop across discovery, contact review,
  candidate readiness, requirement fill path, and placements.

## 2026-07-06 — Step 12: Analytics / ROI feedback loop — Codex — VERIFIED LOCALLY

**What was done**
- Added deterministic read-only ROI analytics service in `src/services/wizmatchRoiAnalytics.ts`.
- Added `GET /api/wizmatch/analytics/roi`, aggregating signals, Contact Intelligence review state,
  candidates, requirements, placements, and source performance.
- Updated Wizmatch Analytics admin page with:
  - ROI KPI cards,
  - operating funnel conversion,
  - module scorecards,
  - recommendations,
  - risks,
  - guardrail panel,
  - existing domain/source/pipeline sections.
- Added no-login `/wizmatch/analytics-demo`.
- Added focused ROI service tests and route registration coverage.

**Guardrails preserved**
- Read-only analytics only.
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation.
- No schema/migration changes in this slice.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.

**Files changed**
- `src/services/wizmatchRoiAnalytics.ts`
- `src/routes/wizmatch.ts`
- `src/__tests__/wizmatchRoiAnalytics.test.ts`
- `src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
- `admin/src/pages/WizmatchAnalyticsPage.jsx`
- `admin/src/App.jsx`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/AI_BRIEF.md`
- `.ai/HANDOFF_LOG.md`

**Verification**
- `npx vitest --run src/__tests__/wizmatchRoiAnalytics.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
  passed: 2 files, 3 tests.
- `npm run build` passed.
- `npm run build` in `admin/` passed.
- `npm test` passed: 17 files, 188 tests.

**Next**
- Build a unified review/action workbench that turns ROI recommendations into safe manual actions:
  contact approval, candidate shortlist planning, requirement prioritization, and safety blocker
  resolution without auto-sending.

## 2026-07-06 — Step 13: Local review + preview verification — Codex — VERIFIED LOCALLY

**What was done**
- Reviewed the local Wizmatch intelligence implementation across Contact Intelligence, Client
  Discovery, Candidate Intelligence, Command Center, and Analytics / ROI.
- Fixed Contact Intelligence manual contact handling so email/phone values use the shared CRM
  channel normalization before persistence/linking.
- Regenerated `.ai/AI_BRIEF.md` after verification.

**Guardrails preserved**
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.

**Files changed**
- `src/routes/wizmatch.ts`
- `.ai/AI_BRIEF.md`
- `.ai/HANDOFF_LOG.md`

**Verification**
- `npm run build` passed.
- `npm test` passed: 17 files, 188 tests.
- `npm run build` in `admin/` passed.
- `npm run ai:brief` passed.

## 2026-07-06 — Step 14: Wizmatch V2 admin presentation pages — Codex — VERIFIED LOCALLY

**What was done**
- Added CRM-styled V2 presentation pages for the Wizmatch operating modules:
  - Command Center,
  - Client Discovery,
  - Contact Intelligence,
  - Candidate Intelligence,
  - Analytics / ROI.
- Kept all existing classic pages and demo routes intact.
- Added separate authenticated `-new` routes and no-login `-new-demo` routes.
- Added Wizmatch sidebar entries for the V2 pages.
- V2 pages reuse existing APIs and fall back to local demo data if live data is unavailable.

**Guardrails preserved**
- Admin UI only plus AI context updates.
- No backend route/service changes.
- No database schema or migration changes.
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.
- Classic Wizmatch pages were not removed.

**Files changed**
- `admin/src/pages/WizmatchNewPages.jsx`
- `admin/src/App.jsx`
- `admin/src/components/navEntries.js`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/AI_BRIEF.md`
- `.ai/HANDOFF_LOG.md`

**Verification**
- `npm run build` in `admin/` passed.
- Browser render check passed for:
  - `/wizmatch/command-center-new-demo`
  - `/wizmatch/client-discovery-new-demo`
  - `/wizmatch/contact-intelligence-new-demo`
  - `/wizmatch/candidate-intelligence-new-demo`
  - `/wizmatch/analytics-new-demo`
- No browser page errors or console errors after fixing the V2 candidate table key warning.

## 2026-07-06 — Step 15: Wizmatch unified operating workbench — Codex — VERIFIED LOCALLY

**What was done**
- Added deterministic Requirement Priority scoring for open requirements.
- Added a unified Review Workbench service that combines Client Discovery, Contact Intelligence,
  Candidate Intelligence, Requirement Priority, and Safety blockers into one manual-action queue.
- Updated Candidate Intelligence review so reviewer intent is persisted into existing
  `wizmatch_candidates.india_specific.candidateIntelligenceReview`.
- Added backend routes:
  - `GET /api/wizmatch/review-workbench`
  - `GET /api/wizmatch/guardrails`
  - `GET /api/wizmatch/requirement-priority/queue`
  - `POST /api/wizmatch/requirement-priority/:requirementId/review-plan`
- Added CRM-styled admin pages and demo routes:
  - `/wizmatch/review-workbench-demo`
  - `/wizmatch/requirement-priority-new-demo`
  - `/wizmatch/guardrails-new-demo`
  - `/wizmatch/local-demo-flow-demo`
- Added authenticated routes and sidebar entries for the same new operating pages.

**Guardrails preserved**
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.
- No new schema or migration in this slice; candidate review state uses existing JSON metadata.

**Files changed**
- `src/services/wizmatchRequirementPriority.ts`
- `src/services/wizmatchReviewWorkbench.ts`
- `src/routes/wizmatch.ts`
- `src/__tests__/wizmatchReviewWorkbench.test.ts`
- `src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
- `admin/src/pages/WizmatchOperatingPages.jsx`
- `admin/src/App.jsx`
- `admin/src/components/navEntries.js`
- `public/admin/` rebuilt by `npm run admin:build`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/AI_BRIEF.md`
- `.ai/HANDOFF_LOG.md`

**Verification**
- `npx vitest run src/__tests__/wizmatchReviewWorkbench.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
  passed: 2 files, 3 tests.
- `npm run build` passed.
- `npm run admin:build` passed.
- Browser render checks passed for the four new demo routes with no console/runtime errors.
- Safe action button demo check passed on `/wizmatch/review-workbench-demo`.

## 2026-07-06 — Step 16: Wizmatch operating frontend polish — Codex — VERIFIED LOCALLY

**What was done**
- Improved the new Wizmatch operating pages to better match the existing CRM Fluent styling:
  tighter page chrome, guardrail strip, richer action cards, module icons, operating map,
  cost-control panels, and clearer preview links.
- Added module and priority filters to the Review Workbench.
- Added requirement review-plan action feedback on the Requirement Priority page.
- Made `/wizmatch` route to `/wizmatch/review-workbench`, with `/wizmatch-demo` as a no-login
  demo entry point.
- Reordered/renamed Wizmatch sidebar entries so Review Workbench is the primary operating page
  and V2 pages have cleaner labels.
- Added focused workbench tests proving executable actions stay scoped to safe manual Wizmatch
  endpoints and blocked safety items are not executable.

**Guardrails preserved**
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.
- No schema or migration changes in this slice.
- Classic Wizmatch pages and routes were preserved.

**Files changed**
- `admin/src/pages/WizmatchOperatingPages.jsx`
- `admin/src/App.jsx`
- `admin/src/components/navEntries.js`
- `src/__tests__/wizmatchReviewWorkbench.test.ts`
- `public/admin/` rebuilt by `npm run admin:build`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/AI_BRIEF.md`
- `.ai/HANDOFF_LOG.md`

**Verification**
- `npx vitest run src/__tests__/wizmatchReviewWorkbench.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
  passed: 2 files, 4 tests.
- `npm run admin:build` passed.
- Browser smoke checks passed for:
  - `/wizmatch/review-workbench-demo`
  - `/wizmatch/requirement-priority-new-demo`
  - `/wizmatch/guardrails-new-demo`
  - `/wizmatch/local-demo-flow-demo`
  - `/wizmatch-demo`
- Browser interaction checks passed for Review Workbench module filtering, safe action feedback,
  and Requirement Priority review-plan feedback.

## 2026-07-07 — Step 17: Candidate profile intake + daily operations SOP — Codex — VERIFIED LOCALLY

**What was done**
- Added a manual, authenticated Candidate Profile Intake flow for Candidate Intelligence.
- Added `POST /api/wizmatch/candidate-intelligence/intake`, which defaults to dry-run preview and
  requires `dryRun=false` plus `confirmImport=true` before writing.
- Added CSV/manual parsing, email/phone normalization, skill dedupe, validation, row warnings, and
  a 50-profile request cap in `src/services/wizmatchCandidateIntake.ts`.
- Reused `findOrCreateContact` so CRM contact dedupe and channel normalization remain consistent.
- Skips duplicate Wizmatch candidate records when a candidate already exists for the CRM contact.
- Scores preview/imported profiles through deterministic Candidate Intelligence.
- Added a Candidate Profile Intake panel to the classic Candidate Intelligence page with sample
  CSV, preview scores, import action, and result feedback.
- Fixed the Candidate Intelligence Shortlist action so it calls the supported `shortlist` backend
  action.
- Added `docs/wizmatch-daily-operations.md` for the daily operator workflow.

**Guardrails preserved**
- No outreach sending.
- No automatic candidate submissions.
- No paid enrichment/provider calls.
- No worker/cron automation.
- No schema or migration changes.
- No Railway/Vercel/deployment config changes.
- No `package.json` or `package-lock.json` changes.

**Files changed**
- `src/services/wizmatchCandidateIntake.ts`
- `src/routes/wizmatch.ts`
- `src/__tests__/candidateIntake.test.ts`
- `src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
- `admin/src/pages/WizmatchCandidateIntelligencePage.jsx`
- `public/admin/` rebuilt by `npm run admin:build`
- `docs/wizmatch-daily-operations.md`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/AI_BRIEF.md`
- `.ai/HANDOFF_LOG.md`

**Verification**
- `npm run build` passed.
- `npm test` passed: 22 files, 211 tests.
- `npm run admin:build` passed.

## 2026-07-07 — Step 18: Production analytics/digest resilience — Codex — VERIFIED LOCALLY

**What was done**
- After deploying candidate intake to Railway, production logs showed `/api/wizmatch/analytics/roi`
  and `/api/wizmatch/digest` could 500 when an environment is missing newer Wizmatch tables or
  columns.
- Hardened optional Wizmatch analytics stats so missing optional tables/columns return zeroed
  metrics instead of breaking the page.
- Updated daily digest job-signal status counts to use `created_at`, because `wizmatch_job_signals`
  does not have an `updated_at` column in the current schema.
- Added route-level coverage for classifying optional Wizmatch schema gaps as recoverable.

**Guardrails preserved**
- No schema or migration changes.
- No database mutation changes.
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation.
- No deployment config changes.

**Files changed**
- `src/routes/wizmatch.ts`
- `src/__tests__/wizmatchContactIntelligenceRoutes.test.ts`
- `.ai/CURRENT_STATE.md`
- `.ai/AI_BRIEF.md`
- `.ai/HANDOFF_LOG.md`

**Verification**
- `npm run build` passed.
- `npm test` passed: 22 files, 212 tests.

## 2026-07-07 — Step 19: Wizmatch shared-route smoke + product-aware links — Codex — VERIFIED LOCALLY

**What was done**
- Browser-smoked 26 Wizmatch/shared-route cases locally with mocked authenticated Growth and
  Wizmatch sessions.
- Confirmed Wizmatch users visiting `/contacts` redirect to `/wizmatch/contacts`.
- Confirmed Wizmatch `/` resolves to `/wizmatch/dashboard`.
- Tightened the frontend route guard so Growth-only sessions visiting `/wizmatch/*` redirect to
  `/dashboard` instead of falling through to `/login`.
- Added a shared `productPath()` helper for product-aware internal links.
- Updated shared UI links in Global Search, Contact Slide-In deal links, Pipeline settings links,
  and Lead Discovery import success links so Wizmatch users stay on `/wizmatch/*`.
- Wrapped `/wizmatch/emails` and `/wizmatch/discover` in `AppLayout` so they show the Wizmatch
  shell like the other shared modules.

**Guardrails preserved**
- No schema or migration changes.
- No database writes or real API calls during smoke; `/api/*` was mocked.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation.
- No deployment config changes.

**Files changed**
- `admin/src/App.jsx`
- `admin/src/lib/auth.js`
- `admin/src/components/GlobalSearch.jsx`
- `admin/src/components/ContactSlideIn.jsx`
- `admin/src/pages/LeadDiscoveryPage.jsx`
- `admin/src/pages/PipelinePage.jsx`
- `.ai/CURRENT_TASK.md`
- `.ai/CURRENT_STATE.md`
- `.ai/HANDOFF_LOG.md`

**Verification**
- `npm run admin:build` passed.
- `git diff --check` passed.
- Playwright smoke against `http://127.0.0.1:5174/` passed: 26 checks, 0 failures.
- Real tenant data verification is still pending because this session did not have local/live login
  credentials, database access, or Claude keys.

## 2026-07-08 — Step 20: Wizmatch verification + production data reality check — Codex — VERIFIED LOCALLY/READ-ONLY PROD

**What was done**
- Re-ran the full local verification suite for the current branch.
- Hit production health/readiness endpoints safely:
  - `https://api.growthescalators.com/health` returned 200 with DB ok and webhook stale.
  - `https://api.growthescalators.com/api/wizmatch/readiness` returned 401 without auth, as expected.
- Used Railway CLI read-only production Postgres access to inspect aggregate Wizmatch tenant counts
  without printing PII or mutating data.
- Browser-smoked the built admin app locally with mocked API payloads:
  - 24 Wizmatch shared/staffing routes rendered.
  - 15 Growth shared routes redirected to matching `/wizmatch/*` routes for Wizmatch users.
  - Growth-only session visiting `/wizmatch/dashboard` redirected to `/dashboard`.

**Production Wizmatch data finding**
- `wizmatch` tenant exists and is active.
- Present data:
  - 192 contacts, all `source = wizmatch_github`, `status = lead`.
  - 192 contact channels, all email, unverified.
  - 192 candidates, all `source = github`, `availability_status = available`.
  - 1 bootstrap pipeline.
  - 3 bootstrap domain-health rows.
- Empty Wizmatch operating data:
  - 0 deals, messages/inbox rows, tasks, email templates, WhatsApp templates, billing clients,
    invoices, payments, companies, job signals, placements, suppression rows.
- Missing newer production tables:
  - `wizmatch_requirements`
  - `wizmatch_company_intelligence`
  - `wizmatch_contact_candidates`
  - `wizmatch_discovery_runs`
- Conclusion: production Wizmatch is not pure dummy data because it has real-looking
  GitHub-sourced candidate/contact records, but it is not yet client-ready operating data. Real
  client discovery/contact intelligence/requirements workflows need the missing migrations,
  deployed branch code, real requirements/signals, and manual review.

**Recommended real-data path for tomorrow**
- Get explicit approval before any production migration/deploy because main auto-deploys.
- Apply required migrations/deploy only after approval.
- Manually load 5-10 real active requirements and 20-30 vetted candidate profiles.
- Confirm provider/secrets setup for existing ingestion/discovery paths, then manually dispatch
  approved scrapers/imports; do not add new cron/worker automation.
- Use Data Readiness, Client Discovery, Contact Intelligence, Candidate Intelligence, and AI
  Intelligence as manual review layers.
- Keep outreach sending and candidate submission manual-only.

**Guardrails preserved**
- No schema or migration edits.
- No production DB writes.
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation added.
- No deployment config changes.
- No push/merge to `main`.

**Verification**
- `npm run build` passed.
- `npm test` passed: 24 files, 222 tests.
- `npm run admin:build` passed.
- `git diff --check` passed.
- Playwright route smoke passed: 24 Wizmatch routes, 15 Wizmatch redirects, Growth block check,
  0 failures.

## 2026-07-08 — Step 21: Canonical product/system brief — Codex — DOCS ONLY

**What was done**
- Reviewed the existing repo documentation and code layout to identify whether a single shareable
  product brief already existed.
- Kept `CRM_SYSTEM_DOCS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/DEPLOYMENT.md`,
  `docs/URLS.md`, and Wizmatch docs as supporting technical references.
- Created `docs/PRODUCT_SYSTEM_BRIEF.md` as the canonical high-level brief that explains:
  - What the overall software system means.
  - Growth Escalators and Wizmatch as product profiles on one CRM platform.
  - Live surfaces, modules, routes, architecture, data model, integrations, AI/automation,
    user types, guardrails, current strategic state, and update ritual.
- Updated `.ai/CURRENT_TASK.md` and `.ai/CURRENT_STATE.md` so future agents know to keep this file
  current when product scope, modules, route surface, production data reality, deployment
  assumptions, or guardrails change.

**Guardrails preserved**
- Docs/context only.
- No schema or migration changes.
- No production DB writes.
- No deployment config changes.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation added.

**Verification**
- `git diff --check` passed.

## 2026-07-08 — Step 22: CRM portal error hardening — Codex — VERIFIED LOCALLY

**What was done**
- Fixed the `/wizmatch/pipeline` crash caused by Wizmatch object-based pipeline stages
  (`{ id, name, color }`) meeting string-only pipeline rendering/grouping code.
- Added shared backend/admin pipeline-stage normalization so Growth string stages and Wizmatch
  object stages both render safely.
- Hardened shared admin display/search paths against non-string API values in Pipeline, Pipeline
  Manager, Billing, Dashboard, Inbox, Links, SEO, Clients, Meta Assets, Contact drawer, and command
  palette.
- Updated the app error boundary so route changes reset the error state and the fallback includes
  the failed path plus a dashboard recovery action.
- Made Wizmatch workbench/dashboard/readiness/cost paths tolerate missing optional/newer Wizmatch
  tables where possible, returning zeroed readiness/cost fallback data instead of generic 500
  failures.
- Added regression tests for pipeline stage normalization and missing `wizmatch_discovery_runs`
  cost-guard usage.
- Updated `.ai/CURRENT_TASK.md`, `.ai/CURRENT_STATE.md`, `docs/PRODUCT_SYSTEM_BRIEF.md`, and
  regenerated `.ai/AI_BRIEF.md`.

**Guardrails preserved**
- No schema or migration edits.
- No production DB writes.
- No paid enrichment/provider calls.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation added.
- No deployment config changes.
- Untracked `node_modules` folders were not staged.

**Verification**
- `npx vitest run src/__tests__/pipelineStages.test.ts src/__tests__/wizmatchCostGuard.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts` passed.
- `npm run build` passed.
- `npm test` passed: 25 files, 227 tests.
- `npm run admin:build` passed.
- Browser smoke against local Vite with mocked authenticated sessions passed:
  - 15 Wizmatch routes rendered with production-like object-stage pipeline data.
  - 15 Growth shared routes rendered.
  - No route hit the app error boundary.
- `git diff --check` passed.

## 2026-07-08 — Step 23: Pipeline stage hardening follow-ups — Codex — VERIFIED LOCALLY

**What was done**
- Added normalized pipeline stage outcomes in the shared backend/admin helpers so persisted stage
  objects now serialize as `{ id, name, color, outcome }`.
- Preserved Growth string-stage compatibility, including substring outcome inference for custom
  names like `Deal Won 🎉` and `Client Lost - Competitor`.
- Added index-based merge protection for flattened stage saves over existing object-stage
  pipelines, preserving old `id`, `color`, and `outcome` by position.
- Updated Pipeline Manager to edit full stage objects, display `name`, key stage settings by
  `id`, and save normalized objects.
- Normalized pipeline create/PATCH payloads before persistence.
- Added `stageOutcome` to kanban stage columns and updated Pipeline drag/drop close behavior to
  consume stage outcomes instead of guessing from stage IDs or labels.
- Updated deal PATCH/add-or-update closed-date stamping and pipeline analytics to consume
  normalized stage outcomes. Wizmatch `ended` is treated as terminal success/won.
- Narrowed Wizmatch optional-schema fallbacks to allowlisted optional tables only:
  `wizmatch_requirements`, `wizmatch_company_intelligence`, `wizmatch_contact_candidates`, and
  `wizmatch_discovery_runs`.
- Made tenant slug resolution path-first so explicit `/dashboard` and `/wizmatch/*` routes beat a
  stale cross-tab `crm_active_tenant_slug` value.
- Added tests for stage helper behavior, optional-schema allowlisting, tenant path-first
  resolution, and frontend stage-outcome terminal detection.

**Guardrails preserved**
- No schema or migration edits.
- No auth/RBAC middleware edits.
- No Cashfree edits.
- No production DB writes.
- No outreach sending.
- No automatic candidate submissions.
- No worker/cron automation added.
- No deployment config changes.

**Verification**
- `npx vitest --run src/__tests__/pipelineStages.test.ts src/__tests__/wizmatchContactIntelligenceRoutes.test.ts src/__tests__/adminFrontendHelpers.test.js` passed.
- `npm run build` passed.
- `npm test` passed: 26 files, 234 tests.
- `npm run admin:build` passed.
- `git diff --check` passed.

**Still pending**
- Manual smoke with real local/staging auth and database:
  `/wizmatch/pipelines/settings` rename/save preserves untouched colors, `/wizmatch/pipeline`
  drag to `Ended` shows close modal and sets `closedAt`, and Growth custom closing stages still
  close/report correctly.

## 2026-07-08 — Step 24: Wizmatch operational readiness prep — Codex — VERIFIED LOCALLY

**What was done**
- Diagnosed the newer Wizmatch migration gap without querying or writing production DB state.
- Confirmed `origin/main` contains the newer SQL files, but
  `src/db/migrations/meta/_journal.json` skips `0020_wizmatch_gin_indexes`,
  `0020_curvy_silverclaw`, and `0021_contact_intelligence_phase2`, then jumps to
  `0022_tenant_scoped_user_emails`.
- Documented the migration-journal finding and safe human repair paths in
  `docs/wizmatch-operational-readiness.md`.
- Replaced stale `docs/WIZMATCH_DEPLOYMENT_GUIDE.md` content with current readiness guidance:
  10 source `wizmatch_*` tables, 26-file/229-test local suite result, approved provider order,
  manual-gated operations, env readiness, manual scraper dispatch, and post-deploy smoke checks.
- Added read-only `npm run wizmatch:env-check`, backed by `src/services/wizmatchEnvCheck.ts`, to
  report required/recommended/optional env-var presence without printing secret values.
- Added regression tests proving the env check redacts secret values and accepts
  `INTERNAL_API_TOKEN` as the GitHub Actions secret alias for the backend internal token.
- Made `.github/workflows/wizmatch-dice.yml` and `.github/workflows/wizmatch-jobspy.yml`
  manual-dispatch only until schedule approval, switched them to
  `RAILWAY_INTERNAL_API_URL` / `INTERNAL_API_TOKEN`, and kept them scoped to the existing protected
  `/api/wizmatch/signals/ingest` path.
- Updated `docs/wizmatch-staffing-module.md`, `.ai/CURRENT_TASK.md`,
  `.ai/CURRENT_STATE.md`, `docs/PRODUCT_SYSTEM_BRIEF.md`, and regenerated `.ai/AI_BRIEF.md`.

**Guardrails preserved**
- No schema edits.
- No migration edits.
- No production DB writes.
- No `db:migrate` run.
- No auth/RBAC/Cashfree changes.
- No outreach sending.
- No automatic candidate submission.
- No worker/cron automation enabled; scraper schedules are explicitly disabled/manual-only.
- No deployment config changes.

**Verification**
- `npx vitest --run src/__tests__/wizmatchEnvCheck.test.ts` passed: 1 file, 2 tests.
- `npm run build` passed.
- `npm test` passed: 26 files, 229 tests. Existing `rankTracking.test.ts` nested `vi.mock`
  warnings remain.
- `npm run admin:build` passed.
- `git diff --check` passed.

## 2026-07-08 — Step 25: Main integration for live deploy — Codex — VERIFIED LOCALLY

**What was done**
- Merged `codex/pipeline-stage-hardening-v2` into local `main`.
- Merged `codex/wizmatch-operational-readiness` into local `main`.
- Resolved `.ai/*` context conflicts by preserving both completed work units and regenerating the
  auto brief.
- Prepared `main` for the live push with pipeline hardening, Wizmatch readiness docs/env-check,
  manual-dispatch scraper workflows, and updated AI context.

**Guardrails preserved**
- No schema edits.
- No migration edits.
- No direct production DB writes.
- No direct `db:migrate` execution.
- No auth/RBAC/Cashfree changes.
- No outreach sending.
- No automatic candidate submission.
- No scraper schedules enabled; workflows remain manual-dispatch only.

**Verification**
- `npm run build` passed.
- `npm test` passed: 27 files, 236 tests. Existing `rankTracking.test.ts` nested `vi.mock`
  warnings remain.
- `npm run admin:build` passed.
- `git diff --check` passed.

## 2026-07-08 — Step 26: Live deploy + morning Claude handoff — Codex — DEPLOYED

**What was done**
- Pushed local `main` to `origin/main` at commit `7951c28`.
- Confirmed Railway picked up the push for the `web` service.
- Polled Railway deployment `9a253c24-f400-4c33-ae88-2ddc35000bbd` until terminal `SUCCESS`.
- Confirmed the deployed Railway start command resolved to
  `node dist/scripts/migrate.js && node dist/index.js`.
- Checked live API health:
  - `/health` responded.
  - Database check was `ok`.
  - Overall status was `degraded` only because `lastWebhook` is stale from `2026-06-29`.
- Checked live CRM root:
  - `https://crm.growthescalators.com` returned HTTP 200.
- Ran the read-only Wizmatch env readiness check through Railway without printing secret values.

**Post-deploy findings for the morning**
- Required Wizmatch env vars are present:
  `WIZMATCH_TENANT_ID`, internal token via `INTERNAL_API_TOKEN`,
  `WIZMATCH_UNSUBSCRIBE_HMAC_SECRET`.
- Recommended provider/sending vars are mostly present:
  Claude, GitHub, SerpAPI, Apollo, Snov, Reacher, Serper, Purelymail host/port/users/passwords,
  `WIZMATCH_JOBSPY_QUERIES`, and `WIZMATCH_WARMUP_CONTACTS`.
- Missing/needs human setup:
  - `WIZMATCH_PHYSICAL_ADDRESS`
  - `WIZMATCH_LEADS_CHANNEL`
  - `WIZMATCH_DAILY_CHANNEL`
  - `WIZMATCH_SYSTEM_CHANNEL`
  - GitHub Actions secrets must be confirmed separately:
    `RAILWAY_INTERNAL_API_URL` and `INTERNAL_API_TOKEN`.
- Read-only production table/count verification from local Codex could not connect because
  Railway provided only `postgres.railway.internal` and no `DATABASE_PUBLIC_URL`. Run the psql
  commands in Railway shell next.
- Railway boot logs show existing Wizmatch crons scheduled in-process because
  `WIZMATCH_TENANT_ID` is set. The current GitHub Actions scrapers remain manual-dispatch only.
- Railway boot logs also show legacy/automation warnings for `SNOVIO_API_KEY`,
  `SALESHANDY_API_KEY`, `SALESHANDY_SEQUENCE_ID`, and `PURELYMAIL_PASS_1..6`; check whether these
  are still required aliases or inactive automation noise.

**Morning DB commands for Claude/Jatin**
```bash
psql "$DATABASE_URL" -c "\dt wizmatch*"
psql "$DATABASE_URL" -c "select * from drizzle.__drizzle_migrations order by created_at desc limit 20;"
```

Confirm whether these tables exist before running real operations:
- `wizmatch_requirements`
- `wizmatch_company_intelligence`
- `wizmatch_contact_candidates`
- `wizmatch_discovery_runs`

**Guardrails preserved**
- No schema edits.
- No migration edits.
- No direct production DB writes by Codex.
- No direct `db:migrate` command run by Codex.
- No secrets printed.
- No outreach sent.
- No automatic candidate submission.
- No scraper schedules enabled.

**Verification**
- Railway deployment reached `SUCCESS`.
- API `/health` responded with database `ok`.
- CRM root returned HTTP 200.

## 2026-07-12 — Wizmatch operator-clarity plan: Workstreams B + C shipped
- **PR #37** (merged af74b59): AI Intelligence upgrade — `buildWizmatchDashboardSnapshot` enriched with row-level data (top signals, open requirements w/ skills+budget, candidate skill-supply histogram, company tier counts, recent placement margins), reuses `buildWizmatchRoiAnalytics` instead of re-deriving ROI math. Staffing rules moved into a real Anthropic `system` prompt; `max_tokens` 1800→6000. Output JSON shape unchanged, no frontend change needed.
- **PR #38** (merged 57ae14c): consolidated 4 diagnostic pages (Readiness/Guardrails/Domains/Compliance) into one tabbed `/wizmatch/system` page + new read-only `GET /api/wizmatch/env-check` route (presence-only, no secret values). Old routes redirect into the tabbed page; nav collapsed 4 entries → 1 ("System"). Added missing "add suppression entry" form to Compliance.
- Both built in parallel via isolated git worktrees (non-overlapping edit regions in `src/routes/wizmatch.ts`, confirmed by hunk-range diff + merge-tree dry run before merging). Both reviewed independently (build clean, 292/292 tests) before merge.
- Completes the A→B→C operator-clarity plan (A: PR #36, canonical funnel + declutter, shipped 2026-07-11).
- Railway deployed `57ae14c` successfully (coalesced both pushes into one deploy).
- Note: GitHub repo renamed `growth-escalators-backend-v2` → `Growth-Escalators-CRM` (same owner, auto-redirects); both pushes/deploys worked fine, no action needed but worth a sanity check next main push.

## 2026-07-12 — Client-acquisition workbench: 10 improvements (PRs #39, #40, #41)
Built in parallel via 3 isolated-worktree subagents, reviewed + merged + deployed (main b3c2435).
- **PR #41** (items 1–5): Requirements page filter bar (company/skill/experience/location/mode/region/type/priority/status), clickable rows → detail/edit drawer (uses existing PUT /requirements/:id), "Find candidates" wiring the previously-orphaned GET /candidate-intelligence/requirements/:id/matches, company qualification tier folded into requirement-priority scoring (accountQuality: A+15/B+8/C+3/Reject 0), company name + tier columns.
- **PR #39** (items 8, 10): Contact Intelligence "Open in Pipeline →" after approve+link; new on-demand candidate sourcing — POST /candidates/source-now + WizmatchSourceCandidatesPage, runs GitHub/X-Ray miners live for one skill+location (miners refactored with optional adhocQuery, cron path unchanged). SerpAPI free tier ~100/mo — one query per click.
- **PR #40** (items 6, 7, 9): Candidates location filter, real pagination (was fake — Prev disabled, Next no-op), and experience_years.
- **Migration integrity finding (important):** drizzle `db:generate` is BROKEN in this repo — meta/ snapshots stop at 0019 while SQL/journal run through 0022, so it diffs a stale baseline and emits a destructive migration (re-CREATE TABLE, DROP CONSTRAINT). Subagent correctly refused to commit it. Deploy auto-runs `node dist/scripts/migrate.js && node dist/index.js`, so a bad migration = no boot = outage. Safe path used: hand-written idempotent `ALTER TABLE wizmatch_candidates ADD COLUMN IF NOT EXISTS experience_years integer` (0023) + journal entry (migrator applies off the journal, not snapshots). Verified applied in prod deploy logs ([migrate] complete). The 0020–0022 snapshot drift is still unfixed — any future schema change must hand-write migrations until it's reconciled.

## 2026-07-13 — Wizmatch Staffing Operating System canonical brief — Codex — DOCS ONLY

**What was done**
- Added `docs/prd/004-wizmatch-staffing-operating-system.md` as the canonical future-state product
  contract for the complete company → hiring contact → requirement → candidate → submission →
  interview → placement → revenue chain.
- Captured strict funnel definitions, personas, ownership, target data contracts, state machines,
  separate scoring models, operating screens, daily/weekly workflow, SLAs, KPI formulas, illustrative
  planning scenarios, commercial formulas, phased implementation, migration/backfill requirements,
  security controls, acceptance scenarios, 30/60/90 rollout, and future concepts.
- Distinguished current source/live-audit findings from target behavior and deferred concepts.
- Linked the future-state PRD from `docs/PRODUCT_SYSTEM_BRIEF.md` and made it the next planned focus
  in `.ai/CURRENT_TASK.md` / `.ai/CURRENT_STATE.md`.

**Guardrails preserved**
- Documentation and context only; no product code changed.
- No schema, migration, auth/RBAC, deployment, environment, production data, paid-provider, sending,
  or candidate-submission action.
- No staging, commit, push, or deploy.
- Existing unrelated dirty-worktree changes were preserved.

**Verification / follow-up**
- Documentation links and formatting must be checked after regenerating `.ai/AI_BRIEF.md`.
- Next agent should start with an inspect-first gap/dependency map and the smallest safe Phase 0
  trust repair; guarded changes require a specific proposal and explicit human approval.

**Post-entry verification (same docs-only unit)**
- `npm run ai:brief` passed and regenerated `.ai/AI_BRIEF.md`.
- Required handoff/source files exist; the new PRD has no trailing whitespace.
- `git diff --check` passed for the tracked context/product-brief changes.
- Product build/test suites were not rerun because this unit changes documentation only.

## 2026-07-13 — Collision-free Claude Code handoff package — Codex — DOCS ONLY

**What was done**
- Added `docs/wizmatch/README.md` as the canonical Wizmatch documentation/source-of-truth index.
- Added `docs/wizmatch/WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md` as the single reusable Claude
  Code startup prompt.
- Added `docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md` so human-owned business, SLA,
  commercial, permission, privacy, automation, and architecture decisions remain separate from the
  product contract and are never invented by an agent.
- Added safe startup reading, source precedence, phase-gated references, restricted-path policy,
  naming rules, and the persistent context-update loop.
- Removed the byte-identical untracked PRD copy from the repository root. The only canonical PRD is
  `docs/prd/004-wizmatch-staffing-operating-system.md`.
- Updated PRD 004, the product brief, current task, and current state to link the new entry point.

**Guardrails preserved**
- Documentation/context only; no product code, schema, migration, auth/RBAC, deployment,
  environment, production data, paid-provider, sending, or candidate-submission change.
- Restricted paths were classified by filename and were not copied into the handoff.
- No staging, commit, push, PR, deployment, spend, send, or production mutation.
- Unrelated dirty-worktree files were preserved.

**Verification / follow-up**
- Regenerate `.ai/AI_BRIEF.md` and validate every new local Markdown link, whitespace, and scoped
  diff before handing off to Claude Code.

**Post-entry verification (same docs-only unit)**
- `npm run ai:brief` passed and regenerated `.ai/AI_BRIEF.md`.
- Local Markdown-link validation passed across the index, kickoff, owner-input template, PRD,
  product brief, current task, and current state.
- Confirmed exactly one `004-wizmatch-staffing-operating-system.md` remains, at the canonical
  `docs/prd/` path.
- `git diff --check` passed for tracked handoff/context changes; new Markdown files have no trailing
  whitespace.
- Product build/test suites were not rerun because this unit changes documentation/context only.

## 2026-07-13 — Wizmatch Phase 0 trust hardening — Codex — LOCAL BRANCH

**What was done**
- Created clean worktree `../v2-wizmatch-phase0-trust` on `codex/wizmatch-phase0-trust` from fresh
  `origin/main`; copied only reviewed Wizmatch/product/context paths from the original dirty tree.
- Completed honest authenticated failure states, Pipeline Retry/finally handling, development-only
  demos, current-build-only admin serving, Wizmatch-aware login return paths, and query-aware error
  boundary reset.
- Added deterministic role relevance used by ATS, Client Discovery, Contact Intelligence and manual
  seed scoring. Company vocabulary no longer supplies role fit. Added SAP/Java and false-positive
  regression fixtures plus attainable hot/warm/watch fixtures.
- Bounded AI Intelligence input/output/time and mapped provider failures to safe operator details.
- Added independent database totals to primary queues and split schema readiness from usable-funnel
  readiness. Dashboard, Workbench and Guardrails now use one canonical 30-action queue; response
  pagination reports returned cards without changing canonical summary totals.
- Preserved provider/spend/sending defaults and made no schema, migration, auth/RBAC, deployment,
  environment or production-data change.

**Verification**
- `npm run build` passed.
- `npm run admin:build` passed.
- `npm test` passed: 38 files, 318 tests.
- `npx playwright test --config=playwright.wizmatch-local.config.ts` passed: 10/10 Chromium scenarios,
  including safe AI timeout detail and query-string boundary recovery.
- Production admin bundle contains no Wizmatch demo route paths.
- `git diff --check` passed.

**Approval boundary / next work**
- Nothing was pushed or deployed and no real provider, AI, R2, sending or production write ran.
- Before editing `src/db/schema.ts` or generating Gate A migrations, require the exact owner approval
  recorded in the owner-input file. Credential rotation is a separate production-sensitive action.

## 2026-07-13 — Wizmatch Phase 1 Gate A staffing spine — Codex — LOCAL BRANCH

**What was done**
- Recorded the user’s local Gate A approval in owner inputs and accepted ADR-004 for local Gate A.
- Added one generated additive migration with durable company-contact roles, requirement-contact
  attribution, requirement assignments, append-only staffing events, task links and additive
  requirement operating fields. No migration was applied outside a disposable local database.
- Added tenant-scoped transactional services and APIs for relationship/attribution/assignment CRUD,
  requirement transitions, dated next actions, linked review-plan tasks, timelines and My Work.
- Added Company 360, Hiring Contact 360, Requirement 360, My Work and required-company workflows in
  the Wizmatch admin. Recruiter-level access is isolated to Gate A routes and does not open legacy
  signal/send/spend endpoints.

**Verification**
- Generated SQL review: no drop, rename, delete, truncate or type rewrite.
- Applied `origin/main` schema plus migration 0025 to disposable local Postgres and proved Company A:
  Person A→SAP ABAP, Person B→Java; editing B left A unchanged; duplicate relationship and second
  active primary-source constraints rejected invalid rows.
- Verified the real deployment migrator (`src/scripts/migrate.ts`) against a second disposable
  `origin/main` baseline with the prior journal timestamp: it applied only migration 0025, created
  the Gate A tables/columns and recorded timestamp `1783922500159`.
- Authenticated scratch HTTP check proved My Work, linked next-action task, accepted-stage gate and
  Requirement 360; a recruiter received 403 on legacy `/api/wizmatch/signals`.
- `npm run build`, `npm run admin:build`, `npm test` (40 files / 325 tests), Playwright (14/14) and
  `git diff --check` passed. In-app browser route navigation was blocked by the browser client; the
  original Vite process/tab was restored and automated Chromium covered the new UI paths.

**Approval boundary / next work**
- Nothing pushed, deployed, sent, spent or written to production. Migration apply, production data,
  credential rotation, push/deploy and Gate B/C schema work require separate approval.

## 2026-07-14 — Authenticated production baseline QA and preview-link repair — Codex — STAGING ONLY

**What was done**
- Authenticated to production as Kanishk through the rotated macOS Keychain item without printing or
  persisting the credential. Exercised all visible Wizmatch routes, read-only detail surfaces,
  System query tabs, deep links, refresh behavior, and representative 768px/390px layouts.
- Confirmed production APIs return real tenant totals and that the current hidden staffing routes
  remain closed. No send, provider, delete, business-state mutation, or production write ran.
- Found and fixed one P2 release-candidate UX defect: the live Readiness page advertised links to
  development-only demo routes. Added `getWizmatchPreviewLinks` and a regression test so production
  returns no preview links while local development retains them.

**Verification**
- `npm run build` passed.
- `npm test` passed: 45 files / 361 tests.
- `npm run admin:build` passed.
- Wizmatch Playwright passed: 16/16.
- `git diff --check` passed.
- Commit `1bea426` was deployed only to isolated Railway `web-staging`; deployment
  `52b4a0f3-5ac2-4882-aad8-2674d0fabeec` reached `SUCCESS` and health is green.
- Authenticated staging browser smoke proved the Readiness preview card is absent and a direct demo
  URL redirects to Dashboard without showing demo content.
- Production/staging browser sessions were signed out and the temporary mode-0600 API session file
  was removed after QA.

**Approval boundary / exact next action**
- Production remains on its old deployment; no production environment, user, migration, push,
  feature flag, document, or pilot data was changed.
- Next: obtain the separate production environment-change approval for the already reviewed safety
  bundle with all Gate A/B/C flags off. User creation, migrations, push, each gate activation, R2
  QA upload, and any later production bug-fix push remain separate gates.

## 2026-07-14 — Production Wizmatch safety-variable hardening — Codex — PRODUCTION CONFIG ONLY

**What was done**
- With exact human approval, changed only production `web` safety variables: named roster limited
  to existing Jatin/Kanishk Wizmatch IDs; pilot-all=false; Gate A/B/C server and Vite flags=false;
  sending=false; paid discovery=false; Google fallback=false; TLS verification=1.
- Did not create users, migrate, push code, activate staffing gates, upload documents, import data,
  send outreach, call paid providers, or deploy a worker.

**Verification**
- Railway deployment `346618d7-cc5a-4dbb-9225-684768801e10` redeployed unchanged commit
  `b05ac015` and reached terminal `SUCCESS`.
- Read-back confirmed exactly two roster IDs and every approved flag value.
- API health is healthy with database `ok`; CRM and ecom return HTTP 200.
- Secure Kanishk authentication returned Wizmatch/admin; authenticated readiness returned HTTP 200,
  database connected, real counts (131 companies, 293 candidates, 1 requirement), paid discovery
  false, and Google fallback false. The temporary session artifact was removed.
- Product test suites were not rerun because this unit changed Railway configuration only; the
  previously green release candidate remains unchanged locally.

**Approval boundary / exact next action**
- Obtain separate approval to provision Sneha (`team_lead`), Keshav (`staff`), and Nimisha (`staff`)
  as tenant-scoped Wizmatch users by copying their existing Growth password hashes internally, then
  expand the named roster to five IDs. Migrations, push, Gate A/B/C activation, R2 upload, and pilot
  data import remain independent later approvals.
## 2026-07-14 — Provider activation and staging qualification — Codex — STAGING VERIFIED

**What changed**
- Added SearchAPI.io as the shared named-POC and requirement-first LinkedIn X-Ray provider without
  altering Serper, SerpApi or SEO integrations.
- Added combined daily/monthly allowance evidence, account health, one-company/30-day POC reuse,
  public-evidence-only contact candidates and requirement-linked unreviewed candidate leads.
- Added real free TheirStack preview, credit validation, defensive hiring-team evidence, cursoring,
  `job_id_not` exclusion and safe status-only errors. No secret appears in source or context.
- Added bounded transient provider retry and responsive source health/operator controls.

**Verification**
- Local: build; 47 files/395 Vitest tests; admin build; 22/22 Playwright; diff check.
- Staging deployment `d3b0e543-87db-4fe3-87e2-703bebcbc350` is `SUCCESS`.
- Live capped evidence: 29 distinct relevant TheirStack signals, ATS 10-job refresh, six public POC
  candidates, and 10 requirement-linked X-Ray leads that all remain unreviewed.
- Live Signals browser passed desktop, tablet and 390px without overflow, console errors or 5xx.

**Next**
- Push `c293b88` + `142eb51`, deploy with source flags off, then progressively activate
  TheirStack → ATS/POC → requirement-first X-Ray for Jatin/Kanishk only.
