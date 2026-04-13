# CRM Navigation Restructure + 6 Feature Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure CRM sidebar navigation, merge standalone pages into parent features, fix SEO "never run" workflows, and improve inbox/ads/pipeline UX.

**Architecture:** Frontend-heavy changes (Sidebar.jsx, 5 page components, App.jsx routing) + 3 backend files (inbox.ts query, seoWorkflows.ts endpoint, worker.ts crons). No database schema changes.

**Tech Stack:** React 18 + Vite + Tailwind CSS (frontend), Express.js + TypeScript (backend), PostgreSQL via `pool.query()`.

---

### Task 1: Sidebar Navigation Restructure

**Files:**
- Modify: `admin/src/components/Sidebar.jsx:88-238`

- [ ] **Step 1: Replace the full nav section (lines 88-238) with the new structure**

Replace everything between `<nav className="flex-1 px-3 py-2 overflow-y-auto">` and `</nav>` with:

```jsx
{/* CRM */}
<SectionLabel>CRM</SectionLabel>
<NavLink to="/dashboard" className={navClass}>
  <Home className="w-4 h-4" /> Dashboard
</NavLink>
{canCRM && (
  <>
    <NavLink to="/contacts" className={navClass}>
      <Users className="w-4 h-4" /> Contacts
    </NavLink>
    <NavLink to="/pipeline" className={navClass}>
      <Kanban className="w-4 h-4" /> Pipeline
    </NavLink>
  </>
)}
{canInbox && (
  <NavLink to="/inbox" className={({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive ? 'bg-slate-800 text-white border-l-2 border-l-emerald-400 ml-[-2px]' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
    }`
  }>
    <MessageSquare className="w-4 h-4" />
    Inbox
    {unreadCount > 0 && (
      <span className="ml-auto bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>
    )}
  </NavLink>
)}
{canDiscovery && (
  <NavLink to="/discover" className={navClass}>
    <MapPin className="w-4 h-4" /> Lead Discovery
  </NavLink>
)}
{canReports && (
  <NavLink to="/analytics" className={navClass}>
    <TrendingUp className="w-4 h-4" /> Analytics
  </NavLink>
)}

{/* Marketing */}
{(canAds || canSocial || canMarketing || canSEO) && (
  <>
    <SectionLabel>Marketing</SectionLabel>
    {canAds && (
      <NavLink to="/ads" className={navClass}>
        <BarChart2 className="w-4 h-4" /> Meta Ads
      </NavLink>
    )}
    {canSEO && (
      <NavLink to="/seo" className={navClass}>
        <BarChart2 className="w-4 h-4" /> SEO
      </NavLink>
    )}
    {canSocial && (
      <NavLink to="/social" className={navClass}>
        <Share2 className="w-4 h-4" /> Social
      </NavLink>
    )}
    {isAdmin && (
      <NavLink to="/outreach-dashboard" className={navClass}>
        <Target className="w-4 h-4" /> Outreach
      </NavLink>
    )}
    {isAdmin && (
      <NavLink to="/social-scheduling" className={navClass}>
        <Calendar className="w-4 h-4" /> Social Scheduling
      </NavLink>
    )}
    {canReports && (
      <NavLink to="/reports" className={navClass}>
        <FileText className="w-4 h-4" /> Reports
      </NavLink>
    )}
    {isAdmin && (
      <NavLink to="/growth-os" className={navClass}>
        <Zap className="w-4 h-4" /> Growth OS
      </NavLink>
    )}
  </>
)}

{/* AI & Automation */}
{isAdmin && (
  <>
    <SectionLabel>AI & Automation</SectionLabel>
    <NavLink to="/intelligence" className={navClass}>
      <Brain className="w-4 h-4" /> AI Intelligence
    </NavLink>
  </>
)}

{/* Operations */}
{canSequences && (
  <>
    <SectionLabel>Operations</SectionLabel>
    <NavLink to="/emails" className={navClass}>
      <Mail className="w-4 h-4" /> Email Templates
    </NavLink>
    <NavLink to="/whatsapp-templates" className={navClass}>
      <MessageSquare className="w-4 h-4" /> WA Templates
    </NavLink>
  </>
)}

