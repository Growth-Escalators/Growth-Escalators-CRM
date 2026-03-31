import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { collectDailyData } from '../services/intelligenceDataCollector';
import { analyzeWithClaude, ensureIntelligenceTable } from '../services/intelligenceAnalyzer';
import { deliverDailyIntelligence } from '../services/intelligenceDelivery';

const router = Router();

// Ensure table exists at startup
ensureIntelligenceTable().catch(e => logger.error('[intelligence] table bootstrap failed:', e));

// API key reminder
if (!process.env.CLAUDE_API_KEY) {
  console.warn('[intelligence] ACTION NEEDED: railway variables set CLAUDE_API_KEY=\'your-key\' --service web');
  console.warn('[intelligence] Get your key at: console.anthropic.com → API Keys');
}

// ---------------------------------------------------------------------------
// GET /api/intelligence/reports — last 30 reports
// ---------------------------------------------------------------------------
router.get('/reports', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, report_date, report_type, analysis, wins, problems, actions,
             anomalies, predictions, ads_score, seo_score, sales_score,
             ops_score, overall_score, tokens_used, created_at
      FROM ai_intelligence_reports
      ORDER BY report_date DESC LIMIT 30
    `);
    res.json({ reports: result.rows });
  } catch (e) {
    logger.error('[intelligence] reports fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intelligence/today — today's report (or null)
// ---------------------------------------------------------------------------
router.get('/today', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT * FROM ai_intelligence_reports
      WHERE report_date = CURRENT_DATE
      ORDER BY created_at DESC LIMIT 1
    `);
    res.json({ report: result.rows[0] ?? null });
  } catch (e) {
    logger.error('[intelligence] today fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch today\'s report' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intelligence/scores — score trend for charts
// ---------------------------------------------------------------------------
router.get('/scores', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT report_date, overall_score, ads_score, seo_score, sales_score, ops_score
      FROM ai_intelligence_reports
      ORDER BY report_date DESC LIMIT 30
    `);
    res.json({ scores: result.rows });
  } catch (e) {
    logger.error('[intelligence] scores fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch scores' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intelligence/actions — open actions from last 7 days
// ---------------------------------------------------------------------------
router.get('/actions', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT report_date, actions FROM ai_intelligence_reports
      WHERE report_date >= NOW() - INTERVAL '7 days'
      ORDER BY report_date DESC
    `);
    res.json({ actionsByDay: result.rows });
  } catch (e) {
    logger.error('[intelligence] actions fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch actions' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/intelligence/generate — manual on-demand generation (admin only)
// ---------------------------------------------------------------------------
router.post('/generate', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  // Delete today's existing report so we can regenerate
  await pool.query(`DELETE FROM ai_intelligence_reports WHERE report_date = CURRENT_DATE`).catch(() => {});

  try {
    logger.info('[intelligence] Manual generation triggered');
    const data = await collectDailyData();
    const analysis = await analyzeWithClaude(data);

    res.json({
      ok: true,
      score: analysis.scores.overall,
      summary: analysis.summary,
      one_thing: analysis.one_thing,
      dataErrors: data.errors,
      tokensUsed: analysis.tokensUsed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[intelligence] generation failed:', e);
    res.status(500).json({ error: 'Report generation failed', details: msg });
  }
});

export default router;
