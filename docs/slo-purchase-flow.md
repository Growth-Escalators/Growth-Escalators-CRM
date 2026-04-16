# SLO Purchase Flow — Complete Technical Documentation

**Last Updated:** 16 April 2026
**Author:** Jatin Agrawal / Growth Escalators Engineering
**Status:** Production

---

## Overview

This document describes the end-to-end flow when a customer purchases through our D2C Self-Liquidating Offer (SLO) funnel — from the moment they land on the website to post-purchase delivery, CRM integration, and follow-ups.

**Live URLs:**
- Customer-facing: `ecom.growthescalators.com`
- CRM Dashboard: `crm.growthescalators.com`
- API: `web-production-311da.up.railway.app`

---

## Products & Pricing

| Product | Price | What Customer Gets |
|---------|-------|--------------------|
| D2C Funnel Breakdown Pack | INR 9 | PDF — 5 Winning D2C Brand funnels analyzed |
| Advanced Growth Kit (Bump 1) | INR 199 | Swipe files, ad templates, landing page frameworks, Meta ads checklist |
| 45-min Meta Ads Audit (Bump 2) | INR 499 | Live account review with Jatin via Cal.com |

**Combined pricing tiers:**
- INR 9 = Core product only
- INR 208 = Core + Growth Kit
- INR 508 = Core + Audit Call
- INR 707 = Core + Growth Kit + Audit Call (Complete Bundle)

---

## Stage 1: Customer Visits the Website

Customer visits `ecom.growthescalators.com` and sees the landing page with the INR 9 offer.

The website is a React SPA served from the same Railway deployment as the backend. Hostname-based routing separates CRM from the D2C client:
- `ecom.growthescalators.com` serves the customer-facing SLO page
- `crm.growthescalators.com` serves the internal CRM

---

## Stage 2: Customer Fills the Checkout Form

Customer enters:
- **Name** (first + last)
- **Phone** (10-digit Indian mobile number)
- **Email address**
- **Segment** — self-identifies as one of:
  - `ecom_brand` — D2C brand owner
  - `agency_owner` — Agency running ads for clients
  - `freelancer` — Freelance marketer

Then sees optional bump offers:
- **Bump 1** (INR 199): Advanced D2C Growth Kit
- **Bump 2** (INR 499): 45-min Meta Ads Audit Call with Jatin

---

## Stage 3: Order Creation

**API Endpoint:** `POST /api/cashfree/create-order`

When the customer clicks "Pay":

1. Frontend sends name, phone, email, segment, bump1, bump2 to the backend
2. Backend generates a unique order ID: `ge_slo_{timestamp}_{random}`
3. Backend calls **Cashfree Payment Gateway API** to create a payment order with:
   - Order amount (INR 9/208/508/707)
   - Customer details (name, email, phone)
   - Metadata: `{ segment, bump1, bump2 }`
4. Backend pre-creates a **pending contact** in CRM (fire-and-forget)
   - Phone stored with `91` country code prefix
   - Source: `checkout`
   - Payment status: `pending`
5. Returns `payment_session_id` to the frontend

Frontend opens the Cashfree checkout modal. Customer pays via UPI, Card, or Net Banking.

---

## Stage 4: Payment Success — Webhook Processing

**API Endpoint:** `POST /api/cashfree/webhook`
**Trigger:** Cashfree sends a `PAYMENT_SUCCESS_WEBHOOK` event after successful payment

### What happens (in order):

#### 4a. Validation
- Verifies event type is `PAYMENT_SUCCESS_WEBHOOK` and payment status is `SUCCESS`
- Checks idempotency — if this `cfPaymentId` was already processed, skips (prevents double-processing)

#### 4b. Stage & Product Mapping
```
INR 9   -> Stage: "paid_9"   -> Products: [core_product]
INR 208 -> Stage: "paid_208" -> Products: [core_product, growth_kit]
INR 508 -> Stage: "paid_508" -> Products: [core_product, audit_call]
INR 707 -> Stage: "paid_707" -> Products: [core_product, growth_kit, audit_call]
```

#### 4c. CRM Contact Creation
- Finds existing contact by phone/email, or creates a new one
- Phone is normalized: `91` prefix added if not present
- Contact is tagged: `slo_buyer`, segment tag, product tags
- Metadata updated: `{ paymentStatus: 'paid', paidAmount, segment, bump1, bump2, products }`
- Status set to: `prospect`

#### 4d. Deal Creation
- A new deal is created in the CRM:
  - Title: `"SLO Purchase — {customer name}"`
  - Stage: `paid_9` / `paid_208` / `paid_508` / `paid_707`
  - Service type: `ecom`
  - Value: order amount
