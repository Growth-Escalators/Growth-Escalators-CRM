# CURRENT_TASK.md

## Active task

**Morning Claude handoff after live deploy** — leave the repo ready for the next Claude Code
session to continue from the deployed state without needing chat history.

Scope is **context-only handoff**: record what was deployed, what Railway reported, what local/live
checks passed, and which data/secrets/manual decisions remain. This task does not edit product
code, schema, migrations, auth/RBAC middleware, Cashfree, deployment config, worker/cron schedules,
or production data.

## Definition of done

- [x] `main` contains both merged branches:
  `codex/pipeline-stage-hardening-v2` and `codex/wizmatch-operational-readiness`.
- [x] `main` pushed to GitHub at `7951c28`.
- [x] Railway `web` deployment `9a253c24-f400-4c33-ae88-2ddc35000bbd` reached `SUCCESS`.
- [x] Live API health responded; database check was `ok`.
- [x] CRM root responded HTTP `200`.
- [x] Railway env readiness check ran without printing secrets.
- [x] Remaining human/data items are recorded in `.ai/CURRENT_STATE.md` and `.ai/HANDOFF_LOG.md`.
- [x] `.ai/AI_BRIEF.md` regenerated for Claude Code.

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
