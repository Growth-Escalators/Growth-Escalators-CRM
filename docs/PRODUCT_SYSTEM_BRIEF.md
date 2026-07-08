# Product System Brief

Last updated: 2026-07-08 IST

## Purpose

This is the canonical shareable brief for the `growth-escalators-backend-v2` software system.
Use it when handing the repo to another engineer, another AI tool, a designer, an operator, or a
business collaborator who needs to understand what the software is and what it is becoming.

Update this file whenever a run changes product scope, core modules, live routes, data reality,
deployment assumptions, or operating guardrails. The more tactical `.ai/*` files explain current
task state; this file explains the product as a whole.

## One-line Meaning

This repo is the operating platform for Growth Escalators: a multi-tenant CRM, automation,
marketing intelligence, billing, finance, outreach, and staffing operations system that now serves
two product profiles from one CRM platform: Growth Escalators and Wizmatch.

## Executive Summary

The system started as a custom CRM and automation backend for Growth Escalators, a digital
marketing and growth agency. It captures leads, tracks contacts and deals, manages outreach,
handles bookings and payments, runs billing and finance workflows, and powers marketing/SEO/ads
intelligence.

It is now evolving into a shared CRM platform with separate product profiles:

- Growth Escalators: agency CRM for marketing, sales, clients, campaigns, billing, finance, SEO,
  ads, content, outreach, and internal operations.
- Wizmatch: staffing-focused CRM profile layered on the same platform, with staffing-specific
  workflows for client discovery, contact intelligence, candidate intelligence, requirements,
  placements, guardrails, and analytics.

The important product idea is not "two separate apps." It is one tenant-aware CRM platform where
each tenant/profile gets the right routes, data, workflows, and AI context while preserving strict
data separation.

## Live Surfaces

| Surface | URL | Platform | What it does |
|---|---|---|---|
| API | `https://api.growthescalators.com` | Railway | Express API, webhooks, Socket.IO, CRM backend |
| CRM | `https://crm.growthescalators.com` | Railway | Admin CRM SPA for Growth and Wizmatch users |
| D2C ecommerce | `https://ecom.growthescalators.com` | Vercel | Public landing funnels and Cashfree checkout |
| Content app | `https://content.growthescalators.com` | Vercel, separate repo | Sheets-backed content workflow |

Canonical URL reference: `docs/URLS.md`.

## Product Profiles

### Growth Escalators

Growth is the original CRM profile. It keeps the classic shared CRM routes:

- `/dashboard`
- `/contacts`
- `/pipeline`
- `/tasks`
- `/inbox`
- `/billing`
- `/finance`
- `/emails`
- `/whatsapp-templates`
- `/discover`
- `/outreach-dashboard`
- `/intelligence`
- `/settings/permissions`
- `/settings/audit`
- `/pipelines/settings`

Growth also has marketing-specific modules such as ads, Meta assets, social, SEO, analytics,
Growth OS, clients, reports, links, funnels, and outbound.

### Wizmatch

Wizmatch is the staffing profile on the same CRM platform. It has matching shared CRM routes under
`/wizmatch/*`:

- `/wizmatch/dashboard`
- `/wizmatch/contacts`
- `/wizmatch/pipeline`
- `/wizmatch/tasks`
- `/wizmatch/inbox`
- `/wizmatch/billing`
- `/wizmatch/finance`
- `/wizmatch/emails`
- `/wizmatch/whatsapp-templates`
- `/wizmatch/discover`
- `/wizmatch/outreach`
- `/wizmatch/intelligence`
- `/wizmatch/settings/permissions`
- `/wizmatch/settings/audit`
- `/wizmatch/pipelines/settings`

It also has staffing-specific pages:

- Review Workbench
- Data Readiness
- Client Discovery
- Contact Intelligence
- Candidate Intelligence
- Requirements and Requirement Priority
- Guardrails
- Analytics / ROI
- Signals
- Candidate pool
- Domains
- Compliance
- Placements
- Primes

Current routing intent:

