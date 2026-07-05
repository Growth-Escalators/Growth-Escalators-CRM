# CURRENT_TASK.md

## Active task

**Harden Wizmatch Contact Intelligence PRD** - tighten the PRD before any implementation while
Claude is temporarily unavailable and Codex is acting as implementation lead.

Scope is **documentation/context only**: harden the Contact Intelligence PRD, update task state,
append the handoff log, and regenerate the AI brief. No production app logic, database schema,
migrations, API routes, admin/client UI, deployment config, `package.json`, or `package-lock.json`
changes.

## Definition of done

- [x] Read `AGENTS.md`, `.ai/CURRENT_TASK.md`, `.ai/CURRENT_STATE.md`, `.ai/TOOL_ROLES.md`, `.ai/REVIEW_CHECKLIST.md`, and `.ai/AI_BRIEF.md`.
- [x] Replace Hunter with Apollo -> Snov -> Reacher/email verification -> website/manual pattern -> Google fallback.
- [x] Make Phase 1 explicitly zero-paid-enrichment.
- [x] Reduce MVP data model to company intelligence, contact candidates, and discovery runs.
- [x] Add explicit status enums and exact MVP cost caps.
- [x] Add Phase 1 MVP Build Boundary for what Codex can safely do while Claude is unavailable.
- [x] Regenerate `.ai/AI_BRIEF.md` with `PATH="../v2/node_modules/.bin:$PATH" npm run ai:brief`.
- [x] Commit only docs/context files with `docs(wizmatch): harden contact intelligence PRD`.

## Next task

Review the hardened Contact Intelligence PRD, then create a follow-up implementation ADR before
any schema, migration, API, UI, worker, or paid enrichment work.
