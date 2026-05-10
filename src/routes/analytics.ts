import { Router, type Request, type Response } from 'express';
import { db, pool } from '../db/index';
import { sql } from 'drizzle-orm';
import { requirePermission } from '../middleware/rbac';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/analytics/lead-sources
// ---------------------------------------------------------------------------
router.get('/lead-sources', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(c.source, 'unknown') AS source,
        COUNT(DISTINCT c.id) AS total_leads,
        ROUND(AVG(c.score), 1) AS avg_score,
        COUNT(DISTINCT b.id) FILTER (WHERE b.id IS NOT NULL) AS booked_count,
        COUNT(DISTINCT d.id) FILTER (WHERE d.stage = 'won') AS won_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.score >= 70) AS hot_leads
      FROM contacts c
      LEFT JOIN bookings b ON b.contact_id = c.id
      LEFT JOIN deals d ON d.contact_id = c.id
      WHERE c.tenant_id = ${tenantId}
      GROUP BY COALESCE(c.source, 'unknown')
      ORDER BY COUNT(DISTINCT c.id) DESC
    `);

    const sources = (result.rows as Array<Record<string, unknown>>).map(r => ({
      source: r.source,
      totalLeads: Number(r.total_leads),
      avgScore: Number(r.avg_score) || 0,
      bookedCount: Number(r.booked_count),
      wonCount: Number(r.won_count),
      hotLeads: Number(r.hot_leads),
      bookingRate: Number(r.total_leads) > 0 ? Math.round((Number(r.booked_count) / Number(r.total_leads)) * 100) : 0,
      conversionRate: Number(r.total_leads) > 0 ? Math.round((Number(r.won_count) / Number(r.total_leads)) * 100) : 0,
      hotLeadRate: Number(r.total_leads) > 0 ? Math.round((Number(r.hot_leads) / Number(r.total_leads)) * 100) : 0,
    }));

    res.json({ sources });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/funnel
// ---------------------------------------------------------------------------
router.get('/funnel', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM contacts WHERE tenant_id = ${tenantId}) AS total_contacts,
        (SELECT COUNT(DISTINCT b.contact_id) FROM bookings b JOIN contacts c ON c.id = b.contact_id WHERE c.tenant_id = ${tenantId}) AS booked,
        (SELECT COUNT(DISTINCT c.id) FROM contacts c WHERE c.tenant_id = ${tenantId} AND c.score >= 40) AS qualified,
        (SELECT COUNT(*) FROM deals WHERE tenant_id = ${tenantId} AND stage IN ('proposal', 'proposal_sent')) AS proposal_sent,
        (SELECT COUNT(*) FROM deals WHERE tenant_id = ${tenantId} AND stage = 'won') AS won
    `);

    const row = result.rows[0] as Record<string, unknown>;
    const stages = [
      { name: 'Contacts', count: Number(row.total_contacts) },
      { name: 'Booked', count: Number(row.booked) },
      { name: 'Qualified', count: Number(row.qualified) },
      { name: 'Proposal Sent', count: Number(row.proposal_sent) },
      { name: 'Won', count: Number(row.won) },
    ];

    // Calculate conversion rates between adjacent stages
    for (let i = 1; i < stages.length; i++) {
      const prev = stages[i - 1].count;
      (stages[i] as Record<string, unknown>).conversionRate = prev > 0 ? Math.round((stages[i].count / prev) * 100) : 0;
    }

    res.json({ stages });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/trends?days=30
// ---------------------------------------------------------------------------
router.get('/trends', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const days = Math.min(Number(req.query.days) || 30, 180);

  try {
    const result = await db.execute(sql`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS count
      FROM contacts
      WHERE tenant_id = ${tenantId}
        AND created_at >= NOW() - make_interval(days => ${days})
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `);

    res.json({ days, data: result.rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/revenue-trend — monthly revenue from payments
// ---------------------------------------------------------------------------
router.get('/revenue-trend', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const months = Math.min(Number(req.query.months) || 12, 24);

  try {
    const result = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', payment_date), 'YYYY-MM') AS month,
        SUM(amount) AS total_paise,
        COUNT(*) AS payment_count
      FROM payments
      WHERE tenant_id = ${tenantId}
        AND payment_date >= NOW() - make_interval(months => ${months})
      GROUP BY DATE_TRUNC('month', payment_date)
      ORDER BY month ASC
    `);

    res.json({
      months,
      data: (result.rows as Array<Record<string, unknown>>).map(r => ({
        month: r.month,
        totalPaise: Number(r.total_paise) || 0,
        paymentCount: Number(r.payment_count) || 0,
      })),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/mrr-trend — MRR approximation from invoices
// ---------------------------------------------------------------------------
router.get('/mrr-trend', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const months = Math.min(Number(req.query.months) || 6, 12);

  try {
    const [currentMrrRes, trendRes] = await Promise.all([
      db.execute(sql`
        SELECT COALESCE(SUM(retainer_amount), 0) AS current_mrr
        FROM billing_clients
        WHERE tenant_id = ${tenantId} AND is_active = true
      `),
      db.execute(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', invoice_date), 'YYYY-MM') AS month,
          SUM(total_amount) AS total_paise,
          COUNT(*) AS invoice_count
        FROM invoices
        WHERE tenant_id = ${tenantId}
          AND status NOT IN ('cancelled', 'draft')
          AND invoice_date >= NOW() - make_interval(months => ${months})
        GROUP BY DATE_TRUNC('month', invoice_date)
        ORDER BY month ASC
      `),
    ]);

    res.json({
      currentMrrPaise: Number((currentMrrRes.rows[0] as Record<string, unknown>)?.current_mrr) || 0,
      trend: (trendRes.rows as Array<Record<string, unknown>>).map(r => ({
        month: r.month,
        mrrPaise: Number(r.total_paise) || 0,
        invoiceCount: Number(r.invoice_count) || 0,
      })),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/team-performance — CRM-tasks-backed metrics per team member
// ---------------------------------------------------------------------------
router.get('/team-performance', requirePermission('REPORTS_VIEW'), async (_req: Request, res: Response) => {
  try {
    const { fetchTeamPerformance } = await import('../services/teamPerformanceService');
    const members = await fetchTeamPerformance();
    res.json({ members });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/attribution — UTM attribution report
// ---------------------------------------------------------------------------
router.get('/attribution', requirePermission('REPORTS_VIEW'), async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        metadata->>'utm_source' AS source,
        metadata->>'utm_medium' AS medium,
        metadata->>'utm_campaign' AS campaign,
        metadata->>'utm_content' AS content,
        COUNT(*) AS purchases,
        SUM((metadata->>'paidAmount')::numeric) AS total_revenue,
        ROUND(AVG((metadata->>'paidAmount')::numeric)) AS avg_order_value
      FROM contacts
      WHERE metadata->>'paymentStatus' = 'paid'
        AND metadata->>'utm_source' IS NOT NULL
      GROUP BY
        metadata->>'utm_source',
        metadata->>'utm_medium',
        metadata->>'utm_campaign',
        metadata->>'utm_content'
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attribution data' });
  }
});

export default router;
