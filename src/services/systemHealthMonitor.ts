import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackDM } from './slackService';
import { SLACK_JATIN } from '../config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SubsystemHealth {
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  metrics: Record<string, unknown>;
}

export interface CronJobStatus {
  name: string;
  lastRun: string | null;
  status: string;
  durationMs: number | null;
  recordsProcessed: number;
  healthy: boolean;
}

export interface SystemHealthReport {
  overallScore: number;
  outreach: SubsystemHealth;
  seo: SubsystemHealth;
  crm: SubsystemHealth;
  infrastructure: SubsystemHealth;
  cronJobs: CronJobStatus[];
  checkedAt: string;
}

// Cron expected windows in minutes
const CRON_WINDOWS: Record<string, number> = {
  // Alerts & digests (Blocker Alerts & Spend Alert Check removed — disabled in worker.ts)
  'SOD Digest': 1500, 'Sakcham Priority SOD': 1500, 'EOD Summary': 1500,
  // Finance
  'Monthly Invoice Drafts': 44640,
  'Overdue Invoice Check': 1500, 'Retainer Invoice Generator': 1500,
  // Intelligence & reporting
  'Daily Intelligence Report': 1500,
  'Meta Ads Daily Report': 1500, 'Meta Token Check': 10080,
  'SEO Workflow Health': 1500, 'Growth OS Health Scores': 1500,
  'Money on Table': 10080, 'Creative Intelligence': 360,
  'Competitor Pulse': 10080, 'SEO Weekly Email': 10080,
  'PageSpeed Monitor': 10080, 'Daily Archive': 1500,
  // Outreach
  'Outreach Enrichment': 10, 'Outreach CRM Sync': 60,
  'Outreach Daily Digest': 1500, 'Daily Lead Discovery': 1500,
  'Reset Stuck Enriching Leads': 120, 'Weekly Outreach Summary': 10080,
  'Saleshandy Auto-Upload': 15,
  // Ops
  'Audit Booking Follow-up': 360, 'Weekly Data Cleanup': 10080,
  'Co-Pilot Poller': 5, 'Pipeline Placement': 1,
  'System Health Check': 60, 'Workflow Self-Healing': 60, 'Rank Tracking': 10080,
  'Morning Briefing': 1500, 'Evening Summary': 1500,
  'Competitor Content Analysis': 21600,
  'SEO Alert Triggers': 1500, 'SEO Backlink Monitor': 10080,
  'SEO Content Decay': 44640, 'SEO Weekly Digest': 10080,
};

// Alert rate limiting — 12h cooldown + 5-minute startup grace period
const WORKER_BOOT_TIME = Date.now();
const STARTUP_GRACE_MS = 5 * 60 * 1000; // suppress alerts for 5 min after boot
const lastAlerts = new Map<string, number>();
function canAlert(key: string, cooldownMs = 12 * 60 * 60 * 1000): boolean {
  if (Date.now() - WORKER_BOOT_TIME < STARTUP_GRACE_MS) return false;
  const last = lastAlerts.get(key) ?? 0;
  if (Date.now() - last < cooldownMs) return false;
  lastAlerts.set(key, Date.now());
  return true;
}

