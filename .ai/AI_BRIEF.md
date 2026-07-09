# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-09T14:41:45.694Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: growth-escalators-backend-v2
- **Branch**: `fix/wizmatch-cost-safety`
- **Last commit**: 453b7fa Merge pull request #13 from Growth-Escalators/docs/wizmatch-cost-audit (7 hours ago)
- **Uncommitted changes**: 11 file(s)

## Current task

**Wizmatch P0 cost-safety fixes** — implement the two audit-confirmed P0s on
`fix/wizmatch-cost-safety`, then open a PR against `main`.

Scope is narrow: stop the free/internal enrich path from consuming shared Apollo/Snov quota, and
alert when all configured Wizmatch sending domains degrade while preserving the mailer's
fallback-to-all sending behavior.

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
453b7fa Merge pull request #13 from Growth-Escalators/docs/wizmatch-cost-audit
f8e2aaf docs(wizmatch): add cost-leakage audit + refresh .ai context layer
d07f7ef docs(ai): record env var setup, smoke check, and scraper CI fix
b87fa5e fix(ci): pin playwright install to 1.59.1 in Wizmatch scraper workflows
b4966bb fix(ci): invoke local playwright binary directly to avoid version drift
ead410a fix(ci): install playwright npm package before running Wizmatch scrapers
f1b476d docs(ai): record Wizmatch migration-journal repair + deploy
0f313ba fix(db): repair migration journal gap for Wizmatch operating tables
46e708d docs(ai): update post-deploy Claude handoff
7951c28 docs(ai): record main deployment integration
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
