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

  const triggeredBy = (req as Request & { user?: { id: string } }).user?.id ?? 'manual';
  const startedAt = new Date();

  try {
    const webhookUrl = `${N8N_BASE}/webhook/${workflowPath}`;
    const triggerRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggered_by: triggeredBy, triggered_at: startedAt.toISOString() }),
    });

    const status = triggerRes.ok ? 'triggered' : 'error';

    // Capture executionId from n8n response (if available)
    let executionId: string | null = null;
    try {
      const responseBody = await triggerRes.json() as { executionId?: string };
      executionId = responseBody.executionId ?? null;
    } catch { /* n8n may return non-JSON */ }

    await pool.query(
      `INSERT INTO seo_workflow_logs (workflow_id, workflow_name, status, started_at, triggered_by, execution_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [wf.id, wf.name, status, startedAt, triggeredBy, executionId],
    );

    logger.info(`[seo-workflows] triggered ${wf.name} → ${triggerRes.status}${executionId ? ` (exec: ${executionId})` : ''}`);
    res.json({ triggered: triggerRes.ok, workflow: wf.name, at: startedAt.toISOString(), httpStatus: triggerRes.status, executionId });
  } catch (e) {
    logger.error('[seo-workflows] trigger error:', e);
    await pool.query(
      `INSERT INTO seo_workflow_logs (workflow_id, workflow_name, status, started_at, triggered_by, error_message)
       VALUES ($1, $2, 'error', $3, $4, $5)`,
      [wf.id, wf.name, startedAt, triggeredBy, String(e)],
    ).catch(() => {});
    res.status(500).json({ error: 'Failed to trigger workflow' });
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

// POST /api/seo-workflows/trigger-all
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
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch {
      results.push({ name: wf.name, ok: false });
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  logger.info(`[seo-workflows] trigger-all: ${succeeded}/${results.length} succeeded`);
  res.json({ triggered: results.length, succeeded, results });
});

export default router;