{/* Finance */}
{canBilling && (
  <>
    <SectionLabel>Finance</SectionLabel>
    <NavLink to="/billing" className={navClass}>
      <CreditCard className="w-4 h-4" /> Billing
    </NavLink>
  </>
)}

{/* Settings */}
{isAdmin && (
  <>
    <SectionLabel>Settings</SectionLabel>
    <NavLink to="/settings/permissions" className={navClass}>
      <Shield className="w-4 h-4" /> Permissions
    </NavLink>
    <NavLink to="/settings/audit" className={navClass}>
      <ClipboardList className="w-4 h-4" /> Audit Log
    </NavLink>
  </>
)}
```

**Removed:** AI Intelligence from CRM, Ad Accounts, Automations, Link Shortener, System Health, Pipeline Settings, Reports from Operations.

- [ ] **Step 2: Verify build**

Run: `cd ~/repo-comparison/v2 && npm run build`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/Sidebar.jsx
git commit -m "refactor: restructure sidebar navigation — CRM | Marketing | AI | Ops | Finance | Settings"
```

---

### Task 2: Pipeline Settings Gear Icon

**Files:**
- Modify: `admin/src/pages/PipelinePage.jsx:534-539`

- [ ] **Step 1: Replace "Manage Pipelines" text link with gear icon**

Find lines 534-539 in PipelinePage.jsx:
```jsx
<Link
  to="/pipelines/settings"
  className="text-xs text-orange-500 hover:text-orange-700 font-medium ml-1 flex items-center gap-1"
>
  Manage Pipelines &rarr;
</Link>
```

Replace with:
```jsx
<Link
  to="/pipelines/settings"
  className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
  title="Pipeline Settings"
>
  <Settings className="w-4 h-4" />
</Link>
```

- [ ] **Step 2: Add Settings import if missing**

Check line 3 imports. Add `Settings` to the lucide-react import if not already present. In PipelinePage.jsx, lucide-react is imported at line 3 — verify `Settings` is included.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/PipelinePage.jsx
git commit -m "feat: replace Pipeline Settings nav with gear icon on Pipeline page"
```

---

### Task 3: App.jsx — Add Redirects

**Files:**
- Modify: `admin/src/App.jsx:43-45,55`

- [ ] **Step 1: Replace standalone routes with redirects**

In App.jsx, change these 3 routes:

Line 43 — change from:
```jsx
<Route path="/automations" element={<PrivateRoute><AutomationsPage /></PrivateRoute>} />
```
To:
```jsx
<Route path="/automations" element={<Navigate to="/intelligence?tab=automations" replace />} />
```

Line 45 — change from:
```jsx
<Route path="/health" element={<PrivateRoute><SystemHealthPage /></PrivateRoute>} />
```
To:
```jsx
<Route path="/health" element={<Navigate to="/intelligence?tab=health" replace />} />
```

Line 55 — change from:
```jsx
<Route path="/marketing" element={<PrivateRoute><MarketingPage /></PrivateRoute>} />
```
To:
```jsx
<Route path="/marketing" element={<Navigate to="/ads?tab=accounts" replace />} />
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add admin/src/App.jsx
git commit -m "feat: redirect /automations, /health, /marketing to their new parent pages"
```

---

### Task 4: Meta Ads Page — Dynamic Accounts + Tabs

**Files:**
- Modify: `admin/src/pages/AdsPage.jsx:1-366`

- [ ] **Step 1: Remove hardcoded AD_ACCOUNTS and add state + tab logic**

Replace lines 6-9 (the hardcoded array):
```jsx
const AD_ACCOUNTS = [
  { id: 'act_323237510625803', name: 'GE Agency' },
  { id: 'act_689363376592426', name: 'Paraiso' },
];
```

With:
```jsx
const FALLBACK_ACCOUNTS = [
  { id: 'act_323237510625803', name: 'GE Agency' },
  { id: 'act_689363376592426', name: 'Paraiso' },
];
```

- [ ] **Step 2: Add imports for tabs and account management**

Add to the lucide-react import (line 4):
```jsx
import { BarChart2, RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight, AlertCircle, Plus, Trash2, Settings, Bell } from 'lucide-react';
```

- [ ] **Step 3: Inside the main AdsPage component, add account loading + tab state**

After the existing state declarations, add:
```jsx
const [activeTab, setActiveTab] = useState('performance');
const [adAccounts, setAdAccounts] = useState(FALLBACK_ACCOUNTS);

