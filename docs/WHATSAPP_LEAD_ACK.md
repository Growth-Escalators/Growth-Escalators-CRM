# WhatsApp lead acknowledgement — setup and runbook

Website form → CRM lead → one approved WhatsApp template → human handoff.

Nothing sends until **two** switches are set. Out of the box
`WHATSAPP_AUTOMATION_ENABLED=false` and `WHATSAPP_TEST_MODE=true`, so deploying
this code to production sends nothing to anyone.

---

## 1. What runs where

| Concern | Lives in | Why |
|---|---|---|
| Consent checkbox, form fields | Website (Vercel) | Collection only |
| Lead record, consent audit, assignment | CRM (Railway) | Has the database |
| WhatsApp send, retries, budget, opt-out | CRM (Railway) | Has the queue and state |
| Kapso credentials | CRM only | **Never** on Vercel — the site is public |

This extends the existing `POST /api/leads/website` route rather than adding a
second intake. The route already deduped contacts and stored attribution; this
adds consent capture, service-based assignment, and the acknowledgement job.

### Why there is no "lead submissions" table

`POST /api/leads/website` already writes exactly one `events` row per form
submission (`eventType: 'website_lead_submitted'`). That row is the canonical
per-submission record, so it is the idempotency anchor for the WhatsApp job.
`wa_lead_acks` is keyed by that event id — it is an acknowledgement ledger, not
a second lead ledger.

---

## 2. Manual setup

### 2.1 The number

Use a **dedicated Growth Escalators business number**. Not a personal WhatsApp.

> **Use coexistence, not migration.** Kapso offers two connection paths. The
> **WhatsApp Business App** path keeps the number working on your team's
> handsets and preserves chat history. The other path moves the number fully to
> the API and disables the app. Pick the Business App path and you do not need
> a separate SIM.

If Meta asks for SMS or voice verification instead of showing a QR pairing
screen, you are on the wrong path — stop and restart with **WhatsApp Business
App** selected.

**Prerequisites Meta enforces:** the number is active in the WhatsApp Business
*app* (not personal WhatsApp); access to the right Meta Business Portfolio and
WABA; complete business info in Meta including legal name, address, business
phone and a public HTTPS website; no outstanding verification or billing issues.

### 2.2 What coexistence means for this code

Kapso tags every message with an `origin`:

| origin | meaning | what the webhook does |
|---|---|---|
| `cloud_api` | a customer message, or one we sent | normal handling |
| `business_app` | a salesperson typed it in the phone app | stored as an outbound message; never treated as a reply |
| `history_sync` | historical backfill at connection time | **dropped entirely** |

`history_sync` is the one that matters. Connecting with chat-history sharing
replays old conversations through this webhook. Without the guard, every old
chat would fire a Slack ping — and any contact who had ever typed "stop" in an
unrelated conversation would be silently opted out forever.

The `business_app` guard means a salesperson replying from their phone does not
mark the lead "replied", but does stamp `waHumanHandoffAt` so automation stays
out of a thread a human has taken over.

**Coexistence does not enrol anyone.** It hands Kapso your existing chats; it
does not give those people consent. Automated sends require
`contacts.opted_in_wa = true`, set only by someone ticking the website checkbox.

### 2.3 Kapso credentials

Create the account (free tier: 2,000 messages/month, 1 number, team inbox with
unlimited seats). Copy the API key → `KAPSO_API_KEY` and the phone number id →
`KAPSO_PHONE_NUMBER_ID`.

Confirm the id the API actually wants — the dashboard sometimes shows a
different one:

```bash
curl -s https://api.kapso.ai/platform/v1/whatsapp/phone_numbers \
  -H "X-API-Key: $KAPSO_API_KEY"
```

### 2.4 Submit the template

Templates are not auto-created. Submit by hand:

- **Name:** `website_enquiry_received`
- **Category:** **Utility** (not Marketing — this answers a user-initiated enquiry)
- **Language:** English (`en`)
- **No header, footer or buttons** — this code sends only the three body variables

