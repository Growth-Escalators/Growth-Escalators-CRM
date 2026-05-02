# SEO — Paused (2026-05-02)

All SEO automation is paused to stop ongoing API and compute spend. Nothing
is deleted — every cron, workflow, and route stays in the codebase. Resuming
is two steps: flip an env var on Railway, and re-activate the n8n workflows.

## Why
- ValueSERP (~$50/mo) + DataForSEO (~$30/mo) + occasional Claude API spend
- Worker compute for 10 SEO crons running daily/weekly
- n8n compute for 12 SEO workflows running on schedule

Combined: ~$80–100/month in external API fees plus the n8n container baseline.

---

## What's paused

### 1. Railway worker crons (`src/worker.ts`)

All gated on the `SEO_ENABLED` env var. They still register at boot — when
the schedule fires, the handler returns immediately if `SEO_ENABLED !== 'true'`.

| Cron name | Schedule | File |
|-----------|----------|------|
| SEO Workflow Health | Daily 9:15 AM IST | `src/worker.ts` line ~312 |
| SEO Weekly Email | Thursday 10:30 AM IST | `src/worker.ts` line ~938 |
| PageSpeed Monitor | Sunday 7:30 AM IST | `src/worker.ts` line ~959 |
| Rank Tracking | Tuesday 9:00 AM IST | `src/worker.ts` line ~982 |
| SEO Alert Triggers | Daily 9:00 AM IST | `src/worker.ts` line ~1005 |
| SEO Backlink Monitor | Friday 9:00 AM IST | `src/worker.ts` line ~1028 |
| SEO Content Decay | Monday 9:00 AM IST | `src/worker.ts` line ~1051 |
| SEO Weekly Digest | Friday 5:00 PM IST | `src/worker.ts` line ~1074 |
| Competitor Content Analysis | 1st & 15th 9:00 AM IST | `src/worker.ts` line ~1098 |
| SEO Content Gap Analysis | 15th 10:00 AM IST | `src/worker.ts` line ~1107 |

The `seoCron()` helper that gates these lives near the top of `worker.ts`
right after `safeCron()`.

### 2. n8n workflows (live n8n panel — manual deactivation needed)

URL: `https://primary-production-6c6f5.up.railway.app`
Login: admin / ***REDACTED-ROTATED-2026-07-23*** (per `DEPLOY_N8N_RAILWAY.md`)

For each of the 12 workflows below: open the workflow → top-right → toggle
**Active → Inactive**. **Do not delete** — deactivating preserves the
workflow JSON, schedule, credentials, and execution history.

| ID | Name | Trigger |
|----|------|---------|
| WF-SEO-01 | Weekly SEO Data Pull | Mon 1:00 AM UTC |
| WF-SEO-02 | Daily Alert Triggers | Daily 9:00 AM IST |
| WF-SEO-03 | Weekly AI Insight Report | Friday 4:00 PM IST |
| WF-SEO-04 | WordPress Content Publisher | Webhook |
| WF-SEO-05 | PageSpeed Monitor | Sunday 7:00 AM IST |
| WF-SEO-06 | Rank Tracker | Tuesday 9:00 AM IST |
| WF-SEO-07 | Content Gap | Weekly |
| WF-SEO-08 | Backlink Monitor | Weekly |
| WF-SEO-09 | Internal Linking | Weekly |
| WF-SEO-10 | Indexing Ping | Daily |
| WF-SEO-11 | Content Decay | Weekly |
| WF-SEO-12 | Weekly Opportunity Digest | Friday 5:00 PM IST |

### 3. Optional — remove paid API keys to stop external spend

Railway dashboard → web service → Variables → delete (or leave unset):

```
VALUESREP_API_KEY        # ValueSERP — used by WF-SEO-06, WF-SEO-07
DATAFORSEO_LOGIN         # DataForSEO — used by WF-SEO-08
DATAFORSEO_PASSWORD      # DataForSEO
SERPER_API_KEY           # Serper.dev — used by worker rank tracking + backlink
```

Removing these stops external API spend even if a cron or workflow somehow
fires. Keep the keys in your password manager so you can restore them later.

The corresponding services keep running on the n8n panel and worker, but
they'll log "API key missing" warnings instead of consuming credits.

### 4. NOT paused (these are not SEO and stay live)

- `Workflow Self-Healing` — every 30 min, retries failed n8n executions
  for **all** workflows (CRM job processor, outreach, etc.). Don't pause.
- `Directory Scrapers` — daily 11 AM IST. Despite the SEO-adjacent name,
  this scrapes Clutch / GoodFirms / Upwork / LinkedIn for **outreach lead
  generation**, not SEO. Stays live.
- The `/seo` admin page (`admin/src/pages/SEOPage.jsx`) and any user-
  triggered SEO actions remain accessible — they only run on demand.

---

## How to resume

### Resume worker crons (1 click)

Railway dashboard → **GE-Worker** service → Variables → add:

```
SEO_ENABLED=true
```

Then redeploy the service (or wait for the next deploy). On startup, the
worker will log normal SEO cron registrations and the next scheduled run
will execute. No code changes required.

### Resume n8n workflows (one click each)

For each WF-SEO-* workflow on the n8n panel: open → toggle **Active**.

### Restore API keys

Re-add the four env vars from the list above on Railway. Web service for
SERPER, n8n service (`Primary`) for ValueSERP and DataForSEO.

---

## Verifying SEO is actually paused

After deploying these changes:

1. Open Railway → GE-Worker → Logs. You should see one
   `[CRON] SEO crons paused — set SEO_ENABLED=true to re-enable` line the
   first time any SEO cron fires (typically within the first day).
2. Check the SEO admin page (`/seo` → Workflows tab). All workflows should
   show as overdue / not running.
3. Watch the next billing cycle on Railway and the ValueSERP / DataForSEO
   dashboards — credit consumption should drop to zero.

## Cost expected to drop

| Source | Before | After (with keys removed) |
|--------|--------|--------------------------|
| ValueSERP | ~$50/mo | $0 |
| DataForSEO | ~$30/mo | $0 |
| Serper.dev | $0–100/mo | $0 |
| Claude API (SEO digests, competitor analysis) | $5–20/mo | $0 |
| n8n compute baseline | unchanged (n8n stays for CRM + outreach) | unchanged |
| Worker compute | small reduction | small reduction |
| **Total monthly savings** | | **~$80–200** |
