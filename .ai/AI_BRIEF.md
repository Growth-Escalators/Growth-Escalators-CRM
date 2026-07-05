# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-05T21:25:05.751Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: growth-escalators-backend-v2
- **Branch**: `feature/contact-intelligence-phase1-adr`
- **Last commit**: d629039 docs(wizmatch): add contact intelligence phase 1 ADR (29 minutes ago)
- **Uncommitted changes**: 14 file(s)

## Current task

**Wizmatch Intelligence Command Center local build** — create a broad, read-only Phase 1
operating layer for Wizmatch that combines Contact Intelligence, Client Discovery scoring,
Candidate Intelligence scoring, requirement priority, module health, and a unified manual-review
command queue.

Scope is **local implementation only**. This task may touch backend services/routes, admin UI,
and tests, but must not change database schema, migrations, paid enrichment integrations,
outreach sending, worker/cron automation, deployment config, `package.json`, or `package-lock.json`.

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
d629039 docs(wizmatch): add contact intelligence phase 1 ADR
2f8239a Merge pull request #12 from Growth-Escalators/feature/contact-intelligence-phase1-plan
742bbda docs(wizmatch): add contact intelligence phase 1 plan
4788843 Merge pull request #11 from Growth-Escalators/feature/contact-intelligence-prd
d7b488a docs(wizmatch): harden contact intelligence PRD
a7ac996 docs(wizmatch): add contact intelligence PRD
67adc69 Merge pull request #10 from Growth-Escalators/ai/collaboration-setup
6939550 chore(ai): clarify Railway docs wording
dbbf0ea chore(ai): harden collaboration protocol
d0ab81c chore(ai): add AI collaboration layer (AGENTS.md, .ai/, docs scaffolding, ai:brief)
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
docs/prd/.gitkeep
docs/prd/001-contact-intelligence-phase1-plan.md
docs/prd/001-contact-intelligence.md
docs/reviews/.gitkeep
docs/reviews/codex-ai-collaboration-review.md
```

## Where to read next

- `AGENTS.md` — universal agent instructions + guardrails
- `CLAUDE.md` — Claude-specific responsibilities
- `.ai/TOOL_ROLES.md` — Claude / Codex / ChatGPT role split
- `.ai/REVIEW_CHECKLIST.md` — the gate every change passes
- `docs/` — architecture, database, deployment, security, conventions
