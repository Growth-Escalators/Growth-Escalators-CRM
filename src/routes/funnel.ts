import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Bootstrap table (called from index.ts at startup)
// ---------------------------------------------------------------------------
export async function ensureFunnelWaitlistTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funnel_waitlist (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) NOT NULL,
      email      VARCHAR(255) NOT NULL,
      source     VARCHAR(100) DEFAULT 'unknown',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(email)
    )
  `);
  logger.info('[funnel] funnel_waitlist table ready');
}

// ---------------------------------------------------------------------------
// POST /api/funnel/waitlist
// Body: { name, email, source? }
// ---------------------------------------------------------------------------
router.post('/waitlist', async (req: Request, res: Response) => {
  const { name, email, source = 'unknown' } = req.body as {
    name?: string;
    email?: string;
    source?: string;
  };

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'valid email is required' });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO funnel_waitlist (name, email, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [name.trim(), email.trim().toLowerCase(), source],
    );

    const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM funnel_waitlist`);
    const count = parseInt(rows[0].count as string, 10);

    res.json({ success: true, count });
  } catch (err) {
    logger.error({ err }, '[funnel] waitlist insert failed');
    res.status(500).json({ error: 'internal error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/funnel/waitlist-count
// Public — returns the current waitlist count
// ---------------------------------------------------------------------------
router.get('/waitlist-count', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM funnel_waitlist`);
    res.json({ count: parseInt(rows[0].count as string, 10) });
  } catch (err) {
    logger.error({ err }, '[funnel] waitlist count failed');
    res.status(500).json({ count: 0 });
  }
});

// ---------------------------------------------------------------------------
// GET /api/funnel/recent-purchase
// Returns the most recent purchase with city and minutes ago.
// Falls back to simulated data if no purchase in last 2 hours.
// Used by the checkout page social-proof ticker.
// ---------------------------------------------------------------------------
const INDIAN_CITIES = ['Bengaluru', 'Mumbai', 'Delhi', 'Pune', 'Hyderabad', 'Chennai', 'Ahmedabad', 'Jaipur', 'Surat', 'Kolkata'];

router.get('/recent-purchase', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT first_name AS name, created_at,
             EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 AS minutes_ago
      FROM contacts
      WHERE 'slo_buyer' = ANY(tags)
        AND created_at > NOW() - INTERVAL '2 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (rows.length > 0) {
      const row = rows[0] as { name: string; minutes_ago: number };
      const city = INDIAN_CITIES[Math.floor(Date.now() / 60000) % INDIAN_CITIES.length];
      res.json({ name: row.name, city, minutes_ago: Math.max(1, Math.round(row.minutes_ago)) });
      return;
    }

    // Fallback — simulated
    const SIMULATED = [
      { name: 'Rahul', city: 'Bengaluru', minutes_ago: 4 },
      { name: 'Priya', city: 'Mumbai', minutes_ago: 7 },
      { name: 'Arjun', city: 'Delhi', minutes_ago: 2 },
      { name: 'Sneha', city: 'Pune', minutes_ago: 11 },
      { name: 'Karan', city: 'Hyderabad', minutes_ago: 6 },
    ];
    res.json(SIMULATED[Math.floor(Date.now() / 120000) % SIMULATED.length]);
  } catch (err) {
    logger.error({ err }, '[funnel] recent-purchase failed');
    res.json({ name: 'Rahul', city: 'Bengaluru', minutes_ago: 4 });
  }
});

export default router;
