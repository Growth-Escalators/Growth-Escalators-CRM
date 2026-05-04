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

// Reset orphaned generating reports on startup
pool.query(`UPDATE ai_intelligence_reports SET status='failed', error_message='Orphaned — server restarted' WHERE status='generating' AND created_at < NOW() - INTERVAL '10 minutes'`).catch(() => {});

// API key reminder
const _apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
if (!_apiKey || _apiKey.length <= 10) {
  console.warn('[intelligence] ACTION NEEDED: railway variables set ANTHROPIC_API_KEY=\'your-key\' --service web');
}

// ---------------------------------------------------------------------------
// GET /api/intelligence/reports — last 30 reports (all statuses for history)
// ---------------------------------------------------------------------------
router.get('/reports', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, report_date, report_type, analysis, wins, problems, actions,
             anomalies, predictions, ads_score, seo_score, sales_score,
             ops_score, overall_score, tokens_used, created_at,
             COALESCE(status, 'complete') AS status, error_message
      FROM ai_intelligence_reports
      WHERE COALESCE(status, 'complete') IN ('complete', 'failed', 'generating')
      ORDER BY created_at DESC LIMIT 30
    `);
    res.json({ reports: result.rows });
  } catch (e) {
    logger.error('[intelligence] reports fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intelligence/today — today's complete report, or failed state
// ---------------------------------------------------------------------------
router.get('/today', async (_req: Request, res: Response) => {
  try {
    // Prefer complete report for today
    const complete = await pool.query(`
      SELECT * FROM ai_intelligence_reports
      WHERE report_date = CURRENT_DATE
        AND COALESCE(status, 'complete') = 'complete'
      ORDER BY created_at DESC LIMIT 1
    `);
    if (complete.rows.length > 0) {
      res.json({ report: complete.rows[0] });
      return;
    }
    // Fall back to failed/generating to surface error state to UI
    const latest = await pool.query(`
      SELECT id, report_date, status, error_message, created_at
      FROM ai_intelligence_reports
      WHERE report_date = CURRENT_DATE
      ORDER BY created_at DESC LIMIT 1
    `);
    res.json({ report: latest.rows[0] ?? null });
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
// GET /api/intelligence/system-health — real-time system health check
// ---------------------------------------------------------------------------
router.get('/system-health', async (_req: Request, res: Response) => {
  try {
    const { checkAllSystems } = await import('../services/systemHealthMonitor');
    const report = await checkAllSystems();
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: 'Health check failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/intelligence/run-cron/:name — manually trigger a whitelisted cron.
// Admin-only. Logs to cron_job_logs via the same wrapper the scheduled run uses,
// so success/failure shows up on the System Health page within seconds.
// Add jobs to RUN_CRON_WHITELIST as needed — keep the list small (each entry
// is a 'run anything now' surface).
// ---------------------------------------------------------------------------
const RUN_CRON_WHITELIST: Record<string, () => Promise<unknown>> = {
  'Directory Scrapers': async () => {
    const { runAllScrapers } = await import('../services/directoryScraperService');
    return runAllScrapers();
  },
  'Monthly Client Benchmarks': async () => {
    const { calculateMonthlyBenchmarks } = await import('../services/metaAdsService');
    await calculateMonthlyBenchmarks();
    return { ok: true };
  },
};

router.post('/run-cron/:name', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  const rawName = req.params.name;
  const name = Array.isArray(rawName) ? rawName[0] : rawName;
  const fn = name ? RUN_CRON_WHITELIST[name] : undefined;
  if (!fn) {
    res.status(404).json({ error: `Cron "${name}" not whitelisted for manual run`, allowed: Object.keys(RUN_CRON_WHITELIST) });
    return;
  }

  const { logCronStart, logCronSuccess, logCronFailure } = await import('../services/systemHealthMonitor');
  const logId = await logCronStart(name!).catch(() => null);
  const startedAt = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    if (logId !== null) await logCronSuccess(logId, durationMs, 0);
    res.json({ ok: true, name, durationMs, result });
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    const errMsg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    if (logId !== null) await logCronFailure(logId, durationMs, errMsg);
    logger.error(`[intelligence] manual run of "${name}" failed:`, e);
    res.status(500).json({ ok: false, name, durationMs, error: errMsg.slice(0, 2000) });
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
let _generatingStartedAt: number | null = null;
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// POST /api/intelligence/generate — async with status tracking
// ---------------------------------------------------------------------------
router.post('/generate', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  // Auto-reset if stuck for more than 5 minutes
  if (_generating && _generatingStartedAt && (Date.now() - _generatingStartedAt > GENERATION_TIMEOUT_MS)) {
    _generating = false;
    _generatingStartedAt = null;
    logger.warn('[intelligence] Generation flag auto-reset after 5min timeout');
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
  _generatingStartedAt = Date.now();
  setImmediate(async () => {
    try {
      logger.info('[intelligence] Background generation started');
      const data = await collectDailyData();
      const analysis = await analyzeWithClaude(data);
      await deliverDailyIntelligence(analysis, data);

      // Update record with complete status and actual scores
      if (reportId) {
        await pool.query(`
          UPDATE ai_intelligence_reports
          SET status = 'complete',
              overall_score = $2,
              ads_score = $3,
              seo_score = $4,
              sales_score = $5,
              ops_score = $6,
              tokens_used = $7
          WHERE id = $1
        `, [
          reportId,
          analysis.scores?.overall ?? 0,
          analysis.scores?.ads ?? 0,
          analysis.scores?.seo ?? 0,
          analysis.scores?.sales ?? 0,
          analysis.scores?.ops ?? 0,
          analysis.tokensUsed ?? 0,
        ]).catch(() => {});
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
      _generatingStartedAt = null;
    }
  });
});

export default router;
