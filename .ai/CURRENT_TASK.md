# CURRENT_TASK.md

## Active task

**Wizmatch Operational Readiness** — prepare the repo for a human-reviewed Wizmatch data-readiness
push after portal/pipeline hardening, without applying production migrations or enabling new
automation.

Scope is **migration-gap diagnosis, stale deployment-doc cleanup, read-only environment readiness
checking, manual-dispatch scraper workflow safety, verification, and AI context updates**. This
task does not edit schema, generate migrations, run `db:migrate`, touch auth/RBAC middleware,
touch Cashfree, add worker/cron automation, auto-send outreach, auto-submit candidates, or push to
`main`.

## Definition of done

- [x] Confirmed branch baseline from latest `origin/main`.
- [x] Diagnosed why the newer Wizmatch SQL files may not apply automatically: the files exist on
  `origin/main`, but `src/db/migrations/meta/_journal.json` skips
  `0020_wizmatch_gin_indexes`, `0020_curvy_silverclaw`, and
  `0021_contact_intelligence_phase2`.
- [x] Documented the migration-journal gap and safe human repair paths in
  `docs/wizmatch-operational-readiness.md`.
- [x] Replaced stale `docs/WIZMATCH_DEPLOYMENT_GUIDE.md` content with current readiness,
  migration, env, manual workflow, and smoke-test guidance.
- [x] Removed stale provider/test/table-count guidance from the deployment guide and reflected the
  current 10-table source schema plus 26-file/229-test local suite result.
- [x] Added read-only `npm run wizmatch:env-check` support that reports presence/absence only and
  never prints secret values.
- [x] Added tests for the env-check redaction and internal-token alias behavior.
- [x] Made Dice/Naukri-style scraper workflows manual-dispatch only and switched their GitHub
  secret names to `RAILWAY_INTERNAL_API_URL` and `INTERNAL_API_TOKEN`.
- [x] Confirmed the workflows only call the existing protected
  `POST /api/wizmatch/signals/ingest` endpoint, which writes job signals/companies.
- [x] Updated `.ai/CURRENT_STATE.md`, `.ai/HANDOFF_LOG.md`, and regenerated `.ai/AI_BRIEF.md`.
- [x] Ran `npm run build`, `npm test`, `npm run admin:build`, and `git diff --check`.

## Next task

- [ ] Human decision: repair/apply the skipped Wizmatch migrations after checking production
  `drizzle.__drizzle_migrations` and `\dt wizmatch*`.
- [ ] Human decision: merge/deploy to `main` only when ready for Railway to run the startup
  command.
- [ ] Human decision: enable scraper workflow schedules only after ingest cadence is approved.
- [ ] Set real Railway/GitHub secrets manually; do not commit or print secret values.