- Growth home: `/dashboard`
- Wizmatch home: `/wizmatch/dashboard`
- Wizmatch users visiting shared Growth paths redirect to matching `/wizmatch/*` paths.
- Growth users visiting `/wizmatch/*` are redirected back to `/dashboard`.

## What The System Does

### 1. CRM Core

The CRM manages the daily operating loop:

- Contacts and contact channels
- Deals and configurable pipelines
- Tasks, task lists, comments, attachments, and team performance
- Inbox conversations and message history
- Email templates and WhatsApp templates
- Search, audit logs, permissions, users, and roles
- Clients, client detail, reports, and analytics

Important invariant: email and phone data live in `contact_channels`, not directly on `contacts`.

### 2. Lead Capture And Conversion

The system receives leads from multiple channels:

- Cal.com bookings
- Meta WhatsApp webhooks
- Meta Lead Forms
- Tally forms
- Chatwoot events
- D2C checkout and Cashfree webhooks
- Manual CRM entry/imports
- Outreach discovery and outbound imports

New events are normalized into contacts, channels, events, messages, deals, bookings, jobs, or
processed-event records depending on the flow.

### 3. Agency Marketing Operations

Growth-specific modules support agency work:

- Meta ads accounts, campaigns, insights, creative intelligence, and alerts
- Social account connection, post scheduling, media library, and lead-form status
- SEO workflows, rankings, backlinks, content gaps, content decay, alerts, and digests
- Growth OS health/opportunity/copilot views
- Intelligence reports and chat
- Outreach lead discovery and outbound prospect management

### 4. Billing And Finance

Billing and finance support back-office operations:

- Billing clients
- Invoices
- Invoice line items
- Payments
- Retainers
- Monthly billing generation
- Finance dashboard
- Expenses, income, categories, vendors, payroll, attendance, leaves, and P&L

Billing routes use stricter auth than ordinary CRM routes because they touch money/business
records.

### 5. D2C Landing And Payments

The public D2C side lives in `client/` and is deployed on Vercel. It serves funnel pages and
Cashfree checkout flows. Payment events can be processed through Vercel edge functions and a Redis
stream, then drained into the Railway/Postgres backend when the API is healthy.

The key design is resilience: the public funnel should keep rendering even if the backend is
temporarily unavailable.

### 6. Wizmatch Staffing Operations

Wizmatch turns the CRM into a staffing operating system:

- Job signals from sources such as JobSpy, Dice, Naukri, ATS polling, GitHub mining, X-Ray search,
  and LCA/import flows.
- Candidate records linked to CRM contacts.
- Requirement intake and branded requirement sheet generation.
- Client Discovery to identify and rank target companies.
- Contact Intelligence to qualify companies, find/reuse contact candidates, preview enrichment,
  and preserve manual review.
- Candidate Intelligence to score readiness and match candidates to requirements.
- Placement tracking with margins, bill/pay rates, RTRs, contract dates, and pipeline links.
- Guardrails for cost, domain health, suppression, cooldowns, and manual approvals.

Wizmatch is explicitly manual-gated. The system may score, rank, draft, preview, or recommend, but
it must not auto-send outreach or auto-submit candidates without explicit approval.

## Architecture

### Runtime Shape

| Layer | Path | Purpose |
|---|---|---|
| API process | `src/index.ts` | Express app, REST routes, middleware, Socket.IO, webhooks |
| Worker process | `src/worker.ts` | Cron jobs, background workers, ingestion/matching/monitoring jobs |
| Database schema | `src/db/schema.ts` | Drizzle schema for Postgres |
| Routes | `src/routes/*` | HTTP handlers, validation, route-level auth |
| Services | `src/services/*` | Business logic, DB orchestration, provider calls |
| Admin CRM | `admin/` | React/Vite CRM SPA |
| Public client | `client/` | React/Vite D2C funnel app, Vercel edge functions |
| Tests | `src/__tests__/*` | Vitest coverage for services/routes/guards |

### Deployment

- Railway `web` service runs the API process.
- Railway may also run a separate worker service for `src/worker.ts`; verify the actual Railway
  topology before changing worker/deployment assumptions.
