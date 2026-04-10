import { pool } from '../db/index';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Ensure SEO tables exist (called on startup)
// ---------------------------------------------------------------------------
export async function ensureSeoTables(): Promise<void> {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS seo_weekly_metrics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_name TEXT,
      client_domain TEXT,
      client_name TEXT,
      week_start DATE,
      week_start_date DATE,
      total_clicks INTEGER DEFAULT 0,
      total_impressions INTEGER DEFAULT 0,
      avg_position NUMERIC,
      avg_ctr NUMERIC,
      total_sessions INTEGER DEFAULT 0,
      ga4_sessions INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS seo_weekly_metrics_domain_week_idx ON seo_weekly_metrics(client_domain, week_start DESC)`,
    `CREATE TABLE IF NOT EXISTS site_health_metrics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_name TEXT NOT NULL,
      pagespeed_mobile NUMERIC,
      pagespeed_desktop NUMERIC,
      lcp NUMERIC,
      fid NUMERIC,
      cls NUMERIC,
      broken_links_count INTEGER DEFAULT 0,
      indexed_pages_count INTEGER DEFAULT 0,
      crawl_errors_count INTEGER DEFAULT 0,
      checked_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS site_health_project_checked_at_idx ON site_health_metrics(project_name, checked_at)`,
    `ALTER TABLE site_health_metrics ADD COLUMN IF NOT EXISTS client_domain TEXT`,
    `CREATE TABLE IF NOT EXISTS seo_opportunities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_name TEXT NOT NULL,
      opportunity_type TEXT,
      description TEXT,
      estimated_impact TEXT,
      effort_level TEXT,
      status TEXT DEFAULT 'open',
      identified_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS seo_opportunities_project_status_idx ON seo_opportunities(project_name, status)`,
    `CREATE TABLE IF NOT EXISTS seo_alerts_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_name TEXT NOT NULL,
      alert_type TEXT,
      message TEXT,
      severity TEXT DEFAULT 'info',
      resolved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS seo_alerts_log_created_idx ON seo_alerts_log(created_at DESC)`,
  ];
  for (const s of stmts) {
    await pool.query(s).catch(e => logger.warn(`[seo-tables] ${e instanceof Error ? e.message : String(e)}`));
  }
  // Looker Studio views
  const views = [
    `CREATE OR REPLACE VIEW seo_looker_weekly AS
     SELECT project_name AS client_domain, project_name AS client_name, week_start_date AS week_start,
       total_clicks, total_impressions,
       ROUND(avg_position::numeric, 1) AS avg_position,
       ga4_sessions,
       LAG(total_clicks) OVER (PARTITION BY project_name ORDER BY week_start_date) AS prev_week_clicks,
       LAG(total_impressions) OVER (PARTITION BY project_name ORDER BY week_start_date) AS prev_week_impressions
     FROM seo_weekly_metrics ORDER BY project_name, week_start_date DESC`,
    `CREATE OR REPLACE VIEW seo_looker_keywords AS
     SELECT keyword, project_name AS client_domain, current_position AS position, previous_position,
       (COALESCE(previous_position,0) - current_position) AS position_improvement,
       search_volume, recorded_date AS checked_at,
       CASE WHEN current_position <= 3 THEN 'Top 3' WHEN current_position <= 10 THEN 'Page 1'
            WHEN current_position <= 20 THEN 'Page 2' ELSE 'Page 3+' END AS ranking_tier
     FROM keyword_rankings ORDER BY project_name, current_position ASC`,
    `CREATE OR REPLACE VIEW seo_looker_alerts AS
     SELECT project_name AS client_domain, alert_type, message AS alert_message,
       severity, created_at, DATE_TRUNC('week', created_at) AS alert_week
     FROM seo_alerts_log ORDER BY created_at DESC`,
    `CREATE OR REPLACE VIEW seo_looker_health AS
     SELECT project_name AS client_domain, pagespeed_mobile AS mobile_score,
       pagespeed_desktop AS desktop_score, lcp, fid, cls, checked_at AS created_at,
       CASE WHEN pagespeed_mobile >= 90 THEN 'Good' WHEN pagespeed_mobile >= 50 THEN 'Needs Improvement' ELSE 'Poor' END AS mobile_status
     FROM site_health_metrics ORDER BY project_name, checked_at DESC`,
  ];
  for (const v of views) await pool.query(v).catch(e => logger.warn(`[seo-views] ${e instanceof Error ? e.message : String(e)}`));

  logger.info('[seo-tables] SEO tables + Looker Studio views bootstrapped');
}

// ---------------------------------------------------------------------------
// Workflow definitions — single source of truth shared by route + worker
// ---------------------------------------------------------------------------
export const SEO_WORKFLOWS = [
  { id: 'YXmClFSKZB9DMkyu', name: 'GSC + GA4 Data Pull',      schedule: 'Monday 8AM IST',        webhookPath: 'mtrig-seo01', critical: true  },
  { id: '5FVX2kEjuD7vWD0e', name: 'Alert Triggers',            schedule: 'Daily 9AM IST',          webhookPath: 'mtrig-seo02', critical: true  },
  { id: 'as8HvuMPqAHhAdQ8', name: 'Weekly Insight Report',     schedule: 'Wednesday 10AM IST',     webhookPath: 'mtrig-seo03', critical: false },
  { id: 'CBzwkCqVgeQOxOQl', name: 'Content Publisher',         schedule: 'Manual',                 webhookPath: 'mtrig-seo04', critical: false },
  { id: 'z21W6MDWBF0dukkT', name: 'PageSpeed Monitor',         schedule: 'Sunday 7AM IST',         webhookPath: 'mtrig-seo05', critical: false },
  { id: 'BwO187curjMMA60i', name: 'Rank Tracking',             schedule: 'Tuesday 9AM IST',        webhookPath: 'mtrig-seo06', critical: true  },
  { id: 'Isz1ui9PkjsqBMb8', name: 'Content Gap Analysis',      schedule: 'Alt Wednesday 11AM IST', webhookPath: 'mtrig-seo07', critical: false },
  { id: '19R3BStSY2S1N9H1', name: 'Backlink Monitor',          schedule: 'Friday 9AM IST',         webhookPath: 'mtrig-seo08', critical: false },
  { id: 'akTW1dgtKtCpcz3R', name: 'Internal Linking',          schedule: 'On publish',             webhookPath: 'mtrig-seo09', critical: false },
  { id: '8l9kEQlRVUbL4Ku6', name: 'Google Indexing Ping',      schedule: 'On publish',             webhookPath: 'mtrig-seo10', critical: false },
  { id: 'Ss2Bfps5lXBWUUs4', name: 'Content Decay Detection',   schedule: 'First Monday 9AM IST',   webhookPath: 'mtrig-seo11', critical: false },
  { id: 'M4rbRZL5jh0jJHku', name: 'Weekly Opportunity Digest', schedule: 'Friday 5PM IST',         webhookPath: 'mtrig-seo12', critical: false },
] as const;

export type SeoWorkflow = typeof SEO_WORKFLOWS[number];

// ---------------------------------------------------------------------------
// Schedule period in hours — drives health calculation
// ---------------------------------------------------------------------------
const SCHEDULE_PERIOD_HOURS: Record<string, number> = {
  YXmClFSKZB9DMkyu:  7 * 24,  // weekly
  '5FVX2kEjuD7vWD0e': 24,      // daily
  as8HvuMPqAHhAdQ8:  7 * 24,  // weekly
  CBzwkCqVgeQOxOQl:  0,        // manual
  z21W6MDWBF0dukkT:  7 * 24,
  BwO187curjMMA60i:  7 * 24,
  Isz1ui9PkjsqBMb8:  14 * 24, // biweekly
  '19R3BStSY2S1N9H1': 7 * 24,
  akTW1dgtKtCpcz3R:  0,        // on publish
  '8l9kEQlRVUbL4Ku6': 0,       // on publish
  Ss2Bfps5lXBWUUs4:  28 * 24, // ~monthly
  M4rbRZL5jh0jJHku:  7 * 24,
};

function calcHealth(lastRun: Date | null, periodHours: number) {
  if (periodHours === 0) return { status: 'manual' as const, message: 'Manual trigger only' };
  if (!lastRun)          return { status: 'error'  as const, message: 'Never run' };
  const hoursAgo = (Date.now() - lastRun.getTime()) / 3_600_000;
  if (hoursAgo <= periodHours)      return { status: 'healthy' as const, message: `Ran ${Math.round(hoursAgo)}h ago` };
  if (hoursAgo <= periodHours * 2)  return { status: 'warning' as const, message: `Overdue by ${Math.round(hoursAgo - periodHours)}h` };
  return { status: 'error' as const, message: `Overdue by ${Math.round((hoursAgo - periodHours) / 24)}d` };
}

export interface WorkflowStatus {
  id: string;
  name: string;
  schedule: string;
  critical: boolean;
  webhookPath: string;
  lastRun: string | null;
  status: 'healthy' | 'warning' | 'error' | 'manual';
  statusMessage: string;
  dataCount: number;
}

// ---------------------------------------------------------------------------
// ensureSeoWorkflowLogsTable — idempotent, safe to call at startup
// ---------------------------------------------------------------------------
export async function ensureSeoWorkflowLogsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_workflow_logs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id      TEXT NOT NULL,
      workflow_name    TEXT NOT NULL,
      status           TEXT NOT NULL,
      started_at       TIMESTAMP,
      finished_at      TIMESTAMP,
      duration_seconds INTEGER,
      error_message    TEXT,
      records_processed INTEGER,
      triggered_by     TEXT DEFAULT 'schedule',
      created_at       TIMESTAMP DEFAULT NOW()
    )
  `);
}

