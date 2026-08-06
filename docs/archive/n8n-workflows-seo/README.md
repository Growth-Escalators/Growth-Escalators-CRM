# Archived — n8n SEO workflows (superseded, nothing here executes)

**Status: ARCHIVED, not running, not deployable.** These ten n8n workflow JSONs
(`WF-SEO-04` through `WF-SEO-12`) are kept purely as a historical record of the
node graphs the agency used to run for SEO automation. Nothing in this
directory executes today, nothing imports it at build or runtime, and nothing
in this repo depends on it. Do not re-import these into an n8n instance —
their functionality has been reimplemented natively (see below), and running
both would double-execute the same work.

## Why these are here at all

Before they moved here, this directory (`n8n-workflows/seo/`) already carried
its own "PAUSED" notice (2026-05-03): none of these workflows were deployed to
the live n8n instance even then — that instance only ran an unrelated content
pipeline (workflows 00–07 in the sibling `n8n-workflows/` tree). The n8n
instance itself is now fully decommissioned. The JSONs are the only surviving
record of what those node graphs looked like, which is worth keeping even
though nothing runs them — hence archive, not delete.

## What replaced each workflow

The SEO system is now a set of native, multi-tenant, multi-platform backend
services and crons in `src/`, not n8n graphs. Every workflow below has a
direct native replacement; none is a gap.

| Archived workflow | What it did | Native replacement |
|---|---|---|
| `WF-SEO-04-upgraded.json` | SEO content ingestion / WordPress publish pipeline | `src/modules/site/providers/wordpress.provider.ts` + `src/services/siteChangeService.ts` (the approve-then-publish state machine) |
| `WF-SEO-05-pagespeed-monitor.json` | PageSpeed / Core Web Vitals checks | `src/services/pagespeedService.ts`, cron `PageSpeed Monitor` (Sundays 7:30 AM IST) |
| `WF-SEO-06-rank-tracker.json` | Serper.dev keyword rank tracking | `src/services/rankTrackingService.ts`, cron `Rank Tracking` (Tuesdays 9:00 AM IST) |
| `WF-SEO-07-content-gap.json` | Competitor content gap analysis | `src/services/seoContentGapService.ts`, cron `SEO Content Gap Analysis` (15th of month) |
| `WF-SEO-08-backlink-monitor.json` | Backlink monitoring | `src/services/seoBacklinkService.ts`, cron `SEO Backlink Monitor` (Fridays 9:00 AM IST) |
| `WF-SEO-09-internal-linking.json` | Internal-linking suggestions | Superseded by the site-change/drift model — no direct 1:1 native cron; internal linking is now something an operator proposes as a `site_changes` row like any other page edit |
| `WF-SEO-10-indexing-ping.json` | Search-engine indexing pings | `src/services/seoIndexingQueueService.ts`, cron `SEO Indexing Reminder` (Fridays 12:30 PM IST) — there is no supported push-indexing API for ordinary pages, so this reminds a human to click through GSC by hand rather than calling an API n8n used to hit |
| `WF-SEO-11-content-decay.json` | Content decay detection | `src/services/seoContentDecayService.ts`, cron `SEO Content Decay` (Mondays 9:00 AM IST) |
| `WF-SEO-12-weekly-opportunity-digest.json` | Weekly Slack opportunity digest | `src/services/seoDigestService.ts`, cron `SEO Weekly Digest` (Fridays 5:00 PM IST, gated off by default behind `SEO_DIGEST_SLACK_ENABLED`) |

Two capabilities the old n8n pipeline did not have at all, native-only:

- **A drift sweep** (`src/services/siteDriftService.ts`, cron `SEO Drift Sweep`,
  daily 7:30 AM IST) — detects a client editing a live page behind the
  agency's back, or a page silently losing its SEO metadata. No n8n workflow
  in this archive did this.
- **A human-approval hard stop before anything publishes**
  (`src/services/siteChangeService.ts`) — enforced at three independent
  layers (a DB CHECK constraint, the service, and each platform adapter). The
  old WordPress-publish workflow (`WF-SEO-04`) had no equivalent gate.

For the full current architecture and how to debug it, see
[`docs/seo/seo-debugger.md`](../../seo/seo-debugger.md). For what changed and
why, see the "SEO Phase 1–5" entries in [`.ai/HANDOFF_LOG.md`](../../../.ai/HANDOFF_LOG.md).
