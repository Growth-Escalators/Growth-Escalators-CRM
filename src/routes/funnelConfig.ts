/**
 * funnelConfig.ts — CRUD for funnel_configs table
 *
 * Routes (all require JWT auth via parent mount):
 *   GET    /api/funnel-configs            — list all funnel configs for tenant
 *   GET    /api/funnel-configs/:slug      — get single config by slug
 *   POST   /api/funnel-configs            — create new funnel config
 *   PATCH  /api/funnel-configs/:id        — partial update funnel config
 *   DELETE /api/funnel-configs/:id        — soft delete (set is_active = FALSE)
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import { listFunnelConfigs, getFunnelConfig } from '../services/funnelConfigService';

const router = Router();

// ---------------------------------------------------------------------------
// GET /public/:slug — PUBLIC endpoint (no auth) for frontend checkout
// Returns only display-safe fields (no WA templates, no Slack config)
// ---------------------------------------------------------------------------
router.get('/public/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const slug = String(req.params.slug);
    const result = await pool.query(
      `SELECT slug, name, is_active, base_price, bump1_price, bump2_price, bump1_label, bump2_label,
              product_name, product_labels, main_pdf_url, bump1_pdf_url, bump2_booking_url,
              pipeline_name, pipeline_stages, service_type,
              hero_headline, hero_subheadline, cta_text, accent_color,
              segment_options, testimonials, post_purchase_route, brand_names,
              bump1_description, bump2_description, main_product_description,
              bonus_products
       FROM funnel_configs WHERE slug = $1 AND is_active = TRUE LIMIT 1`,
      [slug],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'funnel not found' });
      return;
    }
    res.json({ ok: true, config: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET / — list all funnel configs for tenant
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const configs = await listFunnelConfigs(tenantId);
    res.json({ ok: true, configs });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /:slug — get single config by slug
// ---------------------------------------------------------------------------
router.get('/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const config = await getFunnelConfig(String(req.params.slug), tenantId);
    if (!config) {
      res.status(404).json({ error: 'funnel config not found' });
      return;
    }
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// Field reader — accept both snake_case (canonical) and camelCase (admin form
// historically sent camelCase; defensive so neither side has to win the
// renaming race).
// ---------------------------------------------------------------------------
function f<T = unknown>(body: Record<string, unknown>, snake: string, camel: string): T | undefined {
  const v = body[snake] ?? body[camel];
  return v as T | undefined;
}

// pipeline_stages comes in as either a JSON-string or an actual array depending
// on the client. Normalise to a JSON string for storage; tolerate either input.
function normaliseStages(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    if (t.startsWith('[')) return t;             // already JSON
    return JSON.stringify(t.split(',').map(s => s.trim()).filter(Boolean));
  }
  if (Array.isArray(v)) return JSON.stringify(v);
  return null;
}

function normaliseJson(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    return t;
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// POST / — create new funnel config
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const b = (req.body ?? {}) as Record<string, unknown>;

    const slug             = f<string>(b, 'slug', 'slug');
    const name             = f<string>(b, 'name', 'name');
    const is_active        = f<boolean>(b, 'is_active', 'isActive');
    const base_price       = f<number>(b, 'base_price', 'basePrice');
    const bump1_price      = f<number>(b, 'bump1_price', 'bump1Price');
    const bump2_price      = f<number>(b, 'bump2_price', 'bump2Price');
    const bump1_label      = f<string>(b, 'bump1_label', 'bump1Label');
    const bump2_label      = f<string>(b, 'bump2_label', 'bump2Label');
    const product_name     = f<string>(b, 'product_name', 'productName');
    const product_labels   = f(b, 'product_labels', 'productLabels');
    const main_product_description = f<string>(b, 'main_product_description', 'mainProductDescription');
    const bump1_description = f<string>(b, 'bump1_description', 'bump1Description');
    const bump2_description = f<string>(b, 'bump2_description', 'bump2Description');
    const main_pdf_url     = f<string>(b, 'main_pdf_url', 'mainPdfUrl');
    const bump1_pdf_url    = f<string>(b, 'bump1_pdf_url', 'bump1PdfUrl');
    const bump2_booking_url = f<string>(b, 'bump2_booking_url', 'bump2BookingUrl');
    const wa_template_name = f<string>(b, 'wa_template_name', 'waTemplateName');
    const wa_msg1_template = f<string>(b, 'wa_msg1_template', 'waMsg1Template');
    const wa_msg2_template = f<string>(b, 'wa_msg2_template', 'waMsg2Template');
    const wa_msg3_template = f<string>(b, 'wa_msg3_template', 'waMsg3Template');
    const email_subject    = f<string>(b, 'email_subject', 'emailSubject');
    const email_body       = f<string>(b, 'email_body', 'emailBody');
    const pipeline_name    = f<string>(b, 'pipeline_name', 'pipelineName');
    const pipeline_stages  = f(b, 'pipeline_stages', 'pipelineStages');
    const sequence_name    = f<string>(b, 'sequence_name', 'sequenceName');
    const slack_channel    = f<string>(b, 'slack_channel', 'slackChannel');
    const slack_emoji      = f<string>(b, 'slack_emoji', 'slackEmoji');
    const slack_label      = f<string>(b, 'slack_label', 'slackLabel');
    const service_type     = f<string>(b, 'service_type', 'serviceType');
    const hero_headline    = f<string>(b, 'hero_headline', 'heroHeadline');
    const hero_subheadline = f<string>(b, 'hero_subheadline', 'heroSubheadline');
    const cta_text         = f<string>(b, 'cta_text', 'ctaText');
    const accent_color     = f<string>(b, 'accent_color', 'accentColor');
    const segment_options  = f(b, 'segment_options', 'segmentOptions');
    const testimonials     = f(b, 'testimonials', 'testimonials');
    const brand_names      = f(b, 'brand_names', 'brandNames');
    const post_purchase_route = f<string>(b, 'post_purchase_route', 'postPurchaseRoute');
    const bonus_products   = f(b, 'bonus_products', 'bonusProducts');

    if (!slug || !name || base_price == null || !product_name || !pipeline_name || !pipeline_stages) {
      res.status(400).json({ error: 'slug, name, base_price, product_name, pipeline_name, and pipeline_stages are required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO funnel_configs (
        tenant_id, slug, name, is_active,
        base_price, bump1_price, bump2_price, bump1_label, bump2_label,
        product_name, product_labels,
        main_product_description, bump1_description, bump2_description,
        main_pdf_url, bump1_pdf_url, bump2_booking_url,
        wa_template_name, wa_msg1_template, wa_msg2_template, wa_msg3_template,
        email_subject, email_body,
        pipeline_name, pipeline_stages,
        sequence_name,
        slack_channel, slack_emoji, slack_label,
        service_type,
        hero_headline, hero_subheadline, cta_text, accent_color,
        segment_options, testimonials, brand_names, post_purchase_route,
        bonus_products
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39
      ) RETURNING *`,
      [
        tenantId, slug, name, is_active ?? true,
        base_price, bump1_price ?? null, bump2_price ?? null, bump1_label ?? null, bump2_label ?? null,
        product_name, product_labels ? JSON.stringify(product_labels) : '{}',
        main_product_description ?? null, bump1_description ?? null, bump2_description ?? null,
        main_pdf_url ?? null, bump1_pdf_url ?? null, bump2_booking_url ?? null,
        wa_template_name ?? null, wa_msg1_template ?? null, wa_msg2_template ?? null, wa_msg3_template ?? null,
        email_subject ?? null, email_body ?? null,
        pipeline_name, normaliseStages(pipeline_stages) ?? '[]',
        sequence_name ?? null,
        slack_channel ?? null, slack_emoji ?? '\u{1F4B0}', slack_label ?? 'New Purchase',
        service_type ?? 'funnel',
        hero_headline ?? null, hero_subheadline ?? null, cta_text ?? null, accent_color ?? null,
        normaliseJson(segment_options), normaliseJson(testimonials), normaliseJson(brand_names), post_purchase_route ?? null,
        normaliseJson(bonus_products) ?? '[]',
      ],
    );

    res.status(201).json({ ok: true, config: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id — partial update funnel config
// ---------------------------------------------------------------------------
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const { id } = req.params;
    const b = (req.body ?? {}) as Record<string, unknown>;

    const slug             = f<string>(b, 'slug', 'slug');
    const name             = f<string>(b, 'name', 'name');
    const is_active        = f<boolean>(b, 'is_active', 'isActive');
    const base_price       = f<number>(b, 'base_price', 'basePrice');
    const bump1_price      = f<number>(b, 'bump1_price', 'bump1Price');
    const bump2_price      = f<number>(b, 'bump2_price', 'bump2Price');
    const bump1_label      = f<string>(b, 'bump1_label', 'bump1Label');
    const bump2_label      = f<string>(b, 'bump2_label', 'bump2Label');
    const product_name     = f<string>(b, 'product_name', 'productName');
    const product_labels   = f(b, 'product_labels', 'productLabels');
    const main_product_description = f<string>(b, 'main_product_description', 'mainProductDescription');
    const bump1_description = f<string>(b, 'bump1_description', 'bump1Description');
    const bump2_description = f<string>(b, 'bump2_description', 'bump2Description');
    const main_pdf_url     = f<string>(b, 'main_pdf_url', 'mainPdfUrl');
    const bump1_pdf_url    = f<string>(b, 'bump1_pdf_url', 'bump1PdfUrl');
    const bump2_booking_url = f<string>(b, 'bump2_booking_url', 'bump2BookingUrl');
    const wa_template_name = f<string>(b, 'wa_template_name', 'waTemplateName');
    const wa_msg1_template = f<string>(b, 'wa_msg1_template', 'waMsg1Template');
    const wa_msg2_template = f<string>(b, 'wa_msg2_template', 'waMsg2Template');
    const wa_msg3_template = f<string>(b, 'wa_msg3_template', 'waMsg3Template');
    const email_subject    = f<string>(b, 'email_subject', 'emailSubject');
    const email_body       = f<string>(b, 'email_body', 'emailBody');
    const pipeline_name    = f<string>(b, 'pipeline_name', 'pipelineName');
    const pipeline_stages  = f(b, 'pipeline_stages', 'pipelineStages');
    const sequence_name    = f<string>(b, 'sequence_name', 'sequenceName');
    const slack_channel    = f<string>(b, 'slack_channel', 'slackChannel');
    const slack_emoji      = f<string>(b, 'slack_emoji', 'slackEmoji');
    const slack_label      = f<string>(b, 'slack_label', 'slackLabel');
    const service_type     = f<string>(b, 'service_type', 'serviceType');
    const hero_headline    = f<string>(b, 'hero_headline', 'heroHeadline');
    const hero_subheadline = f<string>(b, 'hero_subheadline', 'heroSubheadline');
    const cta_text         = f<string>(b, 'cta_text', 'ctaText');
    const accent_color     = f<string>(b, 'accent_color', 'accentColor');
    const segment_options  = f(b, 'segment_options', 'segmentOptions');
    const testimonials     = f(b, 'testimonials', 'testimonials');
    const brand_names      = f(b, 'brand_names', 'brandNames');
    const post_purchase_route = f<string>(b, 'post_purchase_route', 'postPurchaseRoute');
    const bonus_products   = f(b, 'bonus_products', 'bonusProducts');

    const result = await pool.query(
      `UPDATE funnel_configs SET
        slug = COALESCE($3, slug),
        name = COALESCE($4, name),
        is_active = COALESCE($5, is_active),
        base_price = COALESCE($6, base_price),
        bump1_price = COALESCE($7, bump1_price),
        bump2_price = COALESCE($8, bump2_price),
        bump1_label = COALESCE($9, bump1_label),
        bump2_label = COALESCE($10, bump2_label),
        product_name = COALESCE($11, product_name),
        product_labels = COALESCE($12, product_labels),
        main_product_description = COALESCE($13, main_product_description),
        bump1_description = COALESCE($14, bump1_description),
        bump2_description = COALESCE($15, bump2_description),
        main_pdf_url = COALESCE($16, main_pdf_url),
        bump1_pdf_url = COALESCE($17, bump1_pdf_url),
        bump2_booking_url = COALESCE($18, bump2_booking_url),
        wa_template_name = COALESCE($19, wa_template_name),
        wa_msg1_template = COALESCE($20, wa_msg1_template),
        wa_msg2_template = COALESCE($21, wa_msg2_template),
        wa_msg3_template = COALESCE($22, wa_msg3_template),
        email_subject = COALESCE($23, email_subject),
        email_body = COALESCE($24, email_body),
        pipeline_name = COALESCE($25, pipeline_name),
        pipeline_stages = COALESCE($26, pipeline_stages),
        sequence_name = COALESCE($27, sequence_name),
        slack_channel = COALESCE($28, slack_channel),
        slack_emoji = COALESCE($29, slack_emoji),
        slack_label = COALESCE($30, slack_label),
        service_type = COALESCE($31, service_type),
        hero_headline = COALESCE($32, hero_headline),
        hero_subheadline = COALESCE($33, hero_subheadline),
        cta_text = COALESCE($34, cta_text),
        accent_color = COALESCE($35, accent_color),
        segment_options = COALESCE($36::jsonb, segment_options),
        testimonials = COALESCE($37::jsonb, testimonials),
        brand_names = COALESCE($38::jsonb, brand_names),
        post_purchase_route = COALESCE($39, post_purchase_route),
        bonus_products = COALESCE($40::jsonb, bonus_products),
        updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [
        id, tenantId,
        slug ?? null, name ?? null, is_active ?? null,
        base_price ?? null, bump1_price ?? null, bump2_price ?? null, bump1_label ?? null, bump2_label ?? null,
        product_name ?? null, product_labels ? JSON.stringify(product_labels) : null,
        main_product_description ?? null, bump1_description ?? null, bump2_description ?? null,
        main_pdf_url ?? null, bump1_pdf_url ?? null, bump2_booking_url ?? null,
        wa_template_name ?? null, wa_msg1_template ?? null, wa_msg2_template ?? null, wa_msg3_template ?? null,
        email_subject ?? null, email_body ?? null,
        pipeline_name ?? null, normaliseStages(pipeline_stages),
        sequence_name ?? null,
        slack_channel ?? null, slack_emoji ?? null, slack_label ?? null,
        service_type ?? null,
        hero_headline ?? null, hero_subheadline ?? null, cta_text ?? null, accent_color ?? null,
        normaliseJson(segment_options), normaliseJson(testimonials), normaliseJson(brand_names), post_purchase_route ?? null,
        normaliseJson(bonus_products),
      ],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'funnel config not found' });
      return;
    }

    res.json({ ok: true, config: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /:slug/performance — funnel performance metrics
//
// Aggregates from contacts (admitted), events (paid_count + revenue from
// slo_purchase events), and computes attach rates by inspecting the
// products[] array in the event payload. One Promise.all over 4 queries
// so the SPA doesn't fan out.
//
// `visitors` is null today — there's no admit-pixel; UI shows '—'. Slot is
// reserved so future tracking plugs in without changing the response shape.
// ---------------------------------------------------------------------------
router.get('/:slug/performance', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const slug = String(req.params.slug);

    const config = await getFunnelConfig(slug, tenantId);
    if (!config) {
      res.status(404).json({ error: 'funnel not found' });
      return;
    }

    // Window: default last 30 days. ISO date strings only — protect against SQL
    // injection by passing through parsing.
    const dayMs = 86400_000;
    const now = new Date();
    const defaultSince = new Date(now.getTime() - 30 * dayMs);
    const sinceParam = typeof req.query.since === 'string' ? req.query.since : '';
    const untilParam = typeof req.query.until === 'string' ? req.query.until : '';
    const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam) ? new Date(sinceParam) : defaultSince;
    const until = /^\d{4}-\d{2}-\d{2}$/.test(untilParam) ? new Date(untilParam + 'T23:59:59Z') : now;

    // funnel:<slug> tag is applied to every checkout contact in
    // cashfreeEventProcessor.ts; we look it up via array containment.
    const funnelTag = `funnel:${slug}`;

    const [admittedR, paidR, attachR, trendR] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS admitted
           FROM contacts
          WHERE tenant_id = $1
            AND $2 = ANY(tags)
            AND created_at >= $3 AND created_at <= $4`,
        [tenantId, funnelTag, since, until],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS paid_count,
                COALESCE(SUM((payload->>'amount')::numeric), 0)::int AS paid_revenue_paise
           FROM events
          WHERE tenant_id = $1
            AND event_type = 'slo_purchase'
            AND payload->>'funnelSlug' = $2
            AND occurred_at >= $3 AND occurred_at <= $4`,
        [tenantId, slug, since, until],
      ),
      pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE payload->'products' ? 'bump1')::int AS bump1_count,
            COUNT(*) FILTER (WHERE payload->'products' ? 'bump2')::int AS bump2_count,
            COUNT(*)::int AS total
           FROM events
          WHERE tenant_id = $1
            AND event_type = 'slo_purchase'
            AND payload->>'funnelSlug' = $2
            AND occurred_at >= $3 AND occurred_at <= $4`,
        [tenantId, slug, since, until],
      ),
      pool.query(
        `SELECT occurred_at::date AS date,
                COUNT(*)::int AS paid,
                COALESCE(SUM((payload->>'amount')::numeric), 0)::int AS revenue_paise
           FROM events
          WHERE tenant_id = $1
            AND event_type = 'slo_purchase'
            AND payload->>'funnelSlug' = $2
            AND occurred_at >= NOW() - INTERVAL '7 days'
          GROUP BY occurred_at::date
          ORDER BY date`,
        [tenantId, slug],
      ),
    ]);

    const admitted = (admittedR.rows[0] as { admitted: number }).admitted;
    const { paid_count, paid_revenue_paise } = paidR.rows[0] as { paid_count: number; paid_revenue_paise: number };
    const { bump1_count, bump2_count, total } = attachR.rows[0] as { bump1_count: number; bump2_count: number; total: number };

    const conversion_rate = admitted > 0 ? paid_count / admitted : 0;
    const aov_paise = paid_count > 0 ? Math.round(paid_revenue_paise / paid_count) : 0;
    const bump1_attach_rate = total > 0 ? bump1_count / total : 0;
    const bump2_attach_rate = total > 0 ? bump2_count / total : 0;

    res.json({
      slug,
      name: config.name,
      window: { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) },
      visitors: null,
      admitted,
      paid_count,
      paid_revenue_paise,
      conversion_rate: Number(conversion_rate.toFixed(4)),
      aov_paise,
      bump1_attach_rate: Number(bump1_attach_rate.toFixed(4)),
      bump2_attach_rate: Number(bump2_attach_rate.toFixed(4)),
      trend_7d: (trendR.rows as Array<{ date: Date | string; paid: number; revenue_paise: number }>).map(r => ({
        date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10),
        paid: r.paid,
        revenue_paise: r.revenue_paise,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id — soft delete (set is_active = FALSE)
// ---------------------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE funnel_configs SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId],
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'funnel config not found' });
      return;
    }

    res.json({ ok: true, deleted: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
