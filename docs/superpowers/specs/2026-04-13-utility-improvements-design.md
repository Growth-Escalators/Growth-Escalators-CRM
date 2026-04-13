# Utility Improvements — Design Spec

**Date:** 2026-04-13
**Author:** Jatin Agrawal + Claude Code
**Status:** Draft

---

## Problem Statement

The CRM generates 15+ Slack messages per day across 8+ separate notifications. Most are informational noise — hard to find what needs action. Client report preparation takes 30+ minutes because data is scattered across pages.

## Scope

4 utility improvements using ONLY existing data and APIs. No new features, no new tables, no new integrations.

## Team

- Jatin (admin) — sees everything
- Sakcham (sales/ads) — pipeline + ads + billing + outreach stats + discovery budget
- Nimisha (designer) — her ClickUp tasks + content deadlines
- Keshav (video) — his ClickUp tasks + video deadlines

## Existing messages preserved

- SOD Digest at 10:00 AM IST — **kept as-is**
- EOD per-person at 7:15 PM IST — **kept as-is**
- Cron failure DM to Jatin — **kept as-is**

---

## Design

### Change 1: Unified Morning Briefing

**Schedule:** 9:00 AM IST daily (Mon-Sat), one DM per team member
**Replaces:** Standalone blocker alerts, spend alerts, SEO health, Meta Ads daily report, intelligence report delivery
**File:** `src/services/morningBriefingService.ts` (NEW — ~150 lines)
**Cron:** New entry in `src/worker.ts` at `30 3 * * 1-6` (9:00 AM IST)

**Content per person (personalized):**

For **Jatin/Sakcham** (admin/ops — sees outreach + discovery):
```
☀️ Morning Briefing — {Name} | {Day} {Date}

📊 YOUR NUMBERS
• Pipeline: ₹{value} active ({proposal_count} in proposal)
• Ads: ₹{spend} spent today, {roas}x ROAS
• Overdue invoices: {count} (₹{amount})
• Outreach: {enriched} enriched, {replied} replied
• Discovery budget: {remaining}/{total}

🔴 ACTION NEEDED ({count})
• {Most urgent actions from intelligence report, filtered to this person}

📋 YOUR TASKS (ClickUp)
• {due_today} due today, {overdue} overdue
• Top overdue: "{task_name}" ({days}d)

⚠️ SYSTEM (only if broken)
• {Any cron failures or SEO workflow issues}
```

For **Nimisha/Keshav** (staff — simpler):
```
☀️ Morning Briefing — {Name} | {Day} {Date}

📋 YOUR TASKS (ClickUp)
• {due_today} due today, {overdue} overdue
• Top overdue: "{task_name}" ({days}d)
```

**Data sources (all existing):**
- Pipeline: `pool.query` on `deals` table
- Ads: `ads_insights_cache` or Meta API
- Billing: `invoices` table
- Outreach: `outreach_leads` table
- ClickUp: existing `fetchTasksForMember()` from `clickupTasks.ts`
- Intelligence actions: latest `ai_intelligence_reports` row
- System health: `cron_job_logs` table

### Change 2: Unified Evening Summary

**Schedule:** 7:30 PM IST daily (Mon-Sat), one DM per team member (15 min after EOD)
**Replaces:** Standalone outreach daily digest
**File:** `src/services/eveningSummaryService.ts` (NEW — ~100 lines)
**Cron:** New entry in `src/worker.ts` at `0 14 * * 1-6` (7:30 PM IST)

**Content per person:**

For **Jatin/Sakcham:**
```
🌙 Evening Summary — {Name} | {Day} {Date}

✅ COMPLETED TODAY: {count} tasks
📋 CARRYING FORWARD: {open} tasks ({overdue} overdue)
📊 OUTREACH: {enriched} enriched, {replied} replied, {interested} interested
💰 BILLING: {invoices_sent} invoices sent today (₹{amount})

Score: {score}/100 — {label}
```