```
Hi {{1}}, thank you for contacting Growth Escalators regarding {{2}}.

We have received your enquiry and assigned it to {{3}} from our team.

To help us respond better, could you share your preferred time for a quick discussion?

Reply STOP if you don't wish to receive further WhatsApp communication.
```

Sample values are mandatory — Meta rejects submissions without them:
`{{1}}` = `Priya`, `{{2}}` = `Shopify Development`, `{{3}}` = `Rahul`.

**Check the parameter style.** Meta supports two, and they are not
interchangeable. If the template preview shows `{{customer_name}}` it uses
**named** parameters and every send must carry a matching `parameter_name`;
if it shows `{{1}}` it is **positional**. A mismatch is rejected as a
permanent error — it fails instantly and never retries, so no message ever
arrives. For a named template set, in template order:

```
KAPSO_TEMPLATE_PARAM_NAMES=customer_name,service_name,assignee_name
```

Leave it empty for a positional template.

If the language code is `en_US` rather than `en`, set
`KAPSO_TEMPLATE_LANGUAGE=en_US`. A mismatch produces Meta error 132001, which
this code treats as permanent — it will never retry. This is the most common
way the integration silently fails.

**After approval, check the category Meta actually assigned.** Approval and
category are separate; Meta has been known to reclassify Utility to Marketing,
which costs more and tightens consent obligations.

### 2.5 Register the webhook

```
https://api.growthescalators.com/webhooks/kapso
```

Subscribe to `whatsapp.message.received`, `.sent`, `.delivered`, `.read`,
`.failed`. Store the signing secret as `KAPSO_WEBHOOK_SECRET`.

Signature is `X-Webhook-Signature`, HMAC-SHA256 over the raw body, verified
against `req.rawBody`. **Fails closed** — an unset secret rejects everything
with 401.

### 2.6 BD owners

```
BD_MARKETING=   # marketing, SEO, paid ads
BD_D2C=         # Shopify, ecommerce, D2C
BD_TECHNOLOGY=  # website + software development
BD_STAFFING=    # staffing and offshore resourcing
BD_GENERAL=     # everything unclear
```

Blank falls through to the general queue; the notification says "unassigned"
rather than inventing an owner.

### 2.7 Website side

Already configured — `CRM_WEBSITE_LEAD_URL` and `WEBSITE_LEAD_INGEST_SECRET`
predate this work. No change needed.

---

## 3. Migration

```bash
npm run db:migrate
```

Migration `0054_chief_corsair.sql`. Additive only: two new tables, five nullable
columns on `contacts`, one partial unique index. Safe to run while serving.

**Pre-flight** — the index fails if duplicates exist:

```sql
SELECT external_id, COUNT(*) FROM messages
 WHERE external_id IS NOT NULL
 GROUP BY external_id HAVING COUNT(*) > 1;
```

---

## 4. Staging verification

```bash
WHATSAPP_AUTOMATION_ENABLED=true
WHATSAPP_TEST_MODE=true
WHATSAPP_TEST_ALLOWLIST=+91XXXXXXXXXX   # your own number
JOB_DRAINER_ENABLED=true                # the drainer runs the ack job
```

| # | Check | Expected |
|---|---|---|
| 1 | Submit a form | HTTP 200, thank-you panel |
| 2 | Contacts table | exactly one new contact |
| 3 | Submit same email again | still one contact, two `events` rows |
| 4 | `SELECT status FROM wa_lead_acks ORDER BY created_at DESC LIMIT 1` | `sent` for an allowlisted number |
| 5 | Template arrives | variables read first name / service / owner |
| 6 | Reply to it | `contacts.status = 'whatsapp_replied'`, Slack ping to owner |
| 7 | Reply `STOP` | `do_not_contact = true`, `opted_in_wa = false` |
| 8 | Submit again after STOP | `opted_out`, nothing sent |
| 9 | Submit without ticking consent | `skipped_no_consent`, lead still created |
| 10 | Break `KAPSO_API_KEY`, submit | lead created, job retries, no lead lost |
| 11 | Non-allowlisted number | `skipped_test_mode`, nothing sent |

