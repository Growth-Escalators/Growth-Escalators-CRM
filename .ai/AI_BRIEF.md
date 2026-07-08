# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-08T17:36:09.320Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: growth-escalators-backend-v2
- **Branch**: `codex/pipeline-stage-hardening-v2`
- **Last commit**: 061ca2e fix(crm): harden portal rendering and Wizmatch fallbacks (12 hours ago)
- **Uncommitted changes**: 16 file(s)

## Current task

**Pipeline Stage Hardening Follow-ups** — protect Growth and Wizmatch CRM pipelines from stage
metadata loss, make terminal-stage behavior outcome-driven, narrow Wizmatch optional-schema
fallbacks, and make tenant selection path-first.

Scope is **pipeline stage normalization/serialization, Pipeline Manager object-stage editing,
pipeline/deal analytics and closed-date behavior, Wizmatch optional-schema allowlisting,
cross-tab tenant routing polish, tests, and AI context**. This task does not add schema,
migrations, auth/RBAC middleware changes, Cashfree changes, deployment config, worker/cron
automation, outreach sending, or automatic candidate submission.

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
061ca2e fix(crm): harden portal rendering and Wizmatch fallbacks
4358068 feat(crm): harden Wizmatch shared routes
3319859 feat(crm): unify Growth and Wizmatch tenant profiles
d98ddad fix(auth): separate product navigation and lead routing
e3d683f fix(admin): serve freshly built login bundle
ecd140c fix(deploy): install admin dependencies in nixpacks
352add5 feat(auth): separate Growth and Wizmatch logins
8a40b52 feat(crm): add Facebook lead form ingestion
d2e1fec fix(wizmatch): harden analytics against optional schema gaps
717b167 feat(wizmatch): add candidate profile intake
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
