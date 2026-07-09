# CURRENT_TASK.md

## Active task

**Wizmatch P0 cost-safety fixes** — implement the two audit-confirmed P0s on
`fix/wizmatch-cost-safety`, then open a PR against `main`.

Scope is narrow: stop the free/internal enrich path from consuming shared Apollo/Snov quota, and
alert when all configured Wizmatch sending domains degrade while preserving the mailer's
fallback-to-all sending behavior.

## Definition of done

- [x] Local `main` fast-forwarded to `origin/main` (`453b7fa`) and branch
  `fix/wizmatch-cost-safety` created.
- [x] `findEmail` now takes `opts?: { allowPaidProviders?: boolean }`, defaulting to paid providers
  disabled.
- [x] Apollo/Snov steps in `emailExtractorService` run only when `allowPaidProviders === true`.
- [x] Wizmatch internal signal enrichment calls `findEmail(..., { allowPaidProviders: false })`
  explicitly.
- [x] Domain-health cron logic extracted into a testable service.
- [x] Domain health now uses SPF/DMARC failures and low reply rate as warn reasons, without adding
  an `unhealthy` status.
- [x] All-degraded domains post one actionable Slack alert to `WIZMATCH_SYSTEM_CHANNEL`, throttled
  by append-only `events.event_type = 'wizmatch_all_domains_unhealthy_alert'` once per 24 hours.
- [x] Mailer fallback-to-all behavior is unchanged and covered by a regression test.
- [x] No schema/migration/auth/RBAC/Cashfree/SOD-EOD/deployment/workflow-schedule edits.
- [x] Targeted tests passed:
  `npm test -- src/__tests__/emailExtractorService.test.ts src/__tests__/wizmatchDomainHealthService.test.ts src/__tests__/multiDomainMailer.test.ts`
- [x] `npm run build` passed.
- [x] `npm test` passed: 30 files, 242 tests. Existing nested `vi.mock` warnings in
  `rankTracking.test.ts` remain.
- [x] `git diff --check` passed.

## Cost/relevance audit (2026-07-09, docs-only)

- [x] Verified an external "Cost Leakage & Relevance Audit" brief against source and wrote
  `docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md` (verdicts + 6-question answers +
  corrected tunables + P0–P2 backlog). No code changed. See HANDOFF_LOG Step 29. The two P0
  backlog items to pick up when ready: (1) meter/remove the free enrich Apollo/Snov cascade in
  `emailExtractorService` (shares paid accounts, unmetered); (2) all-domains-unhealthy Slack alert
  in the domain-health cron (decision: alert + keep sending).

## Next task

- [x] Verified production Wizmatch table presence via authenticated `/wizmatch/readiness`
  (2026-07-09 IST): confirmed `wizmatch_requirements`, `wizmatch_company_intelligence`,
  `wizmatch_contact_candidates`, `wizmatch_discovery_runs` were genuinely missing.
- [x] Repaired the skipped `0020`/`0021` Wizmatch migrations: added the three missing entries to
  `src/db/migrations/meta/_journal.json` (commit `0f313ba`), verified locally
  (`npm run build`, `npm test` 27/236, `npm run admin:build`, `git diff --check`), pushed to
  `main` with explicit approval, confirmed Railway deploy `e23a4c03` reached `SUCCESS`, and
  re-checked `/wizmatch/readiness` — all 4 tables now show `ready`/`needs data` (0 missing tables,
  score 40 → 81).
- [x] Set missing Wizmatch operational variables (2026-07-09 IST): `WIZMATCH_PHYSICAL_ADDRESS` and
  all three Slack channel vars set to the existing BD/Sales channel (`C0AMPEF302G`) to start;
  Railway redeploy `9869d19d` reached `SUCCESS` with no new missing-env warnings.
- [x] Ran authenticated Wizmatch smoke check (2026-07-09 IST): logged in as `jatin@wizmatch.com`
  via `/auth/login` with `tenantSlug: "wizmatch"`, confirmed `/api/wizmatch/readiness` (score 81,
  `needs_data`), `/client-discovery/queue`, `/candidate-intelligence/queue`, and
  `/review-workbench` all return 200 with well-formed bodies. Session token discarded after use.
- [x] Fixed a real CI crash bug in both scraper workflows (2026-07-09 IST, commits `ead410a`,
  `b4966bb`, `b87fa5e`): `npx playwright install --with-deps chromium` only downloaded the
  Chromium *browser*, never installed the `playwright` *npm package*, so `require("playwright")`
  crashed with `MODULE_NOT_FOUND` on every dispatch. Root cause after two more failed attempts:
  the repo's `package-lock.json` already pins `playwright@1.59.1` via `@playwright/test`; an
  unpinned `npm install playwright` fetched npm's current `latest` (`1.61.1`) fresh at the top
  level while `node_modules/.bin/playwright` resolved to the pre-existing nested `1.59.1` copy via
  hoisting, so the browser build downloaded didn't match what `require()` loaded at runtime.
  Pinned both workflows to `playwright@1.59.1` explicitly; both `wizmatch-dice.yml` and
  `wizmatch-jobspy.yml` now run to completion successfully.
- [ ] **Known issue, not fixed**: both scrapers now run without crashing but find 0 results —
  `wizmatch-dice.yml` logged "No Dice jobs found"; `wizmatch-jobspy.yml` (Naukri) logged "0 jobs"
  for all 8 skill/city queries. The CSS selectors used to parse Dice.com/Naukri.com search-result
  pages appear stale against the sites' current markup (the Naukri workflow's own file header
  already flagged this as a maintenance risk). Needs live selector inspection against the current
  DOM of both sites — out of scope for this session; scrapers are not currently a usable real-data
  source until selectors are rewritten.
- [ ] Load real Wizmatch requirements, candidates, companies, job signals, and reviewed contact
  candidates before any client-facing use. Given the scraper selector issue above, the reliable
  path right now is manual Candidate Profile Intake (CSV) plus manual requirement entry, per
  `docs/wizmatch-daily-operations.md`.