// ---------------------------------------------------------------------------
// Ensure cron_job_logs table
// ---------------------------------------------------------------------------
export async function ensureCronJobLogsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cron_job_logs (
      id SERIAL PRIMARY KEY,
      job_name VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL,
      started_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP,
      duration_ms INTEGER,
      error_message TEXT,
      records_processed INTEGER DEFAULT 0
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS cron_job_logs_name_idx ON cron_job_logs(job_name)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS cron_job_logs_started_idx ON cron_job_logs(started_at DESC)`).catch(() => {});
  // Clean up obsolete job names from before rename fix
  await pool.query(`
    DELETE FROM cron_job_logs
    WHERE job_name IN ('Blocker Alerts (morning)', 'Blocker Alerts (evening)', 'Daily ROAS Report')
  `).catch(() => {});
}

// ---------------------------------------------------------------------------
// Log cron execution (called from safeCron wrapper)
// ---------------------------------------------------------------------------
export async function logCronStart(jobName: string): Promise<number> {
  const r = await pool.query(
    `INSERT INTO cron_job_logs (job_name, status) VALUES ($1, 'running') RETURNING id`,
    [jobName],
  );
  return (r.rows[0] as { id: number }).id;
}

export async function logCronSuccess(logId: number, durationMs: number, recordsProcessed = 0): Promise<void> {
  await pool.query(
    `UPDATE cron_job_logs SET status='success', completed_at=NOW(), duration_ms=$1, records_processed=$2 WHERE id=$3`,
    [durationMs, recordsProcessed, logId],
  ).catch(() => {});
}

export async function logCronFailure(logId: number, durationMs: number, error: string): Promise<void> {
  await pool.query(
    `UPDATE cron_job_logs SET status='failed', completed_at=NOW(), duration_ms=$1, error_message=$2 WHERE id=$3`,
    [durationMs, error.slice(0, 500), logId],
  ).catch(() => {});
}

// ---------------------------------------------------------------------------
// Main health check
// ---------------------------------------------------------------------------
export async function checkAllSystems(): Promise<SystemHealthReport> {
  const [outreach, seo, crm, infra, cronJobs] = await Promise.all([
    checkOutreach().catch(() => ({ status: 'CRITICAL' as const, metrics: { error: 'check failed' } })),
    checkSeo().catch(() => ({ status: 'WARNING' as const, metrics: { error: 'check failed' } })),
    checkCrm().catch(() => ({ status: 'HEALTHY' as const, metrics: { error: 'check failed' } })),
    checkInfrastructure().catch(() => ({ status: 'CRITICAL' as const, metrics: { error: 'check failed' } })),
    checkCronJobs().catch(() => []),
  ]);

  // Calculate score
  let score = 0;
  if (infra.status === 'HEALTHY') score += 30;
  else if (infra.status === 'WARNING') score += 15;
  if (outreach.status === 'HEALTHY') score += 20;
  else if (outreach.status === 'WARNING') score += 10;
  if (seo.status === 'HEALTHY') score += 20;
  else if (seo.status === 'WARNING') score += 10;
  if (crm.status === 'HEALTHY') score += 15;
  else if (crm.status === 'WARNING') score += 8;
  const cronHealthy = cronJobs.filter(c => c.healthy).length;
  const cronTotal = Math.max(cronJobs.length, 1);
  score += Math.round((cronHealthy / cronTotal) * 15);

  if (infra.status === 'CRITICAL') score = Math.min(score, 29);

  return { overallScore: score, outreach, seo, crm, infrastructure: infra, cronJobs, checkedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Subsystem checks
// ---------------------------------------------------------------------------
async function checkOutreach(): Promise<SubsystemHealth> {
  const r = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS discovered_today,
      COUNT(*) FILTER (WHERE status = 'Enriching' AND updated_at < NOW() - INTERVAL '60 minutes') AS stuck,
      COUNT(*) FILTER (WHERE status = 'Active') AS active,
      COUNT(*) FILTER (WHERE saleshandy_uploaded = true) AS uploaded,
      COUNT(*) FILTER (WHERE reply_category IS NOT NULL AND updated_at::date = CURRENT_DATE) AS replies_today,
      MAX(created_at) AS last_discovery
    FROM outreach_leads
  `);
  const m = r.rows[0] as Record<string, string>;
  const discoveredToday = parseInt(m.discovered_today ?? '0');
  const stuck = parseInt(m.stuck ?? '0');
  const lastDiscovery = m.last_discovery ? new Date(m.last_discovery) : null;
  const hoursSinceDiscovery = lastDiscovery ? (Date.now() - lastDiscovery.getTime()) / 3600000 : 999;

  let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
  if (stuck > 0) status = 'WARNING';
  if (hoursSinceDiscovery > 48) status = 'CRITICAL';

  // Auto-heal: reset stuck leads
  if (stuck > 0) {
    await pool.query(`UPDATE outreach_leads SET status='New', retry_count=0, updated_at=NOW() WHERE status='Enriching' AND updated_at < NOW() - INTERVAL '60 minutes'`).catch(() => {});
  }

  return { status, metrics: { discoveredToday, stuck, active: parseInt(m.active ?? '0'), uploaded: parseInt(m.uploaded ?? '0'), repliesToday: parseInt(m.replies_today ?? '0'), hoursSinceDiscovery: Math.round(hoursSinceDiscovery) } };
}

async function checkSeo(): Promise<SubsystemHealth> {
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM seo_weekly_metrics WHERE week_start >= CURRENT_DATE - 14) AS recent_metrics,
      (SELECT COUNT(*)::int FROM keyword_rankings WHERE checked_at >= NOW() - INTERVAL '48 hours') AS recent_rankings
  `);
  const m = r.rows[0] as Record<string, string>;
  const recentMetrics = parseInt(m.recent_metrics ?? '0');
  const recentRankings = parseInt(m.recent_rankings ?? '0');

  let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
  if (recentMetrics === 0 && recentRankings === 0) status = 'CRITICAL';
  else if (recentMetrics === 0 || recentRankings === 0) status = 'WARNING';

  return { status, metrics: { recentMetrics, recentRankings } };
}

async function checkCrm(): Promise<SubsystemHealth> {
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM contacts WHERE created_at::date = CURRENT_DATE) AS contacts_today,
      (SELECT COUNT(*)::int FROM deals WHERE stage NOT IN ('won', 'lost', 'Won', 'Lost')) AS deals_active,
      (SELECT COALESCE(SUM(deal_value), 0)::bigint FROM deals WHERE stage NOT IN ('won', 'lost', 'Won', 'Lost')) AS pipeline_value,
      (SELECT COUNT(*)::int FROM invoices WHERE status = 'overdue') AS invoices_overdue
  `);
  const m = r.rows[0] as Record<string, string>;
  const overdueCount = parseInt(m.invoices_overdue ?? '0');
  let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
  if (overdueCount > 3) status = 'WARNING';

  return { status, metrics: { contactsToday: parseInt(m.contacts_today ?? '0'), dealsActive: parseInt(m.deals_active ?? '0'), pipelineValue: parseInt(m.pipeline_value ?? '0'), invoicesOverdue: overdueCount } };
}

