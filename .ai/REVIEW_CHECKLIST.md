# REVIEW_CHECKLIST.md

Every change passes this gate before it's called done. Reviewer (Codex first pass, Claude for
risky paths) works top-to-bottom. Save notable reviews under `docs/reviews/`.

## Build & tests

- [ ] `npm run build` exits 0 (no new `tsc` errors).
- [ ] `npm test` passes; new logic has tests where practical.
- [ ] If the admin SPA changed: `npm run admin:build` succeeds and `public/admin` is rebuilt.

## Correctness

- [ ] Contact writes normalise email (`trim().toLowerCase()`) and phone (digits-only, `91` prefix).
- [ ] `lastActivityAt` bumped on every contact write.
- [ ] Any query joining `contacts` / Wizmatch tables aliases filter columns (no 42702 ambiguity).
- [ ] Worker-side code calls the public API base URL, not `localhost`.

## Guardrails

- [ ] No unapproved edits to `src/db/schema.ts`, `src/db/migrations/`, `auth.ts`, `rbac.ts`,
      `cashfree.ts`, or `sodEodService.ts` Slack logic.
- [ ] No deployment (Railway/Vercel) config change unless the task required it.
- [ ] Schema change (if approved) went through `npm run db:generate`, not a hand-edited migration.

## Scope & hygiene

- [ ] Diff is one coherent unit; nothing unrelated snuck in.
- [ ] Secrets/keys not hard-coded; env vars used.
- [ ] Follows surrounding code style (naming, structure, comment density).

## Trail

- [ ] `.ai/HANDOFF_LOG.md` appended; `.ai/CURRENT_TASK.md` / `CURRENT_STATE.md` updated if needed.
- [ ] Commit message explains what and why; ends with the Co-Authored-By line.