- Vercel hosts the public D2C landing app from `client/`.
- GitHub Actions run heavy off-box Wizmatch scrapers so Railway does not carry browser-scraping
  workload.

### Technology

- Node 20
- Express
- TypeScript
- Drizzle ORM
- PostgreSQL
- Vitest
- React + Vite + Tailwind for admin
- React + Vite for client landing
- Socket.IO for inbox/realtime pieces
- node-cron for scheduled worker tasks
- Railway, Vercel, Upstash Redis

## Data Model

The database is multi-tenant. Each business profile is represented by a tenant, and most business
tables carry `tenant_id`.

Core tables include:

- `tenants`
- `users`
- `contacts`
- `contact_channels`
- `pipelines`
- `deals`
- `events`
- `messages`
- `sequences`
- `sequence_enrolments`
- `bookings`
- `jobs`
- `processed_events`
- `tasks`
- `email_templates`
- `wa_templates`
- `billing_clients`
- `invoices`
- `payments`
- `audit_events`

Wizmatch-specific tables include:

- `wizmatch_companies`
- `wizmatch_job_signals`
- `wizmatch_candidates`
- `wizmatch_placements`
- `wizmatch_domain_health`
- `wizmatch_suppression_list`
- `wizmatch_requirements`
- `wizmatch_company_intelligence`
- `wizmatch_contact_candidates`
- `wizmatch_discovery_runs`

Current production note from 2026-07-08 IST: production Wizmatch has partial real candidate/contact
data, but is not yet client-ready operating data. It has 192 GitHub-sourced contacts/candidates,
192 email channels, 1 bootstrap pipeline, and 3 domain-health rows. It has 0 Wizmatch companies,
job signals, deals, tasks, messages, templates, billing records, invoices, payments, placements,
or suppression rows, and production is missing the newer requirements/contact-intelligence tables.
Readiness diagnosis from 2026-07-08 IST found those newer SQL files exist in the repo, but
`src/db/migrations/meta/_journal.json` skips the relevant `0020`/`0021` migration tags, so Drizzle's
journal-based migrator should not be assumed to apply them on a normal deploy until the migration
repair path is approved.

Portal hardening note from 2026-07-08 IST: shared CRM pipeline pages now support both classic
string stages and richer stage objects such as `{ id, name, color }`, which matters for Wizmatch
placement pipelines. Wizmatch live operating pages should degrade to readiness/cost fallback data
when optional/newer Wizmatch tables are absent, but that fallback does not replace the need to
apply approved migrations and load real operating data.

## AI And Automation

The system uses AI as an assistive operating layer, not an unchecked autopilot:

- Growth Intelligence summarizes agency/marketing operating data.
- Wizmatch AI Intelligence summarizes staffing data only.
- Claude keys are used for manual generation paths where configured.
- Deterministic TypeScript scoring is preferred for repeatable ranking.
- Cost guardrails and provider availability checks protect paid enrichment.
- Outreach sending and candidate submission remain manual-gated.

AI-related code lives across:

- `src/services/claudeService.ts`
- `src/routes/intelligence.ts`
- `src/routes/intelligenceChat.ts`
- `src/routes/wizmatch.ts`
- `src/services/wizmatch*`
- Admin pages under `admin/src/pages/*Intelligence*` and `Wizmatch*`

## Main Integrations

| Integration | Purpose |
|---|---|
| Cal.com | Booking intake and qualification |
| Meta WhatsApp | Inbound/outbound WhatsApp |
| Meta Lead Forms | Lead capture from connected pages |
| Brevo | Email sending and template sync |
| Cashfree | D2C checkout and payments |
| Tally | Form intake |
| Chatwoot | Conversation events |
| Slack | Operational alerts and summaries |
| Upstash Redis | Edge queue for resilient payment/event capture |
| Purelymail / SMTP | Wizmatch multi-domain mailer |
| Apollo/Snov/Reacher/Serper | Optional contact discovery/enrichment providers |
| Claude/Anthropic | Manual AI analysis and draft generation |
| GitHub Actions | Off-box Wizmatch scrapers |

