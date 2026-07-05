# HANDOFF_LOG.md

Append-only log of completed units of work. Newest first. One entry per coherent change.
Format: `## YYYY-MM-DD — <title> — <agent>` then a few bullets (what changed, how to verify, what's next).

---

## 2026-07-06 — Step 1: AI collaboration layer setup — Claude — READY FOR CODEX REVIEW

**What was done**
- Added `AGENTS.md` (universal agent instructions) and made `CLAUDE.md` import it via `@AGENTS.md`
  plus a Claude-specific responsibilities section.
- Created the `.ai/` context layer: `AI_BRIEF.md` (auto-generated), `CURRENT_TASK.md`,
  `CURRENT_STATE.md`, `HANDOFF_LOG.md`, `TOOL_ROLES.md`, `REVIEW_CHECKLIST.md`.
- Created `docs/prd/`, `docs/decisions/`, `docs/reviews/` (each with `.gitkeep`).
- Added `scripts/generate-ai-brief.ts` and the `ai:brief` npm script (local-repo-only, no network).

**Files created:** `AGENTS.md`, `.ai/AI_BRIEF.md`, `.ai/CURRENT_TASK.md`, `.ai/CURRENT_STATE.md`,
`.ai/HANDOFF_LOG.md`, `.ai/TOOL_ROLES.md`, `.ai/REVIEW_CHECKLIST.md`,
`docs/prd/.gitkeep`, `docs/decisions/.gitkeep`, `docs/reviews/.gitkeep`, `scripts/generate-ai-brief.ts`.
**Files modified:** `CLAUDE.md` (added import + section, prior content intact), `package.json` (added `ai:brief` script).

**Not changed by this task:** no `src/`, `admin/`, `client/`, `src/db/`, `.github/`, `railway.json`,
`Procfile`, or Vercel config. No DB schema, API route, frontend UI, or business logic touched.
(Note: `src/db/migrations/meta/_journal.json` + `0020_snapshot.json` show as dirty in the tree, but
those are pre-existing uncommitted artifacts from the 2026-07-05 Wizmatch `db:generate`, unrelated to Step 1.)

**Verify:** `npm run ai:brief` regenerates `.ai/AI_BRIEF.md` successfully (exit 0).
**Next:** Codex review against `.ai/REVIEW_CHECKLIST.md`; then adopt the role loop in `.ai/TOOL_ROLES.md`.

## 2026-07-06 — Step 2/3: collaboration-protocol fixes from Codex review — Claude — READY FOR CODEX RE-REVIEW

**What was done**
Codex reviewed commit `d0ab81c` and flagged the collaboration protocol itself (not production
code) as unsafe in a few places: an unconditional `git pull origin main` startup instruction,
no explicit dirty-worktree protection, an unqualified "commit and push after each unit" default,
an overstated Railway two-service claim, and an `.ai/AI_BRIEF.md` "Current task" section that
only echoed the file's own H1 title instead of the actual task content. All five were fixed:

1. `AGENTS.md` — replaced the unconditional `git pull origin main` step with: check
   `git branch --show-current` + `git status --short` first, `git fetch origin` for freshness,
   only pull `main` when intentionally on it with a clean tree, never pull/merge/rebase over
   unrelated dirty files.
2. `AGENTS.md` — added an explicit "Dirty-worktree protection" section: preserve unrelated
   changes, never stage/commit/delete/reformat files outside the task, never run
   `git reset --hard` / `git clean` / `checkout -- .` without explicit instruction, every commit
   scoped to task-relevant files only (staged by path, not `git add -A`).
3. `CLAUDE.md` — removed the unconditional `git pull origin main` session-start line and the
   "commit and push after each coherent unit" default; replaced with: check branch/status first,
   commit only when explicitly asked or task scope calls for it, never push without explicit
   human confirmation, never push to `main` unless explicitly approved — production deploys are
   sensitive. Folded the equivalent commit-discipline bullet into `AGENTS.md`'s working agreement
   too (removed the duplicate section that edit briefly introduced).
4. `AGENTS.md` and `.ai/CURRENT_STATE.md` — reworded the Railway deployment claim from an
   assertion of two dedicated services (`web` + `worker`) to a verified/conditional statement:
   repo docs describe a single Express + Socket.io + node-cron process that can run standalone
   (`DISABLE_BACKGROUND_JOBS=true` for API-only mode); production *may* split this across
   separate Railway services if configured in the Railway UI; agents must verify actual topology
   before changing deployment/worker assumptions.
5. `scripts/generate-ai-brief.ts` — replaced `firstHeadingLines()` (which just returned the
   file's first heading, i.e. literally "CURRENT_TASK.md") with `sectionBody()`, which extracts
   the text under the `## Active task` heading in `.ai/CURRENT_TASK.md` up to the next heading.
   `.ai/AI_BRIEF.md`'s "Current task" section now shows the real task summary.

**Files modified:** `AGENTS.md`, `CLAUDE.md`, `.ai/CURRENT_STATE.md`, `scripts/generate-ai-brief.ts`,
`.ai/AI_BRIEF.md` (regenerated).

**Not changed by this task:** no `src/` (other than the pre-existing, unrelated
`src/db/migrations/meta/*` dirt already noted in the Step 1 entry above — still untouched by
this task), `admin/`, `client/`, `src/db/schema.ts`, `.github/`, `railway.json`, `Procfile`,
Vercel config, or any production logic/database schema/UI file.

**Verify:** `npm run ai:brief` ran successfully (exit 0); `.ai/AI_BRIEF.md`'s "Current task"
section now shows the actual active-task summary instead of the file title.
**Next:** Codex re-review; not pushed, not deployed.
