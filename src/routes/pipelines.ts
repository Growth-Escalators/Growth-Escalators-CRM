import { Router } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db, pipelines, deals, contacts, contactChannels } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/pipelines — list all active pipelines for tenant
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
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
// PATCH /api/pipelines/:id — update pipeline
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
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
});

// ---------------------------------------------------------------------------
// GET /api/pipelines/:id/deals — kanban data: deals grouped by stage
// Each stage returns: stageName, deals array with enriched contact info
// ---------------------------------------------------------------------------
router.get('/:id/deals', async (req, res) => {
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
});

export default router;
