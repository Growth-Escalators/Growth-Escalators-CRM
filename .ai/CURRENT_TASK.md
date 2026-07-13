# CURRENT_TASK.md

## Active task

**Wizmatch Staffing Operating System — Phase 1 Gate A implemented and verified locally as of 2026-07-13. Worktree:
`../v2-wizmatch-phase0-trust`; branch: `codex/wizmatch-phase0-trust`. Nothing pushed, deployed,
sent, spent, migrated, or written to production.**

Canonical product contract:
[`docs/prd/004-wizmatch-staffing-operating-system.md`](../docs/prd/004-wizmatch-staffing-operating-system.md).

Claude Code entry point:
[`docs/wizmatch/README.md`](../docs/wizmatch/README.md) →
[`WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md`](../docs/wizmatch/WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md).
Human-owned decisions live in
[`WIZMATCH_STAFFING_OS_OWNER_INPUTS.md`](../docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md)
and must not be invented by an agent.

The target chain is: company → named hiring contact → confirmed requirement → candidate match →
recruiter shortlist → consent/RTR → submission → interview → offer → joining/placement → invoice,
revenue, and margin. The PRD also preserves future concepts without putting them into the MVP.

Current remediation status is canonical in
[`WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md`](../docs/wizmatch/WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md).

**Current verified slice:** D-1–D-7, D-9–D-15, D-19–D-21,
D-26–D-31 are locally verified. D-13 and D-15 are now locally verified through Gate A. D-18 still
requires live configuration evidence; D-17/D-22/D-24/D-25 require later storage, commercial or
infrastructure gates. See the defect register for the exact evidence and
next action for every item.

**Implemented locally in the current Phase 0 candidate bundle:**

- **D-1:** the canonical Contact Intelligence page now preserves review/manual-add/CRM-link/Pipeline
  workflows while adding read-only discovery preview, explicit cost acknowledgement, confirmed
  manual discovery, and honest authenticated error/Retry behavior. No provider was called and no
  provider/env/budget setting changed.
- **D-2:** requirement parsing uses canonical `apiFetch(FormData)`. Focused tests prove Wizmatch
  token selection, browser multipart handling, and tenant-specific 401 session cleanup. Validation
  and real parse failures have distinct inline feedback; Retry appears only for request failures.
- **D-9/D-10/D-11:** CRM-linked hiring contacts receive Client Lead/company/provenance classification
  on both create and dedup paths; shared Contacts search matches full name and tenant-scoped channel
  values; disabled outcome cards no longer consume the Review Workbench action queue.
- **D-12, D-14, D-20, D-21, D-23:** truthful Contact Intelligence handoff copy, useful
  Requirement Priority empty state, accurate Open Tasks helper, canonical dashboard work order, and
  plain-language CRM-link results.
- **D-3/D-4/D-5/D-7:** manual signals use deterministic scoring; ATS ingestion accepts explicit
  IT-role evidence only; company vocabulary is separate from role fit; SAP ABAP/FICO, Java and
  JavaScript plus known false-positive fixtures pass; hot/warm/watch are all attainable.
- **D-6/D-8/D-19:** AI analysis is bounded to 40 KB/1,500 tokens/20 seconds with safe failure
  details; four primary queue endpoints return true database totals plus returned counts; the same
  canonical server-side action queue supplies Dashboard/Workbench/Guardrails totals; readiness
  separates schema health from usable-funnel health.
- **D-26–D-31:** authenticated outages never substitute demo records or enable dependent actions;
  Pipeline has Retry/finally behavior; demo routes are development-only; the server requires a
  current admin build; login preserves Wizmatch/return path; query-string tabs reset boundaries.
- Local Playwright coverage uses an isolated port 5184 clean-branch Vite server: **10/10 passed**.
- Full local verification: `npm run build`, `npm run admin:build`, `npm test` (**38 files / 318
  tests**), Playwright **10/10**, production-bundle demo-route absence, and `git diff --check` passed.
- Persistent context was hardened: canonical defect register, corrected dataflow/product brief,
  proposed ADR-004 + Phase 1 plan, improved Claude kickoff, and current-tree credential redaction.

**Security approval required:** a plaintext login credential existed in committed history and four
tracked files. The current working tree redacts/removes it and the onboarding script now requires
secure env injection. The live credential has **not** been rotated and Git history has **not** been
rewritten. Rotation is the essential containment step but requires explicit production-mutation
approval; history remediation is a separate coordinated decision.

**Gate A local implementation complete:** ADR-004 Gate A approval is recorded in
`WIZMATCH_STAFFING_OS_OWNER_INPUTS.md`. The branch includes the additive schema/migration,
transactional relationship/attribution/assignment/task/timeline APIs, Company/Hiring Contact/
Requirement 360 and My Work. Migration apply, production data, push and deployment remain unapproved.

**Exact next step:** review the scoped local Gate A commits, then separately approve or reject
migration application. After an approved scratch/staging rollout and authenticated smoke, prepare
the Gate B canonical-skills/matching proposal; do not begin Gate B schema work by implication.

### Last shipped product unit (2026-07-12) — Wizmatch client-acquisition workbench + repo hardening
All on `main` (product changes through `6d659ec`; current repo head `ba4be81` adds context/gitignore
housekeeping), each verified (build + 292 tests) and deployed:
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

## Worktree discipline

This branch was created from fresh `origin/main` in a separate clean worktree. The original
`/Users/jatinagrawal/repo-comparison/v2` dirty workspace remains untouched and must not be used for
staging this branch. Local `node_modules` symlinks are setup-only and must be removed before staging.
Gate A intentionally edits `src/db/schema.ts` and adds one generated migration under the recorded
approval. Auth/RBAC/payment/Slack/deployment files remain untouched.

Never use `git add .`/`git add -A`. Re-run `git status --short` immediately before any staging.
