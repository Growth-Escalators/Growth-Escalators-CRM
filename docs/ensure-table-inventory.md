# `ensure*` table inventory (M10 — Fable review 2026-07-16)

**Finding:** three parallel schema-management mechanisms coexist in this repo — Drizzle
`schema.ts` + journaled migrations (the source of truth for ~110 tables), and 41 tables
created ad hoc by `ensure*()` functions (raw `CREATE TABLE IF NOT EXISTS` run at server
boot, one per table/group). The `ensure*` tables are invisible to `drizzle-kit generate`,
have no FK constraints by construction (nothing in `schema.ts` references them), and their
column history lives only in git blame on the `CREATE TABLE`/`ALTER TABLE ... ADD COLUMN`
statements themselves.

**Scope of this doc:** the inventory + a recommended migration order (this is the "framework"
half of M10's fix path). Actually migrating tables into `schema.ts` is deliberately **not**
done in this pass — each migration needs the same care as the `prospects.tenant_id` migration
in this same PR (nullable-first-then-backfill, or explicit column-by-column diffing against
whatever the ad hoc SQL actually created over time), and doing 41 of those in one sitting
trades quality for speed on a guarded path. Treat the "Recommended order" section as the
punch list for follow-up PRs, highest-value first.

## Full inventory (41 tables, 32 `ensure*()` functions)

| Table | Created by | Notes |
|---|---|---|
| `deal_activities` | `src/index.ts` (inline, not a named `ensure*`) | FK-less; cited directly in M19 |
| `ads_settings` | `src/routes/ads.ts` | |
| `funnel_waitlist` | `ensureFunnelWaitlistTable` (`routes/funnel.ts`) | |
| `task_lists`, `task_checklist_items` | `routes/task-lists.ts` | |
| `audit_logs` | `ensureAuditLogsTable` (`services/auditLogger.ts`) | append-only |
| `expense_categories`, `team_payroll`, `expenses`, `income_entries`, `team_attendance`, `team_leaves` | `ensureFinanceTables` (`services/financeService.ts`) | money-adjacent — no tenant_id confirmed, worth an audit |
| `purchase_delivery_log` | `ensureDeliveryLogTable` (`services/funnelConfigService.ts`) | cited in H13/M25 fixes this same effort |
| `funnel_configs` | `ensureFunnelConfigTable` (`services/funnelConfigService.ts`) | |
| `growth_os_clients`, `brand_health_scores`, `money_on_table`, `creative_intelligence`, `competitor_pulse`, `copilot_conversations` | `ensureGrowthOSTables` (`services/growthOSSetup.ts`) | |
| `outreach_processed_replies` | `ensureProcessedRepliesTable` (`services/imapService.ts`) | |
| `ai_intelligence_reports` | `ensureIntelligenceTable` (`services/intelligenceAnalyzer.ts`) | |
| `ad_accounts`, `client_benchmarks` | `metaAdsService.ts` | |
| `outreach_funnel_daily` | `ensureOutreachFunnelTable` (`services/outreachFunnelMetrics.ts`) | |
| `outreach_leads`, `outreach_errors`, `outreach_migrations` | `ensureOutreachLeadsTable` (`services/outreachLeadsService.ts`) | `outreach_leads` is the outreach pipeline's primary table — high traffic |
| `pipeline_contacts` | `ensurePipelineContactsTable` (`services/pipelineService.ts`) | on the purchase→delivery hot path fixed in H13/M18 this effort |
| `client_retainers`, `retainer_line_items` | `ensureRetainerTables` (`services/retainerService.ts`) | billing-adjacent |
| `seo_content_calendar` | `ensureContentCalendarTable` (`services/seoContentGapService.ts`) | |
| `seo_weekly_metrics`, `site_health_metrics`, `seo_opportunities`, `seo_alerts_log`, `seo_workflow_logs` | `seoWorkflowHealthService.ts` | part of the H18 SEO-table-family tenant_id gap (not fixed this pass — see below) |
| `short_links` | `ensureShortLinksTable` (`services/shortLinksDb.ts`) | replaces external shlink service |
| `cron_job_logs` | `ensureCronJobLogsTable` (`services/systemHealthMonitor.ts`) | extended with a `'partial'` status in Batch 6 (`fix/reliability-crons`) — column is `VARCHAR(20)` with no CHECK, so that was additive-safe |
| `task_comments`, `task_attachments` | `tasksDb.ts` | |
| `outreach_website_cache` | `ensureWebsiteCacheTable` (`services/websiteCacheService.ts`) | |
| `outreach_leads_archive` | `src/worker.ts` (inline `LIKE outreach_leads INCLUDING ALL`) | |
| (+ several column-only `ensure*Columns` functions not listed — they `ALTER TABLE` existing Drizzle-tracked tables, not create new ones: `ensureAttendanceColumns`, `ensureCreativeIntelligenceColumns`, `ensureOutreachAlertColumns`, `ensureEnrichmentColumns`, `ensureSelfHealingColumns`, `ensureMetaColumns`/`ensureColumnsAndSeed` in `whatsappTemplates.ts`, `ensureMarketingAccountsNotifySlackColumn`, `ensureAdAccountsTable`'s column additions) | | these are actually the SAME underlying problem (schema drift invisible to `schema.ts`) but on tables Drizzle *does* know about — lower priority since the base table is still tracked |

## Recommended migration order (highest value first)

1. **`outreach_leads`, `outreach_errors`, `outreach_migrations`** — the busiest ad hoc table by
   query volume (daily outreach cron + n8n webhooks); most likely to benefit from Drizzle-managed
   indexes/FKs and to have accumulated undocumented columns.
2. **`pipeline_contacts`, `purchase_delivery_log`** — directly on the money/delivery path
   touched by this PR's H13/M18 fixes; already explicitly named in M19.
3. **`deal_activities`** — named directly in M19; small, low-risk table to prove out the
   migration pattern before tackling bigger ones.
4. **Finance tables** (`expenses`, `income_entries`, `team_payroll`, `team_attendance`,
   `team_leaves`, `expense_categories`) — money-adjacent, worth confirming tenant scoping
   while migrating.
5. **SEO table family** (`site_health_metrics`, `seo_opportunities`, `seo_alerts_log`,
   `seo_weekly_metrics`, `seo_workflow_logs`, `seo_content_calendar`) — do this together
   with the H18 SEO tenant_id backfill (that finding lists these same tables) rather than
   as two separate migrations touching the same rows.
6. Everything else, opportunistically, whenever a feature PR needs to touch one of these
   tables anyway (cheapest time to migrate it into `schema.ts` is when you're already there).

## Relationship to other 2026-07-16 review findings

- **M19** (FK-less runtime tables) is the same root cause as M10 — a table can't get a
  `references()` FK in `schema.ts` until it *is* in `schema.ts`. `prospects` got its FK this
  PR (H18) because it was already Drizzle-tracked; `deal_activities`/`pipeline_contacts`/
  `purchase_delivery_log` need the M10 migration first.
- **H18** (missing `tenant_id` on outbound + SEO tables): `prospects`/`signals`/`replies`/
  `outbound_events` are fixed in this PR (they were already in `schema.ts`). The SEO table
  family is not — see item 5 above.
- **M26** (6,091-line `routes/wizmatch.ts` god-route) is a separate, unrelated large item —
  not attempted this pass, tracked separately.
