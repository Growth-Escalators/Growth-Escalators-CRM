import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackDM } from './slackService';
import { SLACK_JATIN, DEFAULT_TENANT_SLUG } from '../config/constants';
import { isPaused } from '../config/featureFlags';
import { resolveDefaultSeoTenantId } from './seoTenantContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type SubsystemStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'PAUSED';

export interface SubsystemHealth {
  status: SubsystemStatus;
  metrics: Record<string, unknown>;
}

export interface CronJobStatus {
  name: string;
  lastRun: string | null;
  status: string;
  durationMs: number | null;
  recordsProcessed: number;
  healthy: boolean;
  errorMessage: string | null;
}

export interface SystemHealthReport {
  overallScore: number;
  seo: SubsystemHealth;
  crm: SubsystemHealth;
  // GE-global platform/ops concerns (third-party credential health, n8n
  // reachability, cron scheduler health). A non-GE tenant doesn't own these
  // credentials or crons, so these keys are omitted from the response
  // entirely for them — see checkAllSystems()'s isGeOwnTenant branch below.
  infrastructure?: SubsystemHealth;
  cronJobs?: CronJobStatus[];
  checkedAt: string;
  // 'full' = GE's own platform-ops view (infra + cron included).
  // 'tenant' = a reseller's own workspace view (tenant-scoped subsystems only).
  scope: 'full' | 'tenant';
}

// ---------------------------------------------------------------------------
// GE-tenant-only gate — same invariant as canSendWhatsApp() in
// routes/inbox.ts and canSendGrowthOSWhatsApp() in services/whatsappSendGuard.ts:
// System Health's platform-global subsystems (infra/third-party-credential
// health, cron scheduler health) describe GE's own operational stack, not
// anything a reseller tenant owns or configured. checkAllSystems() below
// uses this to decide whether to include those subsystems at all.
// ---------------------------------------------------------------------------
let _geTenantIdPromise: Promise<string | null> | null = null;
async function resolveGeTenantId(): Promise<string | null> {
  if (!_geTenantIdPromise) {
    _geTenantIdPromise = pool.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [DEFAULT_TENANT_SLUG])
      .then(r => (r.rows[0] as { id?: string } | undefined)?.id ?? null)
      .catch(() => null);
  }
  const id = await _geTenantIdPromise;
  if (!id) _geTenantIdPromise = null; // allow retry on next call if the lookup failed
  return id;
}

/** Fail-closed: a null/undefined tenant id (never GE) is not GE's own tenant. */
export async function isGeOwnTenant(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  const geTenantId = await resolveGeTenantId();
  return geTenantId !== null && tenantId === geTenantId;
}

// Test-only escape hatch — lets tests reset the memoized GE tenant id between cases.
export function __resetGeTenantCacheForTests(): void {
  _geTenantIdPromise = null;
}

