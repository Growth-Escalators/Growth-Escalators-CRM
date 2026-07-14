# CURRENT_TASK.md

## Active task

**Wizmatch Staffing OS — the safe-automation release candidate is fully qualified locally and on
isolated staging. The next guarded action is applying additive production migrations 0025–0028
with all staffing gates off.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

## Exact release candidate

- Commit `1ceada3` separates Wizmatch automation in the existing in-process web scheduler:
  `WIZMATCH_LEGACY_AUTOMATION_ENABLED` defaults off and controls all sourcing, enrichment,
  warmup, ATS, scraper, importer and digest jobs; `WIZMATCH_STAFFING_AUTOMATION_ENABLED` defaults
  off and permits only deterministic reminders when Gate C is also enabled.
- Staffing reminders remain at 09:17 IST Monday–Saturday. They create deduplicated tasks and
  append-only staffing events only; they do not send, submit or call providers.
- System / Readiness now reports non-sensitive execution, staffing-reminder, legacy-automation,
  sending and next-schedule status.
- Local verification is green: TypeScript build, 46 files / 368 Vitest tests, admin production
  build, 16/16 Playwright, gates-off production-router check, fresh 29-entry migration journal
  apply (81 public tables / 31 Wizmatch tables), and `git diff --check`.

## Staging qualification

- Exact commit `1ceada3` is live only on isolated `web-staging`. Deployment
  `a5ed6f3c-dccb-4add-86e2-17ec9046f204` reached `SUCCESS`; the tenant-variable redeploy
  `9f20e84c-952e-4f48-9f2e-8373528144b7` also reached `SUCCESS`.
- Staging health is green. Logs prove one in-process staffing-reminder schedule, legacy Wizmatch
  automation skipped, sending off, and no separate worker.
- Authenticated browser QA passed My Work, Relationships, Requirements, Talent Matching,
  Delivery, Placements, Analytics and System/Readiness. No page alerts, console errors or desktop/
  390px overflow were found. Readiness reports `web-in-process`, reminders true, legacy false,
  sending false and the correct schedule.
- Two manual reminder invocations returned zero work twice. Unit coverage separately proves open-
  task duplicate suppression. The staging session was signed out and its ephemeral password file
  removed.
- The previously completed staging role matrix and complete fictional Gate A→B→C commercial chain
  remain valid; this release changed only automation gating and readiness presentation.

## Production read-only truth

- Production is healthy on old commit `b05ac015`, deployment
  `346618d7-cc5a-4dbb-9225-684768801e10`; API, CRM and ecom are HTTP 200 and the database is `ok`.
- Topology is one `web` replica plus Postgres; no worker service exists.
- The journal has 23 rows and latest timestamp `1783420000004`, proving the only later journal
  entries are reviewed additive migrations 0025–0028. Gate A/B/C tables are absent as expected.
- Existing counts are 2,812 contacts, 131 Wizmatch companies, 311 candidates and one retained
  audit-test requirement. Production data was read only and nothing was deleted.
- The rise from 293 to 311 candidates is explained by the old production build's still-active
  legacy GitHub miner, which logged 18 candidates created. The reviewed release stops this block by
  safe default while preserving non-Wizmatch Growth CRM jobs.
- Jatin and Kanishk remain the only named pilot users and both remain admins. Do not provision any
  additional user. Genuine records must be entered manually; do not infer historical facts.
- Production safety variables remain: pilot-all false; A/B/C server+Vite flags off; sending, paid
  discovery and Google fallback off; TLS verification on. R2 credentials are present but no QA
  object exists. The two new automation variables are absent, which is safely equivalent to false
  in `1ceada3`.

## Next guarded sequence

1. Obtain exact approval to apply only production migrations 0025–0028 with every staffing gate
   and staffing automation off.
2. Verify journal, constraints, indexes, unchanged legacy counts, then run the official count-only
   staffing backfill preview. Preserve/exclude the audit-test requirement.
3. Obtain separate approval to push the exact reviewed branch to `main`; wait for Railway terminal
   `SUCCESS`, then smoke production with gates off.
4. Obtain separate approvals for Gate A, Gate B/taxonomy, retained non-PII R2 QA upload, and Gate C
   plus staffing automation. Do not create fictional production outcomes.
5. Declare live only for Jatin/Kanishk after Gate C smoke; monitor for 48 hours.

Never push, migrate, change production flags, upload, seed or write genuine production data without
the corresponding point-of-execution approval. Never delete production data or documents.
