import { Router, type Request, type Response } from 'express';
import { db } from '../db/index';
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

export default router;
