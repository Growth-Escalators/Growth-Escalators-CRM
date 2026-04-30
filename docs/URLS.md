# Production URLs

## Live subdomains

| Subdomain | What it serves | Platform | Service |
|---|---|---|---|
| `api.growthescalators.com` | REST API (`src/index.ts`) | Railway | `web` service |
| `crm.growthescalators.com` | Admin CRM SPA (mounted at `/crm`) | Railway | `web` service (same as API) |
| `ecom.growthescalators.com` | D2C landing pages + Cashfree payments | Vercel | `client/` directory |
| `content.growthescalators.com` | Content-creation app (Sheets-backed) | Vercel | `ge-content-frontend` repo |

## Webhook URLs (give these to external services)

| Service | URL |
|---|---|
| Meta WhatsApp | `https://api.growthescalators.com/api/webhooks/meta-wa` |
| Cal.com | `https://api.growthescalators.com/api/webhooks/calcom` |
| Tally | `https://api.growthescalators.com/api/webhooks/tally` |
| Chatwoot | `https://api.growthescalators.com/api/webhooks/chatwoot` |
| Cashfree payment webhook | `https://api.growthescalators.com/api/cashfree/webhook` |

## Health / diagnostics

```bash
curl https://api.growthescalators.com/health   # { status: 'ok', database: true }
curl https://api.growthescalators.com/stats    # production row counts
```

## n8n (SEO automation)

Hosted separately on Railway. URL is in [`docs/seo/automation-handoff.md`](seo/automation-handoff.md).

## Notes

- `consulting.growthescalators.com` is **not in use** — if you see it in CORS config (`src/index.ts`), it can be removed.
- `web-production-311da.up.railway.app` — Railway-generated URL. Cannot confirm current status (not visible in dashboard); treat `api.*` and `crm.*` as canonical and update any hardcoded references to this URL when found.
