# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-14T02:34:56.022Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: Growth-Escalators/Growth-Escalators-CRM
- **Branch**: `codex/wizmatch-phase0-trust`
- **Last commit**: cdc1cf4 chore(ai): record Wizmatch credential rotation (18 minutes ago)
- **Uncommitted changes**: 5 file(s)

## Current task

**Wizmatch Staffing OS — read-only production qualification is complete and the release candidate
is green. The next unit is the separately approved production environment hardening with all
staffing gates kept off, followed by pilot-account provisioning and migrations under later gates.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
cdc1cf4 chore(ai): record Wizmatch credential rotation
51bec73 chore(ai): record final staffing staging qualification
9f4c0f4 fix(wizmatch): enforce staffing pilot access policy
a5863d8 chore(ai): record staging placements smoke
ef2112f fix(wizmatch): verify staging delivery economics
5a4abe0 chore(ai): record staging Gate A pilot evidence + a810d08 guardrail review
a810d08 fix(migrations): make 0008/0014 idempotent for fresh-database apply
08f1ef6 chore(ai): refresh same-day pilot brief
89bcbb2 docs(ai): prepare same-day Wizmatch pilot handoff
2085b84 chore(ai): snapshot clean release state
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
docs/decisions/ADR-005-migration-exception-0008-0014-fresh-apply.md
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
docs/reviews/wizmatch-migration-guardrail-review-2026-07-13.md
docs/reviews/wizmatch-staffing-release-readiness-2026-07-13.md
docs/reviews/wizmatch-staging-gate-c-pilot-2026-07-14.md
docs/reviews/wizmatch-staging-pilot-2026-07-13/wizmatch-staging-gateA-company360.png
docs/reviews/wizmatch-staging-pilot-2026-07-13/wizmatch-staging-gateA-contact360-personA.png
docs/reviews/wizmatch-staging-pilot-2026-07-13/wizmatch-staging-gateA-relationships.png
docs/reviews/wizmatch-staging-pilot-2026-07-13/wizmatch-staging-gateA-requirements-attributed.png
docs/reviews/wizmatch-staging-pilot-2026-07-13/wizmatch-staging-gateB-match-shortlist.png
docs/reviews/wizmatch-staging-pilot-2026-07-13/wizmatch-staging-two-distinct-requirements.png
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
