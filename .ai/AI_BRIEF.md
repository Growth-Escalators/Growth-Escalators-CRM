# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-13T08:41:52.495Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: Growth-Escalators/Growth-Escalators-CRM
- **Branch**: `codex/wizmatch-phase0-trust`
- **Last commit**: 48b1a88 feat(wizmatch): complete Gate C delivery operations (43 seconds ago)
- **Uncommitted changes**: 5 file(s)

## Current task

**Wizmatch Staffing OS — all three planned local implementation phases are complete and verified on
`codex/wizmatch-phase0-trust` in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust`.
The exact next task is release review and separately approved staging/production rollout.**

Nothing from this branch has been pushed, deployed, migrated, sent, spent, written to production,
or used to rotate a credential. The original dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2` remains untouched.

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
48b1a88 feat(wizmatch): complete Gate C delivery operations
a5ac3e8 feat(wizmatch): add Gate B candidate matching
1997e31 feat(wizmatch): harden Phase 1 operations
353221b chore(ai): record Gate A migrator verification
5e733a6 chore(ai): hand off Wizmatch Gate A
b43017e feat(admin): add Wizmatch staffing workspaces
14b51f5 feat(wizmatch): implement Gate A staffing operations
8cd20c6 feat(wizmatch): add Gate A staffing schema
0a8931d chore(ai): finalize phase zero handoff
55165fd docs(wizmatch): close phase zero defect audit
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
- `npm run wizmatch:staffing-backfill-preview` — `tsx scripts/wizmatch-staffing-backfill-preview.ts`
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
