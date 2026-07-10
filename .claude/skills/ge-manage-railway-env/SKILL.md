---
name: ge-manage-railway-env
description: Use when adding, changing, or reviewing a Railway/Vercel environment variable for this repo — enabling a feature flag, pointing a service at a URL, rotating a key, or diagnosing "the env var isn't taking effect". Triggers include "set WIZMATCH_X on railway", "add an env var for Y", "flip the feature flag in prod", "rotate a provider key", "which service needs this env". Skips: local .env edits only (no deploy impact), code that reads env (that's normal dev), secrets you must never print.
---

# Managing Railway / Vercel env vars

Env changes are production-sensitive: the wrong variable on the wrong service silently breaks a
flow, and printing a secret leaks it. There's a generic `use-railway` global skill for the tooling;
this adds the **repo-specific map** and safety rules. Reference:
[`docs/DEPLOYMENT.md`](../../../docs/DEPLOYMENT.md), [`docs/SECURITY.md`](../../../docs/SECURITY.md).

## Which var feeds which subsystem
- **Wizmatch cron block** needs `WIZMATCH_TENANT_ID` set **and** `DISABLE_BACKGROUND_JOBS !== 'true'`
  on the **worker** — else jobs never run (see `wizmatch-add-cron`).
- **Worker → web calls** use `WIZMATCH_API_BASE_URL` (not localhost) — else signals stall.
- **Sending** gated by `WIZMATCH_SENDING_ENABLED` (+ `WIZMATCH_BOUNCE_SUPPRESSION_ENABLED`,
  `WIZMATCH_MAX_SENDS_PER_INBOX_DAY`) — see `wizmatch-go-live-sending`.
- **Discovery cost** via `WIZMATCH_ENABLE_APOLLO/SNOV`, `WIZMATCH_GOOGLE_FALLBACK_ENABLED`, budgets
  (see `wizmatch-cost-guard`).
- **Money/webhooks** (Cashfree keys, HMAC secrets) — treat as guardrail; confirm before change.

## Rules
1. **Right service.** This repo may run split `web` + `worker` on Railway. Worker-only flags
   (crons, `DISABLE_BACKGROUND_JOBS`) must be set on the **worker** service, not just web. Verify
   the actual Railway topology before assuming.
2. **Feature flags default safe.** Turning one on in prod is a deliberate change — confirm.
3. **Never print secrets.** Never echo `DATABASE_URL`, JWT/HMAC secrets, Cashfree keys, Apollo/Snov
   keys, Purelymail passwords, Slack tokens. Reference them by name only.
4. **Verify it took effect.** After setting, confirm the service redeployed/restarted and the flow
   behaves — an env change without a restart does nothing.
5. **A change here is a deploy.** Setting a var can trigger a redeploy — production-sensitive,
   same care as a push.

## Never
- Never set a worker-only flag on the web service (or vice-versa) and assume it works.
- Never print or paste a secret value back to the user or into a file.
- Never flip a money/webhook-related var without explicit confirmation.
