# Landing-page resilience runbook

This document captures the **manual** steps required to finish the move
described in `client/api/` + `src/services/edgeQueueDrainer.ts`. The code is
already merged; what follows is the dashboard configuration nobody can do
from a commit.

## Goal

- `ecom.growthescalators.com` (D2C landing pages, payments) **always** loads,
  even if Railway is down.
- `crm.growthescalators.com` (admin app + public API) can be brought offline
  for maintenance or recovery without touching marketing or payments.
- Postgres on Railway stays the single source of truth — the Upstash queue is
  a transport layer, not a second database.

## Architecture summary

```
ecom.growthescalators.com  ──► Vercel
                                 ├─ Static SPA (client/dist)
                                 └─ /api/*  Vercel serverless functions
                                            ├─ cashfree/create-order  → Cashfree REST
                                            ├─ cashfree/webhook       → Upstash queue
                                            ├─ funnel/waitlist        → Upstash queue
                                            ├─ leads/agency           → Upstash queue
                                            └─ funnel/* read-only     → proxy api.* w/ SWR

api.growthescalators.com   ──► Railway (Express, public API + admin SPA)
                                 └─ src/services/edgeQueueDrainer.ts drains
                                    Upstash → Postgres on its own schedule

crm.growthescalators.com   ──► Railway (same process, admin SPA host)
```

## One-time setup checklist

### 1. Provision Upstash Redis

1. Sign in at https://upstash.com → **Create Database** (Global, Eviction:
   `noeviction`, TLS on).
2. Copy the **REST URL** and **REST TOKEN** from the database overview page.
   You'll paste them into both Railway and Vercel below.

### 2. Add `api.growthescalators.com` as a Railway custom domain

1. In Railway, open the **Web** (API) service → **Settings → Domains** → add
   `api.growthescalators.com`. Railway shows a CNAME target.
2. In your DNS (Cloudflare / wherever): create a CNAME from
   `api.growthescalators.com` to that Railway target. Cloudflare proxy off if
   asked.
3. Once Railway shows the cert as issued, set the env var below.

### 3. Railway env vars (Web + Worker services)

| Var | Value | Notes |
|-----|-------|-------|
| `BACKEND_URL` | `https://api.growthescalators.com` | Used by `src/routes/cashfree.ts` to build webhook + return URLs. |
| `FRONTEND_URL` | `https://ecom.growthescalators.com` | Cashfree return URL after payment. |
| `UPSTASH_REDIS_REST_URL` | from step 1 | Required for the drainer + idempotency. |
| `UPSTASH_REDIS_REST_TOKEN` | from step 1 | |
| `EDGE_DRAINER_ENABLED` | `true` (or unset) | Set to `false` to halt the drainer. |
| `CORS_EXTRA_ORIGIN` | _optional_ | Whitelist a single extra origin if needed for QA. |

Both services need them — the API uses them for the `/api/cashfree/webhook`
fallback path, and the worker uses them to drain.

### 4. Create the Vercel project

1. https://vercel.com/new → Import the repo. **Root Directory:** `client`.
2. Vercel auto-detects Vite. Confirm:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Output directory: `dist`
3. **Settings → Domains** → add `ecom.growthescalators.com`. Vercel will
   prompt for a CNAME — point DNS there.
4. **Settings → Environment Variables** (Production):

| Var | Value |
|-----|-------|
| `CASHFREE_APP_ID` | (from Cashfree dashboard) |
| `CASHFREE_SECRET_KEY` | (from Cashfree dashboard) |
| `CASHFREE_WEBHOOK_SECRET` | (from Cashfree dashboard → Webhooks) |
| `CASHFREE_ENV` | `production` |
| `UPSTASH_REDIS_REST_URL` | from step 1 |
| `UPSTASH_REDIS_REST_TOKEN` | from step 1 |
| `API_BASE_URL` | `https://api.growthescalators.com` |
| `SITE_ORIGIN` | `https://ecom.growthescalators.com` |
| `WEBHOOK_URL` | `https://ecom.growthescalators.com/api/cashfree/webhook` |
| `VITE_CASHFREE_ENV` | `production` |