// Cron expected windows in minutes.
// ONLY currently-scheduled, non-paused jobs go here. Paused jobs (see featureFlags.ts)
// are excluded so the System Health page shows what's actually running.
const CRON_WINDOWS: Record<string, number> = {
  // Daily digests
  'Morning Briefing': 1500, 'Evening Summary': 1500,
  // Finance
  'Overdue Invoice Check': 1500,
  // Intelligence & reporting
  'Meta Ads Daily Report': 1500, 'Meta Token Check': 10080,
  'Monthly Client Benchmarks': 44640,
  // Ops
  'Audit Booking Follow-up': 360, 'Weekly Data Cleanup': 10080,
  'Pipeline Placement': 1,
  'System Health Check': 60, 'Late Attendance Check': 1500,
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

// A cron whose per-item loop fails on SOME items (e.g. 30 of 50 Slack DMs
// failed) previously still called logCronSuccess — the run shows green in
// cron_job_logs and never alerts, even though roughly two-thirds of the
// work silently didn't happen. Distinct from logCronFailure (the whole run
// threw) — this is "the run completed but wasn't fully successful."
export async function logCronPartial(logId: number, durationMs: number, recordsProcessed: number, errorSummary: string): Promise<void> {
  await pool.query(
    `UPDATE cron_job_logs SET status='partial', completed_at=NOW(), duration_ms=$1, records_processed=$2, error_message=$3 WHERE id=$4`,
    [durationMs, recordsProcessed, errorSummary.slice(0, 500), logId],
  ).catch(() => {});
}

export async function logCronFailure(logId: number, durationMs: number, error: string): Promise<void> {
  await pool.query(
    `UPDATE cron_job_logs SET status='failed', completed_at=NOW(), duration_ms=$1, error_message=$2 WHERE id=$3`,
    [durationMs, error.slice(0, 500), logId],
  ).catch(() => {});
}

// ---------------------------------------------------------------------------
// Score helper — earned/earnable across a set of weighted subsystems,
// normalised to `totalOutOf`. PAUSED subsystems are excluded from the
// average (both earned and earnable) so a paused SEO doesn't drag the score
// down and trigger a low_score alert.
// ---------------------------------------------------------------------------
function scoreFromWeights(weights: Array<{ status: SubsystemStatus; full: number }>, totalOutOf: number): number {
  const earnable = weights.filter(w => w.status !== 'PAUSED').reduce((s, w) => s + w.full, 0);
  let earned = 0;
  for (const w of weights) {
    if (w.status === 'HEALTHY') earned += w.full;
    else if (w.status === 'WARNING') earned += Math.round(w.full / 2);
    // PAUSED and CRITICAL contribute 0 — PAUSED is also subtracted from earnable
  }
  return earnable > 0 ? Math.round((earned / earnable) * totalOutOf) : totalOutOf;
}

// ---------------------------------------------------------------------------
// Main health check
//
// tenantId is the CALLING tenant's own id (from req.user.tenantId), not a
// filter chosen by the caller. Every tenant-scoped subsystem below reports
// on that tenant's own data. When tenantId resolves to GE's own tenant (or
// is omitted entirely — internal callers with no request context, e.g. the
// worker.ts cron and intelligenceDelivery.ts), the platform-global
// subsystems (infra, cron scheduler) are included too, same as before this
// tenant param existed. For any other tenant, those keys are left off the
// response entirely — a reseller doesn't own GE's n8n instance, Brevo/
// Cashfree/Cal.com credentials, or cron schedule, so there is nothing
// legitimate to show them there.
// ---------------------------------------------------------------------------
export async function checkAllSystems(tenantId?: string): Promise<SystemHealthReport> {
  const isGe = tenantId === undefined ? true : await isGeOwnTenant(tenantId);

  if (!isGe) {
    const [seo, crm] = await Promise.all([
      checkSeo(tenantId).catch(() => ({ status: 'WARNING' as const, metrics: { error: 'check failed' } })),
      checkCrm(tenantId).catch(() => ({ status: 'HEALTHY' as const, metrics: { error: 'check failed' } })),
    ]);
    const overallScore = scoreFromWeights([
      { status: seo.status, full: 55 },
      { status: crm.status, full: 45 },
    ], 100);
    return { overallScore, seo, crm, checkedAt: new Date().toISOString(), scope: 'tenant' };
  }

  // Full/platform view — GE's own tenant, or an internal caller with no
  // request context at all (tenantId undefined). CRM/SEO still scope to a
  // concrete tenant id (GE's own, resolved below) rather than querying
  // across every tenant, so GE's own ops numbers aren't diluted by reseller
  // data now that this table is multi-tenant.
  const crmSeoTenantId = tenantId ?? (await resolveGeTenantId().catch(() => null)) ?? undefined;

  const [seo, crm, infra, cronJobs] = await Promise.all([
    checkSeo(crmSeoTenantId).catch(() => ({ status: 'WARNING' as const, metrics: { error: 'check failed' } })),
    checkCrm(crmSeoTenantId).catch(() => ({ status: 'HEALTHY' as const, metrics: { error: 'check failed' } })),
    checkInfrastructure().catch(() => ({ status: 'CRITICAL' as const, metrics: { error: 'check failed' } })),
    checkCronJobs().catch(() => []),
  ]);

  // Score weights — rebalanced 2026-08 (Outreach subsystem removed):
  // infra/seo/crm scaled up from 30/20/15 (out of 85) to 40/25/20 (still out
  // of 85) to keep the same relative weighting after dropping the fourth
  // subsystem.
  const weights: Array<{ status: SubsystemStatus; full: number }> = [
    { status: infra.status, full: 40 },
    { status: seo.status,   full: 25 },
    { status: crm.status,   full: 20 },
  ];
  // Normalise so the subsystem portion is out of 85 (cron portion is +15 below)
  const subsystemScore = scoreFromWeights(weights, 85);

  const cronHealthy = cronJobs.filter(c => c.healthy).length;
  const cronTotal = Math.max(cronJobs.length, 1);
  const cronScore = Math.round((cronHealthy / cronTotal) * 15);

  let score = subsystemScore + cronScore;
  if (infra.status === 'CRITICAL') score = Math.min(score, 29);

  return { overallScore: score, seo, crm, infrastructure: infra, cronJobs, checkedAt: new Date().toISOString(), scope: 'full' };
}

// ---------------------------------------------------------------------------
// Subsystem checks
// ---------------------------------------------------------------------------
// tenantId: the tenant whose own SEO data to report on. Falls back to
// resolveDefaultSeoTenantId() (today's single SEO-feature-enabled tenant,
// i.e. GE) only when no tenantId is available at all — preserves the
// pre-existing behaviour for internal callers with no request context.
async function checkSeo(tenantId?: string): Promise<SubsystemHealth> {
  if (isPaused('seo')) {
    return { status: 'PAUSED', metrics: { paused: true } };
  }

  let recentMetrics = 0;
  let recentRankings = 0;

  try {
    const seoTenantId = tenantId ?? await resolveDefaultSeoTenantId();
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM seo_weekly_metrics WHERE week_start_date >= CURRENT_DATE - 14 AND tenant_id = $1) AS recent_metrics,
        (SELECT COUNT(*)::int FROM keyword_rankings WHERE checked_at >= NOW() - INTERVAL '48 hours' AND tenant_id = $1) AS recent_rankings
    `, [seoTenantId]);
    const m = r.rows[0] as Record<string, string>;
    recentMetrics = parseInt(m.recent_metrics ?? '0');
    recentRankings = parseInt(m.recent_rankings ?? '0');
  } catch (e) {
    return {
      status: 'WARNING',
      metrics: {
        recentMetrics: 0,
        recentRankings: 0,
        error: e instanceof Error ? e.message : 'SEO tables query failed',
      },
    };
  }

  let status: SubsystemStatus = 'HEALTHY';
  if (recentMetrics === 0 && recentRankings === 0) status = 'CRITICAL';
  else if (recentMetrics === 0 || recentRankings === 0) status = 'WARNING';

  return { status, metrics: { recentMetrics, recentRankings } };
}

// tenantId: scopes every count to that tenant's own contacts/deals/invoices.
// Left optional only so a resolution failure upstream degrades to the
// subsystem-level catch() in checkAllSystems rather than throwing — every
// real caller always has a concrete tenant id to pass in.
async function checkCrm(tenantId?: string): Promise<SubsystemHealth> {
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM contacts WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE) AS contacts_today,
      (SELECT COUNT(*)::int FROM deals WHERE tenant_id = $1 AND stage NOT IN ('won', 'lost', 'Won', 'Lost')) AS deals_active,
      (SELECT COALESCE(SUM(deal_value), 0)::bigint FROM deals WHERE tenant_id = $1 AND stage NOT IN ('won', 'lost', 'Won', 'Lost')) AS pipeline_value,
      (SELECT COUNT(*)::int FROM invoices WHERE tenant_id = $1 AND status = 'overdue') AS invoices_overdue
  `, [tenantId]);
  const m = r.rows[0] as Record<string, string>;
  const overdueCount = parseInt(m.invoices_overdue ?? '0');
  let status: SubsystemStatus = 'HEALTHY';
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

  // n8n — check /healthz AND DB connectivity via API
  if (!process.env.N8N_API_KEY) {
    checks.n8nUp = null; // Not configured — don't alarm
  } else {
    try {
      const n8nUrl = process.env.N8N_BASE_URL || 'https://primary-production-6c6f5.up.railway.app';
      const r = await fetch(`${n8nUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
      checks.n8nUp = r.ok;

      if (r.ok) {
        const apiKey = process.env.N8N_API_KEY;
        if (apiKey) {
          try {
            const dbCheck = await fetch(`${n8nUrl}/api/v1/workflows?limit=1`, {
              headers: { 'X-N8N-API-KEY': apiKey },
              signal: AbortSignal.timeout(5000),
            });
            checks.n8nDbHealthy = dbCheck.ok;
            if (!dbCheck.ok) checks.n8nUp = false;
          } catch {
            checks.n8nDbHealthy = false;
            checks.n8nUp = false;
          }
        }
      }
    } catch { checks.n8nUp = false; }
  }

  // Database
  const dbStart = Date.now();
  try {
    await pool.query('SELECT 1');
    checks.dbResponseMs = Date.now() - dbStart;
    checks.dbHealthy = (Date.now() - dbStart) < 2000;
  } catch { checks.dbHealthy = false; checks.dbResponseMs = -1; }

  checks.metaTokenSet = !!(process.env.META_ACCESS_TOKEN || process.env.META_ADS_TOKEN);
  checks.whatsappConfigured = !!process.env.WHATSAPP_PHONE_NUMBER_ID;

  let status: SubsystemStatus = 'HEALTHY';
  if (!checks.webUp) status = 'CRITICAL';
  else if ((checks.n8nUp !== null && !checks.n8nUp) || !checks.metaTokenSet) status = 'WARNING';

  return { status, metrics: checks };
}

async function checkCronJobs(): Promise<CronJobStatus[]> {
  try {
    const validNames = Object.keys(CRON_WINDOWS);
    const r = await pool.query(`
      SELECT DISTINCT ON (job_name) job_name, status, started_at, completed_at, duration_ms, records_processed, error_message
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
        errorMessage: (row.error_message as string | null) ?? null,
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
      `🚨 *SYSTEM ALERT*: Overall health score is ${report.overallScore}/100. Check /intelligence immediately.`,
    ).catch(() => {});
  }

  if (report.infrastructure?.status === 'CRITICAL' && canAlert('infra_down')) {
    await sendSlackDM(SLACK_JATIN,
      `🔴 *CRITICAL*: Infrastructure issue detected. Check Railway dashboard.`,
    ).catch(() => {});
  }

  const failedCrons = (report.cronJobs ?? []).filter(c => !c.healthy);
  for (const cron of failedCrons.slice(0, 3)) {
    if (canAlert(`cron_${cron.name}`)) {
      await sendSlackDM(SLACK_JATIN,
        `⏰ *CRON OVERDUE*: ${cron.name} last ran ${cron.lastRun ?? 'never'}. Check worker logs.`,
      ).catch(() => {});
    }
  }
}
