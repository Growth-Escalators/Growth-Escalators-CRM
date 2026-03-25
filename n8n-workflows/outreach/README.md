# GE Outreach n8n Workflows

Four workflows for the Growth Escalators white-label agency outreach system.

## Workflows

### WF-01 — Lead Enrichment Pipeline
**File:** `wf-01-lead-enrichment.json`
**Trigger:** Every 5 minutes
Picks up leads with status=`New` from the Active sheet, finds emails via Hunter.io (with Snov.io fallback), generates AI icebreakers via Claude Haiku, deduplicates, adds to Saleshandy sequence, and updates the sheet to `Active`.

### WF-02 — Reply Handler
**File:** `wf-02-reply-handler.json`
**Trigger:** Webhook POST from Saleshandy
Receives reply webhooks, validates HMAC secret, classifies the reply via Claude Haiku (INTERESTED / OBJECTION / NOT_NOW / REFERRAL / WRONG_PERSON / UNSUBSCRIBE), updates the sheet, and sends appropriate Slack notifications.

### WF-03 — Daily Digest with Reconciliation
**File:** `wf-03-daily-digest.json`
**Trigger:** Daily at 8:00 PM IST (14:30 UTC)
Compiles pipeline stats from the sheet and Saleshandy, reconciles any replies that came in but missed the webhook, and posts a formatted digest to #outreach.

### WF-04 — Weekly Health Check
**File:** `wf-04-weekly-health-check.json`
**Trigger:** Every Monday at 9:00 AM IST (3:30 UTC)
Checks 7-day Saleshandy metrics, blacklist status for all 3 sending domains via MXToolbox, and lead pipeline volume. Posts HEALTHY / WARNING / CRITICAL report. DMs Jatin directly on CRITICAL.

---

## Setup Instructions

### 1. Import Workflows
In n8n: **Settings → Import from File** → import each `.json` file individually.

### 2. Configure Google Sheets OAuth2
After importing, open any workflow with a Google Sheets node:
- Click the Sheets node → Credentials → Create New
- Select **Google Sheets OAuth2 API**
- Complete the OAuth flow
- The credential will be shared across all workflows

### 3. Set Environment Variables in Railway n8n
These must be set in your Railway n8n service environment:

| Variable | Description |
|---|---|
| `OUTREACH_SHEET_ID` | Google Sheet ID (from URL) |
| `HUNTER_API_KEY` | Hunter.io API key |
| `SNOVIO_API_KEY` | Snov.io API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `SALESHANDY_API_KEY` | Saleshandy API key |
| `SALESHANDY_SEQUENCE_ID` | Saleshandy sequence ID |
| `SALESHANDY_WEBHOOK_SECRET` | `ge-outreach-wh-2026-secure` |
| `SLACK_OUTREACH_WEBHOOK` | Slack incoming webhook URL for #outreach |
| `SLACK_BOT_TOKEN` | Slack Bot OAuth token (for DMs to Jatin) |
| `JATIN_SLACK_USER_ID` | Jatin's Slack member ID (e.g. `U0123456789`) |
| `OUTREACH_DAILY_LIMIT` | `50` |
| `MXTOOLBOX_API_KEY` | MXToolbox API key (WF-04 only) |

### 4. Configure Saleshandy Webhook (WF-02)
After importing WF-02:
1. Activate the workflow — n8n will display the webhook URL
2. Copy the URL (format: `https://primary-production-6c6f5.up.railway.app/webhook/saleshandy-reply`)
3. In Saleshandy → Settings → Webhooks → add the URL
4. Set the secret header `X-Webhook-Secret: ge-outreach-wh-2026-secure`

### 5. Activate All Workflows
Toggle each workflow to **Active** in the n8n UI.

---

## Notes
- Slack DMs use the Slack Web API (`chat.postMessage`) — requires `SLACK_BOT_TOKEN` with `chat:write` scope
- Slack channel notifications use the incoming webhook (`SLACK_OUTREACH_WEBHOOK`) — no bot token needed
- Google Sheets matching uses the `company` column as the key for updates — ensure company names are unique in the sheet
- MXToolbox free tier has rate limits; WF-04 runs weekly so this should be fine
