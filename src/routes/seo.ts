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
          keyword, current_position AS position, previous_position,
          (current_position - previous_position) AS position_change,
          search_volume, url_ranking AS url, recorded_date AS checked_at
        FROM keyword_rankings
        WHERE client_domain = ${domain} OR project_name = ${domain}
        ORDER BY keyword, recorded_date DESC
      `),
      db.execute(sql`
        SELECT * FROM site_health_metrics
        WHERE client_domain = ${domain} OR project_name = ${domain}
        ORDER BY checked_at DESC LIMIT 1
      `),
      db.execute(sql`
        SELECT * FROM seo_alerts_log
        WHERE client_domain = ${domain} OR project_name = ${domain}
        ORDER BY created_at DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT * FROM seo_opportunities
        WHERE (client_domain = ${domain} OR project_name = ${domain}) AND status = 'open'
        ORDER BY priority_score DESC NULLS LAST, created_at DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT * FROM content_gap_analysis
        WHERE client_domain = ${domain} OR project_name = ${domain}
        ORDER BY analysed_at DESC LIMIT 5
      `),
      db.execute(sql`
        SELECT * FROM backlink_data
        WHERE client_domain = ${domain} OR project_name = ${domain}
        ORDER BY first_seen DESC NULLS LAST LIMIT 20
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
      SELECT keyword, current_position AS position, previous_position,
        (current_position - previous_position) AS change,
        search_volume, url_ranking AS url, recorded_date AS checked_at
      FROM keyword_rankings
      WHERE client_domain = ${domain} OR project_name = ${domain}
      ORDER BY current_position ASC NULLS LAST
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
      SELECT keyword, COALESCE(client_domain, project_name) AS client_domain,
        current_position AS position,
        previous_position,
        (current_position - previous_position) AS change,
        search_volume,
        recorded_date AS checked_at
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

