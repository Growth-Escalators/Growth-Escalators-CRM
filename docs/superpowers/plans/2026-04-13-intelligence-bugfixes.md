# Intelligence Page Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 visual bugs on the Intelligence page (chart dates, phantom crons, old cleanup) and trigger SEO workflows to populate data.

**Architecture:** 2 file edits (1 frontend, 1 backend) + 1 API call. No schema changes.

**Tech Stack:** React JSX (frontend), TypeScript (backend), PostgreSQL via `pool.query()`.

---

### Task 1: Fix Score Trend Chart Date Formatting

**Files:**
- Modify: `admin/src/pages/IntelligencePage.jsx:370`

- [ ] **Step 1: Fix the date formatting on line 370**

In `admin/src/pages/IntelligencePage.jsx`, find line 370:

```jsx
return <text key={oi} x={x(oi)} y={H-4} textAnchor="middle" fontSize="9" fill="#94a3b8">{String(d.report_date??'').slice(5)}</text>;
```

Replace with:

```jsx
return <text key={oi} x={x(oi)} y={H-4} textAnchor="middle" fontSize="9" fill="#94a3b8">{d.report_date ? new Date(d.report_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</text>;
```

- [ ] **Step 2: Verify build**

Run: `cd ~/repo-comparison/v2 && npm run build`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/IntelligencePage.jsx
git commit -m "fix: score trend chart shows formatted dates instead of raw ISO timestamps"
```

---

### Task 2: Filter Phantom Cron Names + Startup Cleanup

**Files:**
- Modify: `src/services/systemHealthMonitor.ts:74-86,249-253`

- [ ] **Step 1: Add startup cleanup to ensureCronJobLogsTable()**

In `src/services/systemHealthMonitor.ts`, find the `ensureCronJobLogsTable` function (line 74). After the `CREATE INDEX` statements (around line 86), add:

```typescript
  // Clean up obsolete job names from before rename fix
  await pool.query(`
    DELETE FROM cron_job_logs
    WHERE job_name IN ('Blocker Alerts (morning)', 'Blocker Alerts (evening)', 'Daily ROAS Report')
  `).catch(() => {});
```

- [ ] **Step 2: Filter checkCronJobs query to only CRON_WINDOWS names**

In the same file, find the `checkCronJobs` function (line 247). Replace the query at lines 249-253:

```typescript
    const r = await pool.query(`
      SELECT DISTINCT ON (job_name) job_name, status, started_at, completed_at, duration_ms, records_processed
      FROM cron_job_logs
      ORDER BY job_name, started_at DESC
    `);
```

With:

```typescript
    const validNames = Object.keys(CRON_WINDOWS);
    const r = await pool.query(`
      SELECT DISTINCT ON (job_name) job_name, status, started_at, completed_at, duration_ms, records_processed
      FROM cron_job_logs
      WHERE job_name = ANY($1)
      ORDER BY job_name, started_at DESC
    `, [validNames]);
```

- [ ] **Step 3: Verify build + test**

Run: `cd ~/repo-comparison/v2 && npm run build && npm test`
Expected: 0 errors, 72+ tests passing

- [ ] **Step 4: Commit**

```bash
git add src/services/systemHealthMonitor.ts
git commit -m "fix: filter phantom cron names from System Health + cleanup old entries at startup"
```

---

### Task 3: Push + Deploy + Trigger SEO Workflows

- [ ] **Step 1: Push to Railway**

```bash
cd ~/repo-comparison/v2 && git push origin main
```

- [ ] **Step 2: Wait for deploy (90 seconds)**

```bash
sleep 90 && curl -s https://web-production-311da.up.railway.app/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Status: {d[\"status\"]}, Uptime: {d[\"uptime\"]}s')"
```

Expected: Status: degraded (or ok), Uptime: <120s (fresh deploy)

- [ ] **Step 3: Trigger all SEO workflows**

```bash
curl -s -X POST https://web-production-311da.up.railway.app/api/seo-workflows/trigger-all \
  -H "Content-Type: application/json" 2>&1 | head -5
```

Note: This requires auth. If it returns 401, the trigger will happen automatically via the new cron triggers (daily for Alert Triggers, weekly for others). The first automatic run will be:
- Alert Triggers: next 9 AM IST
- Backlink Monitor: next Friday 9 AM IST
- Content Decay: next 1st Monday 9 AM IST
- Weekly Digest: next Friday 5 PM IST

- [ ] **Step 4: Run Playwright E2E**

```bash
E2E_BASE_URL=https://web-production-311da.up.railway.app npx playwright test --reporter=line
```

Expected: 10/10 passing

- [ ] **Step 5: Verify fixes in CRM**

Navigate to:
- `/crm/intelligence` → Today tab → Score Trend chart shows "13 Apr" formatted dates
- `/crm/intelligence` → System Health tab → no "Blocker Alerts (morning/evening)" or "Daily ROAS Report" in cron table
