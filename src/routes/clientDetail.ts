import { Router, type Request, type Response } from 'express';
import { db, billingClients } from '../db/index';
import { eq, and, sql } from 'drizzle-orm';
import { requirePermission } from '../middleware/rbac';
import logger from '../utils/logger';

const router = Router();

const META_API_BASE = 'https://graph.facebook.com/v19.0';

// ---------------------------------------------------------------------------
// GET /api/clients — list every billing client with retainer/billing rollups
// Used by the CRM Clients list view. Returns small, denormalized cards built
// from one query plus three grouped subqueries (no N+1).
// ---------------------------------------------------------------------------
router.get('/', requirePermission('CONTACTS_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';

  try {
    const { pool } = await import('../db/index');

    // Translate the user-facing status filter onto billing_clients.is_active.
    // We support 'active' | 'churned' | 'paused' but only 'active'/'churned'
    // map cleanly today; 'paused' falls back to is_active=false same as churned.
    let isActiveCondition = sql``;
    if (statusFilter === 'active') {
      isActiveCondition = sql`AND bc.is_active = true`;
    } else if (statusFilter === 'churned' || statusFilter === 'paused') {
      isActiveCondition = sql`AND bc.is_active = false`;
    }

    // Base list — one row per billing_client, primary contact name resolved
    // either from billing_clients.contact_person or the linked CRM contact.
    const baseRes = await db.execute(sql`
      SELECT
        bc.id,
        bc.name,
        bc.is_active,
        bc.crm_contact_id,
        bc.updated_at,
        COALESCE(
          NULLIF(TRIM(bc.contact_person), ''),
          NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')
        ) AS primary_contact_name
      FROM billing_clients bc
      LEFT JOIN contacts c ON c.id = bc.crm_contact_id
      WHERE bc.tenant_id = ${tenantId}
      ${isActiveCondition}
      ORDER BY bc.is_active DESC, bc.updated_at DESC
    `);

    const baseRows = baseRes.rows as Array<{
      id: string;
      name: string;
      is_active: boolean | null;
      crm_contact_id: string | null;
      updated_at: string | Date | null;
      primary_contact_name: string | null;
    }>;

    if (baseRows.length === 0) {
      res.json({ clients: [], total: 0 });
      return;
    }

    const clientIds = baseRows.map(r => r.id);
    const contactIds = baseRows.map(r => r.crm_contact_id).filter((x): x is string => !!x);

    // Parallel grouped rollups: invoices (MRR + lifetime + open + last-paid)
    // and deals (won count + last won timestamp).
    const [invRes, dealRes] = await Promise.all([
      pool.query(
        `SELECT
           client_id,
           COALESCE(SUM(CASE
             WHEN status = 'paid' AND paid_at >= NOW() - INTERVAL '30 days'
             THEN amount_paid ELSE 0 END), 0)::bigint AS mrr,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_paid ELSE 0 END), 0)::bigint AS lifetime_value,
           COUNT(*) FILTER (WHERE status IN ('sent', 'overdue', 'partially_paid'))::int AS open_invoice_count,
           COALESCE(SUM(CASE WHEN status IN ('sent', 'overdue', 'partially_paid') THEN amount_due ELSE 0 END), 0)::bigint AS open_invoice_amount,
           MAX(paid_at) AS last_invoice_paid_at
         FROM invoices
         WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])
         GROUP BY client_id`,
        [tenantId, clientIds],
      ),
      contactIds.length > 0
        ? pool.query(
            `SELECT
               contact_id,
               COUNT(*)::int AS total_deals_won,
               MAX(COALESCE(closed_at, updated_at)) AS last_deal_won_at
             FROM deals
             WHERE tenant_id = $1 AND contact_id = ANY($2::uuid[]) AND stage = 'won'
             GROUP BY contact_id`,
            [tenantId, contactIds],
          )
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);

    const invByClient = new Map<string, {
      mrr: number;
      lifetime_value: number;
      open_invoice_count: number;
      open_invoice_amount: number;
      last_invoice_paid_at: string | Date | null;
    }>();
    for (const row of invRes.rows as Array<{
      client_id: string;
      mrr: string | number;
      lifetime_value: string | number;
      open_invoice_count: number;
      open_invoice_amount: string | number;
      last_invoice_paid_at: string | Date | null;
    }>) {
      invByClient.set(row.client_id, {
        mrr: Number(row.mrr ?? 0),
        lifetime_value: Number(row.lifetime_value ?? 0),
        open_invoice_count: Number(row.open_invoice_count ?? 0),
        open_invoice_amount: Number(row.open_invoice_amount ?? 0),
        last_invoice_paid_at: row.last_invoice_paid_at,
      });
    }

    const dealsByContact = new Map<string, {
      total_deals_won: number;
      last_deal_won_at: string | Date | null;
    }>();
    for (const row of dealRes.rows as Array<{
      contact_id: string;
      total_deals_won: number;
      last_deal_won_at: string | Date | null;
    }>) {
      dealsByContact.set(row.contact_id, {
        total_deals_won: Number(row.total_deals_won ?? 0),
        last_deal_won_at: row.last_deal_won_at,
      });
    }

    const toIso = (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      try {
        const d = value instanceof Date ? value : new Date(value);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      } catch {
        return null;
      }
    };

    const maxIso = (...values: Array<string | null>): string | null => {
      let best: number | null = null;
      let bestIso: string | null = null;
      for (const v of values) {
        if (!v) continue;
        const t = new Date(v).getTime();
        if (Number.isNaN(t)) continue;
        if (best === null || t > best) {
          best = t;
          bestIso = v;
        }
      }
      return bestIso;
    };

    const clientsOut = baseRows.map((row) => {
      const inv = invByClient.get(row.id);
      const dealsAgg = row.crm_contact_id ? dealsByContact.get(row.crm_contact_id) : undefined;
      const lastInvoicePaidAt = toIso(inv?.last_invoice_paid_at ?? null);
      const lastDealWonAt = toIso(dealsAgg?.last_deal_won_at ?? null);
      const updatedAt = toIso(row.updated_at);

      return {
        id: row.id,
        name: row.name,
        status: row.is_active ? 'active' : 'churned',
        primaryContactName: row.primary_contact_name ?? null,
        mrr: inv?.mrr ?? 0,
        lifetimeValue: inv?.lifetime_value ?? 0,
        openInvoiceCount: inv?.open_invoice_count ?? 0,
        openInvoiceAmount: inv?.open_invoice_amount ?? 0,
        lastInvoicePaidAt,
        totalDealsWon: dealsAgg?.total_deals_won ?? 0,
        lastActivityAt: maxIso(lastInvoicePaidAt, lastDealWonAt, updatedAt),
      };
    });

    res.json({ clients: clientsOut, total: clientsOut.length });
  } catch (e) {
    logger.error('[clients-list] error:', e);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

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
      fetchClientSeo(client.name, tenantId),
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

async function fetchClientSeo(clientName: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const { pool } = await import('../db/index');
  try {
    // Try to find SEO data by matching client name to seo_weekly_metrics
    const domainRes = await pool.query(
      `SELECT DISTINCT client_domain FROM seo_weekly_metrics WHERE (client_name ILIKE $1 OR project_name ILIKE $1) AND tenant_id = $2 LIMIT 1`,
      [`%${clientName.split(' ')[0]}%`, tenantId],
    );
    const domain = (domainRes.rows[0] as { client_domain?: string })?.client_domain;
    if (!domain) return null;

    const [keywordsRes, healthRes] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE current_position < previous_position) AS improved,
          COUNT(*) FILTER (WHERE current_position > previous_position) AS dropped
        FROM keyword_rankings WHERE client_domain = $1 AND tenant_id = $2
      `, [domain, tenantId]),
      pool.query(`
        SELECT pagespeed_mobile, pagespeed_desktop, checked_at
        FROM site_health_metrics
        WHERE tenant_id = $1
        ORDER BY checked_at DESC LIMIT 1
      `, [tenantId]),
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

// GET /api/clients/:clientId/quick-update — plain text client summary for copy-paste
router.get('/:clientId/quick-update', requirePermission('REPORTS_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const clientId = String(req.params.clientId);

  try {
    const [client] = await db.select().from(billingClients)
      .where(and(eq(billingClients.id, clientId), eq(billingClients.tenantId, tenantId)))
      .limit(1);
    if (!client) { res.status(404).json({ error: 'Client not found' }); return; }

    const { pool: dbPool } = await import('../db/index');
    const fmtINR = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

    // Ads (last 7 days)
    let adsText = 'No ad account linked';
    if (client.metaAdAccountId) {
      const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
      if (token) {
        try {
          const r = await fetch(`https://graph.facebook.com/v19.0/${client.metaAdAccountId}/insights?fields=spend,impressions,clicks,actions,action_values&date_preset=last_7d&level=account&access_token=${token}`, { signal: AbortSignal.timeout(10000) });
          const d = await r.json() as { data?: Array<Record<string, unknown>> };
          const row = d?.data?.[0];
          if (row) {
            const spend = Number(row.spend || 0);
            const actions = (row.actions as Array<{action_type:string;value:string}>) || [];
            const actionValues = (row.action_values as Array<{action_type:string;value:string}>) || [];
            const purchases = actions.filter(a => a.action_type.includes('purchase')).reduce((s, a) => s + Number(a.value), 0);
            const revenue = actionValues.filter(a => a.action_type.includes('purchase')).reduce((s, a) => s + Number(a.value), 0);
            const roas = spend > 0 ? (revenue / spend).toFixed(1) : '0';
            adsText = `Spend: ₹${Math.round(spend).toLocaleString('en-IN')} | ROAS: ${roas}x | Purchases: ${purchases}`;
          }
        } catch { adsText = 'Ad data unavailable'; }
      }
    }

    // SEO
    let seoText = 'No SEO data';
    try {
      const kw = await dbPool.query(`
        SELECT COUNT(*) FILTER (WHERE current_position < previous_position) AS improved,
               COUNT(*) FILTER (WHERE current_position > previous_position) AS dropped
        FROM keyword_rankings WHERE tenant_id = $1
      `, [tenantId]);
      const health = await dbPool.query(`SELECT pagespeed_mobile, pagespeed_desktop FROM site_health_metrics WHERE tenant_id = $1 ORDER BY checked_at DESC LIMIT 1`, [tenantId]);
      const k = kw.rows[0] as Record<string, string>;
      const h = health.rows[0] as Record<string, string> | undefined;
      seoText = `${k?.improved || 0} keywords ↑, ${k?.dropped || 0} ↓`;
      if (h) seoText += `\n• PageSpeed: Mobile ${h.pagespeed_mobile || '—'}, Desktop ${h.pagespeed_desktop || '—'}`;
    } catch {}

    // Billing
    let billingText = 'No invoices';
    try {
      const inv = await dbPool.query(`
        SELECT invoice_number, status, due_date FROM invoices
        WHERE client_id = $1 AND tenant_id = $2 AND status != 'cancelled'
        ORDER BY invoice_date DESC LIMIT 1
      `, [clientId, tenantId]);
      const i = inv.rows[0] as Record<string, string> | undefined;
      if (i) {
        const statusEmoji = i.status === 'paid' ? 'Paid ✅' : i.status === 'sent' ? 'Sent' : i.status === 'overdue' ? 'Overdue ⚠️' : i.status;
        billingText = `Last: ${i.invoice_number} — ${statusEmoji}`;
        if (i.due_date) billingText += `\n• Next due: ${new Date(i.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      }
    } catch {}

    const text = `📊 Growth Escalators — ${client.name}\n\nMeta Ads (last 7 days):\n• ${adsText}\n\nSEO:\n• ${seoText}\n\nBilling:\n• ${billingText}`;

    res.json({ text, clientName: client.name });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate update' });
  }
});

export default router;
