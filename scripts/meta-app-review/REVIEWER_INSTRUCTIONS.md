# Reviewer Instructions — Growth Escalators CRM

**App ID:** 1474406410983034
**Production URL:** https://web-production-311da.up.railway.app/crm

> The same admin SPA is also reachable at `https://crm.growthescalators.com` (the production hostname). Either URL works — the Railway URL is provided as the direct, always-on fallback.

## Test Credentials

- **Email:** `meta-reviewer@growthescalators.com`
- **Password:** `2xItcLc1ch42MUUY1fwFzz8N`

Use Chrome incognito mode for cleanest experience.

The login API is at `POST /auth/login` on `api.growthescalators.com`. Submitting the same credentials returns a JWT — the admin SPA uses this automatically when you log in through the web UI.

## What this app does

Growth Escalators is a CRM for D2C marketing agencies and brands. Business clients authenticate via Facebook Login for Business to grant our app access to their own Pages, ad accounts, and WhatsApp Business Account. Our CRM then provides a unified workspace for managing marketing campaigns, organic content performance, and WhatsApp customer messaging — all scoped to the assets each business explicitly grants.

## How to test each permission

### Facebook Login + Marketing API (pages_show_list, business_management, ads_read, ads_management, pages_read_engagement)

1. After login, click **Clients** in the sidebar.
2. Click the pre-connected test client **Paraiso Comfortwear** — Facebook OAuth was already completed for this account (ad account `act_689363376592426`).
3. The dashboard shows live campaign data from the connected ad account (uses `ads_read`).
4. Click any campaign → use the "Pause" / "Activate" toggle (uses `ads_management`).
5. Click **Pages** tab → shows organic post performance from the connected FB Page (uses `pages_read_engagement`).
6. The available Pages and Ad Accounts are listed via `pages_show_list` and `business_management` respectively.

### WhatsApp Inbox (whatsapp_business_messaging)

1. Click **Inbox** in the sidebar.
2. Three pre-staged conversations are visible:
   - **Test Customer 1** — asking about the growth bundle
   - **Demo Inquiry — Skincare** — D2C skincare brand inquiry
   - **Sample Order Question** — order tracking + gift wrap question
3. Each thread has 4–5 messages spread over the last 48 hours, with the final message inbound so there's something to reply to.
4. Open any thread and type a text → click Send. The message will be delivered to the WhatsApp recipient.
5. Replies arrive in real time via the configured webhook at `/webhooks/meta` and surface in the inbox.

### WhatsApp Templates (whatsapp_business_management)

1. Click **WA Templates** in the sidebar (under Tools).
2. The list includes pre-existing templates: `hello_world`, `ge_hot_lead`, `ge_appt_reminder`, `ge_booking_confirm`, `ge_welcome_d2c`, `ge_followup_d3`, `ge_nudge_d7`, and the freshly-created `ge_app_review_health_check_v1` (created via the Graph API on 2026-05-22).
3. Click **New Template** to create another — saving submits it to Meta via the Graph API.

## Notes for the reviewer

- This is a production application serving real business clients. Please **do not delete data** or modify other clients' settings.
- The test account has admin role scoped to one test client (**Paraiso Comfortwear**, ad account `act_689363376592426`). The seeded WhatsApp demo conversations are isolated and tagged with `metadata.seed='meta-review'`.
- For any issues during review, contact **jatin@growthescalators.com**.

## How to log in via API (alternative for automated testing)

```bash
curl -X POST https://api.growthescalators.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"meta-reviewer@growthescalators.com","password":"2xItcLc1ch42MUUY1fwFzz8N"}'
```

Response: `200 { "token": "<JWT>", "user": { "id", "name", "email", "role": "admin" } }`. Rate limit is 5 requests per minute per IP.
