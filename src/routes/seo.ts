import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import logger from '../utils/logger';
import { SEO_WORKFLOWS } from '../services/seoWorkflowHealthService';

const router = Router();

const N8N_BASE = process.env.N8N_BASE_URL || 'https://primary-production-6c6f5.up.railway.app';

const WORKFLOWS = [
  { id: 'YXmClFSKZB9DMkyu', name: 'GSC + GA4 Data Pull',          schedule: 'Monday 8AM IST',          num: 1  },
  { id: '5FVX2kEjuD7vWD0e', name: 'Alert Triggers',                schedule: 'Daily 9AM IST',            num: 2  },
  { id: 'as8HvuMPqAHhAdQ8', name: 'Weekly Insight Report',         schedule: 'Wednesday 10AM IST',       num: 3  },
  { id: 'CBzwkCqVgeQOxOQl', name: 'Content Publisher',             schedule: 'Manual',                   num: 4  },
  { id: 'z21W6MDWBF0dukkT', name: 'PageSpeed Monitor',             schedule: 'Sunday 7AM IST',           num: 5  },
  { id: 'BwO187curjMMA60i', name: 'Rank Tracking',                 schedule: 'Tuesday 9AM IST',          num: 6  },
  { id: 'Isz1ui9PkjsqBMb8', name: 'Content Gap Analysis',          schedule: 'Alt Wednesday 11AM IST',   num: 7  },
  { id: '19R3BStSY2S1N9H1', name: 'Backlink Monitor',              schedule: 'Friday 9AM IST',           num: 8  },
  { id: 'akTW1dgtKtCpcz3R', name: 'Internal Linking',              schedule: 'On publish',               num: 9  },
  { id: '8l9kEQlRVUbL4Ku6', name: 'Google Indexing Ping',          schedule: 'On publish',               num: 10 },
  { id: 'Ss2Bfps5lXBWUUs4', name: 'Content Decay Detection',       schedule: 'First Monday 9AM IST',     num: 11 },
  { id: 'M4rbRZL5jh0jJHku', name: 'Weekly Opportunity Digest',     schedule: 'Friday 5PM IST',           num: 12 },
];

