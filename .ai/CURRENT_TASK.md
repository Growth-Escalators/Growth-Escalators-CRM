# CURRENT_TASK.md

## Active task

**Wizmatch API cost protection** — add a hard-blocking cost/rate guard around Contact
Intelligence paid discovery so Apollo/Snov/Reacher/Google fallback cannot create unexpected
spend. Discovery remains manual, authenticated, preview-first, and disabled by default unless
env-enabled.

Scope is **Contact Intelligence cost-guard backend services/routes, admin UI visibility, tests,
generated admin bundle, env documentation, and AI context**. This task must not add new database
tables, migrations, automatic outreach sending, automatic candidate submissions, worker/cron
automation, deployment config changes, `package.json`, or `package-lock.json`.

## Definition of done

- [x] Add provider adapters in `src/services/wizmatchContactDiscoveryProviders.ts`.
- [x] Add discovery config, eligibility preview, provider orchestration, dedupe, max-3 candidate
  cap, Reacher verification handling, Google fallback gating, and provider-error handling.
- [x] Add `POST /api/wizmatch/contact-intelligence/companies/:companyId/discovery-preview`.
- [x] Add `POST /api/wizmatch/contact-intelligence/companies/:companyId/discover`.
- [x] Require `confirmPreview=true` before a discovery run executes.
- [x] Persist discovery runs and candidates into existing Contact Intelligence tables only.
- [x] Keep discovery manual and authenticated; no outreach is sent and no candidate is submitted.
- [x] Add env switches to `.env.example`, defaulting paid discovery and Google fallback off.
- [x] Add reusable cost guard config/evaluation using existing `wizmatch_discovery_runs` rows.
- [x] Add hard-blocking monthly/daily/user/provider caps, defaulting to a ₹5,000/month pilot.
- [x] Add provider-env checks for Apollo, Snov, Reacher, and SERPER when Google fallback is enabled.
- [x] Require a cost-guard token before provider execution can run.
- [x] Add a Postgres advisory lock around confirmed discovery runs to prevent double-click/race
  duplicate provider calls.
- [x] Persist blocked confirmed discovery attempts as zero-cost `blocked_by_cap` audit rows with
  budget/block metadata.
- [x] Update Contact Intelligence V2 UI with preview/run controls, provider order, caps, blocked
  reasons, budget posture, provider env status, and provider result metadata.
- [x] Update readiness/guardrail language so paid discovery is gated rather than permanently
  blocked, while auto-send/auto-submit/cron remain blocked.
- [x] Add focused tests for eligibility, caps, cooldown, provider fallback order, Reacher invalid
  handling, provider failures, max-3 dedupe, cost guard budget/provider/user caps, provider env
  blocks, no-provider-without-token behavior, and route registration.
- [x] Run backend build, full Vitest suite, and admin build.

## Next task

Before enabling paid discovery in production, validate `/wizmatch/readiness` while logged in,
confirm the Contact Intelligence tables exist and have expected data, confirm the Cost Controls
card shows expected budget/provider-env state, set provider env vars only in the intended Railway
environment, then run one manual preview and one controlled discovery against a Tier A company.
Automatic outreach, automatic candidate submissions, and worker/cron automation remain out of
scope.
