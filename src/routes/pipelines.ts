import logger from '../utils/logger';
import { Router } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db, pool, pipelines, deals, contacts, contactChannels } from '../db/index';
import {
  buildPipelineStageColumns,
  getPipelineStageIdsByOutcome,
  mergePipelineStagesForSave,
  normalizePipelineStages,
  serializePipelineStages,
} from '../services/pipelineStages';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/pipelines/diagnose — debug pipeline placement issues (admin only)
// ---------------------------------------------------------------------------
router.get('/diagnose', async (req, res) => {
  try {
    const results: Record<string, unknown> = {};

    // 1. Check pipeline_contacts table exists
    try {
      const pcCount = await pool.query('SELECT COUNT(*)::int AS count FROM pipeline_contacts');
      results.pipeline_contacts_rows = pcCount.rows[0].count;
    } catch (e) {
      results.pipeline_contacts_error = (e as Error).message;
    }

    // 2. Check slo_purchase events
    const eventsCount = await pool.query("SELECT COUNT(*)::int AS count FROM events WHERE event_type = 'slo_purchase'");
    results.slo_purchase_events = eventsCount.rows[0].count;

    // 3. Check events with contact_id
    const withContact = await pool.query("SELECT COUNT(*)::int AS count FROM events WHERE event_type = 'slo_purchase' AND contact_id IS NOT NULL");
    results.slo_events_with_contact = withContact.rows[0].count;

    // 4. Check unplaced
    try {
      const unplaced = await pool.query(`
        SELECT COUNT(*)::int AS count FROM events e
        WHERE e.event_type = 'slo_purchase' AND e.contact_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM pipeline_contacts pc WHERE pc.contact_id = e.contact_id)
      `);
      results.unplaced_contacts = unplaced.rows[0].count;
    } catch (e) {
      results.unplaced_query_error = (e as Error).message;
    }

    // 5. Check active pipelines
    const pipesList = await pool.query("SELECT id, name, stages FROM pipelines WHERE is_active = true ORDER BY name");
    results.active_pipelines = pipesList.rows.map((p: Record<string, unknown>) => ({
      id: p.id, name: p.name, stages_count: Array.isArray(p.stages) ? (p.stages as string[]).length : 0,
      stages: p.stages,
    }));

    // 6. Check deals without pipeline
    const noPipeline = await pool.query('SELECT COUNT(*)::int AS count FROM deals WHERE pipeline_id IS NULL');
    results.deals_without_pipeline = noPipeline.rows[0].count;

    // 7. Sample recent events with payload
    const samples = await pool.query(`
      SELECT e.contact_id, e.payload, e.created_at
      FROM events e WHERE e.event_type = 'slo_purchase'
      ORDER BY e.created_at DESC LIMIT 5
    `);
    results.recent_purchases = samples.rows.map((r: Record<string, unknown>) => ({
      contact_id: r.contact_id,
      amount: (r.payload as Record<string, unknown>)?.amount,
      segment: (r.payload as Record<string, unknown>)?.segment,
      funnelSlug: (r.payload as Record<string, unknown>)?.funnelSlug,
      date: r.created_at,
    }));

    // 8. Check funnel_configs
    const configs = await pool.query("SELECT slug, pipeline_name, base_price FROM funnel_configs WHERE is_active = true");
    results.funnel_configs = configs.rows;

    // 9. CAPI status
    results.capi = {
      pixel_id_set: !!process.env.META_PIXEL_ID,
      capi_token_set: !!process.env.META_CAPI_TOKEN,
      access_token_set: !!process.env.META_ACCESS_TOKEN,
      effective_token: !!(process.env.META_CAPI_TOKEN || process.env.META_ACCESS_TOKEN),
    };

    // Auto-fix: for deals without pipeline, try to place them using contact metadata
    if ((results.deals_without_pipeline as number) > 0) {
      try {
        const { placePipelineContact } = await import('../services/pipelineService');
        const orphanDeals = await pool.query(`
          SELECT d.id, d.contact_id, d.tenant_id, d.value, d.stage,
                 c.metadata, c.tags
          FROM deals d
          JOIN contacts c ON c.id = d.contact_id
          WHERE d.pipeline_id IS NULL
          ORDER BY d.created_at DESC
        `);

        const fixResults: Array<{ dealId: string; success: boolean; error?: string }> = [];
        for (const deal of orphanDeals.rows as Array<Record<string, unknown>>) {
          const meta = (deal.metadata || {}) as Record<string, unknown>;
          const tags = (deal.tags || []) as string[];
          const segment = (meta.segment as string) || (tags.includes('agency') ? 'agency' : 'd2c');
          const amount = typeof meta.paidAmount === 'number' ? Math.round(meta.paidAmount) : (Number(deal.value) || 9);
          const funnelSlug = (meta.funnelSlug as string) || 'ecom';

          try {
            const r = await placePipelineContact({
              contactId: deal.contact_id as string,
              segment,
              amount,
              bump1: Boolean(meta.bump1),
              bump2: Boolean(meta.bump2),
              tenantId: deal.tenant_id as string,
              funnelSlug,
            });
            fixResults.push({ dealId: deal.id as string, success: r.success, error: r.success ? undefined : `pipeline=${r.pipeline} stage=${r.stage}` });
          } catch (e) {
            fixResults.push({ dealId: deal.id as string, success: false, error: (e as Error).message });
          }
        }
        results.orphan_deals_fix = fixResults;
      } catch (e) {
        results.orphan_deals_fix_error = (e as Error).message;
      }
    }

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pipelines/_health — production verification (Phase 2)
// ---------------------------------------------------------------------------
router.get('/_health', async (req, res) => {
  try {
    const { pool: dbPool } = await import('../db/index');
    const r = await dbPool.query(`
      SELECT
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='source') AS has_source,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='probability') AS has_probability,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='deal_activities') AS has_deal_activities,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='pipelines' AND column_name='stage_config') AS has_stage_config,
        (SELECT COUNT(*)::int FROM deal_activities) AS activity_count
    `);
    res.json({ ok: true, columns: r.rows[0] });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ---------------------------------------------------------------------------
// GET /api/pipelines — list all active pipelines for tenant
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
  const tenantId = req.user!.tenantId;

  const rows = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.isActive, true)))
    .orderBy(asc(pipelines.sortOrder), asc(pipelines.createdAt));

  // Attach deal count per pipeline
  const pipelineIds = rows.map((p) => p.id);
  let countMap: Record<string, number> = {};
  if (pipelineIds.length > 0) {
    const counts = await db
      .select({ pipelineId: deals.pipelineId, count: sql<number>`count(*)::int` })
      .from(deals)
      .where(
        and(
          eq(deals.tenantId, tenantId),
          sql`${deals.pipelineId} = ANY(ARRAY[${sql.join(pipelineIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
          sql`(${deals.metadata}->>'archived') IS DISTINCT FROM 'true'`,
        ),
      )
      .groupBy(deals.pipelineId);
    for (const c of counts) {
      if (c.pipelineId) countMap[c.pipelineId] = c.count;
    }
  }

  const enriched = rows.map((p) => ({ ...p, normalizedStages: normalizePipelineStages(p.stages), dealCount: countMap[p.id] ?? 0 }));
  res.json(enriched);
  } catch (e: unknown) {
    logger.error('[pipelines] GET / error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipelines — create a new pipeline
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { name, slug, stages, color, sortOrder } = req.body as {
    name?: string;
    slug?: string;
    stages?: unknown[];
    color?: string;
    sortOrder?: number;
  };

  if (!name || !slug || !Array.isArray(stages)) {
    res.status(400).json({ error: 'name, slug, and stages are required' });
    return;
  }

  try {
    const inserted = await db
      .insert(pipelines)
      .values({ tenantId, name, slug, stages: serializePipelineStages(stages), color, sortOrder })
      .returning();
    res.status(201).json(inserted[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      res.status(409).json({ error: 'pipeline slug already exists' });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipelines/reorder — bulk update sortOrder
// ---------------------------------------------------------------------------
router.post('/reorder', async (req, res) => {
  try {
  const tenantId = req.user!.tenantId;
  const { pipelineIds } = req.body as { pipelineIds?: string[] };
  if (!Array.isArray(pipelineIds) || pipelineIds.length === 0) {
    res.status(400).json({ error: 'pipelineIds array is required' });
    return;
  }
  await Promise.all(
    pipelineIds.map((id, index) =>
      db.update(pipelines)
        .set({ sortOrder: index })
        .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId)))
    )
  );
  res.json({ updated: pipelineIds.length });
  } catch (e: unknown) {
    logger.error('[pipelines] POST /reorder error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipelines/duplicate/:id
// ---------------------------------------------------------------------------
router.post('/duplicate/:id', async (req, res) => {
  try {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  const existing = await db.select().from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId)))
    .limit(1);
  if (existing.length === 0) {
    res.status(404).json({ error: 'pipeline not found' });
    return;
  }
  const orig = existing[0];
  const newSlug = `${orig.slug}-copy-${Date.now()}`;
  const inserted = await db.insert(pipelines).values({
    tenantId,
    name: `${orig.name} (Copy)`,
    slug: newSlug,
    stages: orig.stages,
    color: orig.color,
    sortOrder: (orig.sortOrder ?? 0) + 1,
  }).returning();
  res.status(201).json(inserted[0]);
  } catch (e: unknown) {
    logger.error('[pipelines] POST /duplicate/:id error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/pipelines/:id
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.pipelineId, id)));
  const dealCount = countResult[0]?.count ?? 0;
  if (dealCount > 0) {
    res.status(400).json({ error: `Cannot delete pipeline with existing deals. Move or archive deals first.` });
    return;
  }
  await db.delete(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId)));
  res.json({ deleted: true });
  } catch (e: unknown) {
    logger.error('[pipelines] DELETE /:id error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/pipelines/:id — update pipeline
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  try {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  const { name, stages, color, isActive, sortOrder, stageConfig } = req.body;

  const existing = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId)))
    .limit(1);

  if (existing.length === 0) {
    res.status(404).json({ error: 'pipeline not found' });
    return;
  }

  const updates: Partial<typeof pipelines.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (stages !== undefined) updates.stages = mergePipelineStagesForSave(existing[0].stages, stages);
  if (color !== undefined) updates.color = color;
  if (isActive !== undefined) updates.isActive = isActive;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;

  const updated = Object.keys(updates).length > 0
    ? await db
      .update(pipelines)
      .set(updates)
      .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId)))
      .returning()
    : existing;

  if (stageConfig !== undefined) {
    await pool.query(
      `UPDATE pipelines SET stage_config = $1::jsonb WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(stageConfig), id, tenantId]
    );
  }

  res.json(updated[0]);
  } catch (e: unknown) {
    logger.error('[pipelines] PATCH /:id error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pipelines/:id/stage-config — fetch stage_config JSONB for a pipeline
// ---------------------------------------------------------------------------
router.get('/:id/stage-config', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  try {
    const r = await pool.query(
      `SELECT stage_config FROM pipelines WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    res.json(r.rows[0]?.stage_config ?? {});
  } catch (e) {
    logger.error('[pipelines] GET /:id/stage-config error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pipelines/:id/analytics — funnel metrics + by-stage breakdown
// ---------------------------------------------------------------------------
router.get('/:id/analytics', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  const days = parseInt((req.query.days as string) || '90', 10);
  try {
    const pipelineRows = await db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId)))
      .limit(1);

    if (pipelineRows.length === 0) {
      res.status(404).json({ error: 'pipeline not found' });
      return;
    }

    const stageIdsByOutcome = getPipelineStageIdsByOutcome(pipelineRows[0].stages, { lowercase: true });
    const closedStageIds = stageIdsByOutcome.closed;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const r = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN NOT (LOWER(stage) = ANY($4::text[])) THEN COALESCE(deal_value,0) * COALESCE(probability,50) / 100.0 ELSE 0 END), 0)::int AS forecast,
        COUNT(*) FILTER (WHERE NOT (LOWER(stage) = ANY($4::text[]))) AS open_count,
        COUNT(*) FILTER (WHERE LOWER(stage) = ANY($5::text[])) AS won_count,
        COUNT(*) FILTER (WHERE LOWER(stage) = ANY($6::text[])) AS lost_count,
        COUNT(*) FILTER (WHERE LOWER(stage) = ANY($7::text[])) AS abandoned_count,
        COALESCE(SUM(CASE WHEN LOWER(stage) = ANY($5::text[]) THEN COALESCE(deal_value,0) ELSE 0 END), 0)::int AS total_won_value,
        ROUND(AVG(CASE WHEN LOWER(stage) = ANY($5::text[]) AND closed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (closed_at - created_at))/86400.0 END)::numeric, 1) AS avg_cycle_days
      FROM deals
      WHERE pipeline_id = $1 AND tenant_id = $2
        AND (closed_at IS NULL OR closed_at >= $3)
        AND (metadata->>'archived') IS DISTINCT FROM 'true'
    `, [id, tenantId, cutoff, closedStageIds, stageIdsByOutcome.won, stageIdsByOutcome.lost, stageIdsByOutcome.abandoned]);

    const byStage = await pool.query(`
      SELECT stage,
        COUNT(*)::int AS count,
        COALESCE(SUM(deal_value),0)::int AS value,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - created_at))/86400.0)::numeric, 1) AS avg_age_days
      FROM deals
      WHERE pipeline_id = $1 AND tenant_id = $2
        AND NOT (LOWER(stage) = ANY($3::text[]))
        AND (metadata->>'archived') IS DISTINCT FROM 'true'
      GROUP BY stage ORDER BY count DESC
    `, [id, tenantId, closedStageIds]);

    const s = r.rows[0];
    const wonCount = Number(s.won_count);
    const lostCount = Number(s.lost_count);
    const abandonedCount = Number(s.abandoned_count);
    const total = wonCount + lostCount + abandonedCount;
    res.json({
      forecast: Number(s.forecast),
      openCount: Number(s.open_count),
      wonCount,
      lostCount,
      abandonedCount,
      winRate: total > 0 ? Math.round((wonCount / total) * 100) / 100 : 0,
      avgCycleDays: s.avg_cycle_days ? Number(s.avg_cycle_days) : null,
      totalWonValue: Number(s.total_won_value),
      byStage: byStage.rows,
    });
  } catch (e) {
    logger.error('[pipelines] GET /:id/analytics error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pipelines/:id/deals — kanban data: deals grouped by stage
// Each stage returns: stageName, deals array with enriched contact info
// ---------------------------------------------------------------------------
router.get('/:id/deals', async (req, res) => {
  try {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  const { includeArchived } = req.query as Record<string, string>;

  // Get pipeline to know the stage list
  const pipelineRows = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId)))
    .limit(1);

  if (pipelineRows.length === 0) {
    res.status(404).json({ error: 'pipeline not found' });
    return;
  }

  const pipeline = pipelineRows[0];
  const normalizedStages = normalizePipelineStages(pipeline.stages);

  // Get all deals for this pipeline
  const conditions = [
    eq(deals.tenantId, tenantId),
    eq(deals.pipelineId, id),
  ] as ReturnType<typeof eq>[];

  if (includeArchived !== 'true') {
    conditions.push(sql`(${deals.metadata}->>'archived') IS DISTINCT FROM 'true'` as any);
  }

  const dealRows = await db
    .select()
    .from(deals)
    .where(and(...conditions));

  if (dealRows.length === 0) {
    const emptyStages = buildPipelineStageColumns(pipeline.stages, []);
    res.json({ pipeline: { ...pipeline, normalizedStages }, stages: emptyStages });
    return;
  }

  // Enrich with contact name, phone, email
  const contactIds = [...new Set(dealRows.map((d) => d.contactId))];
  const [contactRows, channelRows] = await Promise.all([
    db.select().from(contacts).where(
      sql`${contacts.id} = ANY(ARRAY[${sql.join(contactIds.map((cid) => sql`${cid}::uuid`), sql`, `)}])`
    ),
    db.select().from(contactChannels).where(
      and(
        sql`${contactChannels.contactId} = ANY(ARRAY[${sql.join(contactIds.map((cid) => sql`${cid}::uuid`), sql`, `)}])`,
        sql`${contactChannels.channelType} IN ('whatsapp', 'phone', 'email')`,
      )
    ),
  ]);

  const contactMap = Object.fromEntries(contactRows.map((c) => [c.id, c]));
  const phoneMap: Record<string, string> = {};
  const emailMap: Record<string, string> = {};
  for (const ch of channelRows) {
    if ((ch.channelType === 'whatsapp' || ch.channelType === 'phone') && !phoneMap[ch.contactId]) {
      phoneMap[ch.contactId] = ch.channelValue;
    }
    if (ch.channelType === 'email' && !emailMap[ch.contactId]) {
      emailMap[ch.contactId] = ch.channelValue;
    }
  }

  const enrichedDeals = dealRows.map((d) => {
    const c = contactMap[d.contactId];
    return {
      ...d,
      contactName: c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : 'Unknown',
      companyName: c?.companyName ?? null,
      score: c?.score ?? 0,
      phone: phoneMap[d.contactId] ?? null,
      email: emailMap[d.contactId] ?? null,
    };
  });

  const stages = buildPipelineStageColumns(pipeline.stages, enrichedDeals);

  res.json({ pipeline: { ...pipeline, normalizedStages }, stages });
  } catch (e: unknown) {
    logger.error('[pipelines] GET /:id/deals error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipelines/backfill-all — place ALL unplaced slo_purchase contacts into pipelines
// One-time catch-up for historical purchases that were never placed.
// Admin-only. Does NOT re-send WhatsApp/email (those were already sent or attempted).
// ---------------------------------------------------------------------------
router.post('/backfill-all', async (req, res) => {
  try {
    const user = req.user as { role: string } | undefined;
    if (user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }

    const { pool } = await import('../db/index');
    const { placePipelineContact } = await import('../services/pipelineService');

    // Find ALL slo_purchase events without pipeline placement — no LIMIT
    const { rows } = await pool.query(`
      SELECT e.id, e.contact_id, e.payload, e.tenant_id, e.created_at
      FROM events e
      WHERE e.event_type = 'slo_purchase'
        AND e.contact_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM pipeline_contacts pc
          WHERE pc.contact_id = e.contact_id
        )
      ORDER BY e.created_at ASC
    `);

    if (rows.length === 0) {
      res.json({ message: 'All contacts are already placed in pipelines', placed: 0, failed: 0 });
      return;
    }

    let placed = 0;
    let failed = 0;
    const results: Array<{ contactId: string; success: boolean; pipeline?: string; stage?: string; error?: string }> = [];

    for (const row of rows as Array<{ id: string; contact_id: string; payload: Record<string, unknown>; tenant_id: string; created_at: string }>) {
      const { contact_id, payload, tenant_id } = row;
      const segment = (payload.segment as string) || 'd2c';
      const amount = typeof payload.amount === 'number' ? payload.amount : 9;
      const bump1 = Boolean(payload.bump1);
      const bump2 = Boolean(payload.bump2);
      const funnelSlug = (payload.funnelSlug as string) || 'ecom';

      try {
        const result = await placePipelineContact({ contactId: contact_id, segment, amount, bump1, bump2, tenantId: tenant_id, funnelSlug });
        if (result.success) {
          placed++;
          results.push({ contactId: contact_id, success: true, pipeline: result.pipeline, stage: result.stage });
        } else {
          failed++;
          results.push({ contactId: contact_id, success: false, pipeline: result.pipeline, stage: result.stage, error: 'placement returned false' });
        }
      } catch (e) {
        failed++;
        results.push({ contactId: contact_id, success: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    logger.info(`[pipeline-backfill] Completed: ${placed} placed, ${failed} failed out of ${rows.length} total`);
    res.json({ message: `Backfill complete`, total: rows.length, placed, failed, results: results.slice(0, 50) });
  } catch (e) {
    logger.error('[pipeline-backfill] error:', e);
    res.status(500).json({ error: 'Backfill failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/pipelines/backfill-from-deals — comprehensive backfill
// Finds ALL deals + contacts with purchase evidence (even without slo_purchase events)
// Creates missing events, then places contacts into correct pipelines.
// This handles the case where the webhook was broken and no events were logged.
// ---------------------------------------------------------------------------
router.post('/backfill-from-deals', async (req, res) => {
  try {
    const { placePipelineContact } = await import('../services/pipelineService');

    // Step 1: Find ALL contacts with purchase evidence that aren't in a pipeline
    // Sources: deals table, contact metadata (paymentStatus=paid), contact tags (slo_buyer)
    const { rows: purchaseContacts } = await pool.query(`
      SELECT DISTINCT ON (c.id)
        c.id AS contact_id,
        c.first_name,
        c.last_name,
        c.tenant_id,
        c.metadata,
        c.tags,
        d.id AS deal_id,
        d.value AS deal_value,
        d.stage AS deal_stage,
        d.pipeline_id
      FROM contacts c
      LEFT JOIN deals d ON d.contact_id = c.id
      WHERE (
        -- Has a deal (any deal = purchase evidence)
        d.id IS NOT NULL
        -- OR has slo_buyer tag
        OR 'slo_buyer' = ANY(c.tags)
        -- OR has paymentStatus=paid in metadata
        OR c.metadata->>'paymentStatus' = 'paid'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pipeline_contacts pc WHERE pc.contact_id = c.id
      )
      ORDER BY c.id, d.created_at DESC
    `);

    if (purchaseContacts.length === 0) {
      res.json({ message: 'All purchase contacts are already in pipelines', total: 0, placed: 0, failed: 0, events_created: 0 });
      return;
    }

    console.log(`[backfill-from-deals] Found ${purchaseContacts.length} unplaced purchase contact(s)`);

    let placed = 0;
    let failed = 0;
    let eventsCreated = 0;
    const results: Array<{ contactId: string; name: string; success: boolean; pipeline?: string; stage?: string; error?: string }> = [];

    for (const row of purchaseContacts as Array<Record<string, unknown>>) {
      const contactId = row.contact_id as string;
      const tenantId = row.tenant_id as string;
      const meta = (row.metadata || {}) as Record<string, unknown>;
      const tags = (row.tags || []) as string[];
      const dealValue = row.deal_value ? Number(row.deal_value) : null;
      const firstName = (row.first_name as string) || 'Unknown';
      const lastName = (row.last_name as string) || '';

      // Extract segment from metadata or tags
      let segment = (meta.segment as string) || 'd2c';
      if (segment === 'unknown') {
        if (tags.includes('agency') || tags.includes('agency_owner') || tags.some(t => t.startsWith('seg:agency'))) segment = 'agency';
        else if (tags.includes('freelancer') || tags.some(t => t.startsWith('seg:freelancer'))) segment = 'freelancer';
        else segment = 'd2c';
      }

      // Extract amount from metadata or deal value
      const amount = typeof meta.paidAmount === 'number' ? Math.round(meta.paidAmount) : (dealValue ? Math.round(dealValue) : 9);
      const bump1 = Boolean(meta.bump1);
      const bump2 = Boolean(meta.bump2);
      const funnelSlug = (meta.funnelSlug as string) || 'ecom';

      // Step 2: Create missing slo_purchase event if one doesn't exist
      const existingEvent = await pool.query(
        "SELECT id FROM events WHERE event_type = 'slo_purchase' AND contact_id = $1 LIMIT 1",
        [contactId],
      );
      if (existingEvent.rows.length === 0) {
        await pool.query(
          `INSERT INTO events (id, tenant_id, contact_id, event_type, payload, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'slo_purchase', $3::jsonb, NOW())`,
          [tenantId, contactId, JSON.stringify({ amount, segment, products: ['core_product'], funnelSlug, backfilled: true })],
        );
        eventsCreated++;
      }

      // Step 3: Place in pipeline
      try {
        const result = await placePipelineContact({ contactId, segment, amount, bump1, bump2, tenantId, funnelSlug });
        if (result.success) {
          placed++;
          results.push({ contactId, name: `${firstName} ${lastName}`.trim(), success: true, pipeline: result.pipeline, stage: result.stage });
        } else {
          failed++;
          results.push({ contactId, name: `${firstName} ${lastName}`.trim(), success: false, pipeline: result.pipeline, stage: result.stage, error: 'placement returned false' });
        }
      } catch (e) {
        failed++;
        results.push({ contactId, name: `${firstName} ${lastName}`.trim(), success: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    console.log(`[backfill-from-deals] Complete: ${placed} placed, ${failed} failed, ${eventsCreated} events created`);
    res.json({
      message: 'Backfill complete',
      total: purchaseContacts.length,
      placed,
      failed,
      events_created: eventsCreated,
      results,
    });
  } catch (e) {
    logger.error('[backfill-from-deals] error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
