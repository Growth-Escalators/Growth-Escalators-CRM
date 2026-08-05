# GE SEO n8n Workflows

> ## Status: PAUSED (2026-05-03)
>
> These workflow JSONs are import templates. **None are currently deployed
> to the live n8n instance** (`primary-production-6c6f5.up.railway.app`) —
> that instance only runs an unrelated content pipeline (workflows 00–07).
>
> To re-deploy: open n8n UI → Settings → Workflows → Import → upload the
> JSON, then toggle the workflow active. The Express endpoints these
> workflows call (e.g. `/api/seo-workflows/trigger-all`) still exist and
> are ready.

Eight SEO automation workflows that handle rank tracking, backlinks,
PageSpeed monitoring, content gap analysis, and weekly digests.

## Workflows

| File | Purpose |
|---|---|
| `WF-SEO-04-upgraded.json` | SEO data ingestion / upgraded pipeline |
| `WF-SEO-05-pagespeed-monitor.json` | PageSpeed checks (also runs natively in `src/worker.ts` as backend cron) |
| `WF-SEO-06-rank-tracker.json` | Serper.dev rank tracking (also runs natively in worker — currently paused) |
| `WF-SEO-07-content-gap.json` | Content gap analysis (worker equivalent currently paused) |
| `WF-SEO-08-backlink-monitor.json` | Backlink monitoring via Serper (worker equivalent currently paused) |
| `WF-SEO-09-internal-linking.json` | Internal-linking suggestions |
| `WF-SEO-10-indexing-ping.json` | Search-engine indexing pings |
| `WF-SEO-11-content-decay.json` | Content decay detection (worker equivalent currently paused) |
| `WF-SEO-12-weekly-opportunity-digest.json` | Weekly Slack digest (worker equivalent currently active) |

Several of these duplicate cron jobs that already exist natively in
`src/worker.ts` — re-deploying any of them to n8n while the worker cron
is also active would cause double execution. Check `src/worker.ts` first
before re-enabling.