// Load accounts from DB
useEffect(() => {
  apiFetch('/api/ads/accounts')
    .then(d => {
      const accts = (d?.accounts || []).map(a => ({ id: a.account_id || a.id, name: a.client_name || a.name }));
      if (accts.length > 0) setAdAccounts(accts);
    })
    .catch(() => {}); // fallback to hardcoded
}, []);

// Check URL for tab param
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab && ['performance', 'accounts', 'alerts'].includes(tab)) setActiveTab(tab);
}, []);
```

Replace all references to `AD_ACCOUNTS` in the file with `adAccounts`.

- [ ] **Step 4: Add tab bar in the header**

In the sticky header area (after the title), add:
```jsx
<div className="flex gap-1 mt-3">
  {[
    { id: 'performance', label: 'Performance', icon: BarChart2 },
    { id: 'accounts', label: 'Accounts', icon: Settings },
    { id: 'alerts', label: 'ROAS Alerts', icon: Bell },
  ].map(t => (
    <button key={t.id} onClick={() => setActiveTab(t.id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        activeTab === t.id ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100'
      }`}>
      <t.icon className="w-3.5 h-3.5" /> {t.label}
    </button>
  ))}
</div>
```

- [ ] **Step 5: Wrap existing performance content and add accounts/alerts tabs**

Wrap the existing campaign table/content in `{activeTab === 'performance' && (...)}`.

Add accounts tab (simplified version of MarketingPage):
```jsx
{activeTab === 'accounts' && (
  <AccountsTab />
)}
{activeTab === 'alerts' && (
  <AlertsTab />
)}
```

Create `AccountsTab` and `AlertsTab` as function components within the file. AccountsTab fetches `/api/marketing/accounts` and renders the account list with add/remove. AlertsTab uses localStorage for ROAS thresholds.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add admin/src/pages/AdsPage.jsx
git commit -m "feat: Meta Ads absorbs Ad Accounts + ROAS Alerts tabs, loads accounts from DB"
```

---

### Task 5: Inbox — Email + Contact Metadata

**Files:**
- Modify: `src/routes/inbox.ts:33-54`
- Modify: `admin/src/pages/InboxPage.jsx`

- [ ] **Step 1: Update backend inbox query**

In `src/routes/inbox.ts`, find the GET `/conversations` query (lines 33-54). Modify the SQL to:
- Remove `AND cc.channel_type = 'whatsapp'` filter (or keep as LEFT JOIN without filter)
- Add `c.company_name`, `c.tags`, `c.source` to SELECT
- Add `m.channel AS "lastChannel"` to SELECT
- Add email channel join: `LEFT JOIN contact_channels cc_em ON cc_em.contact_id = c.id AND cc_em.channel_type = 'email'`
- Add `cc_em.channel_value AS "contactEmail"` to SELECT

- [ ] **Step 2: Update frontend conversation list**

In `admin/src/pages/InboxPage.jsx`, in the conversation list rendering:
- Add channel badge: green `MessageSquare` for WhatsApp, blue `Mail` for email (import `Mail` from lucide-react)
- Show `conv.companyName` as a small gray subtitle below contact name
- Truncate `conv.lastMessage` to 50 chars for preview

- [ ] **Step 3: Verify build + test**

Run: `npm run build && npm test`
Expected: 0 errors, 72 tests passing

- [ ] **Step 4: Commit**

```bash
git add src/routes/inbox.ts admin/src/pages/InboxPage.jsx
git commit -m "feat: inbox shows email + WhatsApp with channel badges and contact metadata"
```

---

### Task 6: Intelligence — Absorbs Automations Tab

**Files:**
- Modify: `admin/src/pages/IntelligencePage.jsx:556-560,682-688`

- [ ] **Step 1: Add useSearchParams and Automations tab**

At the top of IntelligencePage.jsx, add to imports:
```jsx
import { useSearchParams } from 'react-router-dom';
```

Inside the main `IntelligencePage` component (after line 556), add:
```jsx
const [searchParams] = useSearchParams();
```

Modify the `activeTab` useState (line 562) to read from URL:
```jsx
const [activeTab, setActiveTab] = useState(() => {
  const urlTab = new URLSearchParams(window.location.search).get('tab');
  return urlTab && ['today', 'prompts', 'health', 'history', 'automations', 'chat'].includes(urlTab)
    ? urlTab : 'today';
});
```

- [ ] **Step 2: Add Automations to TABS array**

In the TABS array (line 682-688), add before the Ask AI entry:
```jsx
...(isAdmin ? [{ id: 'automations', label: 'Automations', icon: Zap }] : []),
```

The full TABS array becomes:
```jsx
const TABS = [
  { id: 'today',   label: "Today's Report", icon: Brain },
  { id: 'prompts', label: `Action Prompts${promptCount > 0 ? ` (${promptCount})` : ''}`, icon: Zap },
  { id: 'health',  label: 'System Health', icon: Activity },
  { id: 'history', label: 'History', icon: Activity },
  ...(isAdmin ? [{ id: 'automations', label: 'Automations', icon: Zap }] : []),
  ...(isAdmin ? [{ id: 'chat', label: 'Ask AI', icon: MessageSquare }] : []),
];
```

- [ ] **Step 3: Add Automations tab render**

After the history tab render section, add:
```jsx
{activeTab === 'automations' && isAdmin && (
  <AutomationsEmbed />
)}
```

Create `AutomationsEmbed` as a simple function component that fetches `/api/automations/hub-stats` and renders the automation flows (extracted from AutomationsPage core content).

- [ ] **Step 4: Add "View Audit Trail" link to System Health tab**

In the SystemHealthTab component (around line 549), add before the closing `</section>`:
```jsx
<a href="/crm/settings/audit" className="text-xs text-sky-600 hover:underline flex items-center gap-1 mt-4">
  <ClipboardList className="w-3 h-3" /> View Audit Trail
</a>
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/IntelligencePage.jsx
git commit -m "feat: Intelligence absorbs Automations tab (admin-only) + deep linking + audit trail link"
```

---

### Task 7: SEO — Backend Cron Triggers + Trigger-All Endpoint

**Files:**
- Modify: `src/worker.ts`
- Modify: `src/routes/seoWorkflows.ts`
- Modify: `src/services/systemHealthMonitor.ts`

- [ ] **Step 1: Add 4 missing SEO cron triggers to worker.ts**

After the existing rank tracking cron (search for `Rank tracking scheduled`), add:

```typescript
// SEO Alert Triggers — Daily 9 AM IST (3:30 UTC)
const N8N_WEBHOOK_BASE = process.env.N8N_BASE_URL ?? 'https://primary-production-6c6f5.up.railway.app';
cron.schedule('30 3 * * *', () => safeCron('SEO Alert Triggers', async () => {
  await fetch(`${N8N_WEBHOOK_BASE}/webhook/mtrig-seo02`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ triggered_by: 'cron', triggered_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(15000),
  });
  console.log('[CRON] SEO Alert Triggers fired');
}), { timezone: 'UTC' });
console.log('[cron] SEO alert triggers scheduled — daily 9:00 AM IST');

// SEO Backlink Monitor — Friday 9 AM IST (3:30 UTC)
cron.schedule('30 3 * * 5', () => safeCron('SEO Backlink Monitor', async () => {
  await fetch(`${N8N_WEBHOOK_BASE}/webhook/mtrig-seo08`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ triggered_by: 'cron', triggered_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(15000),
  });
  console.log('[CRON] SEO Backlink Monitor fired');
}), { timezone: 'UTC' });
console.log('[cron] SEO backlink monitor scheduled — Fridays 9:00 AM IST');

// SEO Content Decay Detection — 1st Monday 9 AM IST (3:30 UTC)
cron.schedule('30 3 1-7 * 1', () => safeCron('SEO Content Decay', async () => {
  await fetch(`${N8N_WEBHOOK_BASE}/webhook/mtrig-seo11`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ triggered_by: 'cron', triggered_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(15000),
  });
  console.log('[CRON] SEO Content Decay fired');
}), { timezone: 'UTC' });
console.log('[cron] SEO content decay scheduled — 1st Monday 9:00 AM IST');

// SEO Weekly Opportunity Digest — Friday 5 PM IST (11:30 UTC)
cron.schedule('30 11 * * 5', () => safeCron('SEO Weekly Digest', async () => {
  await fetch(`${N8N_WEBHOOK_BASE}/webhook/mtrig-seo12`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ triggered_by: 'cron', triggered_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(15000),
  });
  console.log('[CRON] SEO Weekly Digest fired');
}), { timezone: 'UTC' });
console.log('[cron] SEO weekly digest scheduled — Fridays 5:00 PM IST');
```

- [ ] **Step 2: Add trigger-all endpoint to seoWorkflows.ts**

In `src/routes/seoWorkflows.ts`, before `export default router;`, add:

```typescript
// ---------------------------------------------------------------------------
// POST /api/seo-workflows/trigger-all — fire all SEO workflows at once
// ---------------------------------------------------------------------------
router.post('/trigger-all', async (req: Request, res: Response) => {
  const triggeredBy = (req as Request & { user?: { id: string } }).user?.id ?? 'manual';
  const results: Array<{ name: string; ok: boolean }> = [];

  for (const wf of SEO_WORKFLOWS) {
    if (!wf.webhookPath) continue;
    try {
      const webhookUrl = `${N8N_BASE}/webhook/${wf.webhookPath}`;
      const r = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: triggeredBy, triggered_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(10000),
      });
      results.push({ name: wf.name, ok: r.ok });
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1s between triggers
    } catch {
      results.push({ name: wf.name, ok: false });
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  logger.info(`[seo-workflows] trigger-all: ${succeeded}/${results.length} succeeded`);
  res.json({ triggered: results.length, succeeded, results });
});
```

- [ ] **Step 3: Add new cron names to CRON_WINDOWS**

In `src/services/systemHealthMonitor.ts`, add to the CRON_WINDOWS object:
```typescript
'SEO Alert Triggers': 1500, 'SEO Backlink Monitor': 10080,
'SEO Content Decay': 44640, 'SEO Weekly Digest': 10080,
```

- [ ] **Step 4: Verify build + test**

Run: `npm run build && npm test`
Expected: 0 errors, 72 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts src/routes/seoWorkflows.ts src/services/systemHealthMonitor.ts
git commit -m "feat: add 4 missing SEO cron triggers + trigger-all endpoint"
```

