---
name: ge-morning-check
description: Use at the start of a working session to confirm prod is healthy before diving into changes. Triggers include "morning check", "is prod ok", "before I start, run the checks", "where are we at", "anything broken overnight", or any open-of-day prompt asking for system state. Skips: mid-session reviews (use ge-debug-prod-down if something is broken), single-service status questions ("is the worker up?" — just curl), feature-status reviews.
---

# Morning system check

Five minutes to confirm everything's still running before you commit to a session. The goal is to catch overnight regressions before you spend an hour investigating "wait, was this broken when I started?".

Reference: [`docs/URLS.md`](../../../docs/URLS.md), [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md).

## Steps

1. **Pull latest.**
   ```bash
   git pull origin main
   ```
   Mandatory — the repo auto-deploys on push, so if someone else (or another window) pushed overnight, your local is already behind production.

2. **Health probes — both subdomains.**
   ```bash
   curl -i https://api.growthescalators.com/health
   curl -i https://crm.growthescalators.com/health
   ```
   Both must return 200 with `{ status: 'ok', database: true }`. The canonical path is `/health` not `/api/health` — see [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md).

3. **Stats — does prod data look sane?**
   ```bash
   curl https://api.growthescalators.com/stats
   ```
   Compare row counts against your mental baseline. Wild swings (contacts dropped overnight, deals at 0) mean something deleted data — investigate before doing anything else.

4. **Worker service.** The web service can be green while the worker is dead — they're separate Railway services. Quick proxies for "worker is alive":
   - SEO crons: check `seo_workflow_logs` for entries in the last 24h.
     ```bash
     railway run --service web psql $DATABASE_URL \
       -c "SELECT service, status, ran_at FROM seo_workflow_logs ORDER BY ran_at DESC LIMIT 5;"
     ```
   - Stuck `jobs`: rows in `processing` for >10 min mean the worker has been down longer than that.
     ```bash
     railway run --service web psql $DATABASE_URL \
       -c "SELECT idempotency_key, status, attempts, locked_until FROM jobs WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes';"
     ```
   - If either looks wrong: open Railway dashboard → `worker` service → check Deployments tab.

5. **Recent commits.**
   ```bash
   git log --oneline -10
   ```
   See what landed since you last looked. If anything is `fix(...)` from someone else, skim the diff so you're not surprised by a behavioural change.

6. **Vercel edge — landing pages alive?**
   ```bash
   curl -I https://ecom.growthescalators.com/
   ```
   Should return 200. If 5xx, check Vercel deployments dashboard — landing pages are decoupled from Railway, but the queue drainer assumes they're capturing payments correctly.

7. **Webhook chain spot check.** If yesterday's purchases haven't shown up in the CRM:
   1. Vercel function logs (`ecom.*` deployments) — was the webhook received?
   2. Upstash Redis Stream (`crm:events`) — events stuck pending?
   3. `processed_events` — drainer picked them up?
   4. `contacts` + `deals` — final landing place?

8. **Read your own handoffs.** `.claude/handoffs/*.md` may have a "what to do next session" line from yesterday's session. The pending items there are usually small actions you'd otherwise rediscover an hour later.

## Quick all-in-one

```bash
git pull origin main && \
  curl -s https://api.growthescalators.com/health && echo "" && \
  curl -s https://crm.growthescalators.com/health && echo "" && \
  curl -s https://api.growthescalators.com/stats && echo "" && \
  git log --oneline -10
```

## When something looks off

- 5xx on health: jump to `ge-debug-prod-down`.
- Worker silent (no recent SEO logs): restart `worker` service on Railway, check the deploy logs for boot errors.
- Stale Vercel function: re-deploy from Vercel dashboard or push a no-op to the `client/` directory.
- Contacts row count dropped: STOP. Pull the audit log; don't push anything else until you've explained the delta.

## Reference

- [`docs/URLS.md`](../../../docs/URLS.md) — all production URLs
- [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md) — what each failure mode means
- `.claude/handoffs/` — yesterday's "next session" notes
