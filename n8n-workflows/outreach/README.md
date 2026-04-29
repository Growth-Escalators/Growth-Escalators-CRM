# GE Outreach n8n Workflows

Six workflows for the Growth Escalators white-label agency outreach system.

## Workflows

### WF-01 — Lead Enrichment Pipeline
**File:** `wf-01-lead-enrichment.json`
**Trigger:** Every 5 minutes
Picks up leads with status=`New` from the Active sheet, finds emails via Hunter.io (with Snov.io fallback), generates AI icebreakers via Claude Haiku, deduplicates, adds to Saleshandy sequence, and updates the sheet to `Active`.

### WF-02B — Reply Poller (IMAP)
**File:** `wf-02b-reply-poller.json`
**Trigger:** Schedule — every 5 minutes
Polls all 6 Purelymail inboxes (jatin/hello @ adscalelab.co, partnerpeak.co, partners-ge.co) via IMAP.
The Railway backend (`/api/outreach/imap/fetch-replies`) handles IMAP connection, warm-up email filtering (TrulyInbox), lead matching against `outreach_leads WHERE status='Active'`, and dedup via `outreach_processed_replies` table.
n8n classifies each reply via Claude Haiku (INTERESTED / OBJECTION / NOT_NOW / REFERRAL / WRONG_PERSON / UNSUBSCRIBE), updates the lead in Postgres, and sends Slack notifications.

### WF-03 — Daily Digest with Reconciliation
**File:** `wf-03-daily-digest.json`
**Trigger:** Daily at 8:00 PM IST (14:30 UTC)
Compiles pipeline stats from the sheet and Saleshandy, reconciles any replies that came in but missed the webhook, and posts a formatted digest to #outreach.

### WF-04 — Weekly Health Check
**File:** `wf-04-weekly-health-check.json`
**Trigger:** Every Monday at 9:00 AM IST (3:30 UTC)
Checks 7-day Saleshandy metrics, blacklist status for all 3 sending domains via MXToolbox, and lead pipeline volume. Posts HEALTHY / WARNING / CRITICAL report. DMs Jatin directly on CRITICAL.

### WF-05 — Lead Lifecycle Manager
**File:** `wf-05-lead-lifecycle.json`
**Trigger:** Daily at 10:00 AM IST (04:30 UTC)
Re-engages NOT_NOW leads after 90 days (sets status back to New). Auto-archives Closed leads after 30 days. Posts daily lifecycle summary to Slack.

### WF-06 — Auto Discovery
**File:** `wf-06-auto-discovery.json`
**Trigger:** Every Sunday at 11:00 AM IST (05:30 UTC)
Automatically discovers new leads using the backend's Google Places API integration.

---

## Setup Instructions

### 1. Import Workflows
In n8n: **Settings → Import from File** → import each `.json` file individually.

### 2. Configure Google Sheets OAuth2
After importing, open any workflow with a Google Sheets node:
- Click the Sheets node → Credentials → Create New
- Select **Google Sheets OAuth2 API**
- Complete the OAuth flow

### 3. Set Environment Variables in Railway

#### n8n Service (primary-production-6c6f5)
| Variable | Description |
|---|---|
| `OUTREACH_BACKEND_URL` | `https://web-production-311da.up.railway.app` |
| `OUTREACH_INTERNAL_SECRET` | Shared secret for n8n ↔ backend calls (generate a random string) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `SLACK_BOT_TOKEN` | Slack Bot OAuth token (for DMs to Jatin) |
| `JATIN_SLACK_USER_ID` | Jatin's Slack member ID (e.g. `U0123456789`) |
| `SLACK_OUTREACH_WEBHOOK` | Slack incoming webhook URL for #outreach channel |
| `HUNTER_API_KEY` | Hunter.io API key |
| `SNOVIO_API_KEY` | Snov.io API key |
| `SALESHANDY_API_KEY` | Saleshandy API key |
| `SALESHANDY_SEQUENCE_ID` | Saleshandy sequence ID |
| `OUTREACH_DAILY_LIMIT` | `50` |
| `MXTOOLBOX_API_KEY` | MXToolbox API key (WF-04 only) |

