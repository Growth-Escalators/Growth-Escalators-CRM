# CURRENT_TASK.md

## Active task

**Live deploy merged pipeline hardening + Wizmatch readiness** — merge the two reviewed Codex
branches into `main`, verify the combined tree, push `main` to trigger Railway, and report the
remaining human-owned data/secrets/migration items.

Scope is **git integration, conflict resolution in AI context files, local verification, main push,
and deployment/status reporting**. This task does not hand-edit schema or migrations, does not run
`db:migrate` directly against any database, does not set secrets, does not enable scraper
schedules, does not send outreach, and does not auto-submit candidates.

## Definition of done

- [x] Merge `codex/pipeline-stage-hardening-v2` into local `main`.
- [x] Merge `codex/wizmatch-operational-readiness` into local `main`.
- [x] Resolve context-file conflicts so `.ai/*` preserves both completed work units.
- [x] Regenerate `.ai/AI_BRIEF.md`.
- [x] Run `npm run build`.
- [x] Run `npm test`.
- [x] Run `npm run admin:build`.
- [x] Run `git diff --check`.
- [x] Push `main` to `origin/main`.
- [x] Check deployment state where available.
- [x] Tell Jatin exactly which production data points/secrets/manual checks remain.

## Next task

- [ ] Human-owned: repair/apply skipped Wizmatch migrations only after DB state is checked.
- [ ] Human-owned: set Railway/GitHub secrets without printing or committing values.
- [ ] Human-owned: enable scraper schedules only after approving cadence.
- [ ] Human-owned: run authenticated Growth/Wizmatch smoke checks with real users/data.