// ---------------------------------------------------------------------------
// GET /api/seo/content-gaps — all content gaps across clients
// ---------------------------------------------------------------------------
router.get('/content-gaps', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT id, project_name, target_keyword, our_url, our_position,
             competitor_urls, topics_missing, questions_missing,
             word_count_gap, priority_score, status, analysed_at
      FROM content_gap_analysis
      ORDER BY priority_score DESC NULLS LAST, analysed_at DESC
      LIMIT 100
    `);
    res.json({ gaps: result.rows });
  } catch (e) {
    logger.error('[seo] content-gaps error:', e);
    res.status(500).json({ error: 'Failed to fetch content gaps' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/backlinks — all backlinks across clients
// ---------------------------------------------------------------------------
router.get('/backlinks', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT id, project_name, source_url, target_url,
             domain_authority, anchor_text, link_type,
             first_seen, last_seen, status
      FROM backlink_data
      WHERE status = 'active'
      ORDER BY domain_authority DESC NULLS LAST, first_seen DESC
      LIMIT 200
    `);
    res.json({ backlinks: result.rows });
  } catch (e) {
    logger.error('[seo] backlinks error:', e);
    res.status(500).json({ error: 'Failed to fetch backlinks' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo/generate-content — AI-optimized content generation
// ---------------------------------------------------------------------------
router.post('/generate-content', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  const { clientDomain, keyword, aiOptimized } = req.body as {
    clientDomain: string; keyword: string; aiOptimized?: boolean;
  };
  if (!clientDomain || !keyword) { res.status(400).json({ error: 'clientDomain and keyword required' }); return; }

  try {
    if (aiOptimized) {
      const { generateAIOptimizedContent } = await import('../services/contentGenerationService');
      const result = await generateAIOptimizedContent(clientDomain, keyword);
      res.json(result);
    } else {
      const { generateContentForClient } = await import('../services/contentGenerationService');
      const result = await generateContentForClient(clientDomain, keyword);
      res.json(result);
    }
  } catch (e) {
    logger.error('[seo] generate-content error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'Content generation failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo/analyze-visibility — AI visibility score for a URL
// ---------------------------------------------------------------------------
router.post('/analyze-visibility', async (req: Request, res: Response) => {
  const { url } = req.body as { url: string };
  if (!url) { res.status(400).json({ error: 'url required' }); return; }

  try {
    const { analyzeAIVisibility } = await import('../services/aiVisibilityService');
    const result = await analyzeAIVisibility(url);
    res.json(result);
  } catch (e) {
    logger.error('[seo] analyze-visibility error:', e);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo/competitor-brief — competitor content analysis for a keyword
// ---------------------------------------------------------------------------
router.post('/competitor-brief', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  const { keyword, clientDomain } = req.body as { keyword: string; clientDomain: string };
  if (!keyword || !clientDomain) { res.status(400).json({ error: 'keyword and clientDomain required' }); return; }

  try {
    const { fetchCompetitorPages, analyzeCompetitorContent } = await import('../services/competitorContentService');
    const competitors = await fetchCompetitorPages(keyword);
    const analysis = await analyzeCompetitorContent(keyword, clientDomain, competitors);
    res.json({ keyword, clientDomain, competitors, analysis });
  } catch (e) {
    logger.error('[seo] competitor-brief error:', e);
    res.status(500).json({ error: 'Competitor analysis failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/content-briefs — list generated content and briefs
// ---------------------------------------------------------------------------
router.get('/content-briefs', async (_req: Request, res: Response) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    const [pages, gaps] = await Promise.all([
      dbPool.query(`
        SELECT id, project_name, client_domain, page_title, page_slug, status, page_type, target_keyword, created_at
        FROM client_pages
        ORDER BY created_at DESC LIMIT 50
      `).catch(() => ({ rows: [] })),
      dbPool.query(`
        SELECT id, project_name, target_keyword, our_position, priority_score, status, analysed_at,
               topics_missing, questions_missing, word_count_gap
        FROM content_gap_analysis
        ORDER BY priority_score DESC NULLS LAST, analysed_at DESC LIMIT 30
      `).catch(() => ({ rows: [] })),
    ]);
    res.json({ pages: pages.rows, briefs: gaps.rows });
  } catch (e) {
    logger.error('[seo] content-briefs error:', e);
    res.status(500).json({ error: 'Failed to fetch content briefs' });
  }
});

// ─── Content Calendar ────────────────────────────────────────────────
router.get('/content-calendar', async (req: Request, res: Response) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    const { client, status, limit } = req.query;
    let query = `SELECT * FROM seo_content_calendar WHERE 1=1`;
    const params: unknown[] = [];
    let idx = 0;
    if (client) { idx++; query += ` AND client_domain = $${idx}`; params.push(client); }
    if (status) { idx++; query += ` AND status = $${idx}`; params.push(status); }
    query += ` ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC`;
    if (limit) { idx++; query += ` LIMIT $${idx}`; params.push(Number(limit)); }
    const result = await dbPool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    logger.error('[seo] content-calendar error:', e);
    res.status(500).json({ error: 'Failed to fetch content calendar' });
  }
});

router.get('/content-calendar/summary', async (_req: Request, res: Response) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    const result = await dbPool.query(`
      SELECT
        client_domain,
        COUNT(*) FILTER (WHERE status = 'planned') AS planned,
        COUNT(*) FILTER (WHERE status = 'writing') AS writing,
        COUNT(*) FILTER (WHERE status = 'review') AS review,
        COUNT(*) FILTER (WHERE status = 'published') AS published,
        COUNT(*) AS total
      FROM seo_content_calendar
      GROUP BY client_domain
      ORDER BY client_domain
    `);
    res.json(result.rows);
  } catch (e) {
    logger.error('[seo] content-calendar summary error:', e);
    res.status(500).json({ error: 'Failed to fetch calendar summary' });
  }
});

router.patch('/content-calendar/:id', async (req: Request, res: Response) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    const { id } = req.params;
    const { status, title, assigned_to, target_publish_date, published_url, notes, priority } = req.body;
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 0;
    if (status !== undefined) { idx++; fields.push(`status = $${idx}`); values.push(status); }
    if (title !== undefined) { idx++; fields.push(`title = $${idx}`); values.push(title); }
    if (assigned_to !== undefined) { idx++; fields.push(`assigned_to = $${idx}`); values.push(assigned_to); }
    if (target_publish_date !== undefined) { idx++; fields.push(`target_publish_date = $${idx}`); values.push(target_publish_date); }
    if (published_url !== undefined) { idx++; fields.push(`published_url = $${idx}`); values.push(published_url); }
    if (notes !== undefined) { idx++; fields.push(`notes = $${idx}`); values.push(notes); }
    if (priority !== undefined) { idx++; fields.push(`priority = $${idx}`); values.push(priority); }
    if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    fields.push('updated_at = NOW()');
    idx++; values.push(id);
    const result = await dbPool.query(`UPDATE seo_content_calendar SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch (e) {
    logger.error('[seo] content-calendar patch error:', e);
    res.status(500).json({ error: 'Failed to update calendar entry' });
  }
});

router.post('/content-calendar', async (req: Request, res: Response) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    const { client_domain, keyword, content_type, title, priority, assigned_to, target_publish_date, notes } = req.body;
    if (!client_domain || !keyword) { res.status(400).json({ error: 'client_domain and keyword are required' }); return; }
    const result = await dbPool.query(`
      INSERT INTO seo_content_calendar (client_domain, keyword, content_type, title, priority, assigned_to, target_publish_date, notes, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual')
      ON CONFLICT (client_domain, keyword, content_type) DO UPDATE SET
        title = COALESCE(EXCLUDED.title, seo_content_calendar.title),
        priority = COALESCE(EXCLUDED.priority, seo_content_calendar.priority),
        updated_at = NOW()
      RETURNING *
    `, [client_domain, keyword, content_type || 'blog', title, priority || 'medium', assigned_to, target_publish_date, notes]);
    res.json(result.rows[0]);
  } catch (e) {
    logger.error('[seo] content-calendar create error:', e);
    res.status(500).json({ error: 'Failed to create calendar entry' });
  }
});

router.delete('/content-calendar/:id', async (req: Request, res: Response) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    await dbPool.query('DELETE FROM seo_content_calendar WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (e) {
    logger.error('[seo] content-calendar delete error:', e);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

export default router;