#### Web Service (web-production-311da) — for WF-02B IMAP
| Variable | Description |
|---|---|
| `OUTREACH_INTERNAL_SECRET` | Same value as n8n service above |
| `PURELYMAIL_PASS_JATIN_ADSCALELAB` | IMAP password for jatin@adscalelab.co |
| `PURELYMAIL_PASS_HELLO_ADSCALELAB` | IMAP password for hello@adscalelab.co |
| `PURELYMAIL_PASS_JATIN_PARTNERPEAK` | IMAP password for jatin@partnerpeak.co |
| `PURELYMAIL_PASS_HELLO_PARTNERPEAK` | IMAP password for hello@partnerpeak.co |
| `PURELYMAIL_PASS_JATIN_PARTNERSGE` | IMAP password for jatin@partners-ge.co |
| `PURELYMAIL_PASS_HELLO_PARTNERSGE` | IMAP password for hello@partners-ge.co |

Get passwords from Purelymail dashboard → Domains → each domain → Mailboxes → the password you set when creating each mailbox.

### 4. WF-02B IMAP Setup
WF-02B is already imported and **active** in n8n.

To make it work end-to-end:
1. Set all `PURELYMAIL_PASS_*` env vars in the Railway **web service** (not n8n)
2. Set `OUTREACH_INTERNAL_SECRET` in **both** Railway web and n8n services (same value)
3. WF-02B will automatically start polling all 6 inboxes every 5 minutes

The backend endpoint (`/api/outreach/imap/fetch-replies`) handles:
- Connecting to each inbox via IMAP (imap.purelymail.com:993 SSL)
- Filtering TrulyInbox warm-up emails (any email containing `Phone_N0:` in body)
- Matching against `outreach_leads WHERE status='Active'`
- Dedup via `outreach_processed_replies` table (prevents double-processing)
- Marking emails as Seen in IMAP immediately after reading

### 5. Activate All Workflows
Toggle each workflow to **Active** in the n8n UI (WF-02B is already active).

---

## Architecture: WF-02B Reply Detection Flow

```
Every 5 min
    │
    ▼
n8n Schedule Trigger
    │
    ▼  GET /api/outreach/imap/fetch-replies
    │  X-Internal-Secret: {OUTREACH_INTERNAL_SECRET}
    │
    ▼
Railway Backend
    ├── Connect to 6 Purelymail inboxes (IMAP SSL)
    ├── Fetch UNSEEN emails (mark as SEEN immediately)
    ├── Filter: skip warm-up, spam, system emails
    ├── Dedup: skip message IDs in outreach_processed_replies
    ├── Match: only return emails from outreach_leads WHERE status='Active'
    └── Returns: [{ messageId, from, subject, body, inbox, leadId, firstName, company }]
    │
    ▼
n8n: Split Replies (one item per reply)
    │
    ▼
n8n: Claude Haiku — classify into 6 categories
    │
    ▼
n8n: Switch → 6 branches
    ├── INTERESTED  → UPDATE status='Replied' + Slack DM to Jatin
    ├── OBJECTION   → UPDATE status='Replied' + Slack DM to Jatin
    ├── NOT_NOW     → UPDATE status='Replied', notes += re-engage date + Slack webhook
    ├── REFERRAL    → UPDATE status='Replied' + Slack DM to Jatin
    ├── WRONG_PERSON → UPDATE status='Closed' + Slack webhook
    └── UNSUBSCRIBE  → UPDATE status='Closed' + Slack webhook
```

---

## Notes
- **SALESHANDY_WEBHOOK_SECRET** is no longer needed — remove it from Railway env vars
- The `outreach_processed_replies` table auto-creates on backend startup
- If an inbox has no password set, the backend skips it silently and logs a warning
- TrulyInbox warm-up emails are identified by the string `Phone_N0:` in the body — these are always marked as seen and skipped
