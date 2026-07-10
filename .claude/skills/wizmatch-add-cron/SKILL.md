---
name: wizmatch-add-cron
description: Use when adding or changing a Wizmatch background job / cron in the worker — a new sourcing engine, a scoring/enrichment/matching job, a digest, or any node-cron schedule under the Wizmatch block. Triggers include "add a wizmatch cron", "schedule a new sourcing job", "run X every N hours in the worker", "my wizmatch job isn't running", "signals stuck at status=new". Skips: web-request handlers (use ge-add-route), GitHub Actions scraper workflows (those run in CI, not the worker), Growth CRM crons.
---

# Adding a Wizmatch worker cron

Worker jobs have three sharp edges that have already caused silent failures. Get all three right.
Reference: [`src/worker.ts`](../../../src/worker.ts) (Wizmatch block starts ~line 1400) and
[`docs/wizmatch/DATAFLOW.md`](../../../docs/wizmatch/DATAFLOW.md) §2 (crons + gating).

## The three rules

1. **Master gate.** The entire Wizmatch cron block only runs when:
   ```ts
   if (process.env.DISABLE_BACKGROUND_JOBS !== 'true' && process.env.WIZMATCH_TENANT_ID) { ... }
   ```
   Put your new cron **inside** this block. If either env condition is unmet, nothing fires — so if
   a job "isn't running", check these two envs first.

2. **Call the web service by URL, never localhost.** Worker jobs that hit the API must use
   `process.env.WIZMATCH_API_BASE_URL || 'https://api.growthescalators.com'` — not `localhost`.
   The classic bug: signal-scoring can't reach the web service, so signals stall forever at
   `status='new'`. Copy the `baseUrl` pattern already in `worker.ts`.

3. **No double-runs / collisions.** Pick a schedule that doesn't collide with the existing staggered
   jobs (scoring `*/30`, enrichment hourly, matching `*/2h`, domain health hourly, warmup `*/6h`,
   ATS `00:30`, X-Ray `02:30`, GitHub miner `03:30`, LCA weekly Sun `16:30`, digest Mon–Sat `12:30`).
   Space new jobs off the same minute.

## Steps
1. Read the Wizmatch block in `worker.ts` and place the new `cron.schedule(...)` inside the gate.
2. Resolve `tenantId` from `WIZMATCH_TENANT_ID` and `baseUrl` from `WIZMATCH_API_BASE_URL` exactly
   as the neighbours do.
3. Wrap the body in try/catch and log start + outcome (so you can confirm it fired).
4. Pick a non-colliding schedule.
5. Verify locally with the gate envs set, or read the worker logs after deploy to confirm the run.

## Never
- Never place the cron outside the master gate (it'll run for the wrong tenant or never).
- Never call `localhost` from the worker (stalls the pipeline).
- Never assume it ran — confirm from logs.