// ---------------------------------------------------------------------------
// checkWorkflowHealth — queries all output tables + logs table
// ---------------------------------------------------------------------------
export async function checkWorkflowHealth(): Promise<{
  workflows: WorkflowStatus[];
  summary: { healthy: number; warning: number; error: number; manual: number; lastChecked: string };
}> {
  const client = await pool.connect();
  try {
    const [wm, al, sh, kr, bd, op, logs] = await Promise.all([
      client.query('SELECT MAX(week_start_date) AS last_run, COUNT(*) AS cnt FROM seo_weekly_metrics'),
      client.query('SELECT MAX(created_at)  AS last_run, COUNT(*) AS cnt FROM seo_alerts_log'),
      client.query('SELECT MAX(checked_at)  AS last_run, COUNT(*) AS cnt FROM site_health_metrics'),
      client.query('SELECT MAX(recorded_date) AS last_run, COUNT(*) AS cnt FROM keyword_rankings'),
      client.query('SELECT MAX(checked_at)  AS last_run, COUNT(*) AS cnt FROM backlink_data'),
      client.query('SELECT MAX(created_at)  AS last_run, COUNT(*) AS cnt FROM seo_opportunities'),
      client.query(`
        SELECT workflow_id, MAX(created_at) AS last_run, COUNT(*) AS cnt
        FROM seo_workflow_logs GROUP BY workflow_id
      `),
    ]);

    // Map wf logs
    const logMap: Record<string, { lastRun: Date | null; cnt: number }> = {};
    for (const row of logs.rows as Array<{ workflow_id: string; last_run: string | null; cnt: string }>) {
      logMap[row.workflow_id] = { lastRun: row.last_run ? new Date(row.last_run) : null, cnt: Number(row.cnt) };
    }

    // Direct-table lookups override log lookups for known mappings
    const tableData: Record<string, { lastRun: Date | null; cnt: number }> = {
      YXmClFSKZB9DMkyu:  { lastRun: wm.rows[0]?.last_run ? new Date(wm.rows[0].last_run) : null, cnt: Number(wm.rows[0]?.cnt ?? 0) },
      '5FVX2kEjuD7vWD0e': { lastRun: al.rows[0]?.last_run ? new Date(al.rows[0].last_run) : null, cnt: Number(al.rows[0]?.cnt ?? 0) },
      z21W6MDWBF0dukkT:  { lastRun: sh.rows[0]?.last_run ? new Date(sh.rows[0].last_run) : null, cnt: Number(sh.rows[0]?.cnt ?? 0) },
      BwO187curjMMA60i:  { lastRun: kr.rows[0]?.last_run ? new Date(kr.rows[0].last_run) : null, cnt: Number(kr.rows[0]?.cnt ?? 0) },
      '19R3BStSY2S1N9H1': { lastRun: bd.rows[0]?.last_run ? new Date(bd.rows[0].last_run) : null, cnt: Number(bd.rows[0]?.cnt ?? 0) },
      Ss2Bfps5lXBWUUs4:  { lastRun: op.rows[0]?.last_run ? new Date(op.rows[0].last_run) : null, cnt: Number(op.rows[0]?.cnt ?? 0) },
    };

    const workflows: WorkflowStatus[] = SEO_WORKFLOWS.map(wf => {
      const data = tableData[wf.id] ?? logMap[wf.id] ?? { lastRun: null, cnt: 0 };
      const period = SCHEDULE_PERIOD_HOURS[wf.id] ?? 0;
      const { status, message } = calcHealth(data.lastRun, period);
      return {
        id: wf.id,
        name: wf.name,
        schedule: wf.schedule,
        critical: wf.critical,
        webhookPath: wf.webhookPath,
        lastRun: data.lastRun?.toISOString() ?? null,
        status,
        statusMessage: message,
        dataCount: data.cnt,
      };
    });

    const summary = {
      healthy: workflows.filter(w => w.status === 'healthy').length,
      warning: workflows.filter(w => w.status === 'warning').length,
      error:   workflows.filter(w => w.status === 'error').length,
      manual:  workflows.filter(w => w.status === 'manual').length,
      lastChecked: new Date().toISOString(),
    };

    return { workflows, summary };
  } finally {
    client.release();
  }
}