Only then set `WHATSAPP_TEST_MODE=false`, do one controlled live test, and leave
it on.

---

## 5. Monitoring

```sql
SELECT status, COUNT(*) FROM wa_lead_acks
 WHERE created_at > NOW() - INTERVAL '1 day' GROUP BY status ORDER BY 2 DESC;

SELECT id, last_error, attempts FROM jobs
 WHERE job_type = 'wa_lead_ack' AND status = 'dead_letter';

SELECT * FROM wa_monthly_usage ORDER BY year_month DESC LIMIT 3;
```

---

## 6. Rollback

1. **Stop sending.** `WHATSAPP_AUTOMATION_ENABLED=false`, redeploy. Leads,
   assignment and notifications continue; acks record `skipped_disabled`.
2. **Stop sending to real customers only.** `WHATSAPP_TEST_MODE=true`.
3. **Revert the code.** The lead route returns to its pre-change behaviour.
   **Leave the migration** — additive and unused by reverted code.
4. **Revert the database** (only if truly required — destroys the consent audit
   trail; export first):
   ```sql
   DROP TABLE IF EXISTS wa_lead_acks;
   DROP TABLE IF EXISTS wa_monthly_usage;
   DROP INDEX IF EXISTS messages_external_id_unique_idx;
   ALTER TABLE contacts
     DROP COLUMN IF EXISTS wa_consent_at,
     DROP COLUMN IF EXISTS wa_consent_text_version,
     DROP COLUMN IF EXISTS wa_consent_source,
     DROP COLUMN IF EXISTS wa_opt_out_at,
     DROP COLUMN IF EXISTS wa_opt_out_reason;
   ```

---

## 7. Cost

| Item | Cost |
|---|---|
| Kapso | ₹0 on the free tier |
| Meta utility conversations | **Billable per delivered template** |
| New infrastructure | ₹0 — reuses Postgres, `jobs`, the drainer, Slack |

Kapso passes Meta's fees through at cost, but **the system cannot be guaranteed
free.** The customer filled a web form rather than messaging us, so no 24-hour
service window is open when the acknowledgement fires — that first template is
chargeable every time. Verify the current India utility rate on your own rate
card.

`WHATSAPP_MONTHLY_HARD_LIMIT` defaults to 1,800 — below the free tier's 2,000 —
so the system fails closed rather than into an invoice. Human replies are never
counted and never blocked by it.

---

## 8. Known limitations

- **Up to ~60s delay.** The acknowledgement rides the existing `jobDrainer`
  poll interval. Fine for an acknowledgement; not for anything time-critical.
- **`getPendingJobs()` never returns retryable failures.** It filters
  `status = 'pending'`, while `failJob()` parks retries as `'failed'` with a
  future `process_after`. This module queries both statuses itself. **Every
  other job type in the CRM inherits that gap and silently never retries** —
  worth fixing centrally.
- **`claimJob()` is not atomic** (updates by id with no status predicate). This
  module uses a conditional claim instead.
- **Phone dedup and sending format differ deliberately.** `contact_channels`
  keeps the legacy `normalizeChannelValue` format (digits, `91`-prefixed) so
  dedup stays compatible with every historical row. E.164 is computed for
  sending only. That legacy rule mangles non-Indian numbers — a US
  `2025550123` becomes `912025550123` — but rewriting it would fragment dedup
  against existing data. A backfill is separate work.
- **The blog capture form has no consent checkbox** — it collects no phone.
- **Two automated messages per lead.** The site already sends an email
  autoresponder; a consenting lead now gets that plus a WhatsApp
  acknowledgement. Decide whether both should fire.
- **`vitest.config.ts` was renamed to `.mts`.** Under `"type": "commonjs"` the
  `.ts` config loaded via `require()`, and vitest 4's ESM-only `std-env`
  dependency threw `ERR_REQUIRE_ESM` before any test ran — the entire suite was
  unrunnable on `main`. The rename is what lets 3,200+ tests execute.
