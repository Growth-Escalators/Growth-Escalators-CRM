# Architecture

## Two Railway services from one repo

- **`railway.json`** — runs `node dist/scripts/migrate.js && node dist/index.js`. The **API process** (`src/index.ts`). Serves REST routes, mounts the admin SPA at `/crm`, serves the D2C landing at `/`, owns Socket.IO for the inbox.
- **`railway.worker.json`** — runs `node dist/worker.js`. The **worker process** (`src/worker.ts`). Owns all cron jobs, background workers (`startStuckJobWorker`, `startSequenceWorker`, `startSocialPostWorker`), and long-running services (Meta CAPI catch-up, intelligence collection, IMAP polling).

The two processes share the codebase but **must not import each other's entry points**. Anything cron- or worker-shaped goes behind `src/services/` so both can call it cleanly.

## Routes vs services

- **`src/routes/*`** — thin Express handlers: validate → call a service → return JSON. Rarely contain business logic.
- **`src/services/*`** — real work: DB access, third-party API calls, orchestration. Services are testable units; routes mostly aren't.
- When adding a feature: service first + vitest test, then plumb a route handler.

## Frontend SPAs

- **`admin/`** — the CRM (Vite + React + Tailwind). Built artifacts served by the API process at `crm.growthescalators.com`.
- **`client/`** — the public D2C landing pages + payments. **Hosted on Vercel** at `ecom.growthescalators.com` (not served by Express). Vercel builds `client/` and runs serverless functions in `client/api/*`.
- Both are separate npm projects with their own `package.json`. `build:all` runs all three in order — useful locally; Vercel builds `client/` independently.
- Auth: admin uses JWT from the `/api/auth` flow; client is mostly public.

## Landing-page split + payment resilience

- `ecom.growthescalators.com` is on **Vercel**, fully decoupled from Railway. Pages render from bundled funnel configs (`client/src/data/funnelConfigs/*.json`) so first paint never depends on the API.
- Payments hit Vercel edge functions (`client/api/cashfree/*`) → write to an **Upstash Redis Stream** (`crm:events`). The drainer in `src/services/edgeQueueDrainer.ts` reads that stream into Postgres when Railway is healthy.
- `processCashfreeEvent()` in `src/services/cashfreeEventProcessor.ts` is the single canonical handler — used by both the legacy `/api/cashfree/webhook` route and the queue drainer. Do not duplicate this logic.
- API lives at `api.growthescalators.com` (separate Railway custom domain). CORS allows `ecom.*`, `crm.*`, `consulting.*`, `localhost:*`, and `*.vercel.app` previews.

Full setup runbook: [`docs/landing-page-resilience.md`](landing-page-resilience.md).

## Quick file map

| Entry point | What it boots |
|---|---|
| `src/index.ts` | API process — route mounting, middleware, Socket.IO |
| `src/worker.ts` | Worker process — cron jobs, background services |
| `src/db/schema.ts` | All tables in one file |
| `src/config/constants.ts` | Magic numbers, Slack IDs, tenant slug |