## User Types

- Owner/admin: manages tenants, settings, permissions, billing, finance, intelligence, and high
  risk operations.
- Growth operator: manages agency leads, contacts, clients, pipelines, tasks, campaigns, SEO, and
  outreach.
- Wizmatch operator: reviews requirements, candidates, client discovery, contact intelligence,
  placements, and guardrails.
- Sales/BD user: works contacts, tasks, inbox, outreach, follow-ups, and pipeline stages.
- Finance/admin user: manages invoices, payments, income, expenses, payroll, attendance, and
  reports.
- Public customer/prospect: interacts with D2C funnel pages, checkout, forms, booking links, or
  unsubscribe links.

## Operating Guardrails

These constraints are load-bearing:

- Preserve tenant separation. Growth data must not appear in Wizmatch, and Wizmatch data must not
  appear in Growth.
- Do not touch `src/db/schema.ts` or `src/db/migrations/` without explicit approval and the proper
  migration workflow.
- Do not auto-send outreach.
- Do not auto-submit candidates.
- Do not add worker/cron automation without explicit approval.
- Do not push to `main` without explicit approval because Railway auto-deploys from `main`.
- Do not stage untracked `node_modules` folders.
- Contact exact-match logic must normalize email and phone before matching.
- `lastActivityAt` must be bumped on every contact write.

## Current Strategic State

The platform is moving from a Growth-only CRM into a multi-profile operating system:

1. Growth remains the stable agency CRM.
2. Wizmatch now has matching shared CRM routes under `/wizmatch`.
3. Wizmatch has staffing-specific intelligence and review workflows.
4. The live production Wizmatch dataset is still thin: useful candidate/contact seed exists, but
   client/revenue workflows need real requirements, companies, job signals, templates, tasks,
   pipeline data, and missing production tables.
5. The next business milestone is to get real Wizmatch data flowing through manual, reviewed
   workflows before enabling any broader automation.

## How To Use This File With Another AI Tool

Paste this file first. Then add the current task from `.ai/CURRENT_TASK.md` and the latest state
from `.ai/CURRENT_STATE.md`.

Good prompts to ask another AI tool:

- "Given this system brief, what product opportunities would you prioritize for Wizmatch revenue?"
- "Given this system brief and current production data reality, design the next 7-day operating
  plan."
- "Review the CRM navigation and tell me what modules should be merged, hidden, or promoted."
- "Create a sales demo script for Growth and Wizmatch based on the existing product."
- "Identify risks in tenant separation, manual review, and production deployment."

When asking an AI for implementation help, also provide:

- Branch name
- Current task
- Git status
- Relevant files
- Guardrails from this brief
- Whether schema/migrations/deploy changes are approved

## Update Ritual

Every meaningful product/system run should do this:

1. Read `.ai/CURRENT_TASK.md` and `.ai/CURRENT_STATE.md`.
2. If the product meaning, module list, route surface, production data reality, or guardrails
   changed, update this file.
3. Append the concrete work to `.ai/HANDOFF_LOG.md`.
4. Regenerate `.ai/AI_BRIEF.md` with `npm run ai:brief`.
5. Run at least `git diff --check` for docs-only edits; run builds/tests when code changed.

## Related Docs

- `CRM_SYSTEM_DOCS.md` - older full narrative and API-route reference.
- `docs/ARCHITECTURE.md` - process, service, and frontend architecture.
- `docs/DATABASE.md` - schema lifecycle, multi-tenancy, table notes.
- `docs/DEPLOYMENT.md` - Railway/Vercel deployment and gotchas.
- `docs/URLS.md` - production URLs and webhook URLs.
- `docs/wizmatch-staffing-module.md` - staffing module architecture and setup.
- `docs/wizmatch-daily-operations.md` - operator loop for Wizmatch.
- `docs/prd/*` - product requirement documents.
- `docs/decisions/*` - architecture decision records.
- `.ai/*` - current task, state, handoff, review checklist, and generated AI brief.
