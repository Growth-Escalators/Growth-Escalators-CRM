---
name: ge-debug-prod-down
description: Use when production is reported broken — site returning errors, webhook not processing, contact list empty, payments capturing but not appearing in CRM, "API down", "PROD IS DOWN", "the CRM is throwing 500s", or anything coming in as a P0. Skips: known-flaky local dev issues, build failures (use ge-release-check), feature requests, "this looks weird in the admin panel" without an HTTP error.
---

# Prod-down playbook

When prod is reported down, work the symptom from outside-in. Don't guess. The first 60 seconds is health checks; everything else flows from what they tell you.

Reference: [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md) for the canonical decision tree, [`docs/URLS.md`](../../../docs/URLS.md) for production URLs.

## Steps

1. **Health probes — both subdomains.** The canonical health route is `/health`, NOT `/api/health` (the latter is a recently-added alias; some old monitors still use it).
   ```bash
   curl -i https://api.growthescalators.com/health
   curl -i https://crm.growthescalators.com/health
   curl -i https://api.growthescalators.com/stats
   ```
   - 200 + `{ status: 'ok', database: true }` → API is fine; the bug is downstream (worker, integration, frontend).
   - 404 with `Application not found` body (HTML) → Railway-side: app routing or failed deploy.
   - 404 with `{"error":"route not found"}` (JSON) → Express IS up, you hit the wrong path. Try `/health` not `/api/health`.
   - 5xx → Express up but database / boot-time hook is failing. Move to step 4 (logs).
   - Connection refused / timeout → Railway service is down or DNS is broken.

2. **Check both Railway services in parallel.** The web service serves `api.*` + `crm.*`. The worker is a SEPARATE service running `dist/worker.js` — webhook drainer, SEO crons, sequence stepping. Either can be down independently.
   - Open Railway dashboard → project → check `web` and `worker` Deployments tabs.
   - "Building" >5 min: cancel and redeploy. See [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md) "Railway deploy stuck".
   - Crashed / Failed: read the deploy logs for the error.
   - Last successful deploy time: cross-reference against recent commits.

3. **Recent commits — what changed in the last hour?**
   ```bash
   git log --oneline -10 origin/main
   ```
   If the prod-down report came in shortly after a deploy, that commit is the prime suspect. Check the diff. Common culprits:
   - Schema migration that fails to apply (NOT NULL on populated table, missing default).
   - New env var the code requires but Railway doesn't have set.
   - Edge function ESM import without `.js` extension.
   - Removed a route mount that something external still hits.

4. **Stuck `processed_events` / `jobs` rows.** If health is 200 but webhooks aren't landing or sequence steps aren't sending:
   ```bash
   railway run --service web psql $DATABASE_URL \
     -c "SELECT id, event_type, status, processed_at FROM processed_events ORDER BY received_at DESC LIMIT 20;"
   railway run --service web psql $DATABASE_URL \
     -c "SELECT idempotency_key, status, attempts, locked_until FROM jobs WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes';"
   ```
   Stuck `jobs` rows mean the worker is dead or `startStuckJobWorker` isn't resetting them. Restart the worker service.

5. **Webhook landed but no contact?** Check the chain:
   1. Edge function logs on Vercel (`ecom.growthescalators.com` deployments).
   2. Upstash Redis Stream `crm:events` — is the event sitting there because the drainer isn't running?
   3. `processed_events` — drainer wrote it but processing failed?
   4. `contacts` + `contact_channels` — the row exists but the email/phone is mis-normalised so a duplicate was created?

6. **The "Deal not found" / "Contact not found" class of errors.** Almost always: a route is doing `SELECT c.email FROM contacts` — those columns don't exist, query 500s, frontend renders the !found fallback. See [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md) "Common 500s".

7. **DNS / TLS edge cases.**
   ```bash
   dig crm.growthescalators.com
   dig api.growthescalators.com
   ```
   Should return Railway CNAMEs. If pointing somewhere else, someone changed DNS — escalate, don't try to fix in code.

8. **Once you've identified the issue:**
   - Code bug: fix on a branch, follow `ge-release-check` before pushing. Don't push direct to main without `npm run build && npm test` passing — half the prod-downs in this repo's history started as "quick fix" pushes that broke build.
   - Railway-side issue (stuck deploy, env var missing): fix in dashboard, redeploy.
   - Genuinely external (DNS, Cashfree side, Vercel outage): wait + monitor; don't ship random changes.

9. **Post-mortem note.** After resolution, jot two lines: what happened, what would have caught it earlier. If the answer is "a startup-time env validator" or "a smoke test", that's worth a follow-up issue.

## Quick reference table

| Symptom | First check |
|---|---|
| `/health` 404 with HTML | Railway dashboard — failed deploy |
| `/health` 404 with JSON `route not found` | You hit wrong path — try `/health` not `/api/health` |
| Webhook received, no CRM row | `processed_events` table, then worker logs |
| Contact list empty | Recent migration broke `contacts` query, or worker died mid-batch |
| Payment captured, no contact | Edge → Upstash → drainer chain (step 5) |
| Sequence step not firing | Worker service down OR `nextStepAt` in past + status='active' |
| 500 on deal detail | Route SELECTing `c.email` from `contacts` |

## Reference

- [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md) — canonical decision tree
- [`docs/URLS.md`](../../../docs/URLS.md) — health endpoints, webhook URLs
- [`docs/DEPLOYMENT.md`](../../../docs/DEPLOYMENT.md) — Railway build gotchas
- Past incidents: `.claude/handoffs/gatekeeper.md`, `.claude/handoffs/seo.md` — read for the "wait, that 404 was actually our Express catch-all" class of misdiagnosis
