import { Router, type Request, type Response } from 'express';
import { db, pool } from '../db';
import { sql } from 'drizzle-orm';
import logger from '../utils/logger';
import { SEO_WORKFLOWS } from '../services/seoWorkflowHealthService';

const router = Router();

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
  { id: 'Ss2Bfps5lXBWUUs4', name: 'Content Decay Detection',       schedule: 'Every Monday 9AM IST',     num: 11 },
  { id: 'M4rbRZL5jh0jJHku', name: 'Weekly Opportunity Digest',     schedule: 'Friday 5PM IST',           num: 12 },
];

// ---------------------------------------------------------------------------
// GET /api/seo/overview — summary across all clients with week-over-week trend
// ---------------------------------------------------------------------------
router.get('/overview', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    // Per-client keyword ranking summary (works without GSC/GA4)
    const clientStats = await pool.query(`
      SELECT
        COALESCE(client_domain, project_name) AS client_domain,
        MAX(COALESCE(client_domain, project_name)) AS client_name,
        COUNT(DISTINCT keyword) AS total_keywords,
        COUNT(*) FILTER (WHERE current_position IS NOT NULL AND current_position <= 3) AS top_3,
        COUNT(*) FILTER (WHERE current_position IS NOT NULL AND current_position <= 10) AS page_1,
        COUNT(*) FILTER (WHERE current_position IS NOT NULL AND current_position <= 20) AS page_2,
        ROUND(AVG(current_position)::numeric, 1) AS avg_position,
        COUNT(*) FILTER (WHERE position_change > 0) AS keywords_improved,
        COUNT(*) FILTER (WHERE position_change < 0) AS keywords_dropped,
        COUNT(*) FILTER (WHERE position_change = 0 OR position_change IS NULL) AS keywords_stable,
        COUNT(*) FILTER (WHERE featured_snippet = true) AS featured_snippets,
        MAX(COALESCE(checked_at, recorded_date::timestamp)) AS last_checked
      FROM keyword_rankings
      WHERE keyword IS NOT NULL AND tenant_id = $1
      GROUP BY COALESCE(client_domain, project_name)
      ORDER BY COALESCE(client_domain, project_name)
    `, [tenantId]);

    // Site health per client
    const healthStats = await pool.query(`
      SELECT DISTINCT ON (project_name) project_name AS client_domain,
        pagespeed_mobile, pagespeed_desktop, lcp, cls, checked_at
      FROM site_health_metrics WHERE tenant_id = $1 ORDER BY project_name, checked_at DESC
    `, [tenantId]);
    const healthMap: Record<string, Record<string, unknown>> = {};
    for (const h of healthStats.rows as Array<Record<string, unknown>>) {
      healthMap[h.client_domain as string] = h;
    }

    // Aggregate totals
    const totals = await pool.query(`
      SELECT
        COUNT(DISTINCT keyword) AS total_keywords,
        COUNT(*) FILTER (WHERE current_position IS NOT NULL AND current_position <= 10) AS total_page_1,
        COUNT(*) FILTER (WHERE position_change > 0) AS total_improved,
        COUNT(*) FILTER (WHERE position_change < 0) AS total_dropped,
        COUNT(*) FILTER (WHERE featured_snippet = true) AS total_featured
      FROM keyword_rankings WHERE keyword IS NOT NULL AND tenant_id = $1
    `, [tenantId]);

    const opps = await pool.query(`SELECT COUNT(*)::int AS count FROM seo_opportunities WHERE status = 'open' AND tenant_id = $1`, [tenantId]).catch(() => ({ rows: [{ count: 0 }] }));
    const alerts = await pool.query(`SELECT COUNT(*)::int AS count FROM seo_alerts_log WHERE created_at > NOW() - INTERVAL '7 days' AND tenant_id = $1`, [tenantId]).catch(() => ({ rows: [{ count: 0 }] }));
    const backlinks = await pool.query(`SELECT COUNT(*)::int AS count FROM backlink_data WHERE status = 'active' AND tenant_id = $1`, [tenantId]).catch(() => ({ rows: [{ count: 0 }] }));

    res.json({
      clients: clientStats.rows,
      health: healthMap,
      totals: totals.rows[0],
      openOpportunities: (opps.rows[0] as Record<string, number>)?.count ?? 0,
      recentAlerts: (alerts.rows[0] as Record<string, number>)?.count ?? 0,
      activeBacklinks: (backlinks.rows[0] as Record<string, number>)?.count ?? 0,
    });
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
  const tenantId = req.user!.tenantId;
  try {
    const [weekly, keywords, healthRes, alerts, opportunities, content, backlinks] = await Promise.all([
      db.execute(sql`
        SELECT * FROM seo_weekly_metrics
        WHERE client_domain = ${domain} AND tenant_id = ${tenantId}
        ORDER BY week_start DESC LIMIT 12
      `),
      db.execute(sql`
        SELECT DISTINCT ON (keyword)
          keyword, current_position AS position, previous_position,
          (current_position - previous_position) AS position_change,
          search_volume, url_ranking AS url, recorded_date AS checked_at
        FROM keyword_rankings
        WHERE (client_domain = ${domain} OR project_name = ${domain}) AND tenant_id = ${tenantId}
        ORDER BY keyword, recorded_date DESC
      `),
      db.execute(sql`
        SELECT * FROM site_health_metrics
        WHERE (client_domain = ${domain} OR project_name = ${domain}) AND tenant_id = ${tenantId}
        ORDER BY checked_at DESC LIMIT 1
      `),
      db.execute(sql`
        SELECT * FROM seo_alerts_log
        WHERE (client_domain = ${domain} OR project_name = ${domain}) AND tenant_id = ${tenantId}
        ORDER BY created_at DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT * FROM seo_opportunities
        WHERE (client_domain = ${domain} OR project_name = ${domain}) AND status = 'open' AND tenant_id = ${tenantId}
        ORDER BY priority_score DESC NULLS LAST, created_at DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT * FROM content_gap_analysis
        WHERE (client_domain = ${domain} OR project_name = ${domain}) AND tenant_id = ${tenantId}
        ORDER BY analysed_at DESC LIMIT 5
      `),
      db.execute(sql`
        SELECT * FROM backlink_data
        WHERE (client_domain = ${domain} OR project_name = ${domain}) AND tenant_id = ${tenantId}
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
  const tenantId = req.user!.tenantId;
  try {
    const result = await db.execute(sql`
      SELECT keyword, current_position AS position, previous_position,
        (current_position - previous_position) AS change,
        search_volume, url_ranking AS url, recorded_date AS checked_at
      FROM keyword_rankings
      WHERE (client_domain = ${domain} OR project_name = ${domain}) AND tenant_id = ${tenantId}
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
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const result = await db.execute(sql`
      SELECT * FROM seo_alerts_log
      WHERE tenant_id = ${tenantId}
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
  const seoWf = SEO_WORKFLOWS.find(w => w.id === workflowId);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }

  const webhookPath = seoWf?.webhookPath ?? `mtrig-seo${String(workflow.num).padStart(2, '0')}`;

  // Backend-native services — run directly without n8n
  const BACKEND_SERVICES: Record<string, () => Promise<{ ok: boolean; detail: string }>> = {
    'mtrig-seo02': async () => { const { runSeoAlertChecks } = await import('../services/seoAlertService'); const r = await runSeoAlertChecks(); return { ok: true, detail: `${r.alerts} alerts generated` }; },
    'mtrig-seo05': async () => { const { runPageSpeedChecks } = await import('../services/pagespeedService'); const r = await runPageSpeedChecks(); return { ok: true, detail: `${r.checked} sites checked` }; },
    'mtrig-seo06': async () => { const { runRankChecks } = await import('../services/rankTrackingService'); const r = await runRankChecks(); return { ok: true, detail: `${r.checked} keywords checked` }; },
    'mtrig-seo07': async () => { const { runContentGapAnalysis } = await import('../services/seoContentGapService'); const r = await runContentGapAnalysis(); return { ok: true, detail: `${r.gaps} gaps found` }; },
    'mtrig-seo08': async () => { const { runBacklinkCheck } = await import('../services/seoBacklinkService'); const r = await runBacklinkCheck(); return { ok: true, detail: `${r.found} backlinks found` }; },
    'mtrig-seo11': async () => { const { runContentDecayDetection } = await import('../services/seoContentDecayService'); const r = await runContentDecayDetection(); return { ok: true, detail: `${r.opportunities} opportunities` }; },
    'mtrig-seo12': async () => { const { sendWeeklyOpportunityDigest } = await import('../services/seoDigestService'); const r = await sendWeeklyOpportunityDigest(); return { ok: r.sent, detail: r.sent ? 'Digest sent' : 'Send failed' }; },
  };

  try {
    const backendService = BACKEND_SERVICES[webhookPath];
    if (backendService) {
      // Run backend-native service directly (no n8n needed)
      const result = await backendService();
      logger.info(`[seo] ran ${workflow.name} (backend-native) → ${result.detail}`);
      res.json({ ok: result.ok, workflow: workflow.name, method: 'backend', detail: result.detail });
    } else {
      // No backend-native implementation for this workflow
      res.status(501).json({ error: 'workflow_not_implemented', workflow: workflow.id });
    }
  } catch (e) {
    logger.error('[seo] trigger error:', e);
    res.status(500).json({ error: 'Failed to trigger workflow' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/keywords-all — all keywords across all clients
// ---------------------------------------------------------------------------
router.get('/keywords-all', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const result = await db.execute(sql`
      SELECT keyword, COALESCE(client_domain, project_name) AS client_domain,
        current_position AS position,
        previous_position,
        (current_position - previous_position) AS change,
        search_volume,
        recorded_date AS checked_at
      FROM keyword_rankings
      WHERE tenant_id = ${tenantId}
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
// FAIL-CLOSED GATE for the three programmatic-SEO routes below.
//
// programmaticSeoService.publishToWordPress() resolves its WordPress target
// from GLOBAL env vars (WP_AGEDDENTISTRY_*), not from the tenant. The tenantId
// those functions now accept scopes which client_pages rows are read and
// written — it does NOT change where content actually gets published.
//
// So without this gate, a reseller admin pressing "generate" or "publish" would
// draft pages onto Growth Escalators' own WordPress site. A comment does not
// stop the request; this does.
//
// The rule: you may only drive these routes if the configured WordPress domain
// is a site registered under YOUR tenant. Phase 3's SiteAdapter replaces this
// by resolving the publish target per site, at which point the gate becomes a
// per-site capability check instead of a single-domain one.
//
// Returns null when the caller is allowed; otherwise it has already responded.
// ---------------------------------------------------------------------------
async function assertOwnsWordPressTarget(tenantId: string, res: Response): Promise<boolean> {
  const { getSeoSiteByDomain, normaliseDomain } = await import('../services/seoSiteRegistry');
  const wpTarget = normaliseDomain(process.env.WP_AGEDDENTISTRY_URL || 'https://ageddentistry.org');
  const owned = await getSeoSiteByDomain(tenantId, wpTarget);
  if (!owned) {
    res.status(409).json({
      error: 'Programmatic page publishing is not available for your sites yet — the configured WordPress target is not a site you own.',
      code: 'publish_target_not_owned',
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// POST /api/seo/generate-local-pages — programmatic SEO page generation
// ---------------------------------------------------------------------------
router.post('/generate-local-pages', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string; tenantId?: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  const tenantId = user?.tenantId;
  if (!tenantId) { res.status(401).json({ error: 'No tenant on session' }); return; }

  try {
    // Generation publishes to WordPress as part of its run (see wpPublished in
    // the result), so it is gated exactly like the explicit publish route.
    if (!(await assertOwnsWordPressTarget(tenantId, res))) return;
    const { generateLocationPages } = await import('../services/programmaticSeoService');
    const result = await generateLocationPages(tenantId);
    res.json(result);
  } catch (e) {
    logger.error('[seo] generate-local-pages error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo/regenerate-pages — delete old pages and generate fresh ones
// ---------------------------------------------------------------------------
// The domain is now a required body parameter, not the hardcoded
// 'ageddentistry.org' this route used to pin. Two reasons: that is one of three
// retired clients whose data is scheduled for deletion, and a reseller admin
// hitting this endpoint would have deleted and regenerated pages for a domain
// belonging to somebody else entirely.
//
// It must be a domain registered to the CALLER's tenant. Requiring it
// explicitly rather than defaulting to "all this tenant's sites" is deliberate:
// this endpoint deletes rows, and a destructive default is how you lose data
// you meant to keep.
router.post('/regenerate-pages', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string; tenantId?: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  const tenantId = user?.tenantId;
  if (!tenantId) { res.status(401).json({ error: 'No tenant on session' }); return; }

  const domain = typeof req.body?.domain === 'string' ? req.body.domain.trim() : '';
  if (!domain) {
    res.status(400).json({ error: 'domain is required', code: 'domain_required' });
    return;
  }

  try {
    const { pool } = await import('../db/index');
    const { getSeoSiteByDomain } = await import('../services/seoSiteRegistry');

    // Ownership check before the DELETE, not after — an unregistered domain
    // must not be able to delete anything, even zero rows.
    const site = await getSeoSiteByDomain(tenantId, domain);
    if (!site) {
      res.status(404).json({ error: 'No site registered for that domain under this tenant', code: 'site_not_found' });
      return;
    }

    // Both checks run BEFORE the DELETE. Gating after it would delete the
    // caller's pages and then refuse to regenerate them — destroying data on
    // the path that rejects the request.
    if (!(await assertOwnsWordPressTarget(tenantId, res))) return;

    const del = await pool.query(
      `DELETE FROM client_pages WHERE client_domain = $1 AND tenant_id = $2`,
      [site.domain, tenantId],
    );
    logger.info(`[seo] Deleted ${del.rowCount} old pages for ${site.domain}`);

    const { generateLocationPages } = await import('../services/programmaticSeoService');
    const result = await generateLocationPages(tenantId);
    res.json({ ...result, oldPagesDeleted: del.rowCount, domain: site.domain });
  } catch (e) {
    logger.error('[seo] regenerate-pages error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo/publish-pending-pages — publish draft_local pages to WordPress
// ---------------------------------------------------------------------------
// Publishes to a live external website. The tenant comes off the session, never
// the body — a client-supplied tenant id here would let one agency publish into
// another agency's client's site.
//
// FAIL-CLOSED GATE. programmaticSeoService.publishToWordPress() resolves its
// WordPress target from GLOBAL env vars (WP_AGEDDENTISTRY_*), not from the
// tenant. So the tenantId below scopes which client_pages rows get read, but
// NOT where the content lands: without this gate, a reseller admin pressing
// "publish" would draft their pages onto Growth Escalators' own WordPress site.
//
// Until Phase 3's SiteAdapter resolves the publish target per site, this
// endpoint is restricted to the tenant that actually owns the configured
// WordPress domain. Everyone else gets a 409 that says so. A gate is used
// rather than a comment because the comment does not stop the request.
router.post('/publish-pending-pages', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string; tenantId?: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  const tenantId = user?.tenantId;
  if (!tenantId) { res.status(401).json({ error: 'No tenant on session' }); return; }

  try {
    if (!(await assertOwnsWordPressTarget(tenantId, res))) return;
    const { publishPendingToWordPress } = await import('../services/programmaticSeoService');
    const result = await publishPendingToWordPress(tenantId);
    res.json(result);
  } catch (e) {
    logger.error('[seo] publish-pending error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/pages — list all generated pages
// ---------------------------------------------------------------------------
router.get('/pages', async (req: Request, res: Response) => {
  try {
    const { pool } = await import('../db/index');
    const result = await pool.query(
      `SELECT * FROM client_pages WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.user!.tenantId],
    );
    res.json({ pages: result.rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/content-gaps — all content gaps across clients
// ---------------------------------------------------------------------------
router.get('/content-gaps', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const result = await db.execute(sql`
      SELECT id, project_name, target_keyword, our_url, our_position,
             competitor_urls, topics_missing, questions_missing,
             word_count_gap, priority_score, status, analysed_at
      FROM content_gap_analysis
      WHERE tenant_id = ${tenantId}
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
router.get('/backlinks', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const result = await db.execute(sql`
      SELECT id, project_name, source_url, target_url,
             domain_authority, anchor_text, link_type,
             first_seen, last_seen, status
      FROM backlink_data
      WHERE status = 'active' AND tenant_id = ${tenantId}
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
      const result = await generateAIOptimizedContent(clientDomain, keyword, req.user!.tenantId);
      res.json(result);
    } else {
      const { generateContentForClient } = await import('../services/contentGenerationService');
      const result = await generateContentForClient(clientDomain, keyword, undefined, req.user!.tenantId);
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
    const tenantId = req.user!.tenantId;

    // Resolve the site so spend is attributed to it, and so the per-SITE cap
    // applies rather than only the tenant-wide one. A domain with no
    // registered site still runs — it just gets tenant-level caps only.
    const { getSeoSiteByDomain } = await import('../services/seoSiteRegistry');
    const site = await getSeoSiteByDomain(tenantId, clientDomain).catch(() => null);

    // Pre-flight the cost guard so an exhausted cap comes back as a real
    // refusal with a code, not as an empty competitor list the operator has
    // no way to interpret. The cron path (runCompetitorContentAnalysis) keeps
    // the opposite behaviour — skip and continue — because a sweep that
    // aborted on the first capped keyword would be worse than a partial one.
    const { evaluateSeoSpend } = await import('../services/seoSerperGuard');
    const evaluation = await evaluateSeoSpend({
      tenantId,
      siteId: site?.id ?? null,
      operation: 'serper_search',
      label: 'competitor-brief',
    });
    if (!evaluation || !evaluation.allowed) {
      // A null evaluation means the guard itself failed — fail closed, same
      // as guardedSerperCall does.
      res.status(evaluation?.httpStatus ?? 503).json({
        error: evaluation?.blockCode ?? 'cost_guard_unavailable',
        message: evaluation?.blockReasons.join(' ') ?? 'Spend guard could not be evaluated.',
        budget: evaluation?.budget,
      });
      return;
    }

    const { fetchCompetitorPages, analyzeCompetitorContent } = await import('../services/competitorContentService');
    // tenantId/siteId passed explicitly. Without them this fell back to
    // resolveDefaultSeoTenantId(), which THROWS once a second tenant has the
    // SEO feature enabled — the C2 blocker every cron was converted away from
    // in Phase 2, still latent on this route until now.
    const competitors = await fetchCompetitorPages(keyword, tenantId, site?.id ?? null);
    const analysis = await analyzeCompetitorContent(keyword, clientDomain, competitors, tenantId);
    res.json({ keyword, clientDomain, competitors, analysis });
  } catch (e) {
    logger.error('[seo] competitor-brief error:', e);
    res.status(500).json({ error: 'Competitor analysis failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo/content-briefs — list generated content and briefs
// ---------------------------------------------------------------------------
router.get('/content-briefs', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const { pool: dbPool } = await import('../db/index');
    const [pages, gaps] = await Promise.all([
      dbPool.query(`
        SELECT id, project_name, client_domain, page_title, page_slug, status, page_type, target_keyword, created_at
        FROM client_pages
        WHERE tenant_id = $1
        ORDER BY created_at DESC LIMIT 50
      `, [tenantId]).catch(() => ({ rows: [] })),
      dbPool.query(`
        SELECT id, project_name, target_keyword, our_position, priority_score, status, analysed_at,
               topics_missing, questions_missing, word_count_gap
        FROM content_gap_analysis
        WHERE tenant_id = $1
        ORDER BY priority_score DESC NULLS LAST, analysed_at DESC LIMIT 30
      `, [tenantId]).catch(() => ({ rows: [] })),
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
    const tenantId = req.user!.tenantId;
    let query = `SELECT * FROM seo_content_calendar WHERE 1=1`;
    const params: unknown[] = [];
    let idx = 0;
    if (client) { idx++; query += ` AND client_domain = $${idx}`; params.push(client); }
    if (status) { idx++; query += ` AND status = $${idx}`; params.push(status); }
    idx++; query += ` AND tenant_id = $${idx}`; params.push(tenantId);
    query += ` ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC`;
    if (limit) { idx++; query += ` LIMIT $${idx}`; params.push(Number(limit)); }
    const result = await dbPool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    logger.error('[seo] content-calendar error:', e);
    res.status(500).json({ error: 'Failed to fetch content calendar' });
  }
});

router.get('/content-calendar/summary', async (req: Request, res: Response) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    const tenantId = req.user!.tenantId;
    const result = await dbPool.query(`
      SELECT
        client_domain,
        COUNT(*) FILTER (WHERE status = 'planned') AS planned,
        COUNT(*) FILTER (WHERE status = 'writing') AS writing,
        COUNT(*) FILTER (WHERE status = 'review') AS review,
        COUNT(*) FILTER (WHERE status = 'published') AS published,
        COUNT(*) AS total
      FROM seo_content_calendar
      WHERE tenant_id = $1
      GROUP BY client_domain
      ORDER BY client_domain
    `, [tenantId]);
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
    const tenantId = req.user!.tenantId;
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
    const idIdx = idx;
    idx++; values.push(tenantId);
    const tenantIdx = idx;
    const result = await dbPool.query(`UPDATE seo_content_calendar SET ${fields.join(', ')} WHERE id = $${idIdx} AND tenant_id = $${tenantIdx} RETURNING *`, values);
    if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    const row = result.rows[0] as Record<string, unknown>;

    // Close the outcome-measurement loop: propagate published_url back onto the
    // seo_opportunities row this calendar entry was created from (if any), so
    // sendWeeklyOpportunityDigest's 14-day outcome check can actually fire.
    if (published_url !== undefined && row.opportunity_id) {
      await dbPool.query(
        `UPDATE seo_opportunities SET published_url = $1 WHERE id = $2 AND tenant_id = $3`,
        [published_url, row.opportunity_id, tenantId],
      ).catch((e) => {
        logger.warn(`[seo] failed to propagate published_url to opportunity ${row.opportunity_id}: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    res.json(row);
  } catch (e) {
    logger.error('[seo] content-calendar patch error:', e);
    res.status(500).json({ error: 'Failed to update calendar entry' });
  }
});

router.post('/content-calendar', async (req: Request, res: Response) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    const tenantId = req.user!.tenantId;
    const { client_domain, keyword, content_type, title, priority, assigned_to, target_publish_date, notes } = req.body;
    if (!client_domain || !keyword) { res.status(400).json({ error: 'client_domain and keyword are required' }); return; }
    const result = await dbPool.query(`
      INSERT INTO seo_content_calendar (client_domain, keyword, content_type, title, priority, assigned_to, target_publish_date, notes, source, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', $9)
      -- Was ON CONFLICT (client_domain, keyword, content_type) — a 3-column
      -- target with no tenant in it. The INSERT bound tenant_id correctly, but
      -- the conflict target did not: if tenant A already had a calendar row for
      -- (example.com, "dental implants", blog), tenant B creating the same
      -- entry did not insert its own row — it silently UPDATED TENANT A'S ROW,
      -- overwriting their title and priority. A cross-tenant write through a
      -- correctly-scoped INSERT.
      --
      -- This was the last 3-column target in the repo; migration 0047 drops the
      -- old index it referred to. Both had to land together: a 4-column target
      -- while the 3-column UNIQUE index still existed would turn the silent
      -- overwrite into a unique-violation 500 instead of a clean insert.
      ON CONFLICT (tenant_id, client_domain, keyword, content_type) DO UPDATE SET
        title = COALESCE(EXCLUDED.title, seo_content_calendar.title),
        priority = COALESCE(EXCLUDED.priority, seo_content_calendar.priority),
        updated_at = NOW()
      RETURNING *
    `, [client_domain, keyword, content_type || 'blog', title, priority || 'medium', assigned_to, target_publish_date, notes, tenantId]);
    res.json(result.rows[0]);
  } catch (e) {
    logger.error('[seo] content-calendar create error:', e);
    res.status(500).json({ error: 'Failed to create calendar entry' });
  }
});

router.delete('/content-calendar/:id', async (req: Request, res: Response) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    const tenantId = req.user!.tenantId;
    const result = await dbPool.query('DELETE FROM seo_content_calendar WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ deleted: true });
  } catch (e) {
    logger.error('[seo] content-calendar delete error:', e);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

export default router;
