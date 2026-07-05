# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-05T19:58:17.994Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: growth-escalators-backend-v2
- **Branch**: `ai/collaboration-setup`
- **Last commit**: d0ab81c chore(ai): add AI collaboration layer (AGENTS.md, .ai/, docs scaffolding, ai:brief) (8 minutes ago)
- **Uncommitted changes**: 15 file(s)

## Current task

**AI collaboration layer setup** — establishing the persistent, chat-independent context
scaffolding for this repo (`AGENTS.md`, `CLAUDE.md` import, `.ai/` files, `docs/` folders,
and the `ai:brief` generator script).

Scope is **documentation + tooling only**. No production app logic, database schema, admin
UI, deployment config, or API behaviour is changed by this task.

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
d0ab81c chore(ai): add AI collaboration layer (AGENTS.md, .ai/, docs scaffolding, ai:brief)
103e274 feat(wizmatch): India relevance foundation (scoring, matching, ingestion)
db0ff78 chore(admin): rebuild public/admin — Requirements page
c1340b5 feat(admin): Wizmatch Requirements page
69ee2b8 feat(wizmatch): requirement → branded vendor sheet (backend)
f0aa639 feat(wizmatch): wire placements into the CRM deals/pipeline layer
6c013af chore(admin): rebuild public/admin — Wizmatch rate-display fix
45ac3ed fix(wizmatch): unbreak signals list + stalled automation pipeline
0ef9edd chore(admin): rebuild public/admin — Wizmatch 3a/3b Fluent output
b991c16 style(admin): restyle WizmatchPlacementsPage to Fluent 3b spec + wire up Add Placement
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
docs/prd/.gitkeep
docs/reviews/.gitkeep
```

## Where to read next

- `AGENTS.md` — universal agent instructions + guardrails
- `CLAUDE.md` — Claude-specific responsibilities
- `.ai/TOOL_ROLES.md` — Claude / Codex / ChatGPT role split
- `.ai/REVIEW_CHECKLIST.md` — the gate every change passes
- `docs/` — architecture, database, deployment, security, conventions