- Note: Deal is created WITHOUT a pipeline link — the worker assigns it within 30 seconds

#### 4e. Meta Conversions API (CAPI) Event
- Sends a `Purchase` event to Meta Pixel via server-side Conversions API
- Includes: contact info, order value, product name, IP address, user agent
- This enables Meta to optimize ad delivery based on real purchase data

#### 4f. WhatsApp Welcome Template
- Sends the `ge_welcome_d2c` template message via Meta WhatsApp Business API
- This is a pre-approved template — no free-form text
- Sent to the customer's phone number immediately

#### 4g. Slack Alert (Team Notification)
- Posts to the team's Slack channel immediately:
  ```
  New SLO Purchase!
  Name: John Doe
  Amount: INR 208
  Segment: ecom_brand
  Products: core_product, growth_kit
  Phone: 9876543210 | Email: john@example.com
  ```

#### 4h. Purchase Confirmation Email
- Sends via Brevo transactional email API immediately
- Subject: "Your D2C Funnel Breakdown Pack is ready, {name}"
- Contains:
  - PDF download link (always)
  - Growth Kit download link (if bump1)
  - Audit call booking link (if bump2)
- From: `jatin@growthescalators.com`

#### 4i. Event Logging
- Logs `slo_purchase` event in the database with payload: `{ amount, segment, products, cfPaymentId }`
- Marks payment as processed for idempotency

#### 4j. Webhook Response
- Returns `{ ok: true }` to Cashfree (200 status)

---

## Stage 5: Pipeline Placement (Worker — Within 30 Seconds)

**Process:** Background worker cron job runs every 30 seconds
**File:** `src/worker.ts`

### What happens:

#### 5a. Find Unplaced Purchases
Worker queries for `slo_purchase` events where the contact hasn't been placed in any pipeline yet.

#### 5b. Pipeline Assignment
Based on the customer's segment:

| Segment | Pipeline |
|---------|----------|
| `ecom_brand` | D2C Prospects |
| `agency_owner` | Agency Owners |
| `freelancer` | Freelancer |

#### 5c. Stage Assignment
Based on the payment amount:

| Amount | Pipeline Stage |
|--------|---------------|
| INR 9 or less | Paid INR 9 |
| INR 200-299 | Paid INR 208 |
| INR 500-599 | Paid INR 508 |
| INR 700+ | Paid INR 707 |

#### 5d. Deal Linking
The deal created in Stage 4d (which had no pipeline) is now linked to the correct pipeline and stage.

#### 5e. Tag Merging
Additional tags added to the contact:
- `seg:{segment}` (e.g., `seg:ecom_brand`)
- `bump1` (if purchased)
- `bump2` (if purchased)
- `hot_lead` (if purchased both bumps)
- `wl_prospect` (if agency buyer — white-label prospect)

#### 5f. Agency Alert
If the buyer is an `agency_owner`, a Slack DM is sent to Sakcham with:
- Buyer name, phone, amount, stage
- Bump selections
- Action needed: follow up as white-label prospect

---

## Stage 6: Asset Delivery (Immediately After Pipeline Placement)

**File:** `src/services/assetDeliveryService.ts`

Assets are delivered regardless of whether pipeline placement succeeded — the customer always gets their purchase.

### WhatsApp Messages (sent sequentially with 2-second gaps):

**Message 1 — Main Product (always sent):**
```
Hi {name}! Your purchase is confirmed. Here is your D2C Funnel
Breakdown Pack — download it now, it is yours forever: [PDF Link]

This PDF breaks down exactly what 5 winning D2C brands are doing
on Meta right now. Go through Section 2 first — that is where
most brands find their biggest insight.

Reply anytime if you have questions. — Jatin from Growth Escalators
```

**Message 2 — Growth Kit (only if bump1 purchased):**
```
Your Growth Kit is also ready! Download it here: [Growth Kit PDF]

Inside you will find swipe files, ad templates, landing page
frameworks, and the Meta ads checklist. Start with the checklist —
it takes 10 minutes and shows you exactly where your funnel is leaking.
```

**Message 3 — Audit Call Booking (only if bump2 purchased):**
```
Your 45-min Meta Ads Audit with Jatin is confirmed!

Book your slot here (slots fill fast): [Cal.com Link]

Come prepared with:
- Your current ROAS or CPL
- Your top 2-3 running creatives
- Your biggest challenge right now

Jatin will review your live account and give you 3 specific fixes.
```

