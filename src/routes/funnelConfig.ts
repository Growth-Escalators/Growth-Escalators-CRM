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
              bump1_description, bump2_description, main_product_description
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
// POST / — create new funnel config
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const {
      slug, name, is_active,
      base_price, bump1_price, bump2_price, bump1_label, bump2_label,
      product_name, product_labels,
      main_pdf_url, bump1_pdf_url, bump2_booking_url,
      wa_template_name, wa_msg1_template, wa_msg2_template, wa_msg3_template,
      email_subject, email_body,
      pipeline_name, pipeline_stages,
      sequence_name,
      slack_channel, slack_emoji, slack_label,
      service_type,
    } = req.body;

    if (!slug || !name || base_price == null || !product_name || !pipeline_name || !pipeline_stages) {
      res.status(400).json({ error: 'slug, name, base_price, product_name, pipeline_name, and pipeline_stages are required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO funnel_configs (
        tenant_id, slug, name, is_active,
        base_price, bump1_price, bump2_price, bump1_label, bump2_label,
        product_name, product_labels,
        main_pdf_url, bump1_pdf_url, bump2_booking_url,
        wa_template_name, wa_msg1_template, wa_msg2_template, wa_msg3_template,
        email_subject, email_body,
        pipeline_name, pipeline_stages,
        sequence_name,
        slack_channel, slack_emoji, slack_label,
        service_type
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
      ) RETURNING *`,
      [
        tenantId, slug, name, is_active ?? true,
        base_price, bump1_price ?? null, bump2_price ?? null, bump1_label ?? null, bump2_label ?? null,
        product_name, product_labels ? JSON.stringify(product_labels) : '{}',
        main_pdf_url ?? null, bump1_pdf_url ?? null, bump2_booking_url ?? null,
        wa_template_name ?? null, wa_msg1_template ?? null, wa_msg2_template ?? null, wa_msg3_template ?? null,
        email_subject ?? null, email_body ?? null,
        pipeline_name, JSON.stringify(pipeline_stages),
        sequence_name ?? null,
        slack_channel ?? null, slack_emoji ?? '\u{1F4B0}', slack_label ?? 'New Purchase',
        service_type ?? 'funnel',
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
    const {
      slug, name, is_active,
      base_price, bump1_price, bump2_price, bump1_label, bump2_label,
      product_name, product_labels,
      main_pdf_url, bump1_pdf_url, bump2_booking_url,
      wa_template_name, wa_msg1_template, wa_msg2_template, wa_msg3_template,
      email_subject, email_body,
      pipeline_name, pipeline_stages,
      sequence_name,
      slack_channel, slack_emoji, slack_label,
      service_type,
    } = req.body;

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
        main_pdf_url = COALESCE($13, main_pdf_url),
        bump1_pdf_url = COALESCE($14, bump1_pdf_url),
        bump2_booking_url = COALESCE($15, bump2_booking_url),
        wa_template_name = COALESCE($16, wa_template_name),
        wa_msg1_template = COALESCE($17, wa_msg1_template),
        wa_msg2_template = COALESCE($18, wa_msg2_template),
        wa_msg3_template = COALESCE($19, wa_msg3_template),
        email_subject = COALESCE($20, email_subject),
        email_body = COALESCE($21, email_body),
        pipeline_name = COALESCE($22, pipeline_name),
        pipeline_stages = COALESCE($23, pipeline_stages),
        sequence_name = COALESCE($24, sequence_name),
        slack_channel = COALESCE($25, slack_channel),
        slack_emoji = COALESCE($26, slack_emoji),
        slack_label = COALESCE($27, slack_label),
        service_type = COALESCE($28, service_type),
        updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [
        id, tenantId,
        slug ?? null, name ?? null, is_active ?? null,
        base_price ?? null, bump1_price ?? null, bump2_price ?? null, bump1_label ?? null, bump2_label ?? null,
        product_name ?? null, product_labels ? JSON.stringify(product_labels) : null,
        main_pdf_url ?? null, bump1_pdf_url ?? null, bump2_booking_url ?? null,
        wa_template_name ?? null, wa_msg1_template ?? null, wa_msg2_template ?? null, wa_msg3_template ?? null,
        email_subject ?? null, email_body ?? null,
        pipeline_name ?? null, pipeline_stages ? JSON.stringify(pipeline_stages) : null,
        sequence_name ?? null,
        slack_channel ?? null, slack_emoji ?? null, slack_label ?? null,
        service_type ?? null,
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
