# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

- **Repo**: `growth-escalators-backend-v2`
- **Live**:
  - `crm.growthescalators.com` — admin CRM SPA (Railway, auto-deploys from `main`)
  - `api.growthescalators.com` — public REST API (same Railway service)
  - `ecom.growthescalators.com` — D2C landing pages (Vercel, root dir = `client/`)
- **Local**: `~/repo-comparison/v2`
- **Stack**: Node 20 · Express · TypeScript · Drizzle (Postgres) · Vitest · Playwright · React (admin + client SPAs)

Before any session: `git pull origin main`. The repo deploys on push, so an out-of-date checkout means commits will fight live state.

## Commands

```bash
npm run dev              # API process — tsx watch on src/index.ts
npm run build            # tsc → dist/    (must be 0 errors before commit)
npm run start            # node dist/index.js (matches Railway start)
npm test                 # vitest --run (all tests)
npm test -- src/__tests__/billing.test.ts          # single file
npm test -- -t "computes proration"                 # by test name
npm run test:watch       # interactive
npm run test:coverage    # coverage report

# Frontend SPAs (separate deploys baked into the same monorepo)
npm run client:dev       # D2C landing page (Vite, served at /)
npm run admin:dev        # CRM admin panel (Vite, served at /crm)
npm run build:all        # builds client + admin + backend in order

# Database (Drizzle Kit)
npm run db:generate      # diff schema.ts against DB → emit migration SQL
npm run db:migrate       # apply pending migrations
npm run db:studio        # local web UI for the DB

# Specialised
npx tsx src/scripts/<name>.ts   # one-off ops scripts (run with env loaded)
npm run seo:doctor              # SEO automation health check
```

Tests **must** pass before commit. Type errors in `npm run build` block deploy.

## Architecture — the parts that aren't obvious from `ls`

### Two Railway services from one repo
- **`railway.json`** runs `node dist/scripts/migrate.js && node dist/index.js` — the **API process** (`src/index.ts`). Serves REST routes, mounts the admin SPA at `/crm`, serves the D2C landing at `/`, owns Socket.IO for the inbox.
- **`railway.worker.json`** runs `node dist/worker.js` — the **worker process** (`src/worker.ts`). Owns all cron jobs, background workers (`startStuckJobWorker`, `startSequenceWorker`, `startSocialPostWorker`), and long-running services (Meta CAPI catch-up, intelligence collection, IMAP polling).
- The processes share the codebase but **must not import each other's entry points**. Anything cron- or worker-shaped goes behind `src/services/` so both processes can call it cleanly.

### Routes vs services
- **`src/routes/*`** are thin Express handlers: validate → call a service → return JSON. They should rarely contain business logic.
- **`src/services/*`** is where the real work lives — DB access, third-party API calls, orchestration. Services are testable units; routes mostly aren't.
- When adding a feature: add/modify the service first, write a vitest test, then plumb a route handler.

### Schema lifecycle has two paths
- **Drizzle migrations** (`src/db/migrations/`) — generated from `src/db/schema.ts` via `db:generate`. Run on boot via `dist/scripts/migrate.js`. **Never hand-edit migrations or schema.ts** — change the schema and re-generate.
- **Runtime `ensure*` hooks** — many services have `ensureXTable()` / `ensureXColumns()` functions called fire-and-forget at the top of `src/index.ts` and `src/worker.ts` (search for `ensure` in those files). These cover ALTER TABLE deltas that pre-date Drizzle adoption, or columns added quickly during incidents. New columns should ideally go through Drizzle, but inheriting a service that uses `ensure*` — keep that pattern within the service.

### Frontend SPAs
- **`admin/`** — the CRM (Vite + React + Tailwind). Built artifacts served by the API process at `crm.growthescalators.com`.
- **`client/`** — the public D2C landing pages + payments. **Hosted on Vercel** at `ecom.growthescalators.com` (no longer served by Express). Vercel builds `client/` and runs the serverless functions in `client/api/*`.
- They're separate npm projects with their own `package.json`. `build:all` runs all three in order — useful locally; Vercel builds `client/` independently.
- Auth: admin uses JWT from the `/api/auth` flow; client is mostly public.

### Landing-page split + payment resilience
- `ecom.growthescalators.com` is on **Vercel**, fully decoupled from Railway. Pages render from bundled funnel configs (`client/src/data/funnelConfigs/*.json`) so first paint never depends on the API.
- Payments hit Vercel edge functions (`client/api/cashfree/*`) that call Cashfree directly and write to an **Upstash Redis Stream** (`crm:events`). The drainer in `src/services/edgeQueueDrainer.ts` reads from that stream into Postgres when Railway is healthy.
- `processCashfreeEvent()` in `src/services/cashfreeEventProcessor.ts` is the single canonical handler — used by both the legacy `/api/cashfree/webhook` route and the queue drainer. Idempotency via the `processed_events` table; do not duplicate this logic.
- API now lives at `api.growthescalators.com` (separate Railway custom domain). CORS is configured in `src/index.ts` to allow `ecom.*`, `crm.*`, `consulting.*`, `localhost:*`, and `*.vercel.app` previews.
- Full setup runbook: `docs/landing-page-resilience.md`.