---

### Task 8: Final Build + Test + Push

- [ ] **Step 1: Full build check**

Run: `cd ~/repo-comparison/v2 && npm run build`
Expected: 0 TypeScript errors

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: 72+ tests passing

- [ ] **Step 3: Playwright E2E**

Run: `E2E_BASE_URL=https://web-production-311da.up.railway.app npx playwright test`
Expected: 10/10 passing (after deploy)

- [ ] **Step 4: Push to Railway**

```bash
git push origin main
```
Expected: Railway auto-deploys both web and worker services.

- [ ] **Step 5: Trigger all SEO workflows**

After deploy (~2 min), fire all SEO workflows:
```bash
curl -s -X POST https://web-production-311da.up.railway.app/api/seo-workflows/trigger-all \
  -H "Authorization: Bearer <auth-token>" \
  -H "Content-Type: application/json"
```

- [ ] **Step 6: Verify in CRM**

Navigate to:
- `/crm/dashboard` → sidebar shows new structure
- `/crm/pipeline` → gear icon visible in header
- `/crm/ads` → Performance/Accounts/Alerts tabs
- `/crm/intelligence` → Automations tab (admin)
- `/crm/seo` → Workflows tab → workflows turning green
- `/crm/marketing` → redirects to `/crm/ads?tab=accounts`
- `/crm/automations` → redirects to `/crm/intelligence?tab=automations`
