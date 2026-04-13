# CRM Navigation Restructure + 6 Feature Fixes — Design Spec

**Date:** 2026-04-13
**Author:** Jatin Agrawal + Claude Code
**Status:** Draft

---

## Problem Statement

The CRM navigation groups features illogically — Pipeline Settings is buried in Settings, Ad Accounts is separate from Meta Ads, Automations and System Health are standalone pages when they should be part of Intelligence. Additionally, SEO workflows show "never run" because no backend cron triggers exist for 5 of 7 workflows.

## Scope

6 specific fixes + full sidebar navigation restructure:
1. Pipeline Settings → gear icon on Pipeline page
2. Inbox → show WhatsApp + Email + contact metadata
3. Ad Accounts → tab inside Meta Ads + Reports under Marketing
4. Automations + System Health → tabs inside Intelligence (admin-only)
5. UI/UX improvements across pages
6. SEO "never run" workflows → add backend cron triggers

## Out of Scope
- Link Shortener (removed from navigation)
- New database tables or schema changes
- New external API integrations

---

## Design

### 1. Sidebar Navigation Structure

```
CRM
  Dashboard              (all roles)
  Contacts               (admin, manager_ops, sales)
  Pipeline [gear icon]   (admin, manager_ops, sales)
  Inbox                  (admin, manager_ops, sales)
  Lead Discovery         (admin, manager_ops, sales)
  Analytics              (admin, manager_ops, manager_ads)

Marketing
  Meta Ads               (admin, manager_ads)
  SEO                    (admin, manager_ops, manager_ads)
  Social                 (admin, manager_ops, staff)
  Outreach               (admin)
  Social Scheduling      (admin)
  Reports                (admin, manager_ops, manager_ads)
  Growth OS              (admin)

AI & Automation
  AI Intelligence        (admin)

Operations
  Email Templates        (admin, manager_ops, sales)
  WA Templates           (admin, manager_ops, sales)

Finance
  Billing                (admin)

Settings
  Permissions            (admin)
  Audit Log              (admin)
```

**Removed from sidebar:** Ad Accounts, Automations, System Health, Pipeline Settings, Link Shortener.

### 2. Pipeline Settings → Gear Icon

- Add `<Link to="/pipelines/settings">` with `<Settings>` icon in PipelinePage header
- Remove Pipeline Settings NavLink from Sidebar Settings section
- Route and PipelineManagerPage remain unchanged

### 3. Meta Ads Page — 3 Tabs

**Tab 1: Performance** (current AdsPage view)
- Remove hardcoded `AD_ACCOUNTS` array
- Fetch accounts from `/api/ads/accounts` on mount
- Existing campaign/adset/ad drill-down unchanged

**Tab 2: Accounts** (from MarketingPage)
- Add/remove/reactivate ad accounts
- API: `/api/marketing/accounts` (existing)

**Tab 3: Alerts** (new)
- Set ROAS threshold per account
- Stored in localStorage (v1 — no backend needed)
- Visual indicator when ROAS drops below threshold

**Route redirect:** `/marketing` → `/ads?tab=accounts`

### 4. Inbox — Email + Contact Metadata

**Backend (inbox.ts):**
- Remove `AND cc.channel_type = 'whatsapp'` filter
- Add `c.company_name`, `c.tags`, `c.source` to SELECT
- Add `m.channel AS "lastChannel"` to identify WhatsApp vs Email

**Frontend (InboxPage.jsx):**
- Channel badge per conversation (green WhatsApp / blue Email icon)
- Company name as subtitle below contact name
- Last message preview (truncated to 50 chars)
- Unread count badge (already in backend response)

### 5. Intelligence — Absorbs Automations + System Health

**Tabs (admin only):**
- Today's Report
- Action Prompts
- System Health (already exists as tab)
- History
- Automations (NEW — admin-only)
- Ask AI (admin-only)

**Deep linking:** Support `?tab=automations` URL parameter via `useSearchParams`.

**Redirects:**
- `/automations` → `/intelligence?tab=automations`
- `/health` → `/intelligence?tab=health`

**Audit Log:** Stays in Settings. "View Audit Trail →" link added to System Health tab.

### 6. SEO — Fix "Never Run" Workflows

**Add 4 backend cron triggers (worker.ts):**

| Schedule | Workflow | Webhook Path |
|---|---|---|
| Daily 9 AM IST | Alert Triggers | mtrig-seo02 |
| Friday 9 AM IST | Backlink Monitor | mtrig-seo08 |
| 1st Monday 9 AM IST | Content Decay | mtrig-seo11 |
| Friday 5 PM IST | Weekly Digest | mtrig-seo12 |

**New endpoint:** `POST /api/seo-workflows/trigger-all` — fires all SEO workflows.

**UI:** "Run All SEO Workflows" button in Intelligence page's SEO Workflow Health section.

---

## Files to Modify

| File | Changes |
|---|---|
| `admin/src/components/Sidebar.jsx` | Full restructure — 6 items removed, 1 section added |
| `admin/src/pages/PipelinePage.jsx` | Add gear icon in header |
| `admin/src/pages/AdsPage.jsx` | Remove hardcoded accounts, add 3 tabs |
| `admin/src/pages/InboxPage.jsx` | Channel badges, contact metadata |
| `admin/src/pages/IntelligencePage.jsx` | Add Automations tab, deep linking |
| `admin/src/App.jsx` | Add 3 redirects |
| `src/routes/inbox.ts` | Include email + metadata in query |
| `src/routes/seoWorkflows.ts` | Add trigger-all endpoint |
| `src/worker.ts` | Add 4 missing SEO crons |
| `src/services/systemHealthMonitor.ts` | Add cron names to CRON_WINDOWS |

---

## Verification

- `npm run build` — 0 TypeScript errors
- `npm test` — 72+ tests passing
- `npx playwright test` — 10/10 E2E passing
- Sidebar shows correct structure for admin vs non-admin
- Pipeline page has gear icon → opens settings
- Meta Ads page shows Performance/Accounts/Alerts tabs
- Inbox shows email + WhatsApp with channel badges
- Intelligence has Automations tab (admin only)
- SEO workflows show green after trigger-all
- `/marketing`, `/automations`, `/health` redirect correctly