### Cashfree integration gotchas (API v2023-08-01)
- Webhook event-type field is `body.type` — NOT `body.event_type`. The processor and edge `webhook.ts` accept either, but emit `type` going forward.
- Custom order data (segment, bumps, UTMs, fbp/fbc) MUST go in `order_tags` (Map<string,string>, preserved verbatim in webhooks). `order_meta` only preserves the standard keys (`return_url`, `notify_url`, `payment_methods`) — anything else gets silently dropped. See `client/api/cashfree/create-order.ts`.
- The processor reads from BOTH `order_tags` (new) and `order_meta` (legacy fallback), so in-flight orders made before this fix still process correctly.

### Contact dedup invariants
- `findOrCreateContact` does an EXACT match on `(channel_type, channel_value)`. Always normalize before passing in:
  - email → `.trim().toLowerCase()`
  - phone → strip non-digits, then prefix `91` if missing
- `lastActivityAt` MUST be bumped on every contact write. The CRM contacts list sorts by `lastActivityAt DESC, createdAt DESC` (`src/routes/contacts.ts:70`); without the bump, repeat buyers stay buried. All three current paths do this — `cashfreeEventProcessor`, `edgeQueueDrainer` lead handler, `routes/leads.ts`. Don't forget if you add a new contact-touching path.

### Vercel edge function gotchas (`client/api/**`)
- `client/package.json` has `"type": "module"` (Vite needs this), so Vercel runs edge functions in Node ESM mode. **Relative imports MUST include `.js` extensions** (TypeScript with `moduleResolution: "bundler"` allows this — it resolves to `.ts` at typecheck time but the path matches the runtime `.js`).
- Importing JSON in edge functions requires `with { type: 'json' }` import attributes that TypeScript strips. Do NOT bundle JSON configs in edge functions — the client SPA already bundles them at build time. Have edge proxies fail soft (`{ ok: false, config: null }`) and let `useFunnelConfig.js` keep its bundled fallback.
- 10s function timeout on Vercel Hobby. Don't fire-and-forget after sending the response — if the side-effect needs to definitely complete, `await` it before responding. (Known leaky: `pending_order` enqueue in `create-order.ts`. Low impact — the actual contact creation goes through the webhook path which is fully reliable.)

### Railway build gotchas
- Railway IGNORES the `nixpacksPlan` field embedded in `railway.json` / `railway.worker.json`. Use the root-level `nixpacks.toml` instead — Nixpacks reads it natively and respects it.
- Nixpacks defaults to `npm ci` with `NODE_ENV=production` which SKIPS devDependencies. Either keep build-time tools (typescript, etc.) in `dependencies`, or override the install phase in `nixpacks.toml` to `npm install --include=dev`. The current setup does both for safety.

### Multi-tenant
The system is multi-tenant by `tenants.slug`. The default slug `growth-escalators` lives in `src/config/constants.ts` as `DEFAULT_TENANT_SLUG`. Almost every query is tenant-scoped — when adding new tables, include `tenant_id` and the constraint to match.

### Constants live in one place
**`src/config/constants.ts`** holds Slack channel/user IDs, default tenant slug, magic-number defaults. Don't sprinkle string literals — pull from constants so changes are one edit.

### Auth / RBAC
- **`src/middleware/auth.ts`** — JWT verification (`requireAuth`, `optionalAuth`).
- **`src/middleware/rbac.ts`** — role checks. Don't bypass for "convenience"; if a route shouldn't need auth, that's a product decision.
- These two files plus `src/db/schema.ts` and `src/db/migrations/` are the system's load-bearing trust boundary.

### Logging
**Pino** structured logs throughout. Don't add `console.log` to production paths — use a Pino child logger. Worker startup intentionally uses `console.log` for boot ordering visibility; that's the exception, not the rule.

## Don't touch without asking

| Path | Reason |
|---|---|
| `src/db/schema.ts` | Schema changes need migration generation, not hand-edits |
| `src/db/migrations/` | Already-applied SQL — editing breaks Postgres state in prod |
| `src/middleware/auth.ts`, `src/middleware/rbac.ts` | Trust boundary; mistakes here leak data |
| `src/routes/cashfree.ts` | Real money; payment webhooks have idempotency invariants |
| `src/services/sodEodService.ts` Slack-DM logic | Sends to real humans on a schedule |

## Companion repos (different working directories)

This repo is the backend. Two adjacent repos exist:

- **`~/repo-comparison/ge-content-frontend`** — Next.js content-creation app (Sheets-backed). Separate Vercel deploy at content.growthescalators.com. Has its own CLAUDE-relevant rules in its README.
- **`~/Content Machine GE`** — n8n workflow definitions (graphics rendering pipeline) + template HTML. Workflows are deployed via API to Railway-hosted n8n.

When the user mentions "the content frontend" or "the rendering workflow", `cd` into the relevant repo before editing — those repos do not share types, deps, or CI with this one.

## Execution defaults

- Proceed without asking confirmation. Pick the best approach and execute.
- Auto-fix errors that surface during your own work.
- Run tasks fully to completion — don't pause mid-task waiting for input.
- Always commit and push after completing work. Each commit should match a coherent unit of change (fix, feature, refactor — not all three).
- After completing a change, recap what changed, how to test it, and what else got touched (caller sites, tests, configs).

## Quick orientation

If you've just landed in this repo and don't know where to start:
1. `src/index.ts` and `src/worker.ts` — boot order tells you what subsystems exist.
2. `src/db/schema.ts` — every table, one file.
3. `src/config/constants.ts` — the magic numbers and channel IDs.
4. `CRM_SYSTEM_DOCS.md` (root) — narrative architecture overview, deeper than this file.
