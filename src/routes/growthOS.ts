import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { getActiveGrowthOSClients } from '../services/growthOSSetup';
import { calculateBrandHealth, sendHealthScoreWhatsApp } from '../services/brandHealthService';
import { calculateMoneyOnTable } from '../services/opportunityService';
import { trackCreativePerformance } from '../services/creativeIntelligenceService';
import { runCompetitorPulse } from '../services/competitorService';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/growth-os/clients
// ---------------------------------------------------------------------------
router.get('/clients', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM growth_os_clients ORDER BY client_name`);
    res.json({ clients: result.rows });
  } catch (e) {
    logger.error('[growth-os] clients fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/growth-os/clients — add or update
// ---------------------------------------------------------------------------
router.post('/clients', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  const { client_name, ad_account_id, founder_whatsapp, founder_name, monthly_ad_spend, target_roas, industry, competitors } = req.body as Record<string, unknown>;
  if (!client_name || !ad_account_id) { res.status(400).json({ error: 'client_name and ad_account_id required' }); return; }

  try {
    await pool.query(
      `INSERT INTO growth_os_clients (client_name, ad_account_id, founder_whatsapp, founder_name, monthly_ad_spend, target_roas, industry, competitors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_name) DO UPDATE SET
         ad_account_id=$2, founder_whatsapp=$3, founder_name=$4, monthly_ad_spend=$5,
         target_roas=$6, industry=$7, competitors=$8`,
      [client_name, ad_account_id, founder_whatsapp ?? null, founder_name ?? null,
       monthly_ad_spend ?? 0, target_roas ?? 2.5, industry ?? 'general',
       JSON.stringify(competitors ?? [])]
    );
    res.json({ ok: true, message: 'Client saved' });
  } catch (e) {
    logger.error('[growth-os] client save failed:', e);
    res.status(500).json({ error: 'Failed to save client' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/growth-os/health/all
// ---------------------------------------------------------------------------
router.get('/health/all', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (client_name) *
      FROM brand_health_scores
      ORDER BY client_name, score_date DESC
    `);
    res.json({ scores: result.rows });
  } catch (e) {
    logger.error('[growth-os] health/all failed:', e);
    res.status(500).json({ error: 'Failed to fetch health scores' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/growth-os/health/:clientName
// ---------------------------------------------------------------------------
router.get('/health/:clientName', async (req: Request, res: Response) => {
  try {
    const { clientName } = req.params;
    const result = await pool.query(
      `SELECT * FROM brand_health_scores WHERE client_name = $1 ORDER BY score_date DESC LIMIT 30`,
      [clientName]
    );
    res.json({ scores: result.rows, latest: result.rows[0] ?? null });
  } catch (e) {
    logger.error('[growth-os] health fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch health scores' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/growth-os/health/generate — admin only
// ---------------------------------------------------------------------------
router.post('/health/generate', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  res.json({ status: 'generating', message: 'Health score generation started. Check /health/all shortly.' });

  setImmediate(async () => {
    try {
      const clients = await getActiveGrowthOSClients();
      for (const client of clients) {
        const score = await calculateBrandHealth(client);
        if (client.founder_whatsapp) await sendHealthScoreWhatsApp(score, client.founder_whatsapp);
        await new Promise(r => setTimeout(r, 2000));
      }
      logger.info('[growth-os] Manual health generation complete');
    } catch (e) {
      logger.error('[growth-os] Manual health generation failed:', e);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/growth-os/opportunity/:clientName
// ---------------------------------------------------------------------------
router.get('/opportunity/:clientName', async (req: Request, res: Response) => {
  try {
    const { clientName } = req.params;
    const result = await pool.query(
      `SELECT * FROM money_on_table WHERE client_name = $1 ORDER BY created_at DESC LIMIT 8`,
      [clientName]
    );
    res.json({ reports: result.rows, latest: result.rows[0] ?? null });
  } catch (e) {
    logger.error('[growth-os] opportunity fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch opportunity data' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/growth-os/opportunity/generate
// ---------------------------------------------------------------------------
router.post('/opportunity/generate', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  res.json({ status: 'generating', message: 'Opportunity calculation started.' });

  setImmediate(async () => {
    try {
      const clients = await getActiveGrowthOSClients();
      for (const client of clients) {
        await calculateMoneyOnTable(client);
        await new Promise(r => setTimeout(r, 2000));
      }
      logger.info('[growth-os] Manual opportunity generation complete');
    } catch (e) {
      logger.error('[growth-os] Manual opportunity generation failed:', e);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/growth-os/creatives/:adAccountId
// ---------------------------------------------------------------------------
router.get('/creatives/:adAccountId', async (req: Request, res: Response) => {
  try {
    const { adAccountId } = req.params;
    const { status } = req.query as { status?: string };

    let query = `SELECT * FROM creative_intelligence WHERE ad_account_id = $1`;
    const params: unknown[] = [adAccountId];

    if (status) {
      query += ` AND fatigue_status = $2`;
      params.push(status);
    }

    query += ` ORDER BY CASE fatigue_status WHEN 'saturated' THEN 1 WHEN 'fatiguing' THEN 2 WHEN 'aging' THEN 3 ELSE 4 END, updated_at DESC`;

    const result = await pool.query(query, params);
    res.json({ creatives: result.rows });
  } catch (e) {
    logger.error('[growth-os] creatives fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch creatives' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/growth-os/creatives/scan
// ---------------------------------------------------------------------------
router.post('/creatives/scan', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  res.json({ status: 'scanning', message: 'Creative intelligence scan started.' });

  setImmediate(async () => {
    try {
      const clients = await getActiveGrowthOSClients();
      for (const client of clients) {
        await trackCreativePerformance(client.ad_account_id);
        await new Promise(r => setTimeout(r, 3000));
      }
      logger.info('[growth-os] Manual creative scan complete');
    } catch (e) {
      logger.error('[growth-os] Manual creative scan failed:', e);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/growth-os/competitor/:clientName
// ---------------------------------------------------------------------------
router.get('/competitor/:clientName', async (req: Request, res: Response) => {
  try {
    const { clientName } = req.params;
    const result = await pool.query(
      `SELECT * FROM competitor_pulse WHERE client_name = $1 ORDER BY created_at DESC LIMIT 10`,
      [clientName]
    );
    res.json({ pulse: result.rows, latest: result.rows[0] ?? null });
  } catch (e) {
    logger.error('[growth-os] competitor fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch competitor data' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/growth-os/copilot/:clientName
// ---------------------------------------------------------------------------
router.get('/copilot/:clientName', async (req: Request, res: Response) => {
  try {
    const { clientName } = req.params;
    const result = await pool.query(
      `SELECT * FROM copilot_conversations WHERE client_name = $1 ORDER BY created_at DESC LIMIT 20`,
      [clientName]
    );
    res.json({ conversations: result.rows.reverse() }); // Chronological order
  } catch (e) {
    logger.error('[growth-os] copilot fetch failed:', e);
    res.status(500).json({ error: 'Failed to fetch copilot conversations' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/growth-os/competitor/run
// ---------------------------------------------------------------------------
router.post('/competitor/run', async (req: Request, res: Response) => {
  const user = (req as Request & { user?: { role: string } }).user;
  if (user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }

  res.json({ status: 'running', message: 'Competitor pulse started.' });

  setImmediate(async () => {
    try {
      const clients = await getActiveGrowthOSClients();
      for (const client of clients) {
        await runCompetitorPulse(client);
        await new Promise(r => setTimeout(r, 3000));
      }
      logger.info('[growth-os] Manual competitor pulse complete');
    } catch (e) {
      logger.error('[growth-os] Manual competitor pulse failed:', e);
    }
  });
});

export default router;
