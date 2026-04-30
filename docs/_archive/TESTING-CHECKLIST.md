# Growth Escalators CRM — Manual Testing Checklist

Run through this after each deploy. Check ✅ or mark ❌ with notes.

**URL:** https://crm.growthescalators.com (or web-production-311da.up.railway.app/crm)
**Login:** jatin@growthescalators.com

---

## 1. Login & Redirects
- [ ] Visit `/login` → redirects to `/crm/login`
- [ ] Visit `/dashboard` → redirects to `/crm/dashboard`
- [ ] Login form loads, no blank page
- [ ] Login with admin credentials → lands on `/crm/dashboard`

## 2. Dashboard (admin view)
- [ ] 4 core metrics load: Contacts, Active Deals, MRR, Outstanding
- [ ] Pipeline Value card shows data
- [ ] Intelligence Score card shows score or "Generate" link
- [ ] SEO Clients Tracked shows count
- [ ] System Health shows score + cron count
- [ ] Quick access links visible (8 cards for admin)
- [ ] Refresh button works, "Updated X seconds ago" updates

## 3. SEO Page (6 tabs)
- [ ] **Overview tab**: client cards load (or empty state if no n8n data)
- [ ] Click a client card → slide-in detail panel opens
- [ ] Detail panel shows: Core Web Vitals, weekly trend, keywords, alerts
- [ ] Close detail panel (X button or backdrop click)
- [ ] **Keywords tab**: searchable table loads
- [ ] **Content Gaps tab**: table or empty state message
- [ ] **Backlinks tab**: table or empty state message
- [ ] **Alerts tab**: alert feed or empty state
- [ ] **Workflows tab**: 12 trigger buttons visible
- [ ] **Workflows tab**: data freshness panel shows table health
- [ ] Click "Trigger" on any workflow → success/error message appears

## 4. AI Intelligence
- [ ] **Today tab**: shows report, generating state, or empty state with Generate button
- [ ] **Action Prompts tab**: shows fix prompts (if report exists)
- [ ] **System Health tab**: shows 4 subsystem cards + cron table
- [ ] **History tab**: shows past reports with status badges (complete/failed)
- [ ] **Ask AI tab** (admin only): visible in tab bar
- [ ] Chat panel opens with greeting message
- [ ] Starter question buttons work
- [ ] Ask "What's our pipeline value?" → returns real data
- [ ] Non-admin user → "Ask AI" tab should NOT appear

## 5. Billing
- [ ] Stats cards load: MRR, Collected, Outstanding, ARR
- [ ] **Invoices tab**: create new invoice → add 2 line items
- [ ] Tax calculation: select IGST → 18% applied. Select CGST+SGST → 9% + 9%
- [ ] Download PDF → opens correct branded PDF
- [ ] Record Payment → invoice status changes to paid/partially_paid
- [ ] **Retainers tab**: shows active retainers
- [ ] **Clients tab**: add new client with GSTIN → verify tax type auto-selects
- [ ] **Payments tab**: shows payment history

## 6. Reports
- [ ] **Weekly tab**: select client → Generate → preview shows ads + tasks
- [ ] Download PDF → branded Growth Escalators PDF
- [ ] **Monthly tab**: switch from Weekly → Monthly toggle works
- [ ] Month picker shows last 12 months
- [ ] Generate monthly → preview shows Ads + SEO + Billing sections
- [ ] Download monthly PDF → all 3 sections present

## 7. Analytics
- [ ] **Lead Analytics tab**: lead sources table + funnel + trend chart
- [ ] Revenue chart loads (may be empty if no payments)
- [ ] MRR trend shows current MRR number
- [ ] **Team Performance tab**: switch tab → leaderboard loads
- [ ] Medal icons for top 3 performers
- [ ] Summary cards: Completed Today, Overdue, Avg Rate
- [ ] Overdue numbers in red if > 0

## 8. Client 360
- [ ] Navigate to `/crm/client/:clientId` (via billing clients list)
- [ ] Client info section shows name, address, GSTIN
- [ ] Billing summary shows invoiced, paid, outstanding
- [ ] Meta Ads section shows 30-day metrics (or "no ad account" message)
- [ ] SEO section shows keyword count + PageSpeed (if SEO client)
- [ ] Deals table shows active deals
- [ ] Invoices + Payments tables show recent records
- [ ] Back button returns to billing

## 9. Links & Social Scheduling
- [ ] **Link Shortener** (`/crm/links`): page loads (may show empty state if Shlink not configured)
- [ ] **Social Scheduling** (`/crm/social-scheduling`): page loads
- [ ] If Postiz not configured → shows setup banner with instructions

## 10. Sidebar & Navigation
- [ ] All sidebar links work (no 404s)
- [ ] Admin sees all sections (CRM, Marketing, Operations, Finance, Settings)
- [ ] Non-admin (sales role) → cannot see admin-only items (Intelligence, Growth OS, Outreach, Billing)

## 11. System Health
- [ ] `/crm/health` loads with 12 service cards
- [ ] Blockers section shows ClickUp overdue tasks (if configured)
- [ ] Activity feed shows recent events
- [ ] Refresh button works

## 12. API Health
- [ ] `GET /health` returns `{ status: 'ok' }`
- [ ] Any `/api/*` endpoint without auth token returns 401
- [ ] `POST /api/intelligence/chat` without admin role returns 403

---

## After Testing
- Note any ❌ items with exact error messages
- Screenshot any broken UI
- Report to Claude Code session for immediate fix