async function checkInfrastructure(): Promise<SubsystemHealth> {
  const checks: Record<string, unknown> = {};

  // Web service
  try {
    const webUrl = process.env.BASE_URL || 'https://web-production-311da.up.railway.app';
    const r = await fetch(`${webUrl}/health`, { signal: AbortSignal.timeout(5000) });
    checks.webUp = r.ok;
  } catch { checks.webUp = false; }

  // n8n
  try {
    const n8nUrl = process.env.N8N_BASE_URL || 'https://primary-production-6c6f5.up.railway.app';
    const r = await fetch(`${n8nUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
    checks.n8nUp = r.ok;
  } catch { checks.n8nUp = false; }

  // Database
  const dbStart = Date.now();
  try {
    await pool.query('SELECT 1');
    checks.dbResponseMs = Date.now() - dbStart;
    checks.dbHealthy = (Date.now() - dbStart) < 500;
  } catch { checks.dbHealthy = false; checks.dbResponseMs = -1; }

  checks.metaTokenSet = !!(process.env.META_ACCESS_TOKEN || process.env.META_ADS_TOKEN);
  checks.whatsappConfigured = !!process.env.WHATSAPP_PHONE_NUMBER_ID;

  let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
  if (!checks.webUp) status = 'CRITICAL';
  else if (!checks.n8nUp || !checks.metaTokenSet) status = 'WARNING';

  return { status, metrics: checks };
}

async function checkCronJobs(): Promise<CronJobStatus[]> {
  try {
    const validNames = Object.keys(CRON_WINDOWS);
    const r = await pool.query(`
      SELECT DISTINCT ON (job_name) job_name, status, started_at, completed_at, duration_ms, records_processed
      FROM cron_job_logs
      WHERE job_name = ANY($1)
      ORDER BY job_name, started_at DESC
    `, [validNames]);

    return (r.rows as Array<Record<string, unknown>>).map(row => {
      const name = row.job_name as string;
      const windowMin = CRON_WINDOWS[name] ?? 1500;
      const lastRun = row.completed_at ? new Date(row.completed_at as string) : null;
      const minutesSince = lastRun ? (Date.now() - lastRun.getTime()) / 60000 : 9999;
      const healthy = row.status === 'success' && minutesSince < windowMin * 2;

      return {
        name,
        lastRun: lastRun?.toISOString() ?? null,
        status: row.status as string,
        durationMs: row.duration_ms as number | null,
        recordsProcessed: (row.records_processed as number) ?? 0,
        healthy,
      };
    });
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Critical alerts (rate-limited)
// ---------------------------------------------------------------------------
export async function sendCriticalAlerts(report: SystemHealthReport): Promise<void> {
  if (report.overallScore < 50 && canAlert('low_score')) {
    await sendSlackDM(SLACK_JATIN,
      `🚨 *SYSTEM ALERT*: Overall health score is ${report.overallScore}/100. Check /crm/intelligence immediately.`,
    ).catch(() => {});
  }

  if (report.infrastructure.status === 'CRITICAL' && canAlert('infra_down')) {
    await sendSlackDM(SLACK_JATIN,
      `🔴 *CRITICAL*: Infrastructure issue detected. Check Railway dashboard.`,
    ).catch(() => {});
  }

  const stuck = report.outreach.metrics.stuck as number ?? 0;
  if (stuck > 0 && canAlert('enrichment_stuck')) {
    await sendSlackDM(SLACK_JATIN,
      `⚠️ *OUTREACH STUCK*: ${stuck} leads stuck in Enriching >1h. Auto-reset triggered.`,
    ).catch(() => {});
  }

  const failedCrons = report.cronJobs.filter(c => !c.healthy);
  for (const cron of failedCrons.slice(0, 3)) {
    if (canAlert(`cron_${cron.name}`)) {
      await sendSlackDM(SLACK_JATIN,
        `⏰ *CRON OVERDUE*: ${cron.name} last ran ${cron.lastRun ?? 'never'}. Check worker logs.`,
      ).catch(() => {});
    }
  }
}
