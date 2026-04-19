import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';
import {
  SEO_WORKFLOWS,
  ensureSeoWorkflowLogsTable,
  checkWorkflowHealth,
} from '../services/seoWorkflowHealthService';

const router = Router();

const N8N_BASE = process.env.N8N_BASE_URL ?? 'https://primary-production-6c6f5.up.railway.app';

// Ensure table exists at startup
ensureSeoWorkflowLogsTable().catch(e => logger.error('[seo-workflows] table bootstrap failed:', e));

// ---------------------------------------------------------------------------
// GET /api/seo-workflows/status
// ---------------------------------------------------------------------------
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const data = await checkWorkflowHealth();
    res.json(data);
  } catch (e) {
    logger.error('[seo-workflows] status error:', e);
    res.status(500).json({ error: 'Failed to fetch workflow status' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo-workflows/trigger/:workflowPath
// ---------------------------------------------------------------------------
router.post('/trigger/:workflowPath', async (req: Request, res: Response) => {
  const { workflowPath } = req.params;
  const wf = SEO_WORKFLOWS.find(w => w.webhookPath === workflowPath);
  if (!wf) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }

  const startedAt = new Date();

  // Map webhook paths to backend-native services
  const BACKEND_SERVICES: Record<string, () => Promise<{ ok: boolean; detail: string }>> = {
    'mtrig-seo02': async () => { const { runSeoAlertChecks } = await import('../services/seoAlertService'); const r = await runSeoAlertChecks(); return { ok: true, detail: `${r.alerts} alerts` }; },
    'mtrig-seo05': async () => { const { runPageSpeedChecks } = await import('../services/pagespeedService'); const r = await runPageSpeedChecks(); return { ok: true, detail: `${r.checked} sites` }; },
    'mtrig-seo06': async () => { const { runRankChecks } = await import('../services/rankTrackingService'); const r = await runRankChecks(); return { ok: true, detail: `${r.checked} keywords` }; },
    'mtrig-seo08': async () => { const { runBacklinkCheck } = await import('../services/seoBacklinkService'); const r = await runBacklinkCheck(); return { ok: true, detail: `${r.found} new` }; },
    'mtrig-seo11': async () => { const { runContentDecayDetection } = await import('../services/seoContentDecayService'); const r = await runContentDecayDetection(); return { ok: true, detail: `${r.opportunities} opportunities` }; },
    'mtrig-seo12': async () => { const { sendWeeklyOpportunityDigest } = await import('../services/seoDigestService'); const r = await sendWeeklyOpportunityDigest(); return { ok: r.sent, detail: r.sent ? 'Sent' : 'Failed' }; },
  };

  try {
    const backendService = BACKEND_SERVICES[workflowPath as string];
    if (backendService) {
      // Run backend-native service directly
      const result = await backendService();

      await pool.query(
        `INSERT INTO seo_workflow_logs (workflow_id, workflow_name, status, started_at, triggered_by, records_processed)
         VALUES ($1, $2, $3, $4, 'manual', 0)`,
        [wf.id, wf.name, result.ok ? 'success' : 'error', startedAt],
      );

      logger.info(`[seo-workflows] ran ${wf.name} (backend-native) → ${result.detail}`);
      res.json({ triggered: result.ok, workflow: wf.name, at: startedAt.toISOString(), method: 'backend', detail: result.detail });
    } else {
      // Fallback to n8n webhook for workflows without backend implementation
      const webhookUrl = `${N8N_BASE}/webhook/${workflowPath}`;
      const triggerRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: 'manual', triggered_at: startedAt.toISOString() }),
        signal: AbortSignal.timeout(10000),
      });

      await pool.query(
        `INSERT INTO seo_workflow_logs (workflow_id, workflow_name, status, started_at, triggered_by)
         VALUES ($1, $2, $3, $4, 'manual')`,
        [wf.id, wf.name, triggerRes.ok ? 'triggered' : 'error', startedAt],
      );

      res.json({ triggered: triggerRes.ok, workflow: wf.name, at: startedAt.toISOString(), method: 'n8n', httpStatus: triggerRes.status });
    }
  } catch (e) {
    logger.error('[seo-workflows] trigger error:', e);
    await pool.query(
      `INSERT INTO seo_workflow_logs (workflow_id, workflow_name, status, started_at, triggered_by, error_message)
       VALUES ($1, $2, 'error', $3, 'manual', $4)`,
      [wf.id, wf.name, startedAt, String(e)],
    ).catch(() => {});
    res.status(500).json({ error: 'Failed to run workflow' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo-workflows/logs
// ---------------------------------------------------------------------------
router.get('/logs', async (req: Request, res: Response) => {
  const { workflowId } = req.query;
  try {
    const result = workflowId
      ? await pool.query(
          `SELECT * FROM seo_workflow_logs WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [workflowId],
        )
      : await pool.query(
          `SELECT * FROM seo_workflow_logs ORDER BY created_at DESC LIMIT 50`,
        );
    res.json({ logs: result.rows });
  } catch (e) {
    logger.error('[seo-workflows] logs error:', e);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo-workflows/content-decay-stats
// Lightweight stats for the Content Decay admin card
// ---------------------------------------------------------------------------
router.get('/content-decay-stats', async (_req: Request, res: Response) => {
  try {
    const [openQ, recentRowsQ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS count FROM seo_opportunities
         WHERE opportunity_type IN ('content_decay', 'lost_ranking') AND status = 'open'`,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM keyword_rankings
         WHERE recorded_date >= CURRENT_DATE - INTERVAL '10 days'`,
      ),
    ]);
    res.json({
      openOpportunities: Number(openQ.rows[0].count),
      keywordRankingsLast10d: Number(recentRowsQ.rows[0].count),
    });
  } catch (e) {
    logger.error('[seo-workflows] content-decay-stats error:', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo-workflows/rank-tracking-stats
// Lightweight stats for the Rank Tracking admin card
// ---------------------------------------------------------------------------
router.get('/rank-tracking-stats', async (_req: Request, res: Response) => {
  try {
    const [totalQ, recentQ, dropsQ] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT keyword)::int AS keywords FROM keyword_rankings`),
      pool.query(`SELECT COUNT(*)::int AS count FROM keyword_rankings WHERE recorded_date >= CURRENT_DATE - INTERVAL '7 days'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM keyword_rankings WHERE position_change < -5 AND recorded_date >= CURRENT_DATE - INTERVAL '7 days'`),
    ]);
    res.json({
      totalKeywords: Number(totalQ.rows[0].keywords),
      checksLast7d: Number(recentQ.rows[0].count),
      dropsDetected: Number(dropsQ.rows[0].count),
    });
  } catch (e) {
    logger.error('[seo-workflows] rank-tracking-stats error:', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo-workflows/backlinks-stats
// Lightweight stats for the Backlink Monitor admin card
// ---------------------------------------------------------------------------
router.get('/backlinks-stats', async (_req: Request, res: Response) => {
  try {
    const [totalQ, last7Q, lastAtQ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM backlink_data WHERE status = 'active'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM backlink_data WHERE first_seen >= NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT MAX(first_seen) AS last_at FROM backlink_data`),
    ]);
    res.json({
      totalBacklinks: Number(totalQ.rows[0].count),
      newLast7d: Number(last7Q.rows[0].count),
      lastDiscoveredAt: lastAtQ.rows[0].last_at ?? null,
    });
  } catch (e) {
    logger.error('[seo-workflows] backlinks-stats error:', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo-workflows/digest-stats
// Lightweight stats for the Weekly Digest admin card —
// shows what the next digest WOULD contain if it ran right now.
// ---------------------------------------------------------------------------
router.get('/digest-stats', async (_req: Request, res: Response) => {
  try {
    const [oppsQ, alertsQ, rankingsQ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM seo_opportunities WHERE status = 'open'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM seo_alerts_log WHERE created_at > NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM keyword_rankings WHERE recorded_date >= CURRENT_DATE - INTERVAL '10 days'`),
    ]);
    res.json({
      openOpportunities: Number(oppsQ.rows[0].count),
      recentAlerts: Number(alertsQ.rows[0].count),
      keywordRankingsLast10d: Number(rankingsQ.rows[0].count),
    });
  } catch (e) {
    logger.error('[seo-workflows] digest-stats error:', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo-workflows/data-health
// ---------------------------------------------------------------------------
router.get('/data-health', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      const [wm, kr, sh, al, op, bd, cg] = await Promise.all([
        client.query(`SELECT COUNT(*) AS count, MAX(week_start) AS last_entry, COUNT(DISTINCT client_domain) AS clients FROM seo_weekly_metrics`),
        client.query(`SELECT COUNT(*) AS count, MAX(checked_at) AS last_entry, COUNT(DISTINCT keyword) AS keywords FROM keyword_rankings`),
        client.query(`SELECT COUNT(*) AS count, MAX(checked_at) AS last_entry FROM site_health_metrics`),
        client.query(`SELECT COUNT(*) AS count, MAX(created_at) AS last_entry FROM seo_alerts_log`),
        client.query(`
          SELECT COUNT(*) AS count,
            COUNT(*) FILTER (WHERE status = 'open')   AS open,
            COUNT(*) FILTER (WHERE status = 'closed') AS closed
          FROM seo_opportunities
        `),
        client.query(`SELECT COUNT(*) AS count, MAX(checked_at) AS last_entry FROM backlink_data`),
        client.query(`SELECT COUNT(*) AS count, MAX(created_at) AS last_entry FROM content_gap_analysis`),
      ]);

      res.json({
        seo_weekly_metrics:   { count: Number(wm.rows[0].count), lastEntry: wm.rows[0].last_entry, clients: Number(wm.rows[0].clients) },
        keyword_rankings:     { count: Number(kr.rows[0].count), lastEntry: kr.rows[0].last_entry, keywords: Number(kr.rows[0].keywords) },
        site_health_metrics:  { count: Number(sh.rows[0].count), lastEntry: sh.rows[0].last_entry },
        seo_alerts_log:       { count: Number(al.rows[0].count), lastEntry: al.rows[0].last_entry },
        seo_opportunities:    { count: Number(op.rows[0].count), open: Number(op.rows[0].open), closed: Number(op.rows[0].closed) },
        backlink_data:        { count: Number(bd.rows[0].count), lastEntry: bd.rows[0].last_entry },
        content_gap_analysis: { count: Number(cg.rows[0].count), lastEntry: cg.rows[0].last_entry },
      });
    } finally {
      client.release();
    }
  } catch (e) {
    logger.error('[seo-workflows] data-health error:', e);
    res.status(500).json({ error: 'Failed to fetch data health' });
  }
});

// POST /api/seo-workflows/trigger-all — runs backend-native services directly
router.post('/trigger-all', async (_req: Request, res: Response) => {
  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // 1. Rank Tracking (Serper.dev)
  try {
    const { runRankChecks } = await import('../services/rankTrackingService');
    const r = await runRankChecks();
    results.push({ name: 'Rank Tracking', ok: true, detail: `${r.checked} keywords, ${r.errors} errors` });
  } catch (e) {
    results.push({ name: 'Rank Tracking', ok: false, detail: String(e) });
  }

  // 2. PageSpeed Monitor
  try {
    const { runPageSpeedChecks } = await import('../services/pagespeedService');
    const r = await runPageSpeedChecks();
    results.push({ name: 'PageSpeed Monitor', ok: true, detail: `${r.checked} sites, ${r.errors} errors` });
  } catch (e) {
    results.push({ name: 'PageSpeed Monitor', ok: false, detail: String(e) });
  }

  // 3. Alert Triggers
  try {
    const { runSeoAlertChecks } = await import('../services/seoAlertService');
    const r = await runSeoAlertChecks();
    results.push({ name: 'Alert Triggers', ok: true, detail: `${r.alerts} alerts` });
  } catch (e) {
    results.push({ name: 'Alert Triggers', ok: false, detail: String(e) });
  }

  // 4. Backlink Monitor
  try {
    const { runBacklinkCheck } = await import('../services/seoBacklinkService');
    const r = await runBacklinkCheck();
    results.push({ name: 'Backlink Monitor', ok: true, detail: `${r.found} new, ${r.errors} errors` });
  } catch (e) {
    results.push({ name: 'Backlink Monitor', ok: false, detail: String(e) });
  }

  // 5. Content Decay Detection
  try {
    const { runContentDecayDetection } = await import('../services/seoContentDecayService');
    const r = await runContentDecayDetection();
    results.push({ name: 'Content Decay', ok: true, detail: `${r.opportunities} opportunities` });
  } catch (e) {
    results.push({ name: 'Content Decay', ok: false, detail: String(e) });
  }

  // 6. Weekly Digest (Slack)
  try {
    const { sendWeeklyOpportunityDigest } = await import('../services/seoDigestService');
    const r = await sendWeeklyOpportunityDigest();
    results.push({ name: 'Weekly Digest', ok: r.sent, detail: r.sent ? 'Sent to Slack' : 'Failed to send' });
  } catch (e) {
    results.push({ name: 'Weekly Digest', ok: false, detail: String(e) });
  }

  const succeeded = results.filter(r => r.ok).length;
  logger.info(`[seo-workflows] run-all: ${succeeded}/${results.length} succeeded`);
  res.json({ triggered: results.length, succeeded, results });
});

// POST /api/seo-workflows/run/:service — run a specific backend service
router.post('/run/:service', async (req: Request, res: Response) => {
  const { service } = req.params;

  const startedAt = new Date();
  const log = async (workflowId: string, workflowName: string, status: 'success' | 'error', records?: number, errMsg?: string) => {
    try {
      const { logSeoWorkflowRun } = await import('../services/seoWorkflowHealthService');
      await logSeoWorkflowRun({ workflowId, workflowName, status, startedAt, triggeredBy: 'manual', recordsProcessed: records, errorMessage: errMsg });
    } catch { /* logging non-critical */ }
  };

  try {
    switch (service) {
      case 'rank-tracking': {
        const { runRankChecks } = await import('../services/rankTrackingService');
        const r = await runRankChecks();
        await log('BwO187curjMMA60i', 'Rank Tracking', 'success', r.checked);
        res.json({ ok: true, service, detail: `${r.checked} keywords, ${r.errors} errors` });
        return;
      }
      case 'pagespeed': {
        const { runPageSpeedChecks } = await import('../services/pagespeedService');
        const r = await runPageSpeedChecks();
        await log('z21W6MDWBF0dukkT', 'PageSpeed Monitor', 'success', r.checked);
        res.json({ ok: true, service, detail: `${r.checked} sites, ${r.errors} errors` });
        return;
      }
      case 'alerts': {
        const { runSeoAlertChecks } = await import('../services/seoAlertService');
        const r = await runSeoAlertChecks();
        await log('5FVX2kEjuD7vWD0e', 'Alert Triggers', 'success', r.alerts);
        res.json({ ok: true, service, detail: `${r.alerts} alerts` });
        return;
      }
      case 'backlinks': {
        const { runBacklinkCheck } = await import('../services/seoBacklinkService');
        const r = await runBacklinkCheck();
        await log('19R3BStSY2S1N9H1', 'Backlink Monitor', 'success', r.found);
        res.json({ ok: true, service, detail: `${r.found} new, ${r.errors} errors` });
        return;
      }
      case 'content-decay': {
        const { runContentDecayDetection } = await import('../services/seoContentDecayService');
        const r = await runContentDecayDetection();
        await log('Ss2Bfps5lXBWUUs4', 'Content Decay Detection', 'success', r.opportunities);
        res.json({ ok: true, service, detail: `${r.opportunities} opportunities` });
        return;
      }
      case 'digest': {
        const { sendWeeklyOpportunityDigest } = await import('../services/seoDigestService');
        const r = await sendWeeklyOpportunityDigest();
        await log('M4rbRZL5jh0jJHku', 'Weekly Opportunity Digest', r.sent ? 'success' : 'error');
        res.json({ ok: r.sent, service, detail: r.sent ? 'Sent to Slack' : 'Failed' });
        return;
      }
      default:
        res.status(404).json({ error: `Unknown service: ${service}. Valid: rank-tracking, pagespeed, alerts, backlinks, content-decay, digest` });
    }
  } catch (e) {
    logger.error(`[seo-workflows] run ${service} error:`, e);
    res.status(500).json({ ok: false, service, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
