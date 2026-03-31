import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import logger from '../utils/logger';

const router = Router();

const N8N_BASE = 'https://primary-production-6c6f5.up.railway.app';

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
// GET /api/seo/overview — summary across all clients
// ---------------------------------------------------------------------------
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT
        client_domain,
        client_name,
        MAX(week_start)          AS last_updated,
        SUM(total_clicks)        AS total_clicks,
        SUM(total_impressions)   AS total_impressions,
        ROUND(AVG(avg_position)::numeric, 1) AS avg_position,
        SUM(total_sessions)      AS total_sessions
      FROM seo_weekly_metrics
      GROUP BY client_domain, client_name
      ORDER BY total_clicks DESC
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
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  try {
    const webhookUrl = `${N8N_BASE}/webhook/mtrig-seo${workflow.num}`;
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

export default router;
