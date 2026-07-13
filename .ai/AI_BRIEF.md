# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-13T06:53:12.782Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: Growth-Escalators/Growth-Escalators-CRM
- **Branch**: `codex/wizmatch-phase0-trust`
- **Last commit**: 5e733a6 chore(ai): hand off Wizmatch Gate A (3 minutes ago)
- **Uncommitted changes**: 2 file(s)

## Current task

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

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
5e733a6 chore(ai): hand off Wizmatch Gate A
b43017e feat(admin): add Wizmatch staffing workspaces
14b51f5 feat(wizmatch): implement Gate A staffing operations
8cd20c6 feat(wizmatch): add Gate A staffing schema
0a8931d chore(ai): finalize phase zero handoff
55165fd docs(wizmatch): close phase zero defect audit
fac674b chore(ai): record canonical workbench totals
317a061 fix(wizmatch): canonicalize workbench totals
b27c01b chore(ai): record final phase zero QA
807018b test(wizmatch): cover AI and query recovery failures
```

## npm scripts

- `npm run dev` — `tsx watch src/index.ts`
- `npm run build` — `tsc`
- `npm run start` — `node dist/index.js`
- `npm run db:generate` — `drizzle-kit generate`
- `npm run db:migrate` — `drizzle-kit migrate`
- `npm run db:studio` — `drizzle-kit studio`
- `npm run db:seed` — `tsx src/db/seed.ts`
- `npm run db:import` — `tsx src/scripts/importContacts.ts`
- `npm run client:install` — `cd client && npm install`
- `npm run client:build` — `cd client && npm run build`
- `npm run client:dev` — `cd client && npm run dev`
- `npm run admin:install` — `cd admin && npm install`
- `npm run admin:build` — `cd admin && npm run build`
- `npm run admin:dev` — `cd admin && npm run dev`
- `npm run test` — `vitest --run`
- `npm run test:watch` — `vitest`
- `npm run test:coverage` — `vitest --run --coverage`
- `npm run build:all` — `npm run client:build && npm run admin:build && npm run build`
- `npm run seo:doctor` — `npx tsx scripts/seo-doctor.ts`
- `npm run db:sizes` — `npx tsx scripts/db-table-sizes.ts`
- `npm run wizmatch:env-check` — `npx tsx scripts/wizmatch-env-check.ts`
- `npm run ai:brief` — `tsx scripts/generate-ai-brief.ts`

## Context layer files (tracked)

```
.ai/AI_BRIEF.md
.ai/CURRENT_STATE.md
.ai/CURRENT_TASK.md
.ai/HANDOFF_LOG.md
.ai/REVIEW_CHECKLIST.md
.ai/TEST_PLAN.md
.ai/TOOL_ROLES.md
docs/decisions/.gitkeep
docs/decisions/ADR-001-ai-collaboration-workflow.md
docs/decisions/ADR-002-contact-intelligence-phase1-architecture.md
docs/decisions/ADR-003-contact-intelligence-review-persistence.md
docs/decisions/ADR-004-wizmatch-staffing-domain-spine.md
docs/prd/.gitkeep
docs/prd/001-contact-intelligence-phase1-plan.md
docs/prd/001-contact-intelligence.md
docs/prd/002-client-discovery-plan.md
docs/prd/003-candidate-intelligence-plan.md
docs/prd/004-phase-01-core-staffing-domain-spine.md
docs/prd/004-wizmatch-staffing-operating-system.md
docs/reviews/.gitkeep
docs/reviews/codex-ai-collaboration-review.md
docs/reviews/wizmatch-client-funnel-audit-2026-07-12.md
docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md
docs/wizmatch/README.md
docs/wizmatch/WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md
docs/wizmatch/WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md
docs/wizmatch/WIZMATCH_STAFFING_OS_OWNER_INPUTS.md
```

## Where to read next

- `AGENTS.md` — universal agent instructions + guardrails
- `CLAUDE.md` — Claude-specific responsibilities
- `.ai/TOOL_ROLES.md` — Claude / Codex / ChatGPT role split
- `.ai/REVIEW_CHECKLIST.md` — the gate every change passes
- `docs/` — architecture, database, deployment, security, conventions
