# Growth Escalators Backend — Production URLs

## Base URL
https://web-production-311da.up.railway.app

## Webhook URLs (give these to external services)
| Service | URL |
|---------|-----|
| Meta WhatsApp webhook | https://web-production-311da.up.railway.app/webhooks/meta-wa |
| Cal.com webhook | https://web-production-311da.up.railway.app/webhooks/calcom |
| Tally webhook | https://web-production-311da.up.railway.app/webhooks/tally |
| Chatwoot webhook | https://web-production-311da.up.railway.app/webhooks/chatwoot |

## API Routes
| Method | Path | Purpose |
|--------|------|---------|
| GET | /health | Health check with DB connectivity |
| GET | /stats | Production statistics |
| GET | /contacts | List contacts |
| POST | /contacts | Create contact |
| GET | /contacts/:id | Get single contact |
| PATCH | /contacts/:id | Update contact |
| GET | /deals | List deals |
| POST | /deals | Create deal |
| PATCH | /deals/:id | Update deal |
| GET | /bookings | List bookings |
| GET | /bookings/:id | Get single booking |
| GET | /sequences | List sequences |
| POST | /sequences/enrol | Enrol contact in sequence |
| GET | /sequences/enrolments | List enrolments |
| GET | /jobs/pending | Get pending jobs (used by n8n) |
| PATCH | /jobs/:id/claim | Mark job as processing |
| PATCH | /jobs/:id/complete | Mark job as completed |
| PATCH | /jobs/:id/fail | Mark job as failed |
| POST | /messages | Create message record |
| GET | /messages | Get messages for contact |
| POST | /email/send | Send sequence email via Brevo |
| POST | /email/contact | Add/update contact in Brevo |
| GET | /webhooks/test-queue | Debug: view job queue state |

## Credentials needed (add these in Railway → Variables tab for the web service)
| Variable | Description |
|----------|-------------|
| META_ACCESS_TOKEN | From Meta Business Manager → WhatsApp → API Setup |
| META_PHONE_NUMBER_ID | From Meta Business Manager → WhatsApp → API Setup |
| META_APP_SECRET | From Meta Business Manager → App Settings |
| META_VERIFY_TOKEN | Already set: ge_verify_2026 |
| BREVO_API_KEY | From Brevo dashboard → API Keys |
| CHATWOOT_API_TOKEN | From Chatwoot → Settings → Access Tokens |
| CHATWOOT_ACCOUNT_ID | From Chatwoot URL (e.g. /accounts/1) |
| CHATWOOT_INBOX_ID | From Chatwoot → Settings → Inboxes |
| CALCOM_API_KEY | From Cal.com → Settings → Developer → API Keys |
| JATIN_WHATSAPP | Jatin's WhatsApp number with country code (e.g. 919876543210) |

## n8n deployment
See [DEPLOY_N8N_RAILWAY.md](DEPLOY_N8N_RAILWAY.md) for step-by-step instructions.
Import workflow files from [n8n-workflows/](n8n-workflows/) folder after n8n is deployed.

## Database
- Host (internal): postgres.railway.internal:5432
- Host (external): nozomi.proxy.rlwy.net:46852
- Database: railway
- Migrations: applied ✅
- Seed: applied ✅ (Growth Escalators + City Clinic tenants, D2C + Healthcare sequences)