For **Nimisha/Keshav:**
```
🌙 Evening Summary — {Name} | {Day} {Date}

✅ COMPLETED TODAY: {count} tasks
📋 CARRYING FORWARD: {open} tasks ({overdue} overdue)

Score: {score}/100 — {label}
```

### Change 3: One-Click Client Report

**No new service.** Add a function to existing `src/routes/clientDetail.ts` and a button to `admin/src/pages/ClientDetailPage.jsx`.

**New endpoint:** `GET /api/clients/:clientId/quick-update`
- Aggregates: ads (7d), SEO (keywords + PageSpeed), billing (last invoice + status)
- Returns plain text formatted for WhatsApp/email copy-paste

**Frontend:** "Copy Update" button on ClientDetailPage that calls the endpoint, copies result to clipboard via `navigator.clipboard.writeText()`.

**Output format:**
```
📊 Growth Escalators — {Client Name}

Meta Ads (last 7 days):
• Spend: ₹{spend} | ROAS: {roas}x | Purchases: {count}
• Top campaign: {name} ({roas}x)

SEO:
• {improved} keywords ↑, {dropped} ↓
• PageSpeed: Mobile {m}, Desktop {d}

Billing:
• Last: {invoice_number} — {status}
• Next due: {date}
```

### Change 4: Dashboard — Today's Actions Per Person

**No new service.** Modify `admin/src/pages/DashboardPage.jsx` to add a "Today's Actions" section.

**Data source:** `GET /api/intelligence/today` (already exists) — the `problems` field contains issues with `owner` and `severity`. Filter to the logged-in user's name.

**Also pull from:**
- Overdue invoices: `GET /api/billing/stats` (already called by dashboard)
- Overdue deals: from pipeline summary (already called)
- Overdue ClickUp tasks: `GET /api/analytics/team-performance` (already exists)

**UI:** A prominent card at the top of the dashboard showing 3-5 most critical items for the logged-in user, color-coded by severity (red/amber/yellow).

### What Gets Silenced in worker.ts

| Current cron | Action |
|---|---|
| Blocker Alerts (10:15 AM) | Disable — folded into morning briefing |
| Spend Alert Check (hourly) | Disable — folded into morning briefing |
| Meta Ads Daily Report (9:30 AM) | Disable — folded into morning briefing |
| Outreach Daily Digest (8:30 PM) | Disable — folded into evening summary |
| SEO Workflow Health alert (9:15 AM) | Keep cron for health check but disable Slack send — only in morning briefing if broken |

**NOT silenced:**
- SOD Digest (10:00 AM) — kept
- EOD per-person (7:15 PM) — kept
- Sakcham SOD (10:00 AM) — kept
- Cron failure DMs — kept
- Self-healing alerts — kept

---

## Files to Create/Modify

| File | Action |
|---|---|
| `src/services/morningBriefingService.ts` | NEW — personalized morning briefing |
| `src/services/eveningSummaryService.ts` | NEW — personalized evening summary |
| `src/routes/clientDetail.ts` | ADD quick-update endpoint |
| `admin/src/pages/ClientDetailPage.jsx` | ADD "Copy Update" button |
| `admin/src/pages/DashboardPage.jsx` | ADD "Today's Actions" section |
| `src/worker.ts` | ADD 2 crons, DISABLE 5 standalone alerts |

---

## Verification

- `npm run build` — 0 errors
- `npm test` — 72+ tests passing
- Morning briefing sends personalized DMs to each team member at 9 AM
- Evening summary sends at 7:30 PM with completed tasks + outreach
- SOD Digest (10 AM) and EOD (7:15 PM) still fire unchanged
- Client 360 page has "Copy Update" button → clipboard text
- Dashboard shows "Today's Actions" for logged-in user
- Standalone blocker/spend/ads/outreach alerts no longer fire separately
