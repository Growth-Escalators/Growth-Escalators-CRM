# Security

## Trust boundary files

Do not modify these without explicit approval:

| Path | Why |
|---|---|
| `src/middleware/auth.ts` | JWT verification (`requireAuth`, `optionalAuth`). Mistakes here bypass auth on all protected routes. |
| `src/middleware/rbac.ts` | Role checks. Don't bypass "for convenience" — if a route shouldn't need auth, that's a product decision. |
| `src/db/schema.ts` | Schema changes need migration generation, not hand-edits. |
| `src/db/migrations/` | Already-applied SQL — editing breaks Postgres state in prod. |
| `src/routes/cashfree.ts` | Real money. Payment webhooks have idempotency invariants. |
| `src/services/sodEodService.ts` | Sends DMs to real humans on a schedule. |

## Webhook signature verification

Meta WhatsApp webhooks are HMAC-verified in `src/middleware/validateWebhook.ts`. Do not accept raw payloads from Meta without running them through this middleware.

## Idempotency

All incoming webhooks are guarded by the `processed_events` table — `(event_id, source)` unique constraint. The canonical handler is `processCashfreeEvent()` in `src/services/cashfreeEventProcessor.ts`. Do not duplicate payment-processing logic.

## Environment variables

Secrets live in Railway environment variables (API + Worker services) and Vercel environment variables (edge functions). They are never committed to the repo.

Required Railway vars: `DATABASE_URL`, `JWT_SECRET`, `BREVO_API_KEY`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`.

Required for WhatsApp outbound: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`.

Required for Upstash queue: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

## Auth flow

- Admin CRM uses JWT issued by `POST /api/auth/login`. Token stored in `localStorage` as `ge_crm_token`.
- All `/api/*` routes are JWT-protected except `/api/auth/*` and webhook endpoints.
- Client (ecom) is mostly public — no auth required for landing pages or payment initiation.
