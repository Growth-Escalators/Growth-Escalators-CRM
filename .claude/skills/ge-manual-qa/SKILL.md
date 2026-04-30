---
name: ge-manual-qa
description: Use after a non-trivial CRM admin or D2C frontend deploy to walk the high-value user paths in a browser before declaring the change shipped. Triggers include "QA the deploy", "smoke test the admin", "let's manually verify before we move on", or any prompt asking to validate UI behaviour after a change. Skips: backend-only changes with vitest coverage (unit tests are enough), tiny copy/CSS tweaks, anything under a feature flag that's still off.
---

# Manual QA — high-value paths only

Vitest covers the API. The admin SPA and the D2C landing pages don't have e2e coverage, so a 5-minute manual walk catches bundle-drift, route-mount, and layout regressions that unit tests can't see. Don't run all 100 checks from the archived TESTING-CHECKLIST — run the handful that have actually broken in production.

Production URLs in [`docs/URLS.md`](../../../docs/URLS.md). Login: `jatin@growthescalators.com`.

## Pre-QA

1. Confirm the deploy actually shipped:
   ```bash
   curl -s https://api.growthescalators.com/health
   ```
   Should be 200. If it's not, you're QAing the OLD build.
2. Hard-refresh the admin SPA (`Cmd+Shift+R` on macOS) — Cached `admin/dist/index-*.js` will silently mask new bundle changes. Compare the bundle hash in `<script src=...>` against `git log --oneline -1` to make sure you're on the right build.

## Path 1 — D2C purchase smoke (CRITICAL — this is real money)

1. Open `https://ecom.growthescalators.com/` in a private window.
2. Walk one funnel to the checkout. Don't actually pay (use a test card if Cashfree is in sandbox; otherwise stop at the payment page).
3. Confirm payment page loads — `payment_session_id` returned by `/api/cashfree/create-order`. If 502, edge function is broken — see `ge-cashfree-edge`.
4. Open Vercel function logs in another tab; verify `[edge create-order]` log appears with the right segment + bumps.

If you DO complete a real test purchase:
- The contact must appear in CRM contacts list within 30s.
- The deal must appear in the pipeline.
- `lastActivityAt` should be the test time (sort by Activity column in admin).

## Path 2 — Admin SPA core (catches bundle drift)

1. `https://crm.growthescalators.com/` → log in.
2. Dashboard loads, 4 metric cards have numbers (not "—" or "0" if there should be data).
3. Click into Contacts → list renders, search works, click a row → detail panel opens.
4. Click into Pipeline → drag any deal card → drop on a different stage → refresh → verify it stuck. (Pipeline drag persistence has broken twice from drag library updates.)
5. Click any deal card → detail slide-in opens with name, email, phone populated. Empty fields here = `c.email`/`c.phone` SELECT regression — see [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md).

## Path 3 — Auth boundary (security regression check)

1. In a private window, hit `https://api.growthescalators.com/api/contacts` with no auth header. Must be 401.
2. Log in as a non-admin role (if you have one) — admin-only pages (Intelligence, Billing, Outreach) must NOT appear in sidebar AND must 403 if URL is typed directly.
3. Any new admin-only endpoint added in this deploy: hit it as a regular user, confirm 403.

## Path 4 — Anything you actually changed

Whatever the deploy touched, click through it end-to-end. Tests cover the service; this step covers the wiring. If you added a new route, exercise it via the admin SPA. If you changed a webhook payload, find a way to fire one (replay endpoint, test fixture).

## Post-QA

- Document failures in plain text with the EXACT error (status code, error message, screenshot if UI). Not "it broke" — "POST /api/contacts/123/archive returned 500: cannot read property tenantId of undefined". Specifics matter for the next debugging cycle.
- If anything failed, do NOT report the deploy as done. Either roll back or fix forward; don't leave a half-shipped state.
- After fixes are in, re-run the path that failed (don't skip — the fix may have side-effects on other paths).

## When to skip

- Backend-only change with new vitest coverage and no API surface change → unit tests are enough.
- Pure CSS/copy edit on a non-critical page → eyeball the page, ship.
- Behind a flag that's still off → flip the flag in dev only, don't QA in prod.
- The change is itself a fix to broken QA — verify the fix worked, don't re-walk all 4 paths.

## Reference

- Archived full checklist (100+ items, mostly low-value): [docs/_archive/TESTING-CHECKLIST.md](../../../docs/_archive/TESTING-CHECKLIST.md) — pull from this only when explicitly investigating a regression in a specific area.
- [`docs/URLS.md`](../../../docs/URLS.md) — production URLs
- [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md) — what each failure mode means
