# 📋 Growth Escalators Backend v2 — Complete System Overview

> **Repo:** https://github.com/Growth-Escalators/growth-escalators-backend-v2  
> **Purpose:** A custom multi-tenant CRM + marketing automation platform for a D2C performance marketing agency ("Growth Escalators"). It replaces a stack of disconnected SaaS tools (HubSpot, Calendly, shlink, etc.) with a single integrated system.

---

## 1. What This System Does

Growth Escalators is a marketing agency that:
- Sells D2C growth courses/programs (₹9-₹999 range) via funnels on `ecom.growthescalators.com`
- Provides CRM/agency services to clients (SEO, Meta Ads, automation) via `crm.growthescalators.com`
- Runs outbound lead generation for agency/freelancer prospects
- Manages invoicing, billing, and retainer tracking
- Automates SEO workflows (rank tracking, content gap analysis, backlink monitoring)

This repo is the **entire backend + frontend stack** that powers all of it.

---

## 2. Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| **Runtime** | Node.js 20 | See `.nvmrc` |
| **Language** | TypeScript (strict) | Backend is CJS, frontends are ESM |
| **Backend Framework** | Express.js | REST API + Socket.io for real-time |
| **Database** | PostgreSQL (Railway) | Drizzle ORM for schema + queries |
| **Admin Frontend** | React 18 + Vite | Internal CRM admin panel (~30 pages) |
| **Client Frontend** | React 18 + Vite | D2C landing pages + checkout |
| **Edge Functions** | Vercel Serverless | `client/api/` — Cashfree, funnels, leads |
| **Styling** | TailwindCSS + PostCSS | Both admin and client |
| **Testing** | Vitest (unit/integration) + Playwright (E2E) | 145 unit tests, 4 E2E specs |
| **Background Jobs** | node-cron (in-process) | Replaced n8n workflows |
| **Package Manager** | npm | Root + client + admin each have own `package.json` |

---

## 3. Architecture & Deployment

### Three-Part Monorepo

```
growth-escalators-backend-v2/
├── src/                    # Backend API (Express + TypeScript) → Railway
├── admin/                  # Admin CRM SPA (React + Vite) → Built, served by Express
├── client/                 # D2C Landing Pages (React + Vite) → Vercel
│   ├── src/                # SPA code
│   └── api/                # Vercel Edge Functions (serverless)
├── n8n-workflows/          # n8n workflow JSON templates (all PAUSED — replaced by node-cron)
├── docs/                   # Documentation
├── scripts/                # Maintenance & onboarding scripts
├── e2e/                    # Playwright E2E tests
└── public/                 # Built admin/client static assets
```

### Where Things Run

| Service | Platform | URL | What |
|---------|----------|-----|------|
| **API Server** | Railway | `api.growthescalators.com` (bare Railway domain) | Express API, Socket.io, serves admin SPA |
| **CRM Admin** | Railway | `crm.growthescalators.com` | Served by Express from `public/admin/` |
| **D2C Landing** | Vercel | `ecom.growthescalators.com` | React SPA + edge functions |
| **Database** | Railway | (internal) | PostgreSQL |
| **Links** | Railway | `links.growthescalators.com` | Short-link redirects (self-hosted, replaced shlink) |

### Process Architecture (Railway)

```
railway.json → Procfile → npm start → node dist/index.js
  ├── Express HTTP server (port $PORT)
  ├── Socket.io server (real-time inbox)
  ├── node-cron scheduler (background jobs)
  │   ├── Lead scoring (every 5 min)
  │   ├── Pipeline stage automation (every 10 min)
  │   ├── Rank tracking (daily)
  │   ├── PageSpeed checks (weekly)
  │   ├── Outreach digest (daily)
  │   └── Edge queue drainer (every 30s)
  └── Graceful shutdown handler
```

Set `DISABLE_BACKGROUND_JOBS=true` to run API-only (for multi-instance scaling).

### Vercel Edge Functions (`client/api/`)

| Path | Purpose |
|------|---------|
| `cashfree/create-order.ts` | Create Cashfree payment order |
| `cashfree/upsell.ts` | Create upsell order |
| `cashfree/webhook.ts` | Cashfree payment webhook handler |
| `funnel/waitlist.ts` | Join waitlist |
| `funnel/waitlist-count.ts` | Get waitlist count |
| `funnel/recent-purchase.ts` | Recent purchase social proof |
| `funnel-configs/public/[slug].ts` | Public funnel config |
| `leads/agency.ts` | Agency lead form submission |
| `webhooks/tally.ts` | Tally form webhook |
| `_lib/proxy.ts` | Queue proxy to Railway API |
| `_lib/cors.ts` | Shared CORS for edge functions |

