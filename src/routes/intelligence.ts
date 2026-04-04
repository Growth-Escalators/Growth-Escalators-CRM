import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { collectDailyData } from '../services/intelligenceDataCollector';
import { analyzeWithClaude, ensureIntelligenceTable } from '../services/intelligenceAnalyzer';
import { deliverDailyIntelligence } from '../services/intelligenceDelivery';

const router = Router();

// Ensure table exists at startup
ensureIntelligenceTable().catch(e => logger.error('[intelligence] table bootstrap failed:', e));

// Ensure status column exists
pool.query(`ALTER TABLE ai_intelligence_reports ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'complete'`).catch(() => {});
pool.query(`ALTER TABLE ai_intelligence_reports ADD COLUMN IF NOT EXISTS error_message TEXT`).catch(() => {});

// API key reminder
const _apiKey = process.env.CLAUDE_API_KEY;
if (!_apiKey || _apiKey.length <= 10 || !_apiKey.startsWith('sk-ant-')) {
  console.warn('[intelligence] ACTION NEEDED: railway variables set CLAUDE_API_KEY=\'your-key\' --service web');
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
      WHERE COALESCE(status, 'complete') = 'complete'
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
        AND COALESCE(status, 'complete') = 'complete'
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
      WHERE COALESCE(status, 'complete') = 'complete'
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
        AND COALESCE(status, 'complete') = 'complete'
      ORDER BY report_date DESC
    `);
    res.json({ actionsByDay: result.rows });
  } catch (e) {
    logger.error('[intelligence] actions fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch actions' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intelligence/status/:id — poll generation status
// ---------------------------------------------------------------------------
router.get('/status/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, status, overall_score, tokens_used, error_message, created_at
       FROM ai_intelligence_reports WHERE id = $1 LIMIT 1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.json({ status: 'not_found' });
      return;
    }
    const row = result.rows[0] as Record<string, unknown>;
    res.json({
      status: row.status ?? 'complete',
      score: row.overall_score ?? null,
      aiEnabled: (row.tokens_used as number ?? 0) > 0,
      error: row.error_message ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// In-memory flag
let _generating = false;

// ---------------------------------------------------------------------------
// POST /api/intelligence/generate — async with status tracking
// ---------------------------------------------------------------------------
router.post('/generate', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  if (_generating) {
    res.json({ status: 'already_generating', message: 'Generation already in progress' });
    return;
  }

  // Create placeholder record with status 'generating'
  let reportId: string | null = null;
  try {
    const insertResult = await pool.query(`
      INSERT INTO ai_intelligence_reports (report_date, report_type, status, overall_score, tokens_used)
      VALUES (CURRENT_DATE, 'daily', 'generating', 0, 0)
      RETURNING id
    `);
    reportId = (insertResult.rows[0] as { id: string }).id;
  } catch (e) {
    // If today's report exists, delete and recreate
    await pool.query(`DELETE FROM ai_intelligence_reports WHERE report_date = CURRENT_DATE`).catch(() => {});
    const insertResult = await pool.query(`
      INSERT INTO ai_intelligence_reports (report_date, report_type, status, overall_score, tokens_used)
      VALUES (CURRENT_DATE, 'daily', 'generating', 0, 0)
      RETURNING id
    `);
    reportId = (insertResult.rows[0] as { id: string }).id;
  }

  // Return immediately with reportId for polling
  res.json({ status: 'generating', reportId });

  // Background generation
  _generating = true;
  setImmediate(async () => {
    try {
      logger.info('[intelligence] Background generation started');
      const data = await collectDailyData();
      const analysis = await analyzeWithClaude(data);
      await deliverDailyIntelligence(analysis, data);

      // Update record with complete status
      if (reportId) {
        await pool.query(`
          UPDATE ai_intelligence_reports SET status = 'complete' WHERE id = $1
        `, [reportId]).catch(() => {});
      }

      logger.info(`[intelligence] Background generation complete. Score: ${analysis.scores.overall}`);
    } catch (e) {
      logger.error('[intelligence] Background generation failed:', e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (reportId) {
        await pool.query(`
          UPDATE ai_intelligence_reports SET status = 'failed', error_message = $1 WHERE id = $2
        `, [errorMsg.slice(0, 500), reportId]).catch(() => {});
      }
    } finally {
      _generating = false;
    }
  });
});

export default router;
