# TEST_PLAN.md — Self-verification before anything goes live

This is the standing protocol every AI agent follows **before** a change is called done or
shipped to production. The intent (set by Jatin, 2026-07-10): *build → verify automatically →
verify by hand / against real data → make it live → **then** ask for feedback.* Do not ask for
feedback on something that hasn't been verified and, where appropriate, made live.

It complements `REVIEW_CHECKLIST.md` (code-quality gate) — this file is the **runtime / behaviour**
gate: does the thing actually work when exercised?

---

## A. Universal gate — run for EVERY change

Run all of these and report the real result (paste output if anything fails):

1. **Build**: `npm run build` exits 0.
2. **Tests**: `npm test` — all green. If behaviour changed, a test proves the new behaviour.
3. **Admin build** (if any `admin/` file changed): `npm run admin:build` succeeds.
4. **Read-only real-data check**: exercise the new path against real data with **no writes and no
   paid spend** — a script, a `GET`/preview endpoint, a local function call against a real domain,
   or a DB read. Confirm the output is what you claim. (Example: the discovery cascade was run
   against `logixguru.com` / `infosys.com` read-only before merge.)
5. **Side-effect + guardrail review**: `git diff --stat`; confirm only intended files changed and
   none of the guardrail paths (`src/db/schema.ts`, `src/db/migrations/`, `src/middleware/auth.ts`,
   `src/middleware/rbac.ts`, `src/routes/cashfree.ts`, `sodEodService.ts` Slack-DM) were touched
   without explicit approval.
6. **Money check**: if the change can spend real money, **pause and get explicit go** before any
   spend. Verification itself must stay free/read-only.

## B. Ship + post-deploy verification

7. Branch → PR → merge (main auto-deploys to Railway). Never push to `main` directly.
8. **Watch the deploy** reach `SUCCESS` (Railway MCP `list_deployments`).
9. **Health check** the live API (`GET /health` → 200; DB `ok`). Note any pre-existing `degraded`
   reasons so they aren't mistaken for regressions.
10. **Live smoke** of the specific change where it's free to do so (read-only endpoint, dashboard
    load, or a ₹0 path). Only then report to the user + hand them the manual checklist below.

---

## C. Per-feature manual checklists

Add a short checklist per feature so the change can be hand-verified on the live dashboard.

### Wizmatch — Free-first contact discovery (shipped PR #18, 2026-07-10)
On the CRM → Wizmatch → **Contact Intelligence** page:
- [ ] Open a seeded company → **Discovery Preview** shows estimated cost **~₹0–1** (not ₹31) and a
      provider order starting `internal_crm_reuse → website_manual_pattern …` with **no apollo/snov**.
- [ ] **Run discovery** on a company with a real website → contacts appear with a **confidence
      badge** (high/medium/low), a **role inbox** tag where relevant, a **Google/Microsoft** label,
      and one line of plain guidance.
- [ ] A company with a published `careers@`/`hr@`/`info@` returns a **HIGH** contact; a company with
      none returns honest **LOW** guesses (never a false "verified").
- [ ] Cost controls panel still shows month/day spend within the ₹500/mo cap; spend recorded ≈ estimate.
- [ ] DB spot-check (read-only): `wizmatch_discovery_runs` for the company shows `paid_provider=false`
      / cost ≈ 0 and Apollo/Snov were **not** called.

Env flags for this feature: `WIZMATCH_GOOGLE_FALLBACK_ENABLED` (Serper rung, on),
`WIZMATCH_ENABLE_APOLLO` / `WIZMATCH_ENABLE_SNOV` (paid providers, off by default).

---

## D. When to STOP and ask the user first
- Any real-money spend (paid API, paid outreach).
- Any guardrail-path change.
- Any production data mutation / migration / backfill.
- Any deploy-config or cron-schedule change (schedules stay `workflow_dispatch` until approved).
- When you cannot verify a claim — say so plainly rather than shipping on hope.