---

## 4. Database Schema (47 tables)

### Core CRM Tables

| Table | Purpose |
|-------|---------|
| `tenants` | Multi-tenant root — agency is one tenant |
| `contacts` | People (leads, customers, prospects) |
| `contact_channels` | WhatsApp, email, phone, LinkedIn, Instagram per contact |
| `contact_notes` | Free-text notes on contacts |
| `deals` | Sales pipeline deals (stage, value, pipeline_id) |
| `pipelines` | Sales pipelines (D2C, Agency, Freelancer) |
| `events` | **Append-only** event log — every interaction (calls, messages, purchases) |
| `messages` | Sent/received messages (WhatsApp, email) |
| `sequences` | Multi-step outreach sequences (email + WhatsApp) |
| `sequence_enrolments` | Contact enrolment in sequences with `nextStepAt` |
| `bookings` | Cal.com booking records |
| `tasks` | Tasks with assignee, due date, priority, list |
| `task_lists` | User-created task lists (Microsoft To-Do style) |
| `task_checklist_items` | Sub-items within a task |
| `users` | CRM login users with role + tokenVersion |
| `user_permissions` | Granular per-module permissions (contacts, deals, billing, etc.) |

### Billing & Finance Tables

| Table | Purpose |
|-------|---------|
| `billing_clients` | Client businesses for invoicing |
| `invoices` | GST/non-GST invoices with line items, discounts, tax |
| `invoice_line_items` | Individual line items on invoices |
| `payments` | Payment records against invoices |
| `invoice_series` | Auto-incrementing invoice number series |

### Outreach & Prospecting Tables

| Table | Purpose |
|-------|---------|
| `prospects` | Outbound lead-gen prospects (LinkedIn/email targets) |
| `signals` | Buying signals detected on prospects |
| `replies` | Prospect reply tracking + classification |
| `outbound_events` | Status transition audit trail |

### Marketing & Social Tables

| Table | Purpose |
|-------|---------|
| `social_accounts` | Connected Facebook/Instagram accounts |
| `social_posts` | Scheduled/published social posts |
| `marketing_accounts` | Managed Meta ad accounts |
| `ads_insights_cache` | Cached Meta Ads API responses |

### SEO Automation Tables

| Table | Purpose |
|-------|---------|
| `client_knowledge_base` | Brand voice, differentiators, ICP per project |
| `client_pages` | Tracked pages (URL, word count, internal links) |
| `keyword_rankings` | Daily SERP position tracking |
| `backlink_data` | Backlink inventory with domain authority |
| `content_gap_analysis` | Competitor content gap (missing topics/entities) |
| `seo_opportunities` | Identified SEO opportunities |
| `site_health_metrics` | PageSpeed scores, LCP, CLS, broken links |
| `brand_mentions` | External brand mention monitoring |

### Infrastructure Tables

| Table | Purpose |
|-------|---------|
| `jobs` | Background job queue (status, attempts, processAfter) |
| `processed_events` | Idempotency guard for webhooks |
| `wa_templates` | WhatsApp message templates (approval status) |
| `funnels` | Round-robin booking funnels (cal.com rotation) |
| `funnel_members` | Members of round-robin with weights |
| `funnel_assignments` | Audit log of every redirect |
| `audit_events` | Security audit trail |
| `password_reset_tokens` | Password reset flow |

---

## 5. External Integrations

### Payments
- **Cashfree** — Payment gateway for D2C checkout. Webhook → contact creation → deal → pipeline placement → CAPI event → WhatsApp/Slack/Brevo side-effects

### Communication
- **WhatsApp Business API** (Meta Graph) — Welcome templates, sequence messages, hot lead alerts, outreach
- **Brevo (Sendinblue)** — Transactional email (via API + templates), also used for contact sync
- **Slack** — Lead alerts, daily digests, CRM feedback, ad spend reports
- **IMAP** — Reply polling for email outreach (Gmail/App Password)

### Meta / Facebook
- **Graph API** — Ad account insights (spend, ROAS, purchases), ad creative fetching
- **Conversions API (CAPI)** — Server-side conversion tracking (Purchase, Lead, Schedule events with PII hashing)
- **Ad Library** — Competitor ad creative research
- **OAuth** — Meta Assets connection flow for clients

### Calendar & Booking
- **Cal.com** — Round-robin booking with weighted member rotation + qualification scoring

