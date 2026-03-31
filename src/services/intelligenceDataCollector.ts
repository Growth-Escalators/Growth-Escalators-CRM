import { pool } from '../db/index';
import logger from '../utils/logger';
import { DEFAULT_TENANT_SLUG } from '../config/constants';

// ---------------------------------------------------------------------------
// SEO Workflow Health types + collector (exported so worker can call directly)
// ---------------------------------------------------------------------------

export interface SEOWorkflowCheck {
  id: string;
  name: string;
  schedule: string;
  critical: boolean;
  lastRun: string | null;
  daysSince: number;
  total: number | null;
  keywordsTracked?: number | null;
  healthy: boolean;
  status: 'healthy' | 'overdue' | 'error';
  error: string | null;
}

export interface SEOWorkflowHealth {
  n8nAlive: boolean;
  workflows: SEOWorkflowCheck[];
  brokenCritical: SEOWorkflowCheck[];
  allHealthy: boolean;
  healthyCount: number;
  totalCount: number;
}

const N8N_BASE = 'https://primary-production-6c6f5.up.railway.app';

export async function collectSEOWorkflowHealth(): Promise<SEOWorkflowHealth> {
  const now = new Date();

  // Step 1: Check n8n is alive
  let n8nAlive = false;
  try {
    const res = await fetch(`${N8N_BASE}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    n8nAlive = res.ok;
  } catch {
    n8nAlive = false;
  }

  // Step 2: Per-workflow checks via output table freshness
  type CheckFn = () => Promise<{ lastRun: string | null; daysSince: number; total: number | null; keywordsTracked?: number | null; healthy: boolean }>;

  const workflowDefs: Array<{ id: string; name: string; schedule: string; critical: boolean; check: CheckFn }> = [
    {
      id: 'WF-SEO-01', name: 'GSC + GA4 Data Pull', schedule: 'Monday 8AM IST', critical: true,
      check: async () => {
        const r = await pool.query(`SELECT MAX(week_start) AS last_run, COUNT(*) AS total FROM seo_weekly_metrics`);
        const lastRun = (r.rows[0] as { last_run: string | null }).last_run;
        const daysSince = lastRun ? Math.floor((now.getTime() - new Date(lastRun).getTime()) / 86400000) : 999;
        return { lastRun, daysSince, total: Number((r.rows[0] as { total: string }).total), healthy: daysSince <= 8 };
      },
    },
    {
      id: 'WF-SEO-02', name: 'Alert Triggers', schedule: 'Daily 9AM IST', critical: true,
      check: async () => {
        const r = await pool.query(`SELECT MAX(created_at) AS last_run, COUNT(*) AS total FROM seo_alerts_log WHERE created_at > NOW() - INTERVAL '7 days'`);
        const lastRun = (r.rows[0] as { last_run: string | null }).last_run;
        const daysSince = lastRun ? Math.floor((now.getTime() - new Date(lastRun).getTime()) / 86400000) : 999;
        return { lastRun, daysSince, total: Number((r.rows[0] as { total: string }).total), healthy: daysSince <= 2 };
      },
    },
    {
      id: 'WF-SEO-05', name: 'PageSpeed Monitor', schedule: 'Sunday 7AM IST', critical: false,
      check: async () => {
        const r = await pool.query(`SELECT MAX(checked_at) AS last_run, COUNT(*) AS total FROM site_health_metrics`);
        const lastRun = (r.rows[0] as { last_run: string | null }).last_run;
        const daysSince = lastRun ? Math.floor((now.getTime() - new Date(lastRun).getTime()) / 86400000) : 999;
        return { lastRun, daysSince, total: Number((r.rows[0] as { total: string }).total), healthy: daysSince <= 8 };
      },
    },
    {
      id: 'WF-SEO-06', name: 'Rank Tracking', schedule: 'Tuesday 9AM IST', critical: true,
      check: async () => {
        const r = await pool.query(`SELECT MAX(checked_at) AS last_run, COUNT(*) AS total, COUNT(DISTINCT keyword) AS keywords_tracked FROM keyword_rankings`);
        const lastRun = (r.rows[0] as { last_run: string | null }).last_run;
        const daysSince = lastRun ? Math.floor((now.getTime() - new Date(lastRun).getTime()) / 86400000) : 999;
        return { lastRun, daysSince, total: Number((r.rows[0] as { total: string }).total), keywordsTracked: Number((r.rows[0] as { keywords_tracked: string }).keywords_tracked), healthy: daysSince <= 8 };
      },
    },
    {
      id: 'WF-SEO-08', name: 'Backlink Monitor', schedule: 'Friday 9AM IST', critical: false,
      check: async () => {
        const r = await pool.query(`SELECT MAX(checked_at) AS last_run, COUNT(*) AS total FROM backlink_data`);
        const lastRun = (r.rows[0] as { last_run: string | null }).last_run;
        const daysSince = lastRun ? Math.floor((now.getTime() - new Date(lastRun).getTime()) / 86400000) : 999;
        return { lastRun, daysSince, total: Number((r.rows[0] as { total: string }).total), healthy: daysSince <= 8 };
      },
    },
    {
      id: 'WF-SEO-11', name: 'Content Decay Detection', schedule: 'First Monday 9AM IST', critical: false,
      check: async () => {
        const r = await pool.query(`SELECT MAX(created_at) AS last_run, COUNT(*) AS total FROM seo_opportunities`);
        const lastRun = (r.rows[0] as { last_run: string | null }).last_run;
        const daysSince = lastRun ? Math.floor((now.getTime() - new Date(lastRun).getTime()) / 86400000) : 999;
        return { lastRun, daysSince, total: Number((r.rows[0] as { total: string }).total), healthy: daysSince <= 35 };
      },
    },
    {
      id: 'WF-SEO-12', name: 'Weekly Opportunity Digest', schedule: 'Friday 5PM IST', critical: false,
      check: async () => {
        const r = await pool.query(`SELECT MAX(created_at) AS last_run FROM seo_workflow_logs WHERE workflow_id = 'M4rbRZL5jh0jJHku'`).catch(() => ({ rows: [{ last_run: null }] }));
        const lastRun = (r.rows[0] as { last_run: string | null }).last_run;
        const daysSince = lastRun ? Math.floor((now.getTime() - new Date(lastRun).getTime()) / 86400000) : 999;
        return { lastRun, daysSince, total: null, healthy: daysSince <= 8 };
      },
    },
  ];

  const results: SEOWorkflowCheck[] = await Promise.all(
    workflowDefs.map(async wf => {
      try {
        const res = await wf.check();
        return {
          id:       wf.id,
          name:     wf.name,
          schedule: wf.schedule,
          critical: wf.critical,
          ...res,
          status: res.healthy ? ('healthy' as const) : ('overdue' as const),
          error:  null,
        };
      } catch (e) {
        return {
          id:       wf.id,
          name:     wf.name,
          schedule: wf.schedule,
          critical: wf.critical,
          lastRun:  null,
          daysSince: 999,
          total:    null,
          healthy:  false,
          status:   'error' as const,
          error:    e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  const brokenCritical = results.filter(r => r.critical && !r.healthy);
  const allHealthy     = results.every(r => r.healthy);
  const healthyCount   = results.filter(r => r.healthy).length;

  return { n8nAlive, workflows: results, brokenCritical, allHealthy, healthyCount, totalCount: results.length };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdsAccountData {
  accountId: string;
  accountName: string;
  clientName: string | null;
  today: { spend: number; impressions: number; clicks: number; purchases: number; roas: number };
  yesterday: { spend: number; impressions: number; clicks: number; purchases: number; roas: number };
  sevenDayAvg: { spend: number; roas: number; cpc: number };
  spendDelta: number;
  roasDelta: number;
  cpcDelta: number;
}

export interface PipelineData {
  stageBreakdown: Record<string, { count: number; value: number }>;
  newContactsToday: number;
  dealsMovedForward: number;
  dealsCold: number;
  hotLeadsBooked: number;
  totalPipelineValue: number;
}

export interface TeamMemberData {
  name: string;
  clickupId: number;
  completedToday: number;
  overdueCount: number;
  dueTodayCount: number;
  weekCompletionRate: number;
}

export interface SeoData {
  keywordsImproved: number;
  keywordsDropped: number;
  topGains: Array<{ keyword: string; change: number }>;
  topLosses: Array<{ keyword: string; change: number }>;
  alertsToday: number;
  latestAlerts: string[];
  mobileScore: number | null;
  desktopScore: number | null;
  weeklySessionsLatest: number | null;
}

export interface WhatsappData {
  sentToday: number;
  receivedToday: number;
  newConversations: number;
  unreadCount: number;
}

export interface FunnelData {
  paymentsToday: number;
  revenueToday: number;  // paise
}

export interface BillingData {
  overdueCount: number;
  overdueAmount: number;  // paise
  mrr: number;            // paise (sum of active retainers)
  pendingCount: number;
  pendingAmount: number;  // paise
}

export interface AgencyDailyData {
  collectedAt: string;
  tenantId: string;
  ads: AdsAccountData[];
  pipeline: PipelineData;
  team: TeamMemberData[];
  seo: SeoData;
  whatsapp: WhatsappData;
  funnel: FunnelData;
  billing: BillingData;
  seoWorkflows: SEOWorkflowHealth;
  yesterdayScore: number | null;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractInsightMetric(data: unknown, field: string): number {
  if (!data || typeof data !== 'object') return 0;
  const d = data as Record<string, unknown>;
  // data may be { data: [ { [field]: '123' } ] } or direct
  const rows = Array.isArray(d.data) ? d.data : [d];
  const total = rows.reduce((sum: number, row: unknown) => {
    const r = row as Record<string, unknown>;
    const v = r[field];
    return sum + (v != null ? parseFloat(String(v)) : 0);
  }, 0);
  return total;
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

export async function collectDailyData(): Promise<AgencyDailyData> {
  const errors: string[] = [];
  const client = await pool.connect();

  // Resolve tenant ID
  let tenantId = '';
  try {
    const tenantRes = await client.query(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [DEFAULT_TENANT_SLUG],
    );
    tenantId = (tenantRes.rows[0] as { id: string } | undefined)?.id ?? '';
  } catch (e) {
    logger.error('[intel-collector] tenant lookup failed:', e);
    errors.push('tenant_lookup_failed');
  }

  // -------------------------------------------------------------------------
  // 1. META ADS
  // -------------------------------------------------------------------------
  const adsData: AdsAccountData[] = [];
  try {
    const accountsRes = await client.query(
      `SELECT account_id, account_name, client_name FROM marketing_accounts
       WHERE is_active = true AND tenant_id = $1`,
      [tenantId],
    );

    const todayStr = new Date().toISOString().slice(0, 10);
    const yestStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    for (const acc of accountsRes.rows as Array<{ account_id: string; account_name: string; client_name: string }>) {
      try {
        const [todayCache, yestCache, weekCache] = await Promise.all([
          client.query(
            `SELECT data FROM ads_insights_cache WHERE account_id = $1 AND date_range = $2 AND level = 'account' ORDER BY fetched_at DESC LIMIT 1`,
            [acc.account_id, todayStr],
          ),
          client.query(
            `SELECT data FROM ads_insights_cache WHERE account_id = $1 AND date_range = $2 AND level = 'account' ORDER BY fetched_at DESC LIMIT 1`,
            [acc.account_id, yestStr],
          ),
          client.query(
            `SELECT data FROM ads_insights_cache WHERE account_id = $1 AND date_range = 'last_7d' AND level = 'account' ORDER BY fetched_at DESC LIMIT 1`,
            [acc.account_id],
          ),
        ]);

        const td = todayCache.rows[0]?.data as unknown;
        const yd = yestCache.rows[0]?.data as unknown;
        const wd = weekCache.rows[0]?.data as unknown;

        const todaySpend = extractInsightMetric(td, 'spend');
        const yestSpend  = extractInsightMetric(yd, 'spend');
        const weekSpend  = extractInsightMetric(wd, 'spend') / 7;
        const weekClicks = extractInsightMetric(wd, 'clicks') / 7;
        const weekCpc    = weekClicks > 0 ? weekSpend / weekClicks : 0;
        const weekRoas   = extractInsightMetric(wd, 'purchase_roas') / 7;

        const todayClicks  = extractInsightMetric(td, 'clicks');
        const todayCpc     = todayClicks > 0 ? todaySpend / todayClicks : 0;
        const yestClicks   = extractInsightMetric(yd, 'clicks');
        const yestCpc      = yestClicks > 0 ? yestSpend / yestClicks : 0;
        const todayRoas    = extractInsightMetric(td, 'purchase_roas');
        const yestRoas     = extractInsightMetric(yd, 'purchase_roas');

        adsData.push({
          accountId:   acc.account_id,
          accountName: acc.account_name,
          clientName:  acc.client_name,
          today: {
            spend:       todaySpend,
            impressions: extractInsightMetric(td, 'impressions'),
            clicks:      todayClicks,
            purchases:   extractInsightMetric(td, 'purchases'),
            roas:        todayRoas,
          },
          yesterday: {
            spend:       yestSpend,
            impressions: extractInsightMetric(yd, 'impressions'),
            clicks:      yestClicks,
            purchases:   extractInsightMetric(yd, 'purchases'),
            roas:        yestRoas,
          },
          sevenDayAvg: { spend: weekSpend, roas: weekRoas, cpc: weekCpc },
          spendDelta: yestSpend > 0 ? ((todaySpend - yestSpend) / yestSpend) * 100 : 0,
          roasDelta:  yestRoas  > 0 ? ((todayRoas  - yestRoas)  / yestRoas)  * 100 : 0,
          cpcDelta:   yestCpc   > 0 ? ((todayCpc   - yestCpc)   / yestCpc)   * 100 : 0,
        });
      } catch (e) {
        errors.push(`ads_account_${acc.account_id}_failed`);
      }
    }
  } catch (e) {
    logger.error('[intel-collector] ads fetch failed:', e);
    errors.push('ads_fetch_failed');
  }

  // -------------------------------------------------------------------------
  // 2. CRM PIPELINE
  // -------------------------------------------------------------------------
  let pipeline: PipelineData = {
    stageBreakdown: {}, newContactsToday: 0, dealsMovedForward: 0,
    dealsCold: 0, hotLeadsBooked: 0, totalPipelineValue: 0,
  };
  try {
    const [stageRes, newContactsRes, coldRes, newDealsRes] = await Promise.all([
      client.query(`
        SELECT stage,
               COUNT(*) AS count,
               COALESCE(SUM(COALESCE(deal_value, value::integer, 0)), 0) AS value
        FROM deals WHERE tenant_id = $1 AND stage NOT IN ('won', 'lost')
        GROUP BY stage
      `, [tenantId]),
      client.query(`
        SELECT COUNT(*) AS cnt FROM contacts
        WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day'
      `, [tenantId]),
      client.query(`
        SELECT COUNT(*) AS cnt FROM deals
        WHERE tenant_id = $1
          AND stage NOT IN ('won', 'lost')
          AND (updated_at < NOW() - INTERVAL '5 days' OR last_activity_at IS NOT NULL AND last_activity_at < NOW() - INTERVAL '5 days')
      `, [tenantId]),
      client.query(`
        SELECT COUNT(*) AS cnt FROM deals
        WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day'
      `, [tenantId]),
    ]);

    const stageBreakdown: Record<string, { count: number; value: number }> = {};
    let totalValue = 0;
    for (const row of stageRes.rows as Array<{ stage: string; count: string; value: string }>) {
      stageBreakdown[row.stage] = { count: Number(row.count), value: Number(row.value) };
      totalValue += Number(row.value);
    }

    pipeline = {
      stageBreakdown,
      newContactsToday: Number((newContactsRes.rows[0] as { cnt: string }).cnt),
      dealsMovedForward: Number((newDealsRes.rows[0] as { cnt: string }).cnt),
      dealsCold: Number((coldRes.rows[0] as { cnt: string }).cnt),
      hotLeadsBooked: 0,
      totalPipelineValue: totalValue,
    };
  } catch (e) {
    logger.error('[intel-collector] pipeline fetch failed:', e);
    errors.push('pipeline_fetch_failed');
  }

  // -------------------------------------------------------------------------
  // 3. TEAM OPERATIONS (ClickUp)
  // -------------------------------------------------------------------------
  const teamData: TeamMemberData[] = [];
  const TEAM_MEMBERS = [
    { name: 'Jatin',   clickupId: 88911769 },
    { name: 'Sakcham', clickupId: 242618940 },
    { name: 'Vishal',  clickupId: 100972806 },
    { name: 'Nimisha', clickupId: 100972807 },
    { name: 'Keshav',  clickupId: 4800274   },
  ];

  const clickupToken = process.env.CLICKUP_API_TOKEN;
  const clickupTeamId = process.env.CLICKUP_TEAM_ID ?? '9016403868';

  if (clickupToken) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 7);

    for (const member of TEAM_MEMBERS) {
      try {
        type CuRes = { tasks?: unknown[] };
        const [todayTasksRes, overdueRes, dueTodayRes, weekRes] = await Promise.all([
          // Completed today
          fetch(`https://api.clickup.com/api/v2/team/${clickupTeamId}/task?assignees[]=${member.clickupId}&statuses[]=complete&date_closed_gt=${todayStart.getTime()}&include_closed=true`, {
            headers: { Authorization: clickupToken },
          }).then(r => r.json() as Promise<CuRes>).catch(() => ({ tasks: [] as unknown[] })),
          // Overdue
          fetch(`https://api.clickup.com/api/v2/team/${clickupTeamId}/task?assignees[]=${member.clickupId}&due_date_lt=${Date.now()}&statuses[]=to+do&statuses[]=in+progress`, {
            headers: { Authorization: clickupToken },
          }).then(r => r.json() as Promise<CuRes>).catch(() => ({ tasks: [] as unknown[] })),
          // Due today
          fetch(`https://api.clickup.com/api/v2/team/${clickupTeamId}/task?assignees[]=${member.clickupId}&due_date_gt=${todayStart.getTime()}&due_date_lt=${todayStart.getTime() + 86400000}`, {
            headers: { Authorization: clickupToken },
          }).then(r => r.json() as Promise<CuRes>).catch(() => ({ tasks: [] as unknown[] })),
          // This week completed
          fetch(`https://api.clickup.com/api/v2/team/${clickupTeamId}/task?assignees[]=${member.clickupId}&statuses[]=complete&date_closed_gt=${weekStart.getTime()}&include_closed=true`, {
            headers: { Authorization: clickupToken },
          }).then(r => r.json() as Promise<CuRes>).catch(() => ({ tasks: [] as unknown[] })),
        ]);

        const completedToday = (todayTasksRes.tasks?.length ?? 0);
        const overdueCount   = (overdueRes.tasks?.length ?? 0);
        const dueTodayCount  = (dueTodayRes.tasks?.length ?? 0);
        const weekCompleted  = (weekRes.tasks?.length ?? 0);
        const weekTotal      = weekCompleted + overdueCount;
        const weekRate       = weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 100;

        teamData.push({ name: member.name, clickupId: member.clickupId, completedToday, overdueCount, dueTodayCount, weekCompletionRate: weekRate });
      } catch (e) {
        errors.push(`clickup_${member.name}_failed`);
        teamData.push({ name: member.name, clickupId: member.clickupId, completedToday: 0, overdueCount: 0, dueTodayCount: 0, weekCompletionRate: 0 });
      }
    }
  } else {
    errors.push('clickup_no_token');
    TEAM_MEMBERS.forEach(m => teamData.push({ name: m.name, clickupId: m.clickupId, completedToday: 0, overdueCount: 0, dueTodayCount: 0, weekCompletionRate: 0 }));
  }

  // -------------------------------------------------------------------------
  // 4. SEO DATA
  // -------------------------------------------------------------------------
  let seoData: SeoData = {
    keywordsImproved: 0, keywordsDropped: 0, topGains: [], topLosses: [],
    alertsToday: 0, latestAlerts: [], mobileScore: null, desktopScore: null, weeklySessionsLatest: null,
  };
  try {
    const [kwRes, alertRes, healthRes, sessRes] = await Promise.all([
      client.query(`
        SELECT keyword, position, previous_position,
               (previous_position - position) AS improvement
        FROM keyword_rankings
        WHERE checked_at >= NOW() - INTERVAL '2 days'
          AND previous_position IS NOT NULL AND position IS NOT NULL
        ORDER BY improvement DESC
      `),
      client.query(`
        SELECT message FROM seo_alerts_log
        WHERE created_at >= NOW() - INTERVAL '1 day'
        ORDER BY created_at DESC LIMIT 5
      `),
      client.query(`
        SELECT mobile_performance_score, desktop_performance_score
        FROM site_health_metrics ORDER BY checked_at DESC LIMIT 1
      `),
      client.query(`
        SELECT total_sessions FROM seo_weekly_metrics
        ORDER BY week_start DESC LIMIT 1
      `),
    ]);

    type KwRow = { keyword: string; improvement: string };
    const gained = (kwRes.rows as KwRow[]).filter(r => Number(r.improvement) > 0);
    const lost   = (kwRes.rows as KwRow[]).filter(r => Number(r.improvement) < 0);
    const health = healthRes.rows[0] as { mobile_performance_score: number; desktop_performance_score: number } | undefined;

    seoData = {
      keywordsImproved: gained.length,
      keywordsDropped:  lost.length,
      topGains:  gained.slice(0, 5).map(r => ({ keyword: r.keyword, change: Number(r.improvement) })),
      topLosses: lost.slice(-5).map(r => ({ keyword: r.keyword, change: Number(r.improvement) })),
      alertsToday:     alertRes.rows.length,
      latestAlerts:    (alertRes.rows as Array<{ message: string }>).map(r => r.message),
      mobileScore:     health?.mobile_performance_score ?? null,
      desktopScore:    health?.desktop_performance_score ?? null,
      weeklySessionsLatest: sessRes.rows[0] ? Number((sessRes.rows[0] as { total_sessions: string }).total_sessions) : null,
    };
  } catch (e) {
    logger.error('[intel-collector] SEO fetch failed:', e);
    errors.push('seo_fetch_failed');
  }

  // -------------------------------------------------------------------------
  // 5. WHATSAPP / MESSAGES
  // -------------------------------------------------------------------------
  let whatsapp: WhatsappData = { sentToday: 0, receivedToday: 0, newConversations: 0, unreadCount: 0 };
  try {
    const [sentRes, rcvdRes, unreadRes] = await Promise.all([
      client.query(`
        SELECT COUNT(*) AS cnt FROM messages
        WHERE tenant_id = $1 AND direction = 'outbound' AND sent_at >= NOW() - INTERVAL '1 day'
      `, [tenantId]),
      client.query(`
        SELECT COUNT(*) AS cnt FROM messages
        WHERE tenant_id = $1 AND direction = 'inbound' AND sent_at >= NOW() - INTERVAL '1 day'
      `, [tenantId]),
      client.query(`
        SELECT COUNT(DISTINCT contact_id) AS cnt FROM messages
        WHERE tenant_id = $1 AND direction = 'inbound' AND status != 'read'
      `, [tenantId]),
    ]);
    whatsapp = {
      sentToday:       Number((sentRes.rows[0] as { cnt: string }).cnt),
      receivedToday:   Number((rcvdRes.rows[0] as { cnt: string }).cnt),
      newConversations: 0,
      unreadCount:     Number((unreadRes.rows[0] as { cnt: string }).cnt),
    };
  } catch (e) {
    logger.error('[intel-collector] whatsapp fetch failed:', e);
    errors.push('whatsapp_fetch_failed');
  }

  // -------------------------------------------------------------------------
  // 6. SLO FUNNEL / PAYMENTS
  // -------------------------------------------------------------------------
  let funnel: FunnelData = { paymentsToday: 0, revenueToday: 0 };
  try {
    const payRes = await client.query(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
      FROM payments
      WHERE tenant_id = $1 AND payment_date >= NOW() - INTERVAL '1 day'
    `, [tenantId]);
    const row = payRes.rows[0] as { cnt: string; total: string };
    funnel = { paymentsToday: Number(row.cnt), revenueToday: Number(row.total) };
  } catch (e) {
    logger.error('[intel-collector] funnel fetch failed:', e);
    errors.push('funnel_fetch_failed');
  }

  // -------------------------------------------------------------------------
  // 7. BILLING
  // -------------------------------------------------------------------------
  let billing: BillingData = { overdueCount: 0, overdueAmount: 0, mrr: 0, pendingCount: 0, pendingAmount: 0 };
  try {
    const [overdueRes, mrrRes, pendingRes] = await Promise.all([
      client.query(`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_due), 0) AS total
        FROM invoices WHERE tenant_id = $1 AND status = 'overdue'
      `, [tenantId]),
      client.query(`
        SELECT COALESCE(SUM(retainer_amount), 0) AS mrr
        FROM billing_clients WHERE tenant_id = $1 AND is_active = true
      `, [tenantId]),
      client.query(`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_due), 0) AS total
        FROM invoices WHERE tenant_id = $1 AND status IN ('sent', 'partially_paid')
      `, [tenantId]),
    ]);
    billing = {
      overdueCount:  Number((overdueRes.rows[0] as { cnt: string }).cnt),
      overdueAmount: Number((overdueRes.rows[0] as { total: string }).total),
      mrr:           Number((mrrRes.rows[0] as { mrr: string }).mrr),
      pendingCount:  Number((pendingRes.rows[0] as { cnt: string }).cnt),
      pendingAmount: Number((pendingRes.rows[0] as { total: string }).total),
    };
  } catch (e) {
    logger.error('[intel-collector] billing fetch failed:', e);
    errors.push('billing_fetch_failed');
  }

  // -------------------------------------------------------------------------
  // Yesterday's score
  // -------------------------------------------------------------------------
  let yesterdayScore: number | null = null;
  try {
    const scoreRes = await client.query(`
      SELECT overall_score FROM ai_intelligence_reports
      WHERE report_date = CURRENT_DATE - 1 ORDER BY created_at DESC LIMIT 1
    `);
    if (scoreRes.rows[0]) yesterdayScore = Number((scoreRes.rows[0] as { overall_score: number }).overall_score);
  } catch { /* table may not exist yet */ }

  client.release();

  // -------------------------------------------------------------------------
  // 8. SEO WORKFLOW HEALTH (uses pool directly, no client conn needed)
  // -------------------------------------------------------------------------
  let seoWorkflows: SEOWorkflowHealth = {
    n8nAlive: false, workflows: [], brokenCritical: [],
    allHealthy: false, healthyCount: 0, totalCount: 0,
  };
  try {
    seoWorkflows = await collectSEOWorkflowHealth();
  } catch (e) {
    logger.error('[intel-collector] seo workflow health check failed:', e);
    errors.push('seo_workflow_health_failed');
  }

  return {
    collectedAt: new Date().toISOString(),
    tenantId,
    ads:      adsData,
    pipeline,
    team:     teamData,
    seo:      seoData,
    whatsapp,
    funnel,
    billing,
    seoWorkflows,
    yesterdayScore,
    errors,
  };
}
