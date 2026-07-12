# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-12T18:15:34.971Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: growth-escalators-backend-v2
- **Branch**: `main`
- **Last commit**: 6d659ec chore(db): repair drizzle snapshot baseline so db:generate works safely again (#42) (11 minutes ago)
- **Uncommitted changes**: 20 file(s)

## Current task

**Wizmatch staged full-detail admin flow (Hybrid)** — replace the compact "co-pilot" theme with
separate, full-detail per-stage dashboards. Branch `feat/wizmatch-staged-flow` (stacked on
`feat/wizmatch-sending`). Design decision recorded in `docs/design/wizmatch-staged-flow.md`.

Scope is admin-UI only: restore the orphaned full pages for Client Discovery, Candidate
Intelligence, and Analytics; keep Contact Intelligence on the newer send-enabled page; add a
"Wizmatch funnel" stage navigator to the Home dashboard; retire the co-pilot cockpit.

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
6d659ec chore(db): repair drizzle snapshot baseline so db:generate works safely again (#42)
69e91b0 docs(ai): log client-acquisition workbench (PRs #39/#40/#41) + drizzle drift finding
b3c2435 wizmatch: candidates location filter, pagination, experience field (#40)
0e87e36 feat(wizmatch): on-demand candidate sourcing + pipeline hand-off link (#39)
0498408 feat(wizmatch): requirements filter bar, detail drawer, candidate matches, tier-weighted priority (#41)
9ef29d9 feat(crm): surface full candidate/client-lead/company detail in contact drawer
02ff73f fix(crm): show GitHub/LinkedIn profile, skills, and visa status on candidate contacts
ef81cf0 docs(wizmatch): add client-acquisition funnel test plan
624ef01 fix(crm): hide D2C-only fields and format raw source slugs in contact drawer
fd0f791 docs(wizmatch): correct DATAFLOW.md — GitHub/X-ray are supply not demand
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
docs/prd/.gitkeep
docs/prd/001-contact-intelligence-phase1-plan.md
docs/prd/001-contact-intelligence.md
docs/prd/002-client-discovery-plan.md
docs/prd/003-candidate-intelligence-plan.md
docs/reviews/.gitkeep
docs/reviews/codex-ai-collaboration-review.md
docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md
```

## Where to read next

- `AGENTS.md` — universal agent instructions + guardrails
- `CLAUDE.md` — Claude-specific responsibilities
- `.ai/TOOL_ROLES.md` — Claude / Codex / ChatGPT role split
- `.ai/REVIEW_CHECKLIST.md` — the gate every change passes
- `docs/` — architecture, database, deployment, security, conventions
