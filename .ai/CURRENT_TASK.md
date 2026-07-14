# CURRENT_TASK.md

## Active task

**Wizmatch results-first sourcing — Phase 1 foundation is live; ATS and free website POC discovery
are staging-qualified. Obtain the missing TheirStack and SerpAPI keys before the sequential Phase
2/4 provider activations.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

## Live production truth

- Production application commit `1112e47` is deployed as Railway deployment
  `fe6ebb85-cfe2-4a48-9d86-aa6707864e25` with terminal `SUCCESS`.
- Additive migration `0029_premium_shape.sql` applied through the startup migrator. Production now
  has 28 journal rows; `wizmatch_source_runs` exists and is empty. Pre/post counts are unchanged:
  2,812 contacts, 131 companies, 311 candidates, 1 requirement and 6,686 job signals.
- Results-first controls, run history, shared signal ingestion, signal→POC→requirement traceability,
  ATS confirmation, requirement-first X-Ray and source health UI are deployed. All four new source
  flags are off in production; a direct ATS run returns 403.
- Isolated staging passed a controlled Greenhouse run: 10 relevant signals inserted on run one,
  zero inserted/10 deduplicated on run two, POC state honestly `generic_contact_only`, and repeated
  promotion returned the same draft requirement. Desktop/mobile UI had no console/API failures.
- `THEIRSTACK_API_KEY` and `SERPAPI_API_KEY` are absent from Railway and macOS Keychain. TheirStack
  and X-Ray therefore remain fail-closed. Do not claim them active until keys are supplied securely
  and capped live staging checks pass.
- The prior controlled-launch base was `187c741`; it is now superseded by `1112e47` without changing
  Gate A/B/C access, documents, reminders or the named Jatin/Kanishk roster.
- Additive migrations `0025`–`0028` were applied. Production now has 27 migration-journal rows
  and latest migration `0028`; the count is not 29 because two old journal entries were already
  absent from this historical database. All four reviewed pending entries applied successfully.
- Gate A, Gate B and Gate C are enabled for the two-ID named roster only. Pilot-all remains false.
- The four-skill/eight-alias SAP ABAP, SAP FICO, Java and JavaScript taxonomy was seeded
  idempotently. Existing legacy candidates remain unreviewed and excluded from matching.
- A retained non-PII QA PDF proves private dedicated-bucket storage, `r2://` persistence,
  five-minute signed access and failed public/unsigned access. Do not delete that audit object.
- Staffing reminders run once in the production web process at 09:17 IST Monday–Saturday. Legacy
  Wizmatch automation, sending, paid discovery, Google fallback and provider-backed X-Ray sourcing
  remain off. There is no worker service.
- Genuine companies, contacts, requirements, candidate evidence and commercial outcomes must be
  entered manually. Do not invent or backfill unknown facts.

## Qualification evidence

- Final release suite is green: TypeScript build; 46 Vitest files / 372 tests; admin production
  build; 17/17 Wizmatch Playwright scenarios; fresh 29-entry migration apply with 81 public and
  31 Wizmatch tables; gates-off bundle check; secret scan; and `git diff --check`.
- Authenticated production browser QA used Kanishk's Keychain-held admin credential without
  printing it. All 35 visible/direct Wizmatch routes passed desktop, tablet and 390px mobile
  checks. Staffing access, My Work, delivery, analytics and readiness APIs passed; unauthenticated
  access returned 401.
- Three production defects were repaired through tests, staging and production retest:
  dedicated private document bucket (`e38bdb9`), runtime staffing navigation/route access
  (`9bbb570`) and paid-provider X-Ray suppression (`187c741`).
- Production health is green and the database reports `ok`. No production row or document was
  deleted, and no fictional business outcome was created.

## Exact next action

Securely add a staging-scoped `THEIRSTACK_API_KEY`, then run one capped 15-job India import and an
immediate deduplication rerun. Review 25 signals for relevance and only then add the key/enable
TheirStack in production. After that gate passes, activate the already-qualified ATS/POC controls
in production. Add `SERPAPI_API_KEY` only when a genuine accepted requirement is ready for the
single requirement-first X-Ray pilot.

- Heartbeat `wizmatch-15-minute-production-check` performs the 15-minute and one-hour follow-ups,
  then pauses/deletes itself.
- Cron `wizmatch-48-hour-pilot-monitor` runs read-only checks every six hours through
  `2026-07-16T06:12:00Z`, then performs the final check and pauses/deletes itself.

Do not add users, enable pilot-all, sending, Google fallback, legacy automation, automatic
submissions, broad candidate scraping or a worker. Provider activation must retain the committed
caps, audit runs, locks, human qualification and no-delete behavior.