### Email (via Brevo):
Same content as the WhatsApp messages, sent as a single email with all relevant links.

### Audit Tracking (if bump2):
- Contact note added: "Purchased INR 499 audit — send Cal.com link if not booked within 48 hours"
- Contact tagged: `audit_purchased`
- Contact status upgraded to: `qualified`
- 48-hour follow-up event scheduled

---

## Stage 7: Post-Purchase Follow-ups

### Audit Call Follow-up (Every 6 Hours)
- Worker checks for contacts tagged `audit_purchased` who:
  - Purchased more than 48 hours ago
  - Have NOT booked their call (no `appt_booked` tag)
  - Haven't been followed up already
- Sends Slack DM to Jatin: "FOLLOW UP: {name} purchased audit call 48hrs ago but has not booked"
- Marks contact so the alert is not repeated

---

## Where Everything Appears in CRM

| CRM Section | What You See |
|-------------|--------------|
| **Contacts list** | New contact with source `checkout` |
| **Contact > Tags** | `slo_buyer`, `ecom_brand`, `core_product`, `growth_kit`, etc. |
| **Contact > Metadata** | `paymentStatus: paid`, `paidAmount: 208`, `segment`, `bump1`, `bump2` |
| **Contact > Channels** | Phone (WhatsApp) + Email |
| **Pipeline > D2C Prospects** | Deal card at "Paid INR 208" stage |
| **Deal details** | Title, amount, stage, linked contact |

---

## Timeline Summary

```
T+0s      Customer completes payment
T+1s      Webhook fires:
            - Contact created in CRM
            - Deal created
            - Meta CAPI purchase event
            - WhatsApp welcome template
            - Slack alert to team
            - Purchase email with asset links
            - slo_purchase event logged

T+1-30s   Worker cron picks up event:
            - Pipeline placement (D2C Prospects)
            - Deal linked to pipeline
            - Tags merged
            - WhatsApp: PDF download link
            - WhatsApp: Growth Kit link (if bump1)
            - WhatsApp: Audit booking link (if bump2)
            - Email: All asset links (backup)

T+48h     If audit purchased but not booked:
            - Slack DM to Jatin for manual follow-up
```

---

## Asset URLs

| Asset | URL |
|-------|-----|
| Main PDF | `https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf` |
| Growth Kit PDF | `https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/Advanced%20D2C%20Growth%20Kit%20Latest.pdf` |
| Audit Call Booking | `https://cal.com/growth-escalators/discovery-call` |

---

## External Services Used

| Service | Purpose | Credentials |
|---------|---------|-------------|
| **Cashfree** | Payment gateway | `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` |
| **Meta WhatsApp Business API** | WhatsApp messages | `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN` |
| **Meta Conversions API** | Server-side purchase tracking | `META_CAPI_TOKEN`, `META_PIXEL_ID` |
| **Brevo** | Transactional emails | `BREVO_API_KEY` |
| **Slack** | Team notifications | `SLACK_BOT_TOKEN` |
| **Cal.com** | Audit call booking | Public link (no API key needed) |
| **Cloudflare R2** | PDF hosting | Public bucket |

---

## Troubleshooting

### Customer says they didn't receive anything
1. Check CRM contacts — search by phone or email
2. If contact exists with `slo_buyer` tag — assets should have been sent. Check Railway logs for `[asset-delivery]`
3. If contact does NOT exist — the webhook may not have fired. Check Cashfree dashboard for the transaction
4. Check Railway Worker logs for `[CRON] Pipeline placement` and `[CRON] Asset delivery`

### Customer not appearing in pipeline
1. Check if `slo_purchase` event exists in the events table
2. Check if the pipeline exists (D2C Prospects / Agency Owners / Freelancer)
3. Worker processes every 30 seconds — wait and refresh

### WhatsApp not delivered
1. Verify `META_PHONE_NUMBER_ID` and `META_ACCESS_TOKEN` are set in Railway
2. Check if the phone number format is correct (should be `91XXXXXXXXXX`)
3. Check Railway logs for `[cashfree] WhatsApp template error` or `[asset-delivery] WA msg1 failed`

### Email not delivered
1. Verify `BREVO_API_KEY` is set in Railway
2. Check Railway logs for `[asset-delivery] Brevo` errors
3. Check Brevo dashboard for delivery status

---

*This document is auto-generated from the codebase. For code-level details, see: `src/routes/cashfree.ts`, `src/worker.ts`, `src/services/assetDeliveryService.ts`, `src/services/pipelineService.ts`*
