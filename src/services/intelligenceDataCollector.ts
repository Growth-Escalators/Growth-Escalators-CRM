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

const N8N_BASE = process.env.N8N_BASE_URL || 'https://primary-production-6c6f5.up.railway.app';

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
        const r = await pool.query(`SELECT MAX(week_start_date) AS last_run, COUNT(*) AS total FROM seo_weekly_metrics`);
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
        // Check cron_job_logs for backend-native backlink service runs
        const r = await pool.query(`SELECT MAX(started_at) AS last_run FROM cron_job_logs WHERE job_name ILIKE '%backlink%'`).catch(() => ({ rows: [{ last_run: null }] }));
        const lastRun = (r.rows[0] as { last_run: string | null }).last_run;
        const daysSince = lastRun ? Math.floor((now.getTime() - new Date(lastRun).getTime()) / 86400000) : 999;
        return { lastRun, daysSince, total: null, healthy: daysSince <= 8 };
      },
    },
    {
      id: 'WF-SEO-11', name: 'Content Decay Detection', schedule: 'Every Monday 9AM IST', critical: false,
      check: async () => {
        const r = await pool.query(`SELECT MAX(created_at) AS last_run, COUNT(*) AS total FROM seo_opportunities`);
        const lastRun = (r.rows[0] as { last_run: string | null }).last_run;
        const daysSince = lastRun ? Math.floor((now.getTime() - new Date(lastRun).getTime()) / 86400000) : 999;
        return { lastRun, daysSince, total: Number((r.rows[0] as { total: string }).total), healthy: daysSince <= 10 };
      },
    },
    {
      id: 'WF-SEO-12', name: 'Weekly Opportunity Digest', schedule: 'Friday 5PM IST', critical: false,
      check: async () => {
        // Check cron_job_logs for backend-native digest runs
        const r = await pool.query(`SELECT MAX(started_at) AS last_run FROM cron_job_logs WHERE job_name ILIKE '%digest%' OR job_name ILIKE '%opportunity%'`).catch(() => ({ rows: [{ last_run: null }] }));
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
  userId: string | null;
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

export interface SystemError {
  source: string;
  pattern: string;
  count: number;
  detail?: string;
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
  systemErrors: SystemError[];
  yesterdayScore: number | null;
  errors: string[];
  creativeIntel?: { fatiguingCount: number; bestType: string | null; totalTracked: number };
  outreachVelocity?: { enrichedToday: number; repliedToday: number; interestedPending: number };
  contentCalendar?: { planned: number; writing: number; overdue: number };
  financeSnapshot?: { overdueInvoices: number; overdueAmount: number };
  topSources?: Array<{ source: string; purchases: number }>;
}

// ---------------------------------------------------------------------------
// System error collector
// ---------------------------------------------------------------------------

export async function collectSystemErrors(): Promise<SystemError[]> {
  const detected: SystemError[] = [];

  // Failed jobs
  await pool.query(`
    SELECT job_type, error_message, COUNT(*) AS cnt
    FROM jobs
    WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY job_type, error_message
    ORDER BY cnt DESC LIMIT 5
  `).then(r => {
    for (const row of r.rows as Array<{ job_type: string; error_message: string; cnt: string }>) {
      if (Number(row.cnt) > 0) {
        detected.push({
          source: 'job_queue',
          pattern: `${row.job_type} jobs failing`,
          count: Number(row.cnt),
          detail: row.error_message,
        });
      }
    }
  }).catch(() => {});

  // Sequence enrolment errors
  await pool.query(`
    SELECT COUNT(*) AS cnt FROM sequence_enrolments
    WHERE status = 'error' AND updated_at > NOW() - INTERVAL '24 hours'
  `).then(r => {
    const cnt = Number((r.rows[0] as { cnt: string }).cnt ?? 0);
    if (cnt > 0) detected.push({ source: 'sequences', pattern: 'Email sequence enrolment errors', count: cnt });
  }).catch(() => {});

  // (ClickUp task-creation failure check removed — ClickUp dropped 2026-05-09)

  // Generic audit errors
  await pool.query(`
    SELECT action, COUNT(*) AS cnt
    FROM audit_events
    WHERE action LIKE '%error%' OR action LIKE '%failed%'
      AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY action ORDER BY cnt DESC LIMIT 3
  `).then(r => {
    for (const row of r.rows as Array<{ action: string; cnt: string }>) {
      const cnt = Number(row.cnt);
      if (cnt > 2) detected.push({ source: 'audit', pattern: row.action, count: cnt });
    }
  }).catch(() => {});

  return detected;
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

// Timeout wrapper for individual data sources
async function withTimeout<T>(promise: Promise<T>, name: string, fallback: T, timeoutMs = 8000): Promise<T> {
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
  } catch (e) {
    logger.warn(`[intel-collector] ${name}: ${e instanceof Error ? e.message : String(e)} — using fallback`);
    return fallback;
  }
}

export async function collectDailyData(): Promise<AgencyDailyData> {
  const errors: string[] = [];
  logger.info('[intel-collector] Starting data collection...');

  try {
    return await _collectDailyDataInner(pool, errors);
  } catch (e) {
    logger.error('[intel-collector] Collection failed:', e);
    throw e;
  }
}

// Queryable is satisfied by both Pool and PoolClient — each has .query()
type Queryable = { query: (text: string, values?: unknown[]) => Promise<import('pg').QueryResult> };

async function _collectDailyDataInner(client: Queryable, errors: string[]): Promise<AgencyDailyData> {

  // Resolve tenant ID
  let tenantId = '';
  try {
    const tenantRes = await client.query(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [DEFAULT_TENANT_SLUG],
    );
    tenantId = (tenantRes.rows[0] as { id: string } | undefined)?.id ?? '';
    logger.info(`[intel-collector] Tenant resolved: ${tenantId}`);
  } catch (e) {
    logger.error('[intel-collector] tenant lookup failed:', e);
    errors.push('tenant_lookup_failed');
  }

  // -------------------------------------------------------------------------
  // 1. META ADS
  // -------------------------------------------------------------------------
  logger.info('[intel-collector] Collecting ads data...');
  const adsData: AdsAccountData[] = [];
  try {
    const accountsRes = await client.query(
      `SELECT account_id, account_name, client_name FROM marketing_accounts
       WHERE is_active = true AND tenant_id = $1`,
      [tenantId],
    );

    // Fetch live from Meta API instead of empty cache table
    const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
    if (token) {
      for (const acc of accountsRes.rows as Array<{ account_id: string; account_name: string; client_name: string; currency?: string; exchange_rate?: number }>) {
        try {
          const { fetchAccountInsights } = await import('./metaAdsService');
          const acctId = acc.account_id.startsWith('act_') ? acc.account_id : `act_${acc.account_id}`;
          const insights = await fetchAccountInsights(acctId, token, acc.client_name, acc.currency || 'INR', acc.exchange_rate || 1);

          const yd = insights.yesterday;
          const wd = insights.last7days;

          const weekSpend  = wd ? wd.spend / 7 : 0;
          const weekClicks = wd ? wd.clicks / 7 : 0;
          const weekCpc    = weekClicks > 0 ? weekSpend / weekClicks : 0;
          const weekRoas   = wd ? wd.roas : 0;

          const yestSpend  = yd?.spend ?? 0;
          const yestClicks = yd?.clicks ?? 0;
          const yestCpc    = yestClicks > 0 ? yestSpend / yestClicks : 0;
          const yestRoas   = yd?.roas ?? 0;

          // Use yesterday as "today" proxy since Meta's "today" data is always partial
          adsData.push({
            accountId:   acc.account_id,
            accountName: acc.account_name,
            clientName:  acc.client_name,
            today: {
              spend:       yestSpend,
              impressions: yd?.impressions ?? 0,
              clicks:      yestClicks,
              purchases:   yd?.purchases ?? 0,
              roas:        yestRoas,
            },
            yesterday: {
              spend:       yestSpend,
              impressions: yd?.impressions ?? 0,
              clicks:      yestClicks,
              purchases:   yd?.purchases ?? 0,
              roas:        yestRoas,
            },
            sevenDayAvg: { spend: weekSpend, roas: weekRoas, cpc: weekCpc },
            spendDelta: 0,
            roasDelta:  0,
            cpcDelta:   0,
          });
        } catch (e) {
          errors.push(`ads_account_${acc.account_id}_failed`);
        }
      }
    } else {
      errors.push('META_ADS_TOKEN not set');
    }
  } catch (e) {
    logger.error('[intel-collector] ads fetch failed:', e);
    errors.push('ads_fetch_failed');
  }

  // -------------------------------------------------------------------------
  // 2. CRM PIPELINE
  logger.info('[intel-collector] Collecting pipeline data...');
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
          AND updated_at < NOW() - INTERVAL '5 days'
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
  // 3. TEAM OPERATIONS (CRM tasks)
  logger.info('[intel-collector] Collecting team data (CRM tasks)...');
  // -------------------------------------------------------------------------
  let teamData: TeamMemberData[] = [];
  try {
    const { fetchTeamPerformance } = await import('./teamPerformanceService');
    const perf = await fetchTeamPerformance();
    teamData = perf.map(p => ({
      name: p.name,
      userId: p.userId,
      completedToday: p.completedToday,
      overdueCount: p.overdueCount,
      dueTodayCount: p.dueTodayCount,
      weekCompletionRate: p.weekCompletionRate,
    }));
  } catch (e) {
    logger.error('[intel-collector] team-performance fetch failed:', e);
    errors.push('team_performance_failed');
  }

  // -------------------------------------------------------------------------
  // 4. SEO DATA
  logger.info('[intel-collector] Collecting SEO data...');
  // -------------------------------------------------------------------------
  let seoData: SeoData = {
    keywordsImproved: 0, keywordsDropped: 0, topGains: [], topLosses: [],
    alertsToday: 0, latestAlerts: [], mobileScore: null, desktopScore: null, weeklySessionsLatest: null,
  };
  try {
    const [kwRes, alertRes, healthRes, sessRes] = await Promise.all([
      client.query(`
        SELECT keyword, current_position AS position, previous_position,
               (previous_position - current_position) AS improvement
        FROM keyword_rankings
        WHERE recorded_date >= CURRENT_DATE - INTERVAL '2 days'
          AND previous_position IS NOT NULL AND current_position IS NOT NULL
        ORDER BY improvement DESC
      `),
      client.query(`
        SELECT message FROM seo_alerts_log
        WHERE created_at >= NOW() - INTERVAL '1 day'
        ORDER BY created_at DESC LIMIT 5
      `),
      client.query(`
        SELECT pagespeed_mobile AS mobile_performance_score,
               pagespeed_desktop AS desktop_performance_score
        FROM site_health_metrics ORDER BY checked_at DESC LIMIT 1
      `),
      client.query(`
        SELECT ga4_sessions AS total_sessions FROM seo_weekly_metrics
        ORDER BY week_start_date DESC LIMIT 1
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
  logger.info('[intel-collector] Collecting WhatsApp/messages data...');
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
  logger.info('[intel-collector] Collecting payments/funnel data...');
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
  logger.info('[intel-collector] Collecting billing data...');
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

  // -------------------------------------------------------------------------
  // 8. SEO WORKFLOW HEALTH (uses pool directly, no client conn needed)
  logger.info('[intel-collector] Collecting SEO workflow health...');
  // -------------------------------------------------------------------------
  let seoWorkflows: SEOWorkflowHealth = {
    n8nAlive: false, workflows: [], brokenCritical: [],
    allHealthy: false, healthyCount: 0, totalCount: 0,
  };
  seoWorkflows = await withTimeout(
    collectSEOWorkflowHealth(),
    'SEO workflow health',
    seoWorkflows,
    8000,
  );

  // -------------------------------------------------------------------------
  // 9. SYSTEM ERRORS
  logger.info('[intel-collector] Collecting system errors...');
  // -------------------------------------------------------------------------
  let systemErrors: SystemError[] = [];
  systemErrors = await withTimeout(
    collectSystemErrors(),
    'system errors',
    systemErrors,
    5000,
  );

  // -------------------------------------------------------------------------
  // 10. CREATIVE INTELLIGENCE
  logger.info('[intel-collector] Collecting creative intelligence data...');
  // -------------------------------------------------------------------------
  let creativeIntel = { fatiguingCount: 0, bestType: null as string | null, totalTracked: 0 };
  try {
    const fatiguing = await pool.query(
      `SELECT COUNT(*) AS count FROM creative_intelligence WHERE fatigue_status IN ('fatiguing', 'saturated')`
    );
    creativeIntel.fatiguingCount = parseInt(fatiguing.rows[0]?.count || '0');

    const bestType = await pool.query(`
      SELECT creative_tags->>'hook' || ' + ' || creative_tags->>'visual' AS type,
             ROUND(AVG(latest_roas)::numeric, 2) AS avg_roas
      FROM creative_intelligence
      WHERE creative_tags IS NOT NULL AND latest_roas IS NOT NULL
      GROUP BY creative_tags->>'hook', creative_tags->>'visual'
      HAVING COUNT(*) >= 2
      ORDER BY AVG(latest_roas) DESC LIMIT 1
    `);
    if (bestType.rows.length > 0) creativeIntel.bestType = `${bestType.rows[0].type} (${bestType.rows[0].avg_roas}x ROAS)`;

    const tracked = await pool.query(`SELECT COUNT(*) AS count FROM creative_intelligence`);
    creativeIntel.totalTracked = parseInt(tracked.rows[0]?.count || '0');
  } catch { /* creative intel not yet set up */ }

  // -------------------------------------------------------------------------
  // 11. OUTREACH VELOCITY
  logger.info('[intel-collector] Collecting outreach velocity data...');
  // -------------------------------------------------------------------------
  let outreachVelocity = { enrichedToday: 0, repliedToday: 0, interestedPending: 0 };
  try {
    const enriched = await pool.query(
      `SELECT COUNT(*) AS count FROM outreach_leads WHERE enriched_at >= CURRENT_DATE AND enriched_at < CURRENT_DATE + 1`
    );
    outreachVelocity.enrichedToday = parseInt(enriched.rows[0]?.count || '0');

    const replied = await pool.query(
      `SELECT COUNT(*) AS count FROM outreach_leads WHERE reply_time >= CURRENT_DATE AND reply_time < CURRENT_DATE + 1`
    );
    outreachVelocity.repliedToday = parseInt(replied.rows[0]?.count || '0');

    const interested = await pool.query(
      `SELECT COUNT(*) AS count FROM outreach_leads
       WHERE reply_category = 'INTERESTED' AND (jatin_responded_at IS NULL)
       AND reply_time >= NOW() - INTERVAL '7 days'`
    );
    outreachVelocity.interestedPending = parseInt(interested.rows[0]?.count || '0');
  } catch { /* outreach not critical */ }

  // -------------------------------------------------------------------------
  // 12. SEO CONTENT CALENDAR
  logger.info('[intel-collector] Collecting content calendar data...');
  // -------------------------------------------------------------------------
  let contentCalendar = { planned: 0, writing: 0, overdue: 0 };
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'planned') AS planned,
        COUNT(*) FILTER (WHERE status = 'writing') AS writing,
        COUNT(*) FILTER (WHERE status = 'planned' AND target_publish_date < CURRENT_DATE) AS overdue
      FROM seo_content_calendar
    `);
    if (stats.rows[0]) {
      contentCalendar.planned = parseInt(stats.rows[0].planned || '0');
      contentCalendar.writing = parseInt(stats.rows[0].writing || '0');
      contentCalendar.overdue = parseInt(stats.rows[0].overdue || '0');
    }
  } catch { /* calendar not yet set up */ }

  // -------------------------------------------------------------------------
  // 13. FINANCE SNAPSHOT
  logger.info('[intel-collector] Collecting finance snapshot...');
  // -------------------------------------------------------------------------
  let financeSnapshot = { overdueInvoices: 0, overdueAmount: 0 };
  try {
    const overdue = await pool.query(`
      SELECT COUNT(*) AS count, COALESCE(SUM(amount_due), 0) AS total
      FROM invoices WHERE status = 'overdue'
    `);
    if (overdue.rows[0]) {
      financeSnapshot.overdueInvoices = parseInt(overdue.rows[0].count || '0');
      financeSnapshot.overdueAmount = Math.round(parseInt(overdue.rows[0].total || '0') / 100); // paise to rupees
    }
  } catch { /* finance not critical */ }

  // -------------------------------------------------------------------------
  // 14. UTM ATTRIBUTION (top sources)
  logger.info('[intel-collector] Collecting UTM attribution data...');
  // -------------------------------------------------------------------------
  let topSources: Array<{ source: string; purchases: number }> = [];
  try {
    const sources = await pool.query(`
      SELECT metadata->>'utm_source' AS source, COUNT(*) AS purchases
      FROM contacts
      WHERE metadata->>'paymentStatus' = 'paid' AND metadata->>'utm_source' IS NOT NULL
      AND created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY metadata->>'utm_source'
      ORDER BY COUNT(*) DESC LIMIT 3
    `);
    topSources = sources.rows;
  } catch { /* UTM data not yet available */ }

  logger.info(`[intel-collector] All data collected. Errors: [${errors.join(', ') || 'none'}]`);

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
    systemErrors,
    yesterdayScore,
    errors,
    creativeIntel,
    outreachVelocity,
    contentCalendar,
    financeSnapshot,
    topSources,
  };
}
