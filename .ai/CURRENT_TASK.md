# CURRENT_TASK.md

## Active task

**Wizmatch Contact Intelligence Phase 3: preview-first paid discovery** — add a manual,
config-gated discovery workflow for Apollo/Snov/Reacher and controlled Google fallback while
keeping outreach sending, candidate submissions, and worker/cron automation blocked.

Scope is **Contact Intelligence backend services/routes, admin UI, tests, generated admin bundle,
env documentation, and AI context**. This task must not add new database tables, migrations,
automatic outreach sending, automatic candidate submissions, worker/cron automation,
deployment config changes, `package.json`, or `package-lock.json`.

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
- [x] Update Contact Intelligence V2 UI with preview/run controls, provider order, caps, blocked
  reasons, and provider result metadata.
- [x] Update readiness/guardrail language so paid discovery is gated rather than permanently
  blocked, while auto-send/auto-submit/cron remain blocked.
- [x] Add focused tests for eligibility, caps, cooldown, provider fallback order, Reacher invalid
  handling, provider failures, max-3 dedupe, and route registration.
- [x] Run backend build, full Vitest suite, and admin build.

## Next task

Before enabling paid discovery in production, validate `/wizmatch/readiness` while logged in,
confirm the Contact Intelligence tables exist and have expected data, set provider env vars only
in the intended Railway environment, then run one manual preview and one controlled discovery
against a Tier A company. Automatic outreach, automatic candidate submissions, and worker/cron
automation remain out of scope.
