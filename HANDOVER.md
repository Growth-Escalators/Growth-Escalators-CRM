# Growth Escalators CRM — Engineering Handover

**Repo:** `growth-escalators-backend-v2`
**Live:** `crm.growthescalators.com` (admin CRM) · `api.growthescalators.com` (API) · `ecom.growthescalators.com` (D2C)
**Stack:** Node 20 · Express · TypeScript · Drizzle (Postgres) · Vitest · React (admin + client SPAs) · Tailwind
**Document version:** May 18, 2026

---

## 1. What this system is

The Growth Escalators CRM is the **central operations system** for the agency. It replaces what would otherwise be a stack of disconnected SaaS tools (HubSpot + ClickUp + Zapier + Saleshandy + Looker + a separate finance tool) with one self-hosted system that the entire team logs into to do their work.

In a single sentence: it is **the place where every lead, deal, task, payment, ad campaign, SEO ranking, social post and team-attendance record lives, and where automated jobs notify the right person about the right thing at the right time.**

### What it does for each team

| Team | What they use it for |
|---|---|
| **Sales / BD** | Contacts list, Pipeline kanban, Outreach dashboard, Inbox, Tasks |
| **Performance Marketing** | Meta Ads dashboard, conversion tracking, spend alerts, creative intelligence |
| **SEO** | Keyword rank tracking, backlink monitoring, content gap analysis, weekly digest emails |
| **Social Media** | Social post scheduler, multi-platform publishing |
| **Account Managers / Ops** | Client pages, task board, daily SOD/EOD digests, intelligence reports |
| **Finance** | Invoice generation, payment tracking, retainer management, GST handling |
| **Founders / Admin** | Dashboard, Audit log, Permissions, Reports, Team performance metrics |
| **Everyone** | My Attendance, Tasks, Inbox, AI Intelligence chat |

### How it helps the team do more

1. **One login, every workflow.** No tab-juggling between HubSpot, Saleshandy, Slack, Looker, Google Sheets.
2. **Automated daily digests.** Morning Briefing (4 AM), SOD Priority Digest (4:45 AM), EOD Summary (1:45 PM IST), weekly SEO Digest (Fri), Outreach Daily Digest (2:30 PM) — all post into the right Slack channels with the right people @-mentioned, so nobody has to chase status.
3. **Lead-to-cash automation.** A lead hitting a Tally form on `ecom.growthescalators.com` → Vercel edge function → Upstash queue → CRM drainer → contact created → Pipeline placement → Outreach sequence → reply detected via IMAP → task assigned to a salesperson — all without anyone touching it.
4. **Cashfree payments don't get lost.** Edge functions write to Upstash Redis Stream so payments capture even if Railway is down; the drainer reconciles when it comes back online.
5. **AI intelligence layer.** Claude-powered daily intelligence reports surface what changed yesterday — spend anomalies, ranking drops, deal-stage staleness, blockers — and deliver to Slack.
6. **Tasks v2** (shipped May 17, 2026): redesigned task board with kanban, focus view, natural-language quick-capture (`!high @sneha #urgent due tomorrow`), right-side detail slide-in, smart-rank, density toggle. Replaces the old monolithic task page.

---

