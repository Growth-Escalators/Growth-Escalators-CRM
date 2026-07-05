# CURRENT_TASK.md

## Active task

**AI collaboration layer setup** — establishing the persistent, chat-independent context
scaffolding for this repo (`AGENTS.md`, `CLAUDE.md` import, `.ai/` files, `docs/` folders,
and the `ai:brief` generator script).

Scope is **documentation + tooling only**. No production app logic, database schema, admin
UI, deployment config, or API behaviour is changed by this task.

## Definition of done

- [x] `AGENTS.md` — universal agent instructions
- [x] `CLAUDE.md` imports `@AGENTS.md` + Claude-specific responsibilities
- [x] `.ai/` files: `AI_BRIEF.md` (generated), `CURRENT_TASK.md`, `CURRENT_STATE.md`, `HANDOFF_LOG.md`, `TOOL_ROLES.md`, `REVIEW_CHECKLIST.md`
- [x] `docs/prd/`, `docs/decisions/`, `docs/reviews/` created
- [x] `scripts/generate-ai-brief.ts` + `ai:brief` npm script
- [x] `HANDOFF_LOG.md` entry recorded

## Next task

_None assigned yet._ When a new task begins, replace this file's "Active task" section and
reset the checklist. Keep this file to exactly one task in flight.
