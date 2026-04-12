import { Router, type Request, type Response } from 'express';
import { db, billingClients } from '../db/index';
import { eq, and, sql } from 'drizzle-orm';
import { requirePermission } from '../middleware/rbac';
import logger from '../utils/logger';

const router = Router();

const META_API_BASE = 'https://graph.facebook.com/v19.0';

// ---------------------------------------------------------------------------
// GET /api/clients/:clientId/360 — aggregated client view
// ---------------------------------------------------------------------------
router.get('/:clientId/360', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const clientId = String(req.params.clientId);

  try {
    const [client] = await db.select().from(billingClients)
      .where(and(eq(billingClients.id, clientId), eq(billingClients.tenantId, tenantId)))
      .limit(1);

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    // Parallel data fetches
    const [invoicesRes, paymentsRes, dealsRes, adMetrics, seoData] = await Promise.all([
      // Recent invoices
      db.execute(sql`
        SELECT id, invoice_number, invoice_date, due_date, total_amount, amount_paid, amount_due, status, invoice_type
        FROM invoices
        WHERE client_id = ${clientId} AND tenant_id = ${tenantId}
        ORDER BY invoice_date DESC LIMIT 10
      `).catch(() => ({ rows: [] })),

      // Recent payments
      db.execute(sql`
        SELECT p.id, p.amount, p.payment_date, p.payment_mode, p.reference, p.notes,
               i.invoice_number
        FROM payments p
        LEFT JOIN invoices i ON i.id = p.invoice_id
        WHERE p.client_id = ${clientId} AND p.tenant_id = ${tenantId}
        ORDER BY p.payment_date DESC LIMIT 10
      `).catch(() => ({ rows: [] })),

      // Deals (via CRM contact link)
      client.crmContactId
        ? db.execute(sql`
            SELECT id, title, stage, deal_value, assigned_to, updated_at, created_at
            FROM deals
            WHERE contact_id = ${client.crmContactId} AND tenant_id = ${tenantId}
            ORDER BY updated_at DESC LIMIT 10
          `).catch(() => ({ rows: [] }))
        : Promise.resolve({ rows: [] }),

      // Meta Ads (last 30 days)
      fetchAd30Days(client.metaAdAccountId),

      // SEO data (match by client name)
      fetchClientSeo(client.name),
    ]);

    res.json({
      client: {
        id: client.id,
        name: client.name,
        contactPerson: client.contactPerson,
        email: client.email,
        phone: client.phone,
        city: client.city,
        state: client.state,
        gstin: client.gstin,
        retainerAmount: client.retainerAmount,
        isGst: client.isGst,
        serviceDescription: client.serviceDescription,
        metaAdAccountId: client.metaAdAccountId,
      },
      invoices: invoicesRes.rows,
      payments: paymentsRes.rows,
      deals: dealsRes.rows,
      adMetrics,
      seo: seoData,
    });
  } catch (e) {
    logger.error('[client-360] error:', e);
    res.status(500).json({ error: 'Failed to fetch client data' });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fetchAd30Days(adAccountId: string | null): Promise<Record<string, unknown> | null> {
  if (!adAccountId) return null;
  const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!token) return null;

  try {
    const fields = 'spend,impressions,clicks,ctr,cpc,actions,action_values';
    const params = new URLSearchParams({ fields, date_preset: 'last_30d', level: 'account', access_token: token });
    const url = `${META_API_BASE}/${adAccountId}/insights?${params.toString()}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await r.json() as { data?: Array<Record<string, unknown>>; error?: Record<string, string> };
    if (data.error || !data.data?.[0]) return null;

    const row = data.data[0];
    const actions = (row.actions as Array<{ action_type: string; value: string }>) || [];
    const actionValues = (row.action_values as Array<{ action_type: string; value: string }>) || [];
    const purchases = actions.filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase').reduce((s, a) => s + Number(a.value || 0), 0);
    const purchaseValue = actionValues.filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase').reduce((s, a) => s + Number(a.value || 0), 0);
    const spend = Number(row.spend || 0);

    return {
      spend: Math.round(spend * 100) / 100,
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      ctr: Math.round(Number(row.ctr || 0) * 100) / 100,
      cpc: Math.round(Number(row.cpc || 0) * 100) / 100,
      purchases,
      purchaseValue: Math.round(purchaseValue * 100) / 100,
      roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
      period: 'last_30d',
    };
  } catch {
    return null;
  }
}

async function fetchClientSeo(clientName: string): Promise<Record<string, unknown> | null> {
  const { pool } = await import('../db/index');
  try {
    // Try to find SEO data by matching client name to seo_weekly_metrics
    const domainRes = await pool.query(
      `SELECT DISTINCT client_domain FROM seo_weekly_metrics WHERE client_name ILIKE $1 OR project_name ILIKE $1 LIMIT 1`,
      [`%${clientName.split(' ')[0]}%`],
    );
    const domain = (domainRes.rows[0] as { client_domain?: string })?.client_domain;
    if (!domain) return null;

    const [keywordsRes, healthRes] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE current_position < previous_position) AS improved,
          COUNT(*) FILTER (WHERE current_position > previous_position) AS dropped
        FROM keyword_rankings WHERE client_domain = $1
      `, [domain]),
      pool.query(`
        SELECT pagespeed_mobile, pagespeed_desktop, checked_at
        FROM site_health_metrics
        ORDER BY checked_at DESC LIMIT 1
      `),
    ]);

    const kw = keywordsRes.rows[0] as Record<string, string>;
    const health = healthRes.rows[0] as Record<string, unknown> | undefined;

    return {
      domain,
      totalKeywords: Number(kw?.total ?? 0),
      keywordsImproved: Number(kw?.improved ?? 0),
      keywordsDropped: Number(kw?.dropped ?? 0),
      mobileScore: health?.pagespeed_mobile != null ? Number(health.pagespeed_mobile) : null,
      desktopScore: health?.pagespeed_desktop != null ? Number(health.pagespeed_desktop) : null,
    };
  } catch {
    return null;
  }
}

export default router;
