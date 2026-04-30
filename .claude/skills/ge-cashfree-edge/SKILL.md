---
name: ge-cashfree-edge
description: Use when touching Cashfree integration — edge functions in client/api/cashfree/, the canonical processor src/services/cashfreeEventProcessor.ts, src/routes/cashfree.ts, or anything in client/api/_lib/. Triggers include "fix(cashfree):", "Cashfree webhook isn't firing", "thank-you page is blank", "edge function 500 on Vercel", "create-order returning 502", or any change to order_tags / order_meta / signature verification. Skips: D2C admin UI, content frontend, CRM views that just read events.
---

# Cashfree integration

Cashfree is real money — every change here gets defensive review. Five gotchas have already cost us production incidents; the canonical handler is `src/services/cashfreeEventProcessor.ts`. The route in `src/routes/cashfree.ts` and the edge in `client/api/cashfree/webhook.ts` both delegate to it.

Reference: [`docs/DEPLOYMENT.md`](../../../docs/DEPLOYMENT.md) Cashfree + Vercel sections.

## The five gotchas

1. **`body.type` not `body.event_type`** — Cashfree API v2023-08-01 sends `type`. Older payloads (and our test fixtures) use `event_type`. The processor and edge `webhook.ts` accept either via `(body.type ?? body.event_type)`. New code must accept both. The drainer normalises onto `event_type` for queued payloads — keep that contract.

2. **Custom data goes in `order_tags`, not `order_meta`** — `order_meta` only preserves `return_url`, `notify_url`, `payment_methods`. Anything else (segment, bumps, UTMs, fbp/fbc) is silently dropped by Cashfree. Use `order_tags: Map<string, string>` — it's preserved verbatim in the webhook payload. Stringify booleans/numbers (`String(body.bump1 ?? false)`) — `order_tags` values must be strings. The processor reads BOTH for backwards-compat with in-flight orders.

3. **ESM .js extensions in edge imports** — `client/package.json` has `"type": "module"`, so Vercel runs edge functions in Node ESM mode. Relative imports must include `.js` (e.g. `from '../_lib/cors.js'`) even though the source is `.ts`. TypeScript with `moduleResolution: "bundler"` resolves `.js` to `.ts` at typecheck time. Miss the extension → edge function 500 with an opaque module-resolution error.

4. **10s function timeout on Vercel Hobby** — never fire-and-forget after `res.send()`. Either `await` the side-effect before responding, or push to Upstash queue and let Railway drain it. The current pattern: queue the event, return 200 immediately; the drainer in `src/services/edgeQueueDrainer.ts` does the actual CRM write.

5. **No JSON imports in edge functions** — `import x from './x.json'` requires `with { type: 'json' }` import attributes, which TypeScript strips. Edge functions must fail soft (`{ ok: false, config: null }`) and let the SPA bundle the JSON at build time. See `useFunnelConfig.js` for the bundled-fallback pattern.

## Steps

1. **Identify the layer.** Edge function (`client/api/cashfree/*.ts`) for capture and acknowledgement; processor (`src/services/cashfreeEventProcessor.ts`) for the canonical CRM write; route (`src/routes/cashfree.ts`) for direct Express access (legacy + admin replays).

2. **Edge functions — keep them thin.** Read raw body (signature verification needs original bytes — see `webhook.ts`), verify Cashfree HMAC via `verifyCashfreeWebhook`, claim the event in Redis (`tryClaimWebhook(cfPaymentId)`), enqueue, return 200. Don't write to Postgres from the edge. Don't await Railway endpoints from the edge.

3. **Always return 200 on retryable failures.** If Upstash is down, `deadLetter` the body and still 200 — Cashfree retries don't help if the queue is broken. The DLQ has the event for replay. The only valid 4xx/5xx is signature failure (401) or genuinely-bad input (400).

4. **Webhook URL points at `ecom.growthescalators.com`, not the Railway API.** `WEBHOOK_URL` defaults to `${SITE_ORIGIN}/api/cashfree/webhook` so the edge handles capture even when Railway is down. Don't change this to the API host without thinking through landing-page resilience — see [`docs/landing-page-resilience.md`](../../../docs/landing-page-resilience.md).

5. **For new fields on the order, add them to BOTH `order_tags` (capture) AND processor parsing.** The processor merges `order_tags ?? order_meta` ([src/services/cashfreeEventProcessor.ts:74-75](../../../src/services/cashfreeEventProcessor.ts#L74-L75)) — both sides need to know about the field.

6. **Test with both event-name shapes.** Vitest fixtures should cover `body.type = 'PAYMENT_SUCCESS_WEBHOOK'` AND `body.event_type = 'PAYMENT_SUCCESS_WEBHOOK'`. Drift between the two surfaces silently — no error, just "no contact created" because the processor early-returned.

7. **Verify before commit:** `npm run build`, `npm test`. If the edge changed, also `cd client && npm run build` to catch ESM-extension drift before Vercel does. Commit style: `fix(cashfree):` / `feat(cashfree):`.

## Common ways this goes wrong

- Read `body.event_type` only → Cashfree's v2023 webhook has `type` → silent ignore → no contact, no deal, money taken.
- Put `segment` in `order_meta` → Cashfree drops it → processor reads empty → contact tagged `segment:undefined`.
- Forgot `.js` extension on a new edge import → Vercel build green, runtime 500 on first invocation.
- Awaited a slow Railway endpoint after `res.send()` → 10s timeout → Vercel kills the function → DLQ never written.
- Imported JSON config in edge function → works locally, 500 on Vercel.

## Reference

- [references/event-shapes.md](references/event-shapes.md) — sample v2023 vs legacy webhook payloads
- [`docs/DEPLOYMENT.md`](../../../docs/DEPLOYMENT.md) — Cashfree + Vercel gotchas (canonical, this skill links back)
- [`docs/landing-page-resilience.md`](../../../docs/landing-page-resilience.md) — full Vercel + Upstash + Railway drainer architecture
- Canonical handler: [src/services/cashfreeEventProcessor.ts](../../../src/services/cashfreeEventProcessor.ts)
- Edge entry: [client/api/cashfree/webhook.ts](../../../client/api/cashfree/webhook.ts), [client/api/cashfree/create-order.ts](../../../client/api/cashfree/create-order.ts)
