---
name: ge-release-check
description: Use right before pushing to main — code change is ready, tests are written, you're about to ship. Triggers include "let's push this", "ready to ship", "commit and deploy", "wrap up and push", or any user prompt that ends a working session with intent to merge. Skips: WIP commits on a branch, single-file documentation tweaks the user explicitly says to push without checks, anything where the user has already run build+test in-conversation.
---

# Pre-push release check

Railway auto-deploys every push to `main`. There is no staging. Half the prod-down incidents in this repo started as a "small fix" pushed without the build+test loop. Run the loop every time.

Reference: [`docs/DEPLOYMENT.md`](../../../docs/DEPLOYMENT.md) "Pre-deploy checklist".

## Steps

1. **`npm run build`** — must exit 0. TypeScript errors block Railway: the start command is `node dist/scripts/migrate.js && node dist/index.js`, and if `tsc` failed there's no `dist/`. If errors surface, fix them — don't skip the build, don't push hoping it'll resolve.

2. **`npm test`** — must pass. Vitest. If a test that was passing now fails because of your change, that's the test telling you the change has a side effect you didn't predict; understand the failure before "fixing" the test.

3. **`git status`** — review what's actually staged.
   - Pull any out-of-zone files (other windows' WIP) — see the 4-window git hygiene note in `.claude/handoffs/misc.md`.
   - Don't commit `.env`, `*.log`, `dist/`, generated bundles unless they're meant to be tracked.
   - Admin/client bundle changes (`admin/dist/index-*.js`, `client/dist/*`) — Railway rebuilds admin on push, but committing the rebuilt bundle alongside source ensures consistency. Check the existing repo convention before deciding (some repos track bundles, some don't — this one does for admin).

4. **`git diff --staged`** — last sanity read.
   - Any debug `console.log` left behind? Use Pino instead per [`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md).
   - Any hardcoded test data, hardcoded local URLs, hardcoded credentials?
   - Any commented-out code blocks? Delete or explain.
   - Any half-finished migrations or schema edits without a regenerated SQL? See `ge-add-migration`.

5. **Commit message style.** Match the repo convention from `git log --oneline -10`:
   ```
   type(scope): short imperative description
   ```
   Real examples from this repo: `fix(cashfree): lowercase email + strip phone non-digits before contact dedup`, `chore: remove unused consulting subdomain from CORS, fix stale Railway URL in Meta CAPI`, `feat: decouple landing pages to Vercel with edge-resilient payments`.

   Don't write `update X` or `fix bug` — the type/scope prefix is load-bearing for `git log` skimming.

6. **One coherent unit per commit.** A bug fix doesn't need a refactor stapled on; a feature commit doesn't need unrelated cleanup folded in. If you have two unrelated changes, split into two commits.

7. **Push.**
   ```bash
   git push origin main
   ```
   Railway picks up within ~30 seconds and starts building. Watch the deploy logs in the dashboard if the change is risky.

8. **After push — wait + verify.**
   ```bash
   curl https://api.growthescalators.com/health
   curl https://crm.growthescalators.com/health
   ```
   Both should return 200. If either is 5xx within 5 min of pushing, the new build broke prod — go to `ge-debug-prod-down`.

## Skip-the-check exceptions (rare)

- README / docs-only edits: `npm run build` still runs in <30s, just run it. Don't argue.
- Reverting a single commit because prod is on fire: build + test still required, but if they fail because of the same bug you're reverting, push the revert anyway and fix forward.

## Common ways this goes wrong

- Pushed before `npm run build` passed → Railway deploys nothing (no `dist/`), API stays on old version, monitoring quietly shows the old commit hash. Looks fine until the next push exposes it.
- Pushed with failing tests → CI is "advisory" here (no GitHub Actions gate); Railway deploys it anyway. The failing test eventually catches a regression in 2 weeks and you're left guessing what changed.
- Squashed unrelated changes into one commit → next time prod breaks, `git log` skim doesn't isolate the cause and `git revert` becomes painful.
- Skipped reading the diff → committed the WIP from another window's zone (4-window git hygiene).

## Reference

- [`docs/DEPLOYMENT.md`](../../../docs/DEPLOYMENT.md) — pre-deploy checklist + Railway build gotchas
- [`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md) — commit style + logging
- [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md) — if the post-push health check goes red
