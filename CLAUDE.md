# CLAUDE.md

@AGENTS.md

This file provides guidance to Claude Code when working with code in this repository.
The universal instructions for **all** AI agents live in `AGENTS.md` (imported above);
the section below adds Claude-specific responsibilities on top of them.

## Claude-specific responsibilities

Claude acts as the **senior architect + senior engineer** on this repo (see the full role
split in [`.ai/TOOL_ROLES.md`](.ai/TOOL_ROLES.md)):

- **Plan before building.** Turn product intent (`docs/prd/`) into a technical plan; record
  non-obvious architecture calls as ADRs in `docs/decisions/`.
- **Own the risky code.** Schema-adjacent logic, auth/RBAC, money paths, data-integrity
  invariants, and cross-cutting refactors are Claude's to write and to review.
- **Be final reviewer** on anything touching the guardrail paths in `AGENTS.md`; delegate
  well-specified, mechanical work to Codex and review its output against
  [`.ai/REVIEW_CHECKLIST.md`](.ai/REVIEW_CHECKLIST.md).
- **Keep the context layer honest.** After a completed unit of work, append to
  [`.ai/HANDOFF_LOG.md`](.ai/HANDOFF_LOG.md) and update
  [`.ai/CURRENT_TASK.md`](.ai/CURRENT_TASK.md) / [`.ai/CURRENT_STATE.md`](.ai/CURRENT_STATE.md)
  so the next agent — or a fresh chat — can resume cold. Run `npm run ai:brief` to refresh
  the snapshot.

## Repository

- **Repo**: `growth-escalators-backend-v2`
- **Live**: `crm.growthescalators.com` (CRM) · `api.growthescalators.com` (API) · `ecom.growthescalators.com` (D2C, Vercel)
- **Local**: `~/repo-comparison/v2`
- **Stack**: Node 20 · Express · TypeScript · Drizzle (Postgres) · Vitest · React (admin + client SPAs)

Before any session: `git pull origin main`. The repo auto-deploys on push.

## Reference docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — two-process Railway split, routes/services, SPAs, landing-page resilience
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema lifecycle, Drizzle migrations, `ensure*` hooks, multi-tenancy
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Railway + Vercel build gotchas, Cashfree edge gotchas, pre-deploy checklist
- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — logging, constants, contact normalisation, commit style
- [`docs/SECURITY.md`](docs/SECURITY.md) — auth/RBAC trust boundary, webhook signing, env vars
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — prod-down playbook, common 500s
- [`docs/URLS.md`](docs/URLS.md) — live subdomains, webhook URLs
- [`CRM_SYSTEM_DOCS.md`](CRM_SYSTEM_DOCS.md) — full narrative architecture + API route reference

## Commands

```bash
npm run dev          # API process (tsx watch)
npm run build        # tsc → dist/ (must exit 0 before commit)
npm test             # vitest --run (must pass before commit)
npm run db:generate  # diff schema.ts → emit migration SQL
npm run db:migrate   # apply pending migrations
npm run client:dev   # D2C landing (Vite)
npm run admin:dev    # CRM admin panel (Vite)
```

## Contact-touching invariants (load-bearing — always apply)

`findOrCreateContact` exact-matches `(channel_type, channel_value)`. Always normalise:
- email → `.trim().toLowerCase()`
- phone → strip non-digits, prefix `91` if missing

`lastActivityAt` **must** be bumped on every contact write (CRM sorts by this).

## Don't touch without asking

| Path | Reason |
|---|---|
| `src/db/schema.ts` | Schema changes need migration generation, not hand-edits |
| `src/db/migrations/` | Already-applied SQL — editing breaks prod Postgres state |
| `src/middleware/auth.ts`, `src/middleware/rbac.ts` | Trust boundary; mistakes leak data |
| `src/routes/cashfree.ts` | Real money; idempotency invariants |
| `src/services/sodEodService.ts` Slack-DM logic | Sends to real humans on a schedule |

## Companion repos

- **`~/repo-comparison/ge-content-frontend`** — Next.js content app (Vercel, `content.growthescalators.com`).
- **`~/Content Machine GE`** — n8n workflow definitions + template HTML.

When the user mentions "content frontend" or "rendering workflow", work in the relevant repo — they don't share types or deps with this one.

## Execution defaults

- Proceed without asking confirmation. Auto-fix errors that surface during your own work.
- Run tasks fully to completion. Commit and push after each coherent unit of change.
- After completing a change: recap what changed, how to test it, what else was touched.
- **Exception**: pause and confirm before edits to `src/db/schema.ts`, `src/middleware/auth.ts`, `src/middleware/rbac.ts`, or `src/routes/cashfree.ts` — these match the "Don't touch without asking" table and the autonomy default does not override it.

## Quick orientation

1. `src/index.ts` + `src/worker.ts` — boot order shows all subsystems
2. `src/db/schema.ts` — every table
3. `src/config/constants.ts` — magic numbers, channel IDs, tenant slug
4. `CRM_SYSTEM_DOCS.md` — full narrative architecture overview
5. `.claude/skills/` — workflow skills (`ge-add-route`, `ge-cashfree-edge`, etc.) — load by name when starting related work
