# AGENTS.md — Universal instructions for AI coding agents

This is the single source of truth for **any** AI coding agent (Claude Code, Codex,
Cursor, etc.) working in `growth-escalators-backend-v2`. Read this first, every session.
Tool-specific addenda live in `CLAUDE.md` (Claude) and `.ai/TOOL_ROLES.md` (role split).

The goal of this file and the `.ai/` folder is a **persistent, chat-independent context
layer**: any agent — or any fresh chat — can rebuild full working context from the repo
alone, without relying on prior conversation history.

## Repository at a glance

- **Repo**: `growth-escalators-backend-v2`
- **Live**: `crm.growthescalators.com` (CRM) · `api.growthescalators.com` (API) · `ecom.growthescalators.com` (D2C, Vercel)
- **Local**: `~/repo-comparison/v2`
- **Stack**: Node 20 · Express · TypeScript · Drizzle (Postgres) · Vitest · React (admin + client SPAs)
- **Deploy**: two Railway services (`web` + `worker`); auto-deploys on push to `main`.

## Before you start any task

1. `git pull origin main` — the repo auto-deploys, so stale local state is dangerous.
2. Read `.ai/CURRENT_TASK.md` — what is actively being worked on.
3. Skim `.ai/CURRENT_STATE.md` — the last-known-good snapshot.
4. Regenerate the brief if in doubt: `npm run ai:brief` (writes `.ai/AI_BRIEF.md` from local repo facts only).
5. For deeper context, read `CLAUDE.md` and the `docs/` reference set.

## Where context lives (`.ai/`)

| File | Purpose |
|---|---|
| `.ai/AI_BRIEF.md` | Auto-generated snapshot (branch, recent commits, scripts, docs). Never hand-edit — run `npm run ai:brief`. |
| `.ai/CURRENT_TASK.md` | The one task in flight right now. Update when the focus changes. |
| `.ai/CURRENT_STATE.md` | Last-known-good state: what works, what's in progress, known issues. |
| `.ai/HANDOFF_LOG.md` | Append-only log of completed units of work + who/what did them. |
| `.ai/TOOL_ROLES.md` | The Claude / Codex / ChatGPT role split. |
| `.ai/REVIEW_CHECKLIST.md` | The gate every change passes before it's called done. |
| `docs/prd/` | Product requirement docs (one file per feature). |
| `docs/decisions/` | Architecture decision records (ADRs), one per decision. |
| `docs/reviews/` | Saved code-review outputs, one per review. |

## Working agreement (all agents)

- **Small, coherent units.** One logical change per commit; build + tests green before commit.
- **Verify, don't assume.** If a memory or doc names a file/flag, confirm it still exists before acting.
- **Report faithfully.** If tests fail, say so with output. If a step was skipped, say that.
- **Leave a trail.** After a completed unit, append to `.ai/HANDOFF_LOG.md` and update
  `.ai/CURRENT_TASK.md` / `.ai/CURRENT_STATE.md` as needed so the next agent (or chat) can pick up cold.

## Load-bearing invariants (always apply)

`findOrCreateContact` exact-matches `(channel_type, channel_value)`. Always normalise:
- email → `.trim().toLowerCase()`
- phone → strip non-digits, prefix `91` if missing

`lastActivityAt` **must** be bumped on every contact write (the CRM sorts by it).

## Guardrails — do not touch without explicit human confirmation

| Path | Reason |
|---|---|
| `src/db/schema.ts` | Schema changes need migration generation, not hand-edits |
| `src/db/migrations/` | Already-applied SQL — editing breaks prod Postgres state |
| `src/middleware/auth.ts`, `src/middleware/rbac.ts` | Trust boundary; mistakes leak data |
| `src/routes/cashfree.ts` | Real money; idempotency invariants |
| `src/services/sodEodService.ts` Slack-DM logic | Sends to real humans on a schedule |

Also: don't change deployment config (Railway/Vercel) or admin UI unless the task explicitly requires it.

## Commands

```bash
npm run dev          # API process (tsx watch)
npm run build        # tsc → dist/ (must exit 0 before commit)
npm test             # vitest --run (must pass before commit)
npm run ai:brief     # regenerate .ai/AI_BRIEF.md from local repo state
npm run db:generate  # diff schema.ts → emit migration SQL
npm run db:migrate   # apply pending migrations
npm run admin:dev    # CRM admin panel (Vite)
```

## Reference docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DATABASE.md`](docs/DATABASE.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) · [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)
- [`CRM_SYSTEM_DOCS.md`](CRM_SYSTEM_DOCS.md) — full narrative architecture + API route reference
