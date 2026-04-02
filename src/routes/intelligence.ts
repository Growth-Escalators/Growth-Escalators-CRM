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
const _apiKey = process.env.CLAUDE_API_KEY;
if (!_apiKey || _apiKey.length <= 10 || !_apiKey.startsWith('sk-ant-')) {
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

// In-memory flag so we don't double-generate
let _generating = false;

// ---------------------------------------------------------------------------
// POST /api/intelligence/generate — non-blocking, admin only
// Returns immediately. Frontend polls GET /today until report appears.
// ---------------------------------------------------------------------------
router.post('/generate', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  if (_generating) {
    res.json({ status: 'already_generating', message: 'Generation already in progress — poll GET /api/intelligence/today' });
    return;
  }

  // Delete today's existing report so polling knows to wait for the new one
  await pool.query(`DELETE FROM ai_intelligence_reports WHERE report_date = CURRENT_DATE`).catch(() => {});

  // Respond immediately — don't make the browser wait
  res.json({ status: 'generating', message: 'Report generation started. Poll GET /api/intelligence/today every 5s.' });

  // Background generation — fire and forget
  _generating = true;
  setImmediate(async () => {
    try {
      logger.info('[intelligence] Background generation started');
      const data = await collectDailyData();
      const analysis = await analyzeWithClaude(data);
      await deliverDailyIntelligence(analysis, data);
      logger.info(`[intelligence] Background generation complete. Score: ${analysis.scores.overall}`);
    } catch (e) {
      logger.error('[intelligence] Background generation failed:', e);
    } finally {
      _generating = false;
    }
  });
});

export default router;
