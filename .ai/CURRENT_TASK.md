# CURRENT_TASK.md

## Active task

**None in flight as of 2026-07-12.** Everything requested in the 2026-07-12 session is shipped to
`main` and deployed (Railway `web` all SUCCESS). Pick the next item from "Open follow-ups" below.

### Last completed (2026-07-12) — Wizmatch client-acquisition workbench + repo hardening
All on `main` (latest `6d659ec`), each verified (build + 292 tests) and deployed:
- **PR #33** security/perf hardening (RBAC gate on `/api/wizmatch`, in-process crons, SSRF/HMAC).
- **PRs #34–36** contact auto-tags + status chips + streamlined drawer; Review Workbench clarity;
  Workstream A (one canonical funnel order, clearer clicks, decluttered daily pages).
- **PRs #37–38** Workstream C (AI Intelligence reads row-level staffing data + system prompt,
  tokens 1800→6000) and Workstream B (single `/wizmatch/system` page, 5 tabs, `GET /env-check`).
- **Contact drawer** now surfaces the full candidate / client-lead / company detail that was in the
  DB but invisible (GitHub/LinkedIn/skills/visa/rate/experience; title/role/confidence/deliverability;
  company domain/industry/ATS/H-1B + qualification tier). D2C-only fields hidden for Wizmatch contacts.
- **PRs #39–41** on-demand candidate sourcing (`POST /candidates/source-now` + Source Candidates
  page, live GitHub/X-Ray for one skill+location) + Contact-Intel "Open in Pipeline →";
  Requirements filter bar + detail/edit drawer + "Find candidates" + company-tier priority scoring;
  Candidates location filter + real pagination + `experience_years` column.
- **PR #40 migration**: `experience_years` shipped via a hand-written idempotent `ADD COLUMN IF NOT
  EXISTS` migration (drizzle-generate was broken at the time — now fixed by #42).
- **PR #42 db tooling fix**: repaired the drizzle snapshot baseline (`meta/0024_snapshot.json`) so
  `npm run db:generate` works normally again. Verified: generate reports "No schema changes"; a
  test column yields one clean `ALTER`. Snapshot-only, runtime-no-op change.

## Open follow-ups (not started — pick up when ready)
- **Load real Wizmatch data before client-facing use.** Reliable paths today: manual Candidate
  Profile Intake (CSV) + manual requirement entry + the new on-demand Source Candidates page.
  (Dice/Naukri GitHub-Actions scrapers still return 0 results — stale CSS selectors, see history.)
- **Reconcile historical `0020–0023` drizzle snapshots** (optional, low priority): only the latest
  snapshot matters for `generate` and it's now correct, so this is audit-hygiene only.
- **On-demand GitHub sourcing, multi-word skills**: `language:<skill>` takes a single token
  (java/python/react); multi-word skills need the X-Ray provider. UI hint covers it; could improve.
- **Two P0 cost items from the 2026-07-09 audit** (`docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md`):
  (1) meter/remove the free Apollo/Snov enrich cascade in `emailExtractorService`; (2) all-domains-
  unhealthy Slack alert in the domain-health cron. Confirm current status before acting.

## Dirty working tree — someone else's WIP (NOT this session's work; do not commit/discard without the human)
- `package.json`/`package-lock.json` add `googleapis` for SEO work; modified SEO/seed scripts
  (`scripts/seo-doctor.ts`, `test-seo-system.ts`, `src/scripts/seed*.ts`, `addSneha.ts`) + an n8n
  workflow + `docs/seo/*`.
- Untracked: `.agents/`, `.codex/`, `SECRETS-ROTATION.md` (**review before ever committing — may hold
  secrets**), `docs/seo/state/`, `docs/reviews/wizmatch-client-funnel-audit-2026-07-12.md`, and SEO
  scripts (`ge-seo-pull.ts`, `mint_seo_refresh_token.py`, `offboard-clients.ts`).
- Generated junk (`graphify-out/`, `__pycache__/`) is now gitignored so it no longer clutters status.