## 2. High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    GROWTH ESCALATORS                          │
└──────────────────────────────────────────────────────────────┘

  ┌────────────────────┐         ┌────────────────────┐
  │  ecom.* (Vercel)   │         │  content.* (Vercel)│
  │  D2C landing + SPA │         │  Next.js content   │
  │  client/src/*      │         │  (separate repo)   │
  └────────┬───────────┘         └────────────────────┘
           │ payment / form events
           ▼
  ┌────────────────────────────┐
  │  Upstash Redis Stream      │
  │  crm:events                │
  └────────┬───────────────────┘
           │ drained async
           ▼
  ┌────────────────────────────────────────────────────────┐
  │                  RAILWAY (one repo, two services)       │
  │                                                         │
  │  ┌─────────────────┐         ┌────────────────────┐    │
  │  │  API process    │◄────────┤  Worker process    │    │
  │  │  src/index.ts   │         │  src/worker.ts     │    │
  │  │                 │         │                    │    │
  │  │  • REST API     │         │  • All cron jobs   │    │
  │  │  • Admin SPA    │         │  • IMAP polling    │    │
  │  │    served at    │         │  • Sequence worker │    │
  │  │    /crm         │         │  • Edge drainer    │    │
  │  │  • Socket.IO    │         │  • Social poster   │    │
  │  │    (inbox)      │         │  • Stuck-job rescuer│   │
  │  └─────────────────┘         └────────────────────┘    │
  │           │                            │                │
  │           └────────────┬───────────────┘                │
  │                        ▼                                │
  │            ┌────────────────────────┐                   │
  │            │  PostgreSQL (Railway)  │                   │
  │            │  Drizzle schema        │                   │
  │            │  44 tables             │                   │
  │            └────────────────────────┘                   │
  └────────────────────────────────────────────────────────┘
              │
              ├──────────► Slack (digests, alerts)
              ├──────────► Cashfree (payments)
              ├──────────► Meta Ads + CAPI
              ├──────────► Brevo (email)
              ├──────────► Anthropic Claude (AI intel)
              ├──────────► Serper.dev (SEO data)
              ├──────────► Hunter / Snov / Apollo (enrichment)
              ├──────────► Saleshandy (outreach sequences)
              ├──────────► Cal.com (meeting bookings)
              └──────────► IMAP (PurelyMail × 6 inboxes)

  ┌────────────────────┐
  │  n8n (Railway)     │  Separate service. Mostly paused
  │  outreach + SEO    │  as of May 3, 2026. Still hosts
  │  workflows         │  some legacy automations.
  └────────────────────┘
```

### Two-process Railway split

| Service | Config file | Start command | Responsibility |
|---|---|---|---|
| **API** | `railway.json` | `node dist/scripts/migrate.js && node dist/index.js` | HTTP/REST, admin SPA, Socket.IO |
| **Worker** | `railway.worker.json` | `node dist/worker.js` | All cron jobs, IMAP, queue drainer, background workers |

Both share the codebase but **must never import each other's entry points**. Any logic that needs to run in either context lives in `src/services/`.

### Frontends

| SPA | Where it runs | Path | URL |
|---|---|---|---|
| **Admin CRM** | Served by API process under `/crm` | `admin/` | `crm.growthescalators.com` |
| **D2C Landing** | Hosted independently on Vercel | `client/` | `ecom.growthescalators.com` |

Each has its own `package.json`. Local: `npm run admin:dev` (port 5173) and `npm run client:dev` (port 5174).

---

## 3. Codebase tour

### Directory layout

```
v2/
├── src/                       # Backend (TypeScript)
│   ├── index.ts               # API process entry
│   ├── worker.ts              # Worker process entry
│   ├── routes/                # Express handlers (thin)
│   ├── services/              # Business logic (testable)
│   ├── middleware/            # auth, rbac, errors
│   ├── db/
│   │   ├── schema.ts          # ★ all 44 tables, single source of truth
│   │   └── migrations/        # Drizzle-generated SQL
│   ├── config/constants.ts    # ★ magic numbers, Slack IDs, tenant slug
│   └── scripts/               # migrate, seed, one-off utilities
│
├── admin/                     # Admin CRM SPA (Vite + React + Tailwind)
│   ├── src/pages/             # one component per route
│   │   └── tasks/             # ★ Tasks v2 redesign (28 files)
│   ├── src/components/        # Sidebar, navEntries, command palette
│   ├── src/lib/api.js         # apiFetch helper
│   └── vite.config.js
│
├── client/                    # D2C landing SPA (Vite + React)
│   ├── src/pages/             # LandingPage, CheckoutPage, ThankYouPage…
│   ├── api/                   # Vercel edge functions
│   │   ├── cashfree/          # ★ payment routes (don't break)
│   │   ├── funnel/
│   │   └── _lib/              # cashfree + queue helpers
│   ├── vercel.json
│   └── vite.config.js
│
├── docs/                      # Architecture / DB / deployment runbooks
├── n8n-workflows/             # Reference JSON exports of n8n workflows
├── public/admin/              # Compiled admin SPA (committed; served by API)
├── railway.json               # API service Nixpacks config
├── railway.worker.json        # Worker service Nixpacks config
├── nixpacks.toml              # ★ actual build config (Railway uses this)
├── CLAUDE.md                  # AI coding agent instructions
└── CRM_SYSTEM_DOCS.md         # Full narrative architecture
```

### Routes vs services — the rule

Routes (`src/routes/*`) should be **thin**: parse request → call a service → return JSON. All real work happens in `src/services/*` so it's reusable from both the API and the worker, and so it's unit-testable in vitest.

When adding a feature: write the **service** first with a test, then wire a route handler.

---

## 4. Database

44 tables in `src/db/schema.ts`. Grouped by domain:

| Domain | Tables |
|---|---|
| **Tenancy & users** | `tenants`, `users`, `userPermissions`, `passwordResetTokens` |
| **Contacts & clients** | `contacts`, `contactChannels`, `contactNotes`, `clients`, `billingClients` |
| **Deals & pipelines** | `pipelines`, `deals`, `events`, `processedEvents` |
| **Tasks** | `tasks`, `taskLists`, `taskChecklistItems`, `jobs` |
| **Sequences & messages** | `sequences`, `sequenceEnrolments`, `messages` |
| **Funnels & bookings** | `funnels`, `funnelMembers`, `funnelAssignments`, `bookings` |
| **Finance** | `invoices`, `invoiceLineItems`, `payments`, `invoiceSeries` |
| **Communications** | `emailTemplates`, `waTemplates` |
| **Marketing / social / ads** | `socialAccounts`, `socialPosts`, `marketingAccounts`, `adsInsightsCache` |
| **SEO** | `keywordRankings`, `backlinkData`, `contentGapAnalysis`, `seoOpportunities`, `siteHealthMetrics` |
| **Discovery** | `discoverySearches`, `discoveryResults`, `discoveryApiUsage`, `brandMentions` |
| **Knowledge** | `clientKnowledgeBase`, `clientPages` |
| **Audit** | `auditEvents` |

### Two critical invariants

1. **Multi-tenancy by `tenant_id`.** Every table has a `tenant_id` column; every query must be scoped. The default tenant slug is `growth-escalators` in `src/config/constants.ts`.
2. **Contact email and phone are NOT on the `contacts` table.** They live in `contact_channels` rows as `(channel_type, channel_value)` pairs. `SELECT c.email FROM contacts c` will 500. Use a join or correlated subquery against `contact_channels`.

### Schema lifecycle

- **Preferred (new work):** edit `src/db/schema.ts` → `npm run db:generate` → commit schema + migration together. Migrations run automatically on every API boot.
- **Legacy (don't extend):** some services have `ensureXTable()` / `ensureXColumns()` functions called from `src/index.ts`/`src/worker.ts` boot. Keep that pattern *within* the service if it already exists; don't introduce new ones.

### Useful commands

```bash
npm run db:generate    # diff schema.ts → emit migration SQL
npm run db:migrate     # apply pending migrations manually
npm run db:studio      # local web UI for inspecting data
```

---

## 5. Admin CRM (what users see)

The admin SPA mounts at `crm.growthescalators.com`. Sidebar entries (defined in `admin/src/components/navEntries.js`) are role-gated:

### Sidebar sections

**Personal** *(everyone)*
- My Attendance — check-in/out, daily attendance log

**CRM** *(role: sales+)*
- Dashboard — executive KPIs, daily metrics, snapshots
- Contacts — lead/contact list with search, scoring, bulk ops
- Pipeline — sales kanban (deals across stages)
- Clients — client cards with billing rollup
- **Tasks** — *new Tasks v2 (May 2026)*: kanban board + focus view + detail panel + NL quick-capture
- Inbox — email/message inbox via Socket.IO + IMAP polling

**Marketing**
- Meta Ads *(canAds)* — campaign performance, spend
- Social *(canSocial)* — multi-platform scheduler
- Outreach *(team_lead+)* — outreach lead dashboard, funnel metrics
- Content *(external link)* — `content.growthescalators.com` (separate repo)

**AI & Automation**
- AI Intelligence *(team_lead+)* — Claude-powered daily intelligence reports + chat

**Tools** *(collapsible)*
- Lead Discovery — Serper-powered prospect research
- Email Templates — Brevo-synced
- WA Templates — WhatsApp business message templates
- Short Links — URL shortener with click tracking

**Finance** *(collapsible, admin/billing only)*
- Billing — invoice management
- Expenses — leave + expense approvals
- Funnels — funnel builder + config

**Settings** *(collapsible, admin only)*
- Permissions — RBAC, role assignments, per-user overrides
- Audit Log — every state-changing action
- Analytics — pageview tracking, conversion funnels
- SEO — keyword rankings, backlinks, audits
- Pipeline Manager — define stages

### Role hierarchy

```
staff < sales < team_lead < manager_ops / manager_ads < admin
```

`team_lead` is the "trusted ops" tier — gets Outreach, AI Intelligence, Meta Ads, but **not** Billing, Permissions, or Audit. Per-user overrides live in `userPermissions` (e.g. grant a `staff` user `reportsMetaAds: true`).

---

## 6. Tasks v2 (most recent feature)

Shipped in 5 layers (A–E), May 14–17, 2026. Replaced a 3,000-line monolithic `TasksBoardPage.jsx` with **28 files, 3,173 LOC**, no file over 400 lines.

| File group | What it owns |
|---|---|
| `TasksPage.jsx` | Main shell, state, mutations |
| `Header.jsx` + `FilterBar.jsx` | Top bar, quick-capture, view switcher, filters |
| `Board.jsx` + `Column.jsx` + `TaskCard.jsx` | Kanban + drag-drop (`@hello-pangea/dnd`) |
| `FocusView.jsx` + `FocusRow.jsx` | "What needs attention" view: Overdue / Today / In Progress / Up Next |
| `ListView.jsx` | Sortable flat table with multi-select |
| `CalendarView.jsx` | Month grid; click a day to create a task with that due date |
| `TeamPerformanceTab.jsx` | Admin-only metrics: done count, on-time %, aging, sparklines |
| `DetailPanel.jsx` + `DetailPanel/*` | 480px right-side slide-in: StatusPicker + FieldStrip + Description/Subtasks/Activity/Files tabs |
| `BulkToolbar.jsx` | Multi-select bulk status / priority / assignee / delete |
| `QuickCapture.jsx` | Natural-language input: `Call Sneha @sneha !high #urgent due tomorrow` |
| `DensityMenu.jsx` | Compact / Default / Cozy density toggle |
| `lib/parser.js` | Token parser for the NL input |
| `lib/smartRank.js` | Top-5 priority ranking |
| `lib/filterPipeline.js` | Filter composition |
| `atoms/` | Avatar, AvatarGroup, TagChip, PriorityFlag, DueChip, SmartBadge |

### Keyboard shortcuts
- `⌘K` / `Ctrl+K` — focus quick-capture from anywhere
- `↑` / `↓` in detail panel — cycle through visible tasks
- `Esc` — close detail panel (focus returns to originating card)
- Enter in quick-capture — create task with parsed tokens

### Persisted state (localStorage)
- `ge-crm-tasks-view` — scope (mine / all / today)
- `ge-crm-tasks-subview` — board / focus / list / calendar / team
- `ge-crm-tasks-smart-sort` — boolean
- `ge-crm-tasks-collapsed-cols` — array of collapsed column keys
- `ge-crm-tasks-density` — compact / default / cozy

---

## 7. Backend services (the brains)

71 services in `src/services/`. The important ones grouped by domain:

### Payments
- **`cashfreeEventProcessor.ts`** — **canonical** Cashfree webhook handler. Used by both `/api/cashfree/webhook` and the queue drainer. Do **not** duplicate this logic anywhere else.
- `financeService.ts` — invoice/payment math, overdue checks (cron 4 AM daily)
- `recurringInvoiceService.ts` — monthly retainer drafts (cron `30 3 1 * *`)
- `retainerService.ts` — retainer contracts

### Contacts & deals
- `contactService.ts` — lifecycle, the `findOrCreateContact` invariant
- `opportunityService.ts` — opportunity scoring
- `qualificationService.ts` — lead qualification
- `pipelineService.ts` — auto-place new contacts in pipelines (`setInterval` polling)
- `roundRobinService.ts` — assign incoming leads round-robin

### Outreach
- `outreachLeadsService.ts` — lead lifecycle, Saleshandy auto-upload
- `outreachEnrichmentService.ts` — Hunter / Snov / Apollo enrichment (polling)
- `outreachCrmSyncService.ts` — sync CRM ↔ Saleshandy
- `outreachAlertService.ts` — reply alerts, daily digest (2:30 PM)
- `outreachFunnelMetrics.ts` — daily funnel snapshot (6:25 PM)
- `directoryScraperService.ts` — Google Places scraping for prospect discovery
- `emailExtractorService.ts` — Reacher email verification
- `saleshandyStatsService.ts` — pull Saleshandy stats into CRM

### SEO (cron-heavy)
- `rankTrackingService.ts` — Serper rank tracking (Tue 3:30 AM)
- `seoBacklinkService.ts` — backlink monitoring (Fri 3:30 AM)
- `seoContentDecayService.ts` — performance decay detection (Mon 3:30 AM)
- `seoContentGapService.ts` — gap analysis (15th of month, 4:30 AM)
- `seoWeeklyEmailService.ts` — weekly digest (Thu 5 AM)
- `seoAlertService.ts` — threshold alerts (daily 3:30 AM)
- `seoDigestService.ts` — Fri 11:30 AM SEO summary
- `programmaticSeoService.ts` — WordPress page generation
- `seoWorkflowHealthService.ts` — *paused since May 3, 2026* (n8n workflows decommissioned)

### Ads & marketing
- `metaAdsService.ts` — Meta Marketing API integration; daily report 4 AM Mon–Sat; token expiry check Mon 4 AM
- `metaCapi.ts` — Meta Conversions API event firing
- `creativeIntelligenceService.ts` — ad creative ML analysis (every 6h)
- `competitorContentService.ts` — competitor content pulse (Fri 3:30 AM; 1st + 15th 3:30 AM analysis)
- `pagespeedService.ts` — Lighthouse monitoring (Sun 2 AM)

### Intelligence & digests
- `intelligenceDataCollector.ts` + `intelligenceAnalyzer.ts` + `intelligenceDelivery.ts` — daily intelligence report (3 AM)
- `morningBriefingService.ts` — Morning briefing (Mon–Sat 4 AM)
- `sodEodService.ts` — SOD/EOD Slack DMs to humans (Mon–Sat 4:45 AM / 1:45 PM IST). **Don't break this — it pings real people on a schedule.**
- `eveningSummaryService.ts` — evening summary
- `copilotService.ts` — internal copilot, polls every 10 min

### Communications
- `slackService.ts` — Slack channel and DM helpers (uses `SLACK_BOT_TOKEN`)
- `emailService.ts` — SMTP outbound
- `imapService.ts` — IMAP inbox polling (`PURELYMAIL_PASS_1..6`, six mailboxes)
- `brevoTemplateService.ts` — Brevo template sync
- `sequenceService.ts` — orchestrates email/SMS sequences (sequence worker)

### Infrastructure
- `edgeQueueDrainer.ts` — drains Upstash Redis stream into Postgres
- `systemHealthMonitor.ts` — checks DB, Slack, external APIs (`setInterval`)
- `jobQueue.ts` — generic async job queue
- `circuitBreaker.ts` — circuit-breaker wrapper for flaky external APIs
- `pdfService.ts` — invoice / report PDF generation

---

## 8. Scheduled work (cron jobs)

All defined in `src/worker.ts` using a `safeCron` wrapper that prevents overlapping runs. Times are **server time (IST)** unless otherwise stated.

### Daily

| Cron | Job |
|---|---|
| `0 3 * * *` | Intelligence collector + analyzer + delivery |
| `30 3 * * *` | SEO alert triggers |
| `0 4 * * *` | Overdue invoice check |
| `0 4 * * 1-6` | Morning briefing + Meta Ads daily report |
| `45 4 * * 1-6` | SOD digest + Sakcham priority SOD |
| `0 5 * * 1-6` | Late attendance check |
| `45 13 * * 1-6` | EOD summary + Evening summary |
| `30 14 * * 1-6` | Outreach daily digest |
| `30 18 * * *` | Saleshandy stats poll, Outreach funnel snapshot |
| `30 1 * * *` | Daily lead discovery |
| `30 5 * * *` | Directory scrapers |
| `30 21 * * *` | Daily archive |

### Sub-daily

| Cron | Job |
|---|---|
| `*/10 * * * *` | Co-Pilot poller |
| `0 */2 * * *` | Reset stuck enriching leads |
| `0 */6 * * *` | Money-on-table check, creative intelligence, booking follow-up |

### Weekly

| Cron | Job |
|---|---|
| `30 2 * * 1` | Weekly outreach summary |
| `30 3 * * 1` | SEO content decay |
| `30 3 * * 2` | Rank tracking |
| `0 5 * * 4` | SEO weekly email |
| `30 11 * * 5` | SEO weekly digest |
| `30 3 * * 5` | SEO backlink monitor + Competitor pulse |
| `30 20 * * 6` | Weekly data cleanup |
| `0 2 * * 0` | PageSpeed monitor |

### Monthly

| Cron | Job |
|---|---|
| `30 3 1 * *` | Monthly invoice drafts + Finance monthly generation |
| `30 3 1,15 * *` | Competitor content analysis |
| `30 4 15 * *` | SEO content gap analysis |
| `30 5 1 * *` | Monthly client benchmarks |

### Always-running workers (not cron, persistent)

- `startStuckJobWorker()` — rescues stuck async jobs
- `startSequenceWorker()` — processes scheduled email/SMS sequence steps
- `startSocialPostWorker()` — publishes scheduled social posts
- `startEdgeQueueDrainer()` — drains Upstash Redis events into Postgres
- `pipelineService` polling — auto-places new contacts
- `outreachEnrichmentService` polling — auto-enriches new leads
- `outreachCrmSyncService` polling — keeps CRM ↔ Saleshandy in sync
- `systemHealthMonitor` polling — checks dependencies

### Kill switch

Set env `DISABLE_BACKGROUND_JOBS=true` to disable **all** cron and workers (emergency only).

---

## 9. External integrations

| Service | Used for | Entry point | Env var(s) |
|---|---|---|---|
| **Cashfree** | Payments | `src/services/cashfreeEventProcessor.ts`, `client/api/cashfree/*` | `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` |
| **Anthropic Claude** | AI intelligence + chat | `src/services/intelligenceAnalyzer.ts`, `src/routes/intelligenceChat.ts` | `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) |
| **Slack** | Digests, alerts, DMs | `src/services/slackService.ts` | `SLACK_BOT_TOKEN` + per-channel IDs |
| **Brevo** | Transactional email | `src/services/brevoTemplateService.ts` | `BREVO_API_KEY`, `BREVO_LIST_ID` |
| **Meta Ads + CAPI** | Campaign data + conversion API | `src/services/metaAdsService.ts`, `metaCapi.ts` | `META_ADS_TOKEN`, `META_CAPI_TOKEN`, `META_PIXEL_ID` |
| **Serper.dev** | SEO rank tracking, backlinks, scraping | `rankTrackingService.ts`, `seoBacklinkService.ts`, `directoryScraperService.ts` | `SERPER_API_KEY` |
| **Hunter / Snov / Apollo** | Email enrichment | `outreachEnrichmentService.ts` | `HUNTER_API_KEY`, `SNOVIO_API_KEY`, `APOLLO_API_KEY` |
| **Reacher** | Email verification | `emailExtractorService.ts` | `REACHER_BASE_URL` |
| **Saleshandy** | Outreach sequences | `outreachLeadsService.ts` | `SALESHANDY_API_KEY`, `SALESHANDY_SEQUENCE_ID` |
| **Cal.com** | Meeting bookings | `bookingService.ts` | `CALCOM_API_KEY`, `MEETING_BOOKING_URL` |
| **IMAP (PurelyMail)** | Inbox reply polling | `imapService.ts` | `PURELYMAIL_PASS_1..6` |
| **Google Places** | Local directory scraping | `directoryScraperService.ts` | `GOOGLE_PLACES_API_KEY` |
| **Upstash Redis** | Vercel → Railway event queue | `edgeQueueDrainer.ts`, `client/api/_lib/queue.ts` | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Tally** | Form submissions | `client/api/webhooks/tally.ts` | `TALLY_WEBHOOK_SECRET` |
| **n8n** | Legacy workflow automation (mostly paused) | `n8n-workflows/*.json` (reference), `OUTREACH_INTERNAL_SECRET` for callbacks | Separate Railway service |
| **WordPress** | Programmatic SEO | `programmaticSeoService.ts` | `WP_*` |

---

## 10. Deployment

### Railway (auto-deploys on push to `main`)

| Service name | Builds from | Process |
|---|---|---|
| `web` | `railway.json` | API |
| (worker name varies) | `railway.worker.json` | Worker |
| Postgres | Railway-managed | DB |
| n8n | Separate | Workflow engine (mostly idle) |

**Crucial gotcha:** Railway *ignores* the `nixpacksPlan` field inside `railway.json` / `railway.worker.json`. The real build config is in **`nixpacks.toml`** at the repo root. Both services share that one file.

The Nixpacks default `npm ci` runs with `NODE_ENV=production` which **skips devDependencies**. We work around this two ways: (a) build-critical tools like `typescript` live in `dependencies`, and (b) `nixpacks.toml` overrides the install phase to `npm install --include=dev`.

### Vercel (D2C SPA)

- Source: same Git repo, but Vercel builds **only the `client/` directory**.
- Hosts: `ecom.growthescalators.com`.
- Edge functions in `client/api/*` run as Vercel serverless functions (Node ESM, 10s timeout).
- Edge function gotcha: relative imports must include `.js` extensions (TS uses `moduleResolution: "bundler"` so it resolves to `.ts` at typecheck, but runtime needs the `.js`).

### Pre-deploy checklist

```bash
npm run build      # must exit 0; type errors block deploy
npm test           # must pass; failing tests block commit
git push origin main
```

Railway picks up the push and deploys both API and worker. Vercel picks up the same push and rebuilds `client/`.

### Payment resilience

If Railway is down, Cashfree payments don't get lost:

1. Buyer pays on `ecom.*` → Vercel edge function `client/api/cashfree/webhook.ts` writes event to Upstash Redis Stream `crm:events`.
2. When Railway is up, the **edge queue drainer** in `src/services/edgeQueueDrainer.ts` reads the stream and feeds events to `processCashfreeEvent()`.
3. Stream + DLQ names configurable via `EDGE_QUEUE_STREAM`, `EDGE_QUEUE_DLQ`, `EDGE_DRAINER_POLL_MS`.

---

## 11. Security & access control

### Trust boundary

`src/middleware/auth.ts` and `src/middleware/rbac.ts` are **load-bearing** — they decide who sees what. Touching them without care can leak data across tenants. The repo's `CLAUDE.md` explicitly forbids edits without sign-off.

### Authentication

- Admin SPA logs in via `/api/auth/login` → JWT signed with `JWT_SECRET` → stored in localStorage.
- API endpoints check JWT via the `auth` middleware.
- Public landing (`client/`) is mostly open; payment-creation endpoints validate via Cashfree-signed return URLs.

### Authorization (RBAC)

- 5 roles: `staff < sales < team_lead < manager_ops | manager_ads < admin`.
- Role gates live in `admin/src/components/navEntries.js` for UI, and in route handlers (`rbac` middleware) for API.
- Per-user permission overrides in the `userPermissions` table.

### Webhook signing

| Webhook | Verification |
|---|---|
| Cashfree | Signature check in `cashfreeEventProcessor.ts` |
| Tally | Bearer token (`TALLY_WEBHOOK_SECRET`) |
| Cal.com | Signed header (`CAL_WEBHOOK_SECRET`) |
| Chatwoot | Signature (`CHATWOOT_WEBHOOK_SECRET`) |
| n8n internal | Shared secret (`OUTREACH_INTERNAL_SECRET`) |

### Idempotency

The `processed_events` table dedupes incoming webhooks by `(source, external_id)`. **Every new webhook handler must use it.**

---

## 12. Local development

### Setup

```bash
git clone <repo> && cd v2
npm install
cd admin && npm install && cd ..
cd client && npm install && cd ..

# Copy env vars (ask Jatin for .env file)
cp .env.example .env
```

### Daily commands

```bash
npm run dev          # API process (tsx watch) at :8080
npm run admin:dev    # Admin SPA at :5173
npm run client:dev   # D2C landing at :5174

npm run build        # tsc → dist/ (must exit 0 before commit)
npm test             # vitest --run (must pass before commit)

npm run db:generate  # diff schema.ts → emit migration SQL
npm run db:migrate   # apply pending migrations
npm run db:studio    # web UI
```

### Touching contacts? Two invariants

`findOrCreateContact` in `src/services/contactService.ts` exact-matches `(channel_type, channel_value)`. Always normalise:

- **Email:** `.trim().toLowerCase()`
- **Phone:** strip all non-digits, prefix `91` if missing

And **always bump `lastActivityAt`** on any contact write — the CRM sorts by it.

### Skills (Claude Code workflow shortcuts)

The repo ships with workflow skills in `.claude/skills/`. Load by name with the AI coding agent:

| Skill | When |
|---|---|
| `ge-morning-check` | Start of day — verify prod is healthy |
| `ge-add-route` | Adding a new HTTP endpoint |
| `ge-add-migration` | Adding a column / table / index |
| `ge-add-contact-path` | New code that writes to contacts |
| `ge-cashfree-edge` | Touching Cashfree integration |
| `ge-debug-prod-down` | Production is broken |
| `ge-manual-qa` | After a non-trivial UI deploy |
| `ge-release-check` | Right before pushing to main |

---

## 13. "Don't touch without asking" files

These are documented in `CLAUDE.md`. Read it before touching any of these:

| Path | Why |
|---|---|
| `src/db/schema.ts` | Schema changes need migration generation, not hand-edits |
| `src/db/migrations/` | Already-applied SQL — editing breaks prod Postgres |
| `src/middleware/auth.ts` | Trust boundary; mistakes leak data |
| `src/middleware/rbac.ts` | Trust boundary; mistakes leak data |
| `src/routes/cashfree.ts` | Real money; idempotency invariants |
| `src/services/sodEodService.ts` Slack-DM logic | Sends to real humans on a schedule |

---

## 14. What to read first (1-hour onboarding path)

In this order:

1. **`docs/ARCHITECTURE.md`** (5 min) — two-process Railway split, routes vs services
2. **`docs/DATABASE.md`** (5 min) — schema rules, multi-tenancy, contact_channels gotcha
3. **`docs/DEPLOYMENT.md`** (5 min) — Railway + Vercel build gotchas
4. **`src/index.ts`** (10 min) — see every subsystem boot in order
5. **`src/worker.ts`** (10 min) — see every cron job + always-on worker
6. **`src/db/schema.ts`** (15 min) — every table; understand relationships
7. **`admin/src/components/navEntries.js`** (5 min) — every CRM page + role gating
8. **`admin/src/pages/tasks/TasksPage.jsx`** (10 min) — the cleanest example of a modern feature in this repo
9. **`CRM_SYSTEM_DOCS.md`** (skim) — narrative architecture overview

---

## 15. Known follow-ups and tech debt

| Item | Notes |
|---|---|
| **n8n workflows** | Mostly paused since May 3, 2026. Some legacy outreach + SEO workflows still hosted on the n8n Railway service. Decide: rebuild in `src/` or formally retire. |
| **`seoWorkflowHealthService.ts`** | Paused; was monitoring n8n workflows that no longer exist. Either revive against new sources or delete. |
| **Legacy `ensure*` schema hooks** | Many services still have these. Goal is to migrate them all into proper Drizzle migrations. |
| **`workflowSelfHealingService.ts`** | Paused. Tied to n8n. |
| **Tasks v2 `task.deal` chip** | UI references a `deal` field that isn't in the schema; either plumb `deal_id → join → title` or remove the code path. |
| **Tasks v2 sidebar entry** | No separate "Tasks v2" nav entry; the `/tasks` route now resolves to the new shell directly. Old `TasksBoardPage.jsx` is a 7-line re-export — safe to delete after a soft-launch period. |
| **Single-tenant assumption** | The codebase is multi-tenant *by design* but production only has one tenant (`growth-escalators`). When the second tenant lands, audit every service for `tenant_id` scoping. |

---

## 16. Useful links

| Link | Purpose |
|---|---|
| `crm.growthescalators.com` | Admin CRM |
| `api.growthescalators.com` | API root |
| `ecom.growthescalators.com` | D2C landing |
| `content.growthescalators.com` | Content frontend (separate repo: `~/repo-comparison/ge-content-frontend`) |
| Railway dashboard | (account-specific) |
| Vercel dashboard | (account-specific) |
| Upstash console | (account-specific) |
| Cashfree merchant dashboard | (account-specific) |
| Slack workspace | `growthescalators.slack.com` |

---

## 17. Contacts

- **Engineering lead / system owner:** Jatin Agrawal (`jatin@growthescalators.com`)
- **Repo:** `Growth-Escalators/growth-escalators-backend-v2` on GitHub

---

*End of handover. If anything in this document is wrong or out of date, fix it in `HANDOVER.md` and commit — this is a living document.*