// ---------------------------------------------------------------------------
// GET /api/seo/overview — summary across all clients with week-over-week trend
// ---------------------------------------------------------------------------
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    // Current week and previous week per client for WoW trend
    const result = await db.execute(sql`
      WITH ranked AS (
        SELECT
          client_domain,
          client_name,
          week_start,
          total_clicks,
          total_impressions,
          avg_position,
          total_sessions,
          ROW_NUMBER() OVER (PARTITION BY client_domain ORDER BY week_start DESC) AS rn
        FROM seo_weekly_metrics
      ),
      current_week AS (
        SELECT * FROM ranked WHERE rn = 1
      ),
      prev_week AS (
        SELECT * FROM ranked WHERE rn = 2
      )
      SELECT
        c.client_domain,
        c.client_name,
        c.week_start                    AS last_updated,
        c.total_clicks,
        c.total_impressions,
        ROUND(c.avg_position::numeric, 1) AS avg_position,
        c.total_sessions,
        CASE
          WHEN c.total_impressions > 0
          THEN ROUND((c.total_clicks::numeric / c.total_impressions * 100), 2)
          ELSE 0
        END AS avg_ctr,
        p.total_clicks                  AS prev_clicks,
        p.total_impressions             AS prev_impressions,
        ROUND(p.avg_position::numeric, 1) AS prev_position,
        p.total_sessions                AS prev_sessions,
        CASE
          WHEN p.total_impressions > 0
          THEN ROUND((p.total_clicks::numeric / p.total_impressions * 100), 2)
          ELSE 0
        END AS prev_ctr
      FROM current_week c
      LEFT JOIN prev_week p ON c.client_domain = p.client_domain
      ORDER BY c.total_clicks DESC
    `);
    res.json({ clients: result.rows });
  } catch (e) {
    logger.error('[seo] overview error:', e);
    res.status(500).json({ error: 'Failed to fetch SEO overview' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/client/:domain — full data for one client
// ---------------------------------------------------------------------------
router.get('/client/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  try {
    const [weekly, keywords, healthRes, alerts, opportunities, content, backlinks] = await Promise.all([
      db.execute(sql`
        SELECT * FROM seo_weekly_metrics
        WHERE client_domain = ${domain}
        ORDER BY week_start DESC LIMIT 12
      `),
      db.execute(sql`
        SELECT DISTINCT ON (keyword)
          keyword, position, previous_position,
          position - previous_position AS position_change,
          search_volume, url, checked_at
        FROM keyword_rankings
        WHERE client_domain = ${domain}
        ORDER BY keyword, checked_at DESC
      `),
      db.execute(sql`
        SELECT * FROM site_health_metrics
        WHERE client_domain = ${domain}
        ORDER BY checked_at DESC LIMIT 1
      `),
      db.execute(sql`
        SELECT * FROM seo_alerts_log
        WHERE client_domain = ${domain}
        ORDER BY created_at DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT * FROM seo_opportunities
        WHERE client_domain = ${domain} AND status = 'open'
        ORDER BY priority DESC, created_at DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT * FROM content_gap_analysis
        WHERE client_domain = ${domain}
        ORDER BY created_at DESC LIMIT 5
      `),
      db.execute(sql`
        SELECT * FROM backlink_data
        WHERE client_domain = ${domain}
        ORDER BY checked_at DESC LIMIT 1
      `),
    ]);

    res.json({
      weekly:        weekly.rows,
      keywords:      keywords.rows,
      health:        healthRes.rows[0] ?? null,
      alerts:        alerts.rows,
      opportunities: opportunities.rows,
      content:       content.rows,
      backlinks:     backlinks.rows[0] ?? null,
    });
  } catch (e) {
    logger.error('[seo] client detail error:', e);
    res.status(500).json({ error: 'Failed to fetch client SEO data' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/keywords/:domain — all keywords with position trend
// ---------------------------------------------------------------------------
router.get('/keywords/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  try {
    const result = await db.execute(sql`
      SELECT keyword, position, previous_position,
        position - previous_position AS change,
        search_volume, url, checked_at
      FROM keyword_rankings
      WHERE client_domain = ${domain}
      ORDER BY position ASC
    `);
    res.json({ keywords: result.rows });
  } catch (e) {
    logger.error('[seo] keywords error:', e);
    res.status(500).json({ error: 'Failed to fetch keywords' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/alerts — all recent alerts across all clients
// ---------------------------------------------------------------------------
router.get('/alerts', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT * FROM seo_alerts_log
      ORDER BY created_at DESC LIMIT 20
    `);
    res.json({ alerts: result.rows });
  } catch (e) {
    logger.error('[seo] alerts error:', e);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/workflows — list of all 12 n8n workflows
// ---------------------------------------------------------------------------
router.get('/workflows', async (_req: Request, res: Response) => {
  res.json({
    workflows: WORKFLOWS.map(w => ({
      id:          w.id,
      name:        w.name,
      schedule:    w.schedule,
      status:      'active',
      webhookPath: `/webhook/mtrig-seo${w.num}`,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /api/seo/trigger/:workflowId — manually fire a workflow
// ---------------------------------------------------------------------------
router.post('/trigger/:workflowId', async (req: Request, res: Response) => {
  const { workflowId } = req.params;
  const workflow = WORKFLOWS.find(w => w.id === workflowId);
  // Also look up the correct zero-padded webhook path from SEO_WORKFLOWS
  const seoWf = SEO_WORKFLOWS.find(w => w.id === workflowId);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  try {
    // Use the canonical webhookPath (e.g. 'mtrig-seo01') not the numeric shorthand
    const webhookPath = seoWf?.webhookPath ?? `mtrig-seo${String(workflow.num).padStart(2, '0')}`;
    const webhookUrl = `${N8N_BASE}/webhook/${webhookPath}`;
    const triggerRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triggered_by: (req as Request & { user?: { id: string } }).user?.id ?? 'manual',
        triggered_at: new Date().toISOString(),
      }),
    });
    logger.info(`[seo] triggered ${workflow.name} → ${triggerRes.status}`);
    res.json({ ok: triggerRes.ok, workflow: workflow.name, status: triggerRes.status });
  } catch (e) {
    logger.error('[seo] trigger error:', e);
    res.status(500).json({ error: 'Failed to trigger workflow' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/keywords-all — all keywords across all clients
// ---------------------------------------------------------------------------
router.get('/keywords-all', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT keyword, client_domain,
        current_position AS position,
        previous_position,
        (current_position - previous_position) AS change,
        search_volume,
        checked_at
      FROM keyword_rankings
      ORDER BY current_position ASC NULLS LAST
      LIMIT 200
    `);
    res.json({ keywords: result.rows });
  } catch (e) {
    logger.error('[seo] keywords-all error:', e);
    res.status(500).json({ error: 'Failed to fetch keywords' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo/generate-local-pages — programmatic SEO page generation
// ---------------------------------------------------------------------------
router.post('/generate-local-pages', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  try {
    const { generateLocationPages } = await import('../services/programmaticSeoService');
    const result = await generateLocationPages();
    res.json(result);
  } catch (e) {
    logger.error('[seo] generate-local-pages error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo/regenerate-pages — delete old pages and generate fresh ones
// ---------------------------------------------------------------------------
router.post('/regenerate-pages', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  try {
    const { pool } = await import('../db/index');
    // Delete old pages
    const del = await pool.query(`DELETE FROM client_pages WHERE client_domain = 'ageddentistry.org'`);
    logger.info(`[seo] Deleted ${del.rowCount} old pages`);

    // Generate new pages
    const { generateLocationPages } = await import('../services/programmaticSeoService');
    const result = await generateLocationPages();
    res.json({ ...result, oldPagesDeleted: del.rowCount });
  } catch (e) {
    logger.error('[seo] regenerate-pages error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo/publish-pending-pages — publish draft_local pages to WordPress
// ---------------------------------------------------------------------------
router.post('/publish-pending-pages', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  try {
    const { publishPendingToWordPress } = await import('../services/programmaticSeoService');
    const result = await publishPendingToWordPress();
    res.json(result);
  } catch (e) {
    logger.error('[seo] publish-pending error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/pages — list all generated pages
// ---------------------------------------------------------------------------
router.get('/pages', async (_req: Request, res: Response) => {
  try {
    const { pool } = await import('../db/index');
    const result = await pool.query(
      `SELECT * FROM client_pages ORDER BY created_at DESC LIMIT 100`,
    );
    res.json({ pages: result.rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