`VITE_API_BASE_URL` is intentionally **not set** — keeping it empty makes the
SPA call same-origin (so it hits the Vercel edge functions and not Railway
directly). Set it only if you want to bypass the edge layer.

### 5. Update Cashfree dashboard webhook URL

1. Cashfree → **Developers → Webhooks** → edit the active webhook.
2. URL → `https://ecom.growthescalators.com/api/cashfree/webhook`
3. Copy the webhook **secret** that Cashfree shows; this becomes
   `CASHFREE_WEBHOOK_SECRET` in Vercel (step 4) so signature verification
   works.
4. Save. The legacy URL (`https://api.growthescalators.com/api/cashfree/webhook`)
   stays as a code path so manual replay still works, but Cashfree only
   posts to one URL at a time.

### 6. DNS cutover

Switch `ecom.growthescalators.com` from Railway to Vercel by updating the DNS
record (CNAME → Vercel target). After propagation (usually < 5 min) the
landing pages serve from Vercel CDN.

## Verification

Run these checks once everything is wired up.

### A. Pages always load
- Visit `https://ecom.growthescalators.com` and every other page (`/checkout`,
  `/learn`, `/consulting`, `/whitelabel`, `/agency`, `/community`,
  `/thank-you`). All render.
- In Railway, **stop the Web service** for 60 seconds. Reload all pages —
  they still render (bundled funnel configs, no API needed for render).
- Restart the Railway service.

### B. Payments work even when Railway is down
1. Stop the Railway Web service again.
2. From `/checkout`, complete a Cashfree **test-mode** purchase.
3. Confirm in Vercel Functions logs that
   `/api/cashfree/create-order` returned a `payment_session_id`.
4. After payment success, confirm in Cashfree dashboard that the webhook was
   delivered, and in Upstash that the Stream has a new entry on `crm:events`.
5. Restart Railway. Within ~5 seconds the worker logs
   `[edge-drainer] consumer group railway-drainer created` and starts
   processing. Within ~30s the contact, deal, sequence enrolment, Slack
   message, Brevo email, and CAPI Purchase event all fire as normal.

### C. Idempotency
- Replay the same webhook event from Cashfree dashboard. The edge `SET NX`
  rejects it; even if it gets through, the `processed_events` table on
  Postgres blocks the duplicate. No duplicate contacts/deals appear.

### D. DLQ
- POST a malformed body to `https://ecom.growthescalators.com/api/cashfree/webhook`
  with a fake signature. The function should 401. Push a deliberately
  malformed entry into `crm:events` directly via Upstash console — the
  drainer ACKs it and moves it to `crm:events:dlq` without blocking.

## Rollback

If anything goes wrong:

1. **Cashfree:** flip the webhook URL back to
   `https://api.growthescalators.com/api/cashfree/webhook`. The legacy route
   in `src/routes/cashfree.ts` is unchanged and still works.
2. **DNS:** point `ecom.growthescalators.com` back at Railway. The Express
   client-serving block was removed but the Vite `dist/` artifacts are in
   `client/dist/` — copy them to `public/client/` and redeploy if you need
   the legacy path back.
3. **Drainer:** set `EDGE_DRAINER_ENABLED=false` on the Railway Worker
   service and redeploy. The drainer becomes a no-op without halting other
   workers.

## Files of interest

| File | What it does |
|------|--------------|
| `src/services/cashfreeEventProcessor.ts` | Idempotent Cashfree event handler shared by the legacy route + the drainer. |
| `src/services/edgeQueueDrainer.ts` | Polls Upstash stream, dispatches to processors, ACKs or DLQs. |
| `src/services/upstashClient.ts` | Lazy Upstash client + queue config constants. |
| `src/routes/leads.ts` | `POST /api/leads/agency` for the white-label form. |
| `client/api/_lib/queue.ts` | Edge-side enqueue + Cashfree idempotency lock. |
| `client/api/_lib/cashfree.ts` | Cashfree REST creds + webhook signature verify. |
| `client/api/_lib/proxy.ts` | Cached proxy with stale-while-revalidate fallback. |
| `client/src/data/funnelConfigs/*.json` | Bundled funnel configs — page renders even if API is dead. |
| `client/vercel.json` | Vercel build + SPA rewrite config. |
