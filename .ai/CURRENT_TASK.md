# CURRENT_TASK.md

## Active task

**Pipeline Stage Hardening Follow-ups** — protect Growth and Wizmatch CRM pipelines from stage
metadata loss, make terminal-stage behavior outcome-driven, narrow Wizmatch optional-schema
fallbacks, and make tenant selection path-first.

Scope is **pipeline stage normalization/serialization, Pipeline Manager object-stage editing,
pipeline/deal analytics and closed-date behavior, Wizmatch optional-schema allowlisting,
cross-tab tenant routing polish, tests, and AI context**. This task does not add schema,
migrations, auth/RBAC middleware changes, Cashfree changes, deployment config, worker/cron
automation, outreach sending, or automatic candidate submission.

## Definition of done

- [x] Stage helpers normalize/persist `{ id, name, color, outcome }`.
- [x] Outcome is computed in the shared normalization helpers and downstream consumers read that
  normalized outcome.
- [x] Flattened stage saves over object-stage pipelines merge by index and preserve existing
  `id`, `color`, and `outcome`.
- [x] Pipeline Manager edits full stage objects, displays `name`, keys stage settings by `id`,
  and saves normalized objects.
- [x] Pipeline create/PATCH normalize stage payloads before persistence.
- [x] Kanban stage columns expose `stageOutcome`; drag/drop close modal reads `stageOutcome`.
- [x] Deal closed-date stamping uses normalized stage outcome for PATCH and add-or-update paths.
- [x] Pipeline analytics derives open/won/lost/abandoned stage-id lists from normalized stages.
- [x] Wizmatch optional-schema fallbacks are allowlisted to known optional tables.
- [x] Tenant slug resolution prefers explicit Growth/Wizmatch paths over stale localStorage.
- [x] Focused tests added for stage helpers, optional-schema allowlist, frontend outcome helpers,
  and tenant path-first resolution.
- [x] `npm run build`, `npm test`, `npm run admin:build`, and `git diff --check` pass.
- [x] `.ai/HANDOFF_LOG.md`, `.ai/CURRENT_TASK.md`, `.ai/CURRENT_STATE.md`, and `.ai/AI_BRIEF.md`
  updated.

## Next task

- [ ] Manual smoke with a real local/staging database and auth:
  `/wizmatch/pipelines/settings` rename/save preserves untouched colors, `/wizmatch/pipeline`
  drag to `Ended` shows close modal and sets `closedAt`, and a Growth custom closing stage such
  as `Deal Won 🎉` still closes/reports as won.
- [ ] Review whether Pipeline Manager needs an explicit outcome editor before operators start
  changing stage semantics, because this pass preserves outcome on rename by design.
