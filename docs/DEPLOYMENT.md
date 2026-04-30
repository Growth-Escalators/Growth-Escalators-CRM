# Deployment

## Services

| Service | Platform | Config file | Start command |
|---|---|---|---|
| API process | Railway | `railway.json` | `node dist/scripts/migrate.js && node dist/index.js` |
| Worker process | Railway | `railway.worker.json` | `node dist/worker.js` |
| D2C landing (`ecom.*`) | Vercel | `client/vercel.json` | Vite build |

## Railway build gotchas

- Railway **ignores** the `nixpacksPlan` field embedded in `railway.json` / `railway.worker.json`. Use the root-level `nixpacks.toml` — Nixpacks reads it natively.
- Nixpacks defaults to `npm ci` with `NODE_ENV=production`, which **skips devDependencies**. The current setup keeps build-time tools (typescript, etc.) in `dependencies` AND overrides the install phase in `nixpacks.toml` to `npm install --include=dev` — both for safety.
- Two separate Railway services share this repo. Both must build cleanly from the same `nixpacks.toml`.

## Vercel edge function gotchas (`client/api/**`)

- `client/package.json` has `"type": "module"` (Vite needs this), so Vercel runs edge functions in Node ESM mode. **Relative imports must include `.js` extensions** — TypeScript with `moduleResolution: "bundler"` allows this (resolves to `.ts` at typecheck time; the path matches the runtime `.js`).
- Importing JSON in edge functions requires `with { type: 'json' }` import attributes, which TypeScript strips. **Do NOT bundle JSON configs in edge functions** — the client SPA bundles them at build time. Have edge proxies fail soft (`{ ok: false, config: null }`) and let `useFunnelConfig.js` keep its bundled fallback.
- 10s function timeout on Vercel Hobby. Don't fire-and-forget after sending the response — `await` any side-effect that must complete before responding.

## Cashfree integration gotchas (API v2023-08-01)

- Webhook event-type field is `body.type` — **NOT** `body.event_type`. The processor and edge `webhook.ts` accept either, but emit `type` going forward.
- Custom order data (segment, bumps, UTMs, fbp/fbc) **must** go in `order_tags` (Map\<string,string\>, preserved verbatim in webhooks). `order_meta` only preserves standard keys (`return_url`, `notify_url`, `payment_methods`) — anything else is silently dropped. See `client/api/cashfree/create-order.ts`.
- The processor reads from BOTH `order_tags` (new) and `order_meta` (legacy fallback) so in-flight orders made before this fix still process correctly.

## Pre-deploy checklist

```bash
npm run build          # must exit 0 — type errors block deploy
npm test               # must pass — failing tests block commit
git push origin main   # Railway auto-deploys on push
```

## Landing-page resilience

Full setup runbook: [`docs/landing-page-resilience.md`](landing-page-resilience.md).

Architecture summary: Vercel edge functions write to Upstash Redis Stream (`crm:events`); the drainer at `src/services/edgeQueueDrainer.ts` reads into Postgres. This decouples payment capture from Railway availability.