### SEO & Content
- **Serper.dev** — SERP rank tracking API
- **Google PageSpeed Insights** — Core Web Vitals monitoring
- **WordPress REST API** — Programmatic SEO page publishing
- **DataForSEO** — Keyword research, content gap analysis (via n8n workflows)

### Infrastructure
- **Cloudflare R2** — S3-compatible object storage for attachments/assets
- **Vercel** — Edge function hosting for client SPA
- **Railway** — API + database + admin SPA hosting

### Analytics & Intelligence
- **OpenAI GPT-4** — AI-powered intelligence chat, content analysis, creative tagging
- **Google Trends** — Trend data for opportunity discovery

---

## 6. Routes (API Endpoints)

The backend exposes **40+ route groups** under `/api/`:

### CRM Core
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/contacts` | `requireAuth` | CRUD, search, import/export contacts |
| `/api/deals` | `requireAuth` | Deal CRUD, stage moves, pipeline views |
| `/api/pipelines` | `requireAuth` | Pipeline management |
| `/api/messages` | `requireAuth` | Message history, send |
| `/api/inbox` | `requireAuth` | Real-time conversation inbox (Socket.io) |
| `/api/email` | `requireAuth` | Email sending via Brevo |
| `/api/email-templates` | `requireAuth` | Brevo template management |
| `/api/tasks` | `requireAuth` | Task CRUD + attachments |
| `/api/task-lists` | `requireAuth` | Task list management |
| `/api/team` | `requireAuth` | Team member management |
| `/api/clients` | `requireAuth` | Client detail aggregation |

### Auth & Security
| Route | Auth | Purpose |
|-------|------|---------|
| `/auth` | Rate-limited (10/min) | Login, register, password reset, token refresh |
| `/api/permissions` | `requireStrictAuth` | User permission management |
| `/api/audit` | `requireAuth` | Audit log viewing |

### Billing & Finance
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/billing` | `requireStrictAuth` | Invoices, payments, clients, GST calc |
| `/api/finance` | `requireAuth` | Financial dashboard, revenue tracking |
| `/api/cashfree` | Public + Admin | Payment order creation, admin debug |

### Marketing & Social
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/ads` | `requireAuth` | Meta Ads insights, creative fetching |
| `/api/social` | `requireAuth` | Social account connection, post scheduling |
| `/api/social/oauth` | Public | Meta OAuth callback (no auth header possible) |
| `/api/meta` | `requireAuth` | Meta asset management for clients |
| `/api/marketing` | `requireAuth` | Marketing account management |
| `/api/capi` | `requireAuth` | Conversions API event tracking |

### SEO & Discovery
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/seo` | `requireAuth` | Rank tracking, backlinks, content gaps |
| `/api/seo-workflows` | `requireAuth` | SEO workflow management |
| `/api/search` | `requireAuth` | Global search across CRM |
| `/api/analytics` | `requireAuth` | Analytics dashboards |

### Outreach & Automation
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/outreach/discover` | `requireAuth` | Google Maps lead discovery |
| `/api/outreach/leads` | `optionalAuth` | Outreach lead management |
| `/api/outreach/imap` | None | IMAP reply polling (internal) |
| `/api/outbound` | `admin`/`team_lead` | Outbound prospect management |
| `/api/automations` | `requireAuth` | Automation hub |
| `/api/sequences` | `requireAuth` | Sequence management |

### AI & Intelligence
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/intelligence` | `requireAuth` | AI intelligence dashboard |
| `/api/intelligence` (chat) | `requireAuth` | AI chat interface |
| `/api/growth-os` | `requireAuth` | Growth OS client management |

