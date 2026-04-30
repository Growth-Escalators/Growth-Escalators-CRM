# Troubleshooting

## Prod is down — first 60 seconds

```bash
# 1. Health check — should return { status: 'ok', database: true }
curl https://api.growthescalators.com/health

# 2. Basic stats
curl https://api.growthescalators.com/stats
```

If health returns 404 / non-200: check Railway dashboard for the `web` service — look for a failed/in-progress deploy. Redeploy latest `main` if a deploy is stuck.

If health returns 200 but something is broken: check the `worker` service separately — it's a different Railway service and can be down while API is healthy.

## Railway deploy stuck

1. Railway dashboard → project → `web` service → Deployments tab.
2. If the current deploy shows "Building" for >5 min: cancel it and redeploy.
3. Check build logs for `npm ci` failures (missing devDependencies? — see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) Railway build gotchas).
4. `nixpacks.toml` controls the build. `nixpacksPlan` inside `railway.json` is ignored by Railway.

## Webhook not processing

1. Check `processed_events` table — has the event ID been inserted? If yes, it was processed (or is processing).
2. Check the `jobs` table for rows stuck in `processing` state for >10 minutes — the `startStuckJobWorker` should reset them, but if the worker is down they'll pile up.
3. Verify the worker service is running (`railway.worker.json` service in Railway dashboard).

## Contact not appearing in CRM after payment

1. Check `processed_events` — was the Cashfree webhook received and marked as processed?
2. Check Upstash Redis Stream (`crm:events`) — is the event stuck in the queue (worker down)?
3. Verify normalisation: email lowercased, phone digits-only with `91` prefix.
4. Check `contact_channels` table directly — `findOrCreateContact` matches on `(channel_type, channel_value)`.

## Common 500s

| Symptom | Root cause |
|---|---|
| `SELECT c.email FROM contacts` returns 500 | Email is in `contact_channels`, not `contacts` |
| Deal detail panel shows "Deal not found" | Same — `c.email`/`c.phone` columns don't exist on `contacts`; use correlated subquery against `contact_channels` |
| Sequence step not sending | Check `sequence_enrolments.nextStepAt` — worker polls every minute; if worker is down, steps queue up |
| `/api/cashfree/webhook` silently re-processes | Check `processed_events` — duplicate event IDs are blocked; log the `event_id` being received |

## Edge function 500 on Vercel

- Missing `.js` extension on relative imports (ESM mode) — see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) Vercel edge gotchas.
- JSON import without `with { type: 'json' }` — fail soft in the edge function and rely on bundled fallback in the SPA.
- Function timeout: Vercel Hobby is 10s. If a side-effect is taking too long, check whether it's being awaited after `res.send()`.

## SEO system health

```bash
npm run seo:doctor    # runs scripts/seo-doctor.ts against live DB
```

Check Railway logs for the `worker` service — SEO crons log to Pino with `service: 'seo-*'` tags. Missing `SERPER_API_KEY` will throw and write `status='error'` to `seo_workflow_logs`.
