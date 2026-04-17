import logger from '../utils/logger';
import { Router } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db, pool, pipelines, deals, contacts, contactChannels } from '../db/index';

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

  const enriched = rows.map((p) => ({ ...p, dealCount: countMap[p.id] ?? 0 }));
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
    stages?: string[];
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
      .values({ tenantId, name, slug, stages, color, sortOrder })
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
  const { name, stages, color, isActive, sortOrder } = req.body;

  const updates: Partial<typeof pipelines.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (stages !== undefined) updates.stages = stages;
  if (color !== undefined) updates.color = color;
  if (isActive !== undefined) updates.isActive = isActive;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;

  const updated = await db
    .update(pipelines)
    .set(updates)
    .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, tenantId)))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: 'pipeline not found' });
    return;
  }

  res.json(updated[0]);
  } catch (e: unknown) {
    logger.error('[pipelines] PATCH /:id error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
  const stageList = (pipeline.stages as string[]) ?? [];

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
    const emptyStages = stageList.map((s) => ({ stageName: s, deals: [], totalValue: 0 }));
    res.json({ pipeline, stages: emptyStages });
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

  // Group by stage in the pipeline's stage order
  const stageMap: Record<string, typeof enrichedDeals> = {};
  for (const d of enrichedDeals) {
    const s = d.stage ?? 'Unknown';
    if (!stageMap[s]) stageMap[s] = [];
    stageMap[s].push(d);
  }

  const stages = stageList.map((stageName) => {
    const stageDeals = stageMap[stageName] ?? [];
    const totalValue = stageDeals.reduce((sum, d) => sum + (d.dealValue ?? 0), 0);
    return { stageName, deals: stageDeals, totalValue };
  });

  // Add any deals in unknown stages at the end
  const knownStages = new Set(stageList);
  for (const [stageName, stageDeals] of Object.entries(stageMap)) {
    if (!knownStages.has(stageName)) {
      const totalValue = stageDeals.reduce((sum, d) => sum + (d.dealValue ?? 0), 0);
      stages.push({ stageName, deals: stageDeals, totalValue });
    }
  }

  res.json({ pipeline, stages });
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

export default router;