### Funnel & Public
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/funnel` | Public | Waitlist, recent purchases |
| `/api/funnel-configs/public/*` | Public | Public funnel configs for checkout |
| `/api/funnel-configs/*` | `requireAuth` | Funnel config management |
| `/api/leads` | Public | Lead form submissions |
| `/book` | Public | Round-robin cal.com redirect |

### Utility
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/links` | `requireAuth` | Short link management |
| `/s/:slug` | Public | Short link redirect |
| `/api/system` | None | System health monitoring |
| `/health`, `/api/health` | None | Health check endpoint |

---

## 7. Authentication & RBAC

### JWT Auth Flow
1. Login via `/auth/login` → returns JWT with `{ id, email, tenantId, role, tokenVersion }`
2. JWT sent as `Authorization: Bearer <token>` header
3. `requireAuth` middleware validates JWT signature + checks all claims present
4. `requireStrictAuth` additionally checks `tokenVersion` against DB (enables session revocation)

### Roles
| Role | Level | Access |
|------|-------|--------|
| `admin` | Highest | Everything |
| `manager_ops` | High | Contacts, deals, sequences, automations, social, inbox |
| `manager_ads` | High | Ads, marketing, reports |
| `team_lead` | Mid | Operational tools (outreach, AI, growth OS) but not billing/audit |
| `sales` | Standard | Contacts, deals, inbox, discovery |
| `staff` | Limited | Basic access + data masking on contact phone/email |
| `creative_assistant` | Narrow | Tasks, inbox, Meta Ads view/manage, Social |

### Permission System
- Granular per-module permissions in `user_permissions` table (30+ boolean flags)
- `requirePermission()` middleware with fail-closed on unknown permissions
- `hasPermission()` helper for inline checks in route handlers

---

## 8. Background Jobs & Automation

### Active (node-cron in `src/worker.ts`)

| Job | Schedule | Purpose |
|-----|----------|---------|
| Lead scoring | Every 5 min | Recalculates contact scores based on events/activity |
| Pipeline automation | Every 10 min | Auto-moves contacts through pipeline stages |
| Edge queue drainer | Every 30s | Processes jobs table (webhook side-effects) |
| Rank tracking | Daily | Updates SERP positions via Serper.dev |
| PageSpeed | Weekly | Core Web Vitals via Google PageSpeed API |
| Daily digest | Daily | Slack summary of leads, deals, revenue |
| Weekly health | Weekly | Outreach pipeline health check |
| IMAP reply poller | Every 2 min | Checks for email replies in outreach |

### n8n Workflows (20 JSON files — ALL PAUSED)

Located in `n8n-workflows/`. These were the original automation system, now superseded by `node-cron`. They cover:
- Job queue processing (01-05)
- Outreach lead enrichment (wf-01 to wf-06)
- SEO monitoring (WF-SEO-04 to WF-SEO-12)

---

## 9. Frontend Applications

### Admin CRM (`admin/`) — `crm.growthescalators.com`
- ~30 pages: Dashboard, Contacts, Pipeline/Kanban, Inbox, Deals, Billing, Finance, SEO, Social, Analytics, Outreach, Settings, Tasks, Team, Intelligence
- Routes lazily loaded via `React.lazy()`
- Error boundary present
- Auth: JWT in `localStorage` (⚠️ should move to HttpOnly cookies)
- Token passed in `Authorization: Bearer` header

### Client D2C (`client/`) — `ecom.growthescalators.com`
- ~10 pages: Landing, Checkout, Thank You, Consulting, Whitelabel, Learn, Agency, Community
- Funnel-routed: `/creative-kit`, `/creative-kit/checkout`, etc.
- Auth: None (public)
- Payment: Cashfree integration via Vercel edge functions
- Code splitting + error boundary (✅ added in this commit)

---

## 10. What the System Has

✅ **Multi-tenant CRM** with contacts, deals, pipelines, sequences  
✅ **Real-time inbox** with WhatsApp + email + Socket.io  
✅ **Payment processing** via Cashfree with webhook automation  
✅ **GST invoicing** with auto-incrementing series, line items, tax calc  
✅ **Meta Ads integration** with insights caching + CAPI server-side tracking  
✅ **SEO automation suite** — rank tracking, content gaps, backlinks, PageSpeed  
✅ **Outbound prospecting** — Google Maps discovery, email outreach, IMAP reply polling  
✅ **AI intelligence** — GPT-4 powered chat + creative analysis  
✅ **Round-robin booking** with weighted cal.com rotation  
✅ **Short link management** (replaced external shlink service)  
✅ **Task management** with lists, checklists, attachments  
✅ **Audit logging** for security tracking  
✅ **RBAC** with 7 roles + granular permissions  
✅ **Lead scoring** with automated pipeline placement  
✅ **Slack notifications** — alerts, digests, feedback  
✅ **Job queue** with idempotency + retry logic  
✅ **Graceful shutdown** with pool cleanup  

---

## 11. What the System Does NOT Have

❌ **HttpOnly cookie auth** — JWT is in `localStorage` (XSS-exfiltratable)  
❌ **CSRF protection** — Not needed currently (no cookies) but required if moving to cookies  
❌ **Webhook signature verification** on all endpoints (some gaps exist)  
❌ **OpenTelemetry / APM** — No distributed tracing (relies on console logs + Railway logs)  
❌ **Redis / external queue** — Job queue is in PostgreSQL `jobs` table (works but not horizontally scalable)  
❌ **Multi-instance scaling** — Background jobs run in-process; `DISABLE_BACKGROUND_JOBS` flag exists but no separate worker deployment is set up  
❌ **GDPR data purge** — FK cascades are `no action` everywhere; tenant deletion requires manual SQL  
❌ **Comprehensive test coverage** — 145 tests exist but many routes (auth flows, leads CRUD, deals mutations) lack tests  
❌ **Input validation on all routes** — Validation middleware created but not yet applied to existing routes  
❌ **Rate limiting on all sensitive endpoints** — Auth has it, but webhook/booking/leads endpoints have loose limits  
❌ **Feature flags system** — `featureFlags.ts` exists but minimal  
❌ **API versioning** — No `/v1/` prefix or versioning strategy  
❌ **GraphQL** — REST only  
❌ **Mobile app** — Web only (admin is responsive but not a native app)  
❌ **Webhooks outbound** — No system to notify external services of CRM events (only inbound webhooks)  
❌ **SSO / OAuth login** — Email/password only for CRM users  
❌ **Email verification** — Users can register without email verification  
❌ **2FA / MFA** — Not implemented  
❌ **Data encryption at rest** — Relies on Railway/Postgres defaults; social tokens are AES-256 encrypted in DB  
❌ **Automated DB backups** — Relies on Railway's built-in backups  
❌ **Staging environment** — Deploys directly to production on push to `main`  
❌ **CI/CD pipeline** — No GitHub Actions; Railway auto-deploys on push  

---

## 12. Key Configuration

### Environment Variables (`.env.example`)
Key vars needed:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret
- `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` — Payment gateway
- `META_APP_ID` / `META_APP_SECRET` / `META_ACCESS_TOKEN` — Facebook/Instagram
- `BREVO_API_KEY` — Email sending
- `SLACK_BOT_TOKEN` — Slack integration
- `SERPER_API_KEY` — SERP rank tracking
- `OPENAI_API_KEY` — AI intelligence
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY` / `R2_SECRET_KEY` — Cloudflare storage
- `CALCOM_API_KEY` — Booking integration
- `PORT` — Server port (Railway sets this)

### Node Version
- Node 20 (see `.nvmrc`)

### Build Commands
```bash
npm run build          # tsc → dist/
npm run dev            # tsx watch (hot reload)
npm test               # vitest
npm run client:build   # Build D2C SPA
npm run admin:build    # Build admin SPA
```

---

## 13. Recent Code Review & Fixes Applied

**Commit `907f47a`** — Security hardening, performance, and resilience:

### Security Fixes
1. **JWT privilege escalation patched** — Missing claims now fail closed (401) instead of defaulting to admin
2. **Session revocation enabled** — `requireStrictAuth` wired on billing, permissions, cashfree admin routes
3. **Auth rate limiting added** — 10 req/min on `/auth/*` endpoints
4. **Phantom `X-Edge-Token` removed** — CORS header that implied auth where none existed

### Performance
5. **40+ database indexes added** — Migration `0032_fold_orphaned_indexes.sql` (folded from two earlier migration files that predated `_journal.json` tracking and were never actually applied by the migrator) covers tasks, bookings, invoices, payments, user_permissions, password_reset_tokens, and composite indexes for tenant+status queries

### Frontend
6. **Code splitting** — Client SPA pages now lazily loaded
7. **Error boundary** — Prevents full-page crashes on render errors

### Code Quality
8. **Standardized errors** — `HttpError` class + `serializeError()` for consistent API error responses
9. **Input validation middleware** — `validateBody/Query/Params` with type checking (no external dependency)
10. **Improved error handler** — Request-context-aware logging

### Remaining Recommendations (Not Yet Done)
- Move JWT to HttpOnly cookies
- Add FK cascade rules to schema
- Consolidate duplicated logic between `client/api/` and `src/routes/`
- Fix N+1 queries in CRM list endpoints
- Add tests for untested routes
- Set up staging environment
- Add 2FA / email verification

---

## 14. Development Workflow

1. **Local dev:** `npm run dev` (API hot-reload) + `npm run admin:dev` (CRM hot-reload) + `npm run client:dev` (landing page hot-reload)
2. **Database changes:** Edit `src/db/schema.ts` → `npm run db:generate` → `npm run db:migrate`
3. **Testing:** `npm test` (145 vitest tests) + `npx playwright test` (4 E2E specs)
4. **Deploy:** Push to `main` → Railway auto-builds + deploys API + admin SPA. Vercel auto-deploys client SPA on push.
5. **DB migrations:** Run manually via `psql $DATABASE_URL -f src/db/migrations/XXXX.sql`

---

*Generated: 2026-07-03*