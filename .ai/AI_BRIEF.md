# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: 2026-07-17T00:36:21.493Z_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read `AGENTS.md`,
`CLAUDE.md`, and the `.ai/` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: Growth-Escalators/Growth-Escalators-CRM
- **Branch**: `fix/dx-observability`
- **Last commit**: e8af0f8 docs(ai): record free POC discovery enabled in prod (WIZMATCH_POC_DISCOVERY_ENABLED) (11 hours ago)
- **Uncommitted changes**: 21 file(s)

## Current task

**SHIPPED 2026-07-16 (`origin/main` = `695a139`, Railway deploy `35c38b14` SUCCESS): cost-safe
POC/client search — read-only preview + role targeting + credit banner.** Surfaces the existing
free-first, capped machinery so you can search for POCs (Talent Acquisition / HR-People /
Hiring-Delivery Mgr / Vendor-Procurement) without wasting credits: `buildPocSearchQuery(company,
domain, roles?)` is role-parameterized (default = original all-roles query, unchanged); a new
read-only `POST /signals/:id/discover-poc/preview` (`previewFreePocSearch`) returns the exact query +
remaining SearchAPI allowance (today X/5 · month Y/80) + cooldown/internal-contacts state + estimated
credit cost (0 or 1) and **calls no provider** (pure DB read); `/discover-poc` now takes a `roles`
body. The Signals "Find POC" is preview-first (query + role toggles + credit/cost + "Run free
search"), plus a Search-credits banner over the sourcing cards. The free run itself is unchanged
(internal CRM → website scrape → SearchAPI 1 credit only within the 5/day+80/mo caps + 30-day
cooldown + ≤5 cap; channels never guessed); Apollo/Snov stay OFF behind their gate. No schema/
migration, no guardrail file, no new env var. **Verified:** tsc, 455 Vitest (new
`wizmatchPocSearchPreview.test.ts` — role-set query builder + preview cost logic, DB-only/no-provider),
admin build, 97 Playwright (sourcing spec updated to preview-first). **Live:** deploy SUCCESS, zero
5xx, `/health` 200, SPA 200, the new preview route 401 (intact). **Enablement — NOW DONE:**
`WIZMATCH_POC_DISCOVERY_ENABLED=true` was set on the production `web` service (env
`81b087de`, Railway) and applied via a redeploy (empty commit `7223b49`, deploy `2c895610` SUCCESS —
`set_variables` alone did not restart the process, so a push was needed to reboot with the flag).
`SEARCHAPI_API_KEY` was already present (validated in prior handoffs; not re-read, to avoid leaking).
So the free POC search now RUNS in prod (capped 5/day + 80/mo + 30-day cooldown + ≤5 results,
preview-first, channels never guessed). **Apollo/Snov paid discovery stays OFF** behind
`WIZMATCH_PAID_DISCOVERY_ENABLED` + its cost guard — untouched.
Client-side cost-safety (TheirStack free preview + SearchAPI allowance) is on the same Signals
sourcing cards; Companies paid `discovery-preview` + Client-Discovery seeding are unchanged (paid
stays off / seeding is credit-free).

> Full detail in [`.ai/CURRENT_TASK.md`](CURRENT_TASK.md) · state in [`.ai/CURRENT_STATE.md`](CURRENT_STATE.md)

## Recent commits

```
e8af0f8 docs(ai): record free POC discovery enabled in prod (WIZMATCH_POC_DISCOVERY_ENABLED)
7223b49 chore(wizmatch): redeploy to apply WIZMATCH_POC_DISCOVERY_ENABLED=true (free POC search)
3522799 docs(ai): record shipped cost-safe POC search preview + role targeting + live verify
695a139 feat(wizmatch): cost-safe POC search — read-only preview + role targeting + credit banner
f07ea17 docs(ai): record shipped Reports From/To staffing-analytics scoping + live verify
9767469 feat(wizmatch): honor the Reports From/To range on staffing-analytics metrics
0ee6979 docs(ai): record shipped comprehensive Wizmatch filters + global sort + live verify
d7906e0 feat(wizmatch): global server-side sort + full-filtered CSV on the server pages
cbfdde7 test+fix(wizmatch): green the filter rollout (a11y, spec locators, backend test)
53db7d7 feat(wizmatch): wire Placements, Contact Intelligence, Reports to shared filters
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
docs/reviews/wizmatch-results-first-sourcing-phase1-2026-07-14.md
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
