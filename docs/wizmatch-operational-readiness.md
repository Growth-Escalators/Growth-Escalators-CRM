# Wizmatch Operational Readiness Finding

Last updated: 2026-07-08 IST

## Summary

The newer Wizmatch SQL files are present on `origin/main`, but the Drizzle migration journal does
not list all of them. Because Railway starts the API with `node dist/scripts/migrate.js &&
node dist/index.js`, and `src/scripts/migrate.ts` delegates to Drizzle's journal-based migrator,
the skipped SQL files should not be assumed to auto-apply on the next deploy.

This is a migration-journal gap in the repo, not evidence that the table work only exists on an
unmerged feature branch.

## Evidence

`origin/main` is currently `061ca2e fix(crm): harden portal rendering and Wizmatch fallbacks`.

The source schema defines 10 `wizmatch_*` tables:

- `wizmatch_companies`
- `wizmatch_job_signals`
- `wizmatch_candidates`
- `wizmatch_placements`
- `wizmatch_domain_health`
- `wizmatch_suppression_list`
- `wizmatch_requirements`
- `wizmatch_company_intelligence`
- `wizmatch_contact_candidates`
- `wizmatch_discovery_runs`

The SQL files exist locally:

- `src/db/migrations/0019_silly_zodiak.sql`
- `src/db/migrations/0020_wizmatch_gin_indexes.sql`
- `src/db/migrations/0020_curvy_silverclaw.sql`
- `src/db/migrations/0021_contact_intelligence_phase2.sql`
- `src/db/migrations/0022_tenant_scoped_user_emails.sql`

The current `src/db/migrations/meta/_journal.json` lists `0019_silly_zodiak` and then jumps to
`0022_tenant_scoped_user_emails`. It does not list:

- `0020_wizmatch_gin_indexes`
- `0020_curvy_silverclaw`
- `0021_contact_intelligence_phase2`

Commit history explains the gap:

- `b166ec7 feat: Wizmatch US+India IT staffing module...` added `0019_silly_zodiak.sql`,
  `0020_wizmatch_gin_indexes.sql`, and only the `0019_silly_zodiak` journal entry.
- `69ee2b8 feat(wizmatch): requirement -> branded vendor sheet (backend)` added
  `0020_curvy_silverclaw.sql` but did not update the journal.
- `b320d0b feat(wizmatch): add contact intelligence review persistence` added
  `0021_contact_intelligence_phase2.sql` but did not update the journal.
- `352add5 feat(auth): separate Growth and Wizmatch logins` added
  `0022_tenant_scoped_user_emails.sql` and appended the `0022_tenant_scoped_user_emails` journal
  entry, leaving the earlier `0020`/`0021` SQL files skipped.

## Impact

Production can have the original six Wizmatch tables from `0019_silly_zodiak` while missing the
newer four operating tables:

- `wizmatch_requirements`
- `wizmatch_company_intelligence`
- `wizmatch_contact_candidates`
- `wizmatch_discovery_runs`

When those tables are missing, requirement intake, Contact Intelligence persistence, discovery-run
cost/audit tracking, and richer readiness/analytics cannot use real persisted data. Recent UI/API
fallbacks can make the absence readable, but they do not create the missing tables.

## Safe Human Next Step

Do not run production migrations from this branch automatically.

First inspect production state:

```bash
psql "$DATABASE_URL" -c "\dt wizmatch*"
psql "$DATABASE_URL" -c "select * from drizzle.__drizzle_migrations order by created_at desc limit 20;"
```

Then choose one approved repair path:

1. Repair the migration journal in a dedicated, reviewed migration-repair change, test it against a
   database clone, then let the normal Railway start command run `node dist/scripts/migrate.js`.
2. Have a database owner manually apply the existing SQL files in an approved maintenance window:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/migrations/0020_wizmatch_gin_indexes.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/migrations/0020_curvy_silverclaw.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/migrations/0021_contact_intelligence_phase2.sql
```

Use a clone/staging database first if possible. The create-table SQL is not written as
`CREATE TABLE IF NOT EXISTS`, so preflight table checks matter.
