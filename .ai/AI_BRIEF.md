# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-08T17:58:12.206Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: growth-escalators-backend-v2
- **Branch**: `main`
- **Last commit**: d82b6fa merge: pipeline stage hardening (56 seconds ago)
- **Uncommitted changes**: 14 file(s)

## Current task

**Live deploy merged pipeline hardening + Wizmatch readiness** — merge the two reviewed Codex
branches into `main`, verify the combined tree, push `main` to trigger Railway, and report the
remaining human-owned data/secrets/migration items.

Scope is **git integration, conflict resolution in AI context files, local verification, main push,
and deployment/status reporting**. This task does not hand-edit schema or migrations, does not run
`db:migrate` directly against any database, does not set secrets, does not enable scraper
schedules, does not send outreach, and does not auto-submit candidates.

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
d82b6fa merge: pipeline stage hardening
638e7fe fix(crm): harden pipeline stage outcomes
061ca2e fix(crm): harden portal rendering and Wizmatch fallbacks
4358068 feat(crm): harden Wizmatch shared routes
3319859 feat(crm): unify Growth and Wizmatch tenant profiles
d98ddad fix(auth): separate product navigation and lead routing
e3d683f fix(admin): serve freshly built login bundle
ecd140c fix(deploy): install admin dependencies in nixpacks
352add5 feat(auth): separate Growth and Wizmatch logins
8a40b52 feat(crm): add Facebook lead form ingestion
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
.ai/AI_BRIEF.md
.ai/AI_BRIEF.md
.ai/CURRENT_STATE.md
.ai/CURRENT_STATE.md
.ai/CURRENT_STATE.md
.ai/CURRENT_TASK.md
.ai/CURRENT_TASK.md
.ai/CURRENT_TASK.md
.ai/HANDOFF_LOG.md
.ai/HANDOFF_LOG.md
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
```

## Where to read next

- `AGENTS.md` — universal agent instructions + guardrails
- `CLAUDE.md` — Claude-specific responsibilities
- `.ai/TOOL_ROLES.md` — Claude / Codex / ChatGPT role split
- `.ai/REVIEW_CHECKLIST.md` — the gate every change passes
- `docs/` — architecture, database, deployment, security, conventions
