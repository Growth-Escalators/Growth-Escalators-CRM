import { Router, type Request, type Response } from 'express';
import { db, pool } from '../db/index';
import { sql } from 'drizzle-orm';
import { requirePermission } from '../middleware/rbac';
import { DEFAULT_TENANT_SLUG } from '../config/constants';

const router = Router();

// ---------------------------------------------------------------------------
// GE-tenant-only gate — used by /team-performance below. That route reads
// a hardcoded GE staff roster with no tenant dimension at all; scoping the
// underlying `tasks` query by tenant_id would still surface the roster
// itself (with all-zero counts) to every reseller. Block instead. See
// src/services/teamPerformanceService.ts.
// ---------------------------------------------------------------------------
let _geTenantIdPromise: Promise<string | null> | null = null;
async function resolveGeTenantId(): Promise<string | null> {
  if (!_geTenantIdPromise) {
    _geTenantIdPromise = pool.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [DEFAULT_TENANT_SLUG])
      .then(r => (r.rows[0] as { id?: string } | undefined)?.id ?? null)
      .catch(() => null);
  }
  const id = await _geTenantIdPromise;
  if (!id) _geTenantIdPromise = null; // allow retry on next request if the lookup failed
  return id;
}

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
  const since = (req.query.since as string) || '';
  const until = (req.query.until as string) || '';
  const useCustom = /^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until);
  const months = Math.min(Number(req.query.months) || 12, 24);

  try {
    const result = useCustom
      ? await db.execute(sql`
          SELECT
            TO_CHAR(DATE_TRUNC('month', payment_date), 'YYYY-MM') AS month,
            SUM(amount) AS total_paise,
            COUNT(*) AS payment_count
          FROM payments
          WHERE tenant_id = ${tenantId}
            AND payment_date >= ${since}::date
            AND payment_date <  (${until}::date + INTERVAL '1 day')
          GROUP BY DATE_TRUNC('month', payment_date)
          ORDER BY month ASC
        `)
      : await db.execute(sql`
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
      months: useCustom ? null : months,
      range: useCustom ? { since, until } : null,
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
  const since = (req.query.since as string) || '';
  const until = (req.query.until as string) || '';
  const useCustom = /^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until);
  const months = Math.min(Number(req.query.months) || 6, 12);

  try {
    const trendQuery = useCustom
      ? sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', invoice_date), 'YYYY-MM') AS month,
          SUM(total_amount) AS total_paise,
          COUNT(*) AS invoice_count
        FROM invoices
        WHERE tenant_id = ${tenantId}
          AND status NOT IN ('cancelled', 'draft')
          AND invoice_date >= ${since}::date
          AND invoice_date <  (${until}::date + INTERVAL '1 day')
        GROUP BY DATE_TRUNC('month', invoice_date)
        ORDER BY month ASC
      `
      : sql`
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
      `;

    const [currentMrrRes, trendRes] = await Promise.all([
      db.execute(sql`
        SELECT COALESCE(SUM(retainer_amount), 0) AS current_mrr
        FROM billing_clients
        WHERE tenant_id = ${tenantId} AND is_active = true
      `),
      db.execute(trendQuery),
    ]);

    res.json({
      currentMrrPaise: Number((currentMrrRes.rows[0] as Record<string, unknown>)?.current_mrr) || 0,
      range: useCustom ? { since, until } : null,
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
router.get('/team-performance', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  try {
    const geTenantId = await resolveGeTenantId();
    if (!geTenantId || req.user?.tenantId !== geTenantId) {
      res.status(403).json({ error: 'Not available for this tenant' });
      return;
    }
    const { fetchTeamPerformance } = await import('../services/teamPerformanceService');
    const members = await fetchTeamPerformance();
    res.json({ members });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/website-attribution — website lead quality + revenue
//
// Cohort semantics: a lead belongs to the period in which the CRM contact was
// first created. Later won deal value and actual payments are attributed back
// to that acquired lead. Payment attribution only applies where billing_clients
// has crm_contact_id linked to the originating CRM contact.
// ---------------------------------------------------------------------------
router.get('/website-attribution', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const since = String(req.query.since || '');
  const until = String(req.query.until || '');
  const useCustom = /^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until);
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 730);
  const params: unknown[] = [tenantId, ...(useCustom ? [since, until] : [days])];
  const timeWhere = useCustom
    ? `AND c.created_at >= $2::date AND c.created_at < ($3::date + INTERVAL '1 day')`
    : `AND c.created_at >= NOW() - make_interval(days => $2::int)`;

  const websiteCte = `
    WITH website_contacts AS (
      SELECT
        c.id,
        CASE
          WHEN c.metadata->'firstWebsiteAttribution'->>'utmSource' IS NOT NULL
            AND c.metadata->'firstWebsiteAttribution'->>'utmSource' <> ''
            THEN lower(c.metadata->'firstWebsiteAttribution'->>'utmSource')
          WHEN COALESCE(
            NULLIF(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', ''),
            NULLIF(c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', ''),
            ''
          ) = '' THEN 'direct'
          WHEN COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') ILIKE '%google.%' THEN 'google'
          WHEN COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') ILIKE '%bing.%' THEN 'bing'
          ELSE 'referral'
        END AS first_source,
        CASE
          WHEN NULLIF(c.metadata->'firstWebsiteAttribution'->>'utmMedium', '') IS NOT NULL
            THEN lower(c.metadata->'firstWebsiteAttribution'->>'utmMedium')
          WHEN COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') = '' THEN 'none'
          WHEN COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') ILIKE '%google.%'
            OR COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') ILIKE '%bing.%' THEN 'organic'
          ELSE 'referral'
        END AS first_medium,
        COALESCE(
          NULLIF(c.metadata->'firstWebsiteAttribution'->>'landingPage', ''),
          NULLIF(c.metadata->'firstWebsiteAttribution'->>'firstLandingPage', ''),
          '(unknown)'
        ) AS first_landing_page,
        COALESCE(
          NULLIF(c.metadata->'lastWebsiteAttribution'->>'utmSource', ''),
          NULLIF(c.metadata->'firstWebsiteAttribution'->>'utmSource', ''),
          CASE
            WHEN COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') = '' THEN 'direct'
            WHEN COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') ILIKE '%google.%' THEN 'google'
            WHEN COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') ILIKE '%bing.%' THEN 'bing'
            ELSE 'referral'
          END
        ) AS last_source,
        COALESCE(
          NULLIF(c.metadata->'lastWebsiteAttribution'->>'utmMedium', ''),
          NULLIF(c.metadata->'firstWebsiteAttribution'->>'utmMedium', ''),
          CASE
            WHEN COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') = '' THEN 'none'
            WHEN COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') ILIKE '%google.%'
              OR COALESCE(c.metadata->'firstWebsiteAttribution'->>'referrerUrl', c.metadata->'firstWebsiteAttribution'->>'firstReferrerUrl', '') ILIKE '%bing.%' THEN 'organic'
            ELSE 'referral'
          END
        ) AS last_medium,
        COALESCE(
          NULLIF(c.metadata->'latestWebsiteConversion'->>'conversionPage', ''),
          NULLIF(c.metadata->'latestWebsiteLead'->>'conversionPage', ''),
          NULLIF(c.metadata->'lastWebsiteAttribution'->>'landingPage', ''),
          NULLIF(c.metadata->'lastWebsiteAttribution'->>'lastLandingPage', ''),
          '(unknown)'
        ) AS conversion_page,
        lower(COALESCE(c.metadata->>'leadQuality', '')) AS lead_quality,
        CASE
          WHEN COALESCE(c.metadata->>'websiteLeadCount', '') ~ '^\\d+$'
            THEN GREATEST((c.metadata->>'websiteLeadCount')::int, 1)
          ELSE 1
        END AS submission_count
      FROM contacts c
      WHERE c.tenant_id = $1
        AND (c.source = 'website' OR 'website_lead' = ANY(COALESCE(c.tags, ARRAY[]::text[])))
        ${timeWhere}
    ),
    deal_rollup AS (
      SELECT
        d.contact_id,
        COUNT(*) FILTER (WHERE d.stage = 'won')::int AS won_deals,
        COALESCE(SUM(COALESCE(d.deal_value, 0)) FILTER (WHERE d.stage = 'won'), 0)::bigint AS won_deal_value
      FROM deals d
      WHERE d.tenant_id = $1
        AND COALESCE(d.metadata->>'archived', 'false') <> 'true'
      GROUP BY d.contact_id
    ),
    payment_rollup AS (
      SELECT
        bc.crm_contact_id AS contact_id,
        COALESCE(SUM(p.amount), 0)::bigint AS received_revenue_paise
      FROM payments p
      JOIN billing_clients bc
        ON bc.id = p.client_id
       AND bc.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1
        AND bc.crm_contact_id IS NOT NULL
      GROUP BY bc.crm_contact_id
    ),
    cohort AS (
      SELECT
        wc.*,
        COALESCE(dr.won_deals, 0) AS won_deals,
        COALESCE(dr.won_deal_value, 0) AS won_deal_value,
        COALESCE(pr.received_revenue_paise, 0) AS received_revenue_paise
      FROM website_contacts wc
      LEFT JOIN deal_rollup dr ON dr.contact_id = wc.id
      LEFT JOIN payment_rollup pr ON pr.contact_id = wc.id
    )
  `;

  const dimensionQuery = (dimensionSql: string) => `${websiteCte}
    SELECT
      ${dimensionSql} AS label,
      COUNT(*)::int AS leads,
      COALESCE(SUM(submission_count), 0)::int AS submissions,
      COUNT(*) FILTER (WHERE lead_quality <> '')::int AS reviewed,
      COUNT(*) FILTER (WHERE lead_quality IN ('hot', 'good'))::int AS qualified,
      COALESCE(SUM(won_deals), 0)::int AS won_deals,
      COALESCE(SUM(won_deal_value), 0)::bigint AS won_deal_value,
      COALESCE(SUM(received_revenue_paise), 0)::bigint AS received_revenue_paise
    FROM cohort
    GROUP BY ${dimensionSql}
    ORDER BY received_revenue_paise DESC, won_deal_value DESC, qualified DESC, leads DESC
    LIMIT 50
  `;

  try {
    const [totalsResult, firstSourcesResult, lastSourcesResult, firstPagesResult, conversionPagesResult] = await Promise.all([
      pool.query(`${websiteCte}
        SELECT
          COUNT(*)::int AS leads,
          COALESCE(SUM(submission_count), 0)::int AS submissions,
          COUNT(*) FILTER (WHERE lead_quality <> '')::int AS reviewed,
          COUNT(*) FILTER (WHERE lead_quality IN ('hot', 'good'))::int AS qualified,
          COALESCE(SUM(won_deals), 0)::int AS won_deals,
          COALESCE(SUM(won_deal_value), 0)::bigint AS won_deal_value,
          COALESCE(SUM(received_revenue_paise), 0)::bigint AS received_revenue_paise
        FROM cohort
      `, params),
      pool.query(dimensionQuery(`first_source || CASE WHEN first_medium <> '' THEN ' · ' || first_medium ELSE '' END`), params),
      pool.query(dimensionQuery(`last_source || CASE WHEN last_medium <> '' THEN ' · ' || last_medium ELSE '' END`), params),
      pool.query(dimensionQuery('first_landing_page'), params),
      pool.query(dimensionQuery('conversion_page'), params),
    ]);

    const normalizeRows = (rows: Array<Record<string, unknown>>) => rows.map(row => ({
      label: String(row.label || '(unknown)'),
      leads: Number(row.leads) || 0,
      submissions: Number(row.submissions) || 0,
      reviewed: Number(row.reviewed) || 0,
      qualified: Number(row.qualified) || 0,
      wonDeals: Number(row.won_deals) || 0,
      wonDealValue: Number(row.won_deal_value) || 0,
      receivedRevenuePaise: Number(row.received_revenue_paise) || 0,
    }));
    const totalsRow = (totalsResult.rows[0] || {}) as Record<string, unknown>;
    const reviewed = Number(totalsRow.reviewed) || 0;
    const qualified = Number(totalsRow.qualified) || 0;
    const leads = Number(totalsRow.leads) || 0;

    res.json({
      window: useCustom ? { since, until } : { days },
      totals: {
        leads,
        submissions: Number(totalsRow.submissions) || 0,
        reviewed,
        qualified,
        wonDeals: Number(totalsRow.won_deals) || 0,
        wonDealValue: Number(totalsRow.won_deal_value) || 0,
        receivedRevenuePaise: Number(totalsRow.received_revenue_paise) || 0,
        qualificationRate: reviewed > 0 ? Math.round((qualified / reviewed) * 100) : 0,
        reviewRate: leads > 0 ? Math.round((reviewed / leads) * 100) : 0,
      },
      firstSources: normalizeRows(firstSourcesResult.rows as Array<Record<string, unknown>>),
      lastSources: normalizeRows(lastSourcesResult.rows as Array<Record<string, unknown>>),
      firstLandingPages: normalizeRows(firstPagesResult.rows as Array<Record<string, unknown>>),
      conversionPages: normalizeRows(conversionPagesResult.rows as Array<Record<string, unknown>>),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch website attribution' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/attribution — UTM attribution report
// ---------------------------------------------------------------------------
router.get('/attribution', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
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
      WHERE tenant_id = $1
        AND metadata->>'paymentStatus' = 'paid'
        AND metadata->>'utm_source' IS NOT NULL
      GROUP BY
        metadata->>'utm_source',
        metadata->>'utm_medium',
        metadata->>'utm_campaign',
        metadata->>'utm_content'
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `, [tenantId]);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attribution data' });
  }
});

export default router;
