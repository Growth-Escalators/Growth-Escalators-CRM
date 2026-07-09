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
- [ ] Set missing Wizmatch operational variables/channels: `WIZMATCH_PHYSICAL_ADDRESS`,
  `WIZMATCH_LEADS_CHANNEL`, `WIZMATCH_DAILY_CHANNEL`, `WIZMATCH_SYSTEM_CHANNEL`.
- [ ] Run authenticated Growth/Wizmatch smoke checks with real users.
- [ ] Load real Wizmatch requirements, candidates, companies, job signals, and reviewed contact
  candidates before any client-facing use.
