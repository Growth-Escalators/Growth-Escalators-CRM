import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db, deals, contacts, pipelines } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /deals — list deals with optional filters
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { stage, contactId, serviceType, pipelineId, assignedTo, limit = '500', includeArchived } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [eq(deals.tenantId, tenantId)];
  if (stage) conditions.push(eq(deals.stage, stage));
  if (contactId) conditions.push(eq(deals.contactId, contactId));
  if (serviceType) conditions.push(eq(deals.serviceType, serviceType));
  if (pipelineId) conditions.push(eq(deals.pipelineId, pipelineId));
  if (assignedTo) conditions.push(eq(deals.assignedTo, assignedTo));
  if (includeArchived !== 'true') {
    conditions.push(sql`(${deals.metadata}->>'archived') IS DISTINCT FROM 'true'` as any);
  }

  const rows = await db
    .select({
      deal: deals,
      pipelineName: pipelines.name,
      pipelineColor: pipelines.color,
    })
    .from(deals)
    .leftJoin(pipelines, eq(deals.pipelineId, pipelines.id))
    .where(and(...conditions))
    .limit(Math.min(parseInt(limit, 10), 1000));

  const enriched = rows.map((r) => ({
    ...r.deal,
    pipelineName: r.pipelineName ?? null,
    pipelineColor: r.pipelineColor ?? null,
  }));

  res.json({ deals: enriched });
});

// ---------------------------------------------------------------------------
// POST /deals — create a deal
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactId, title, stage, value, dealValue, serviceType, pipelineId, assignedTo, notes, lostReason, wonNotes, metadata } = req.body;

  if (!contactId || !title) {
    res.status(400).json({ error: 'contactId and title are required' });
    return;
  }

  const inserted = await db
    .insert(deals)
    .values({ tenantId, contactId, title, stage, value, dealValue, serviceType, pipelineId, assignedTo, notes, lostReason, wonNotes, metadata })
    .returning();

  // Update contact's lastActivityAt
  await db.update(contacts).set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(contacts.id, contactId));

  res.status(201).json(inserted[0]);
});

// ---------------------------------------------------------------------------
// PATCH /deals/:id — update deal stage, value, metadata, etc.
// Auto-sets closedAt when stage is 'Won' or 'Lost'
// Updates contact lastActivityAt on stage change
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { stage, value, dealValue, lostReason, wonNotes, closedAt, metadata, assignedTo, pipelineId, notes } = req.body;

  // Get current deal to check stage change
  const existing = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (existing.length === 0) {
    res.status(404).json({ error: 'deal not found' });
    return;
  }

  const updates: Partial<typeof deals.$inferInsert> = { updatedAt: new Date() };
  if (stage !== undefined) updates.stage = stage;
  if (value !== undefined) updates.value = value;
  if (dealValue !== undefined) updates.dealValue = dealValue;
  if (lostReason !== undefined) updates.lostReason = lostReason;
  if (wonNotes !== undefined) updates.wonNotes = wonNotes;
  if (metadata !== undefined) updates.metadata = metadata;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo;
  if (pipelineId !== undefined) updates.pipelineId = pipelineId;
  if (notes !== undefined) updates.notes = notes;

  // Auto-set closedAt on terminal stages (case-insensitive)
  const stageLC = stage?.toLowerCase();
  if ((stageLC === 'won' || stageLC === 'lost') && !closedAt) {
    updates.closedAt = new Date();
  } else if (closedAt !== undefined) {
    updates.closedAt = new Date(closedAt);
  }

  const updated = await db.update(deals).set(updates).where(eq(deals.id, id)).returning();

  // Update contact lastActivityAt when stage changes
  if (stage !== undefined && stage !== existing[0].stage) {
    await db.update(contacts).set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(contacts.id, existing[0].contactId));
  }

  res.json(updated[0]);
});

// ---------------------------------------------------------------------------
// POST /deals/bulk-create — create deals for multiple contacts
// Skips contacts already in the same pipeline
// ---------------------------------------------------------------------------
router.post('/bulk-create', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactIds, stage, serviceType, pipelineId, assignedTo, dealValue, notes, title = 'Manual Pipeline Entry' } = req.body as {
    contactIds?: string[];
    stage?: string;
    serviceType?: string;
    pipelineId?: string;
    assignedTo?: string;
    dealValue?: number;
    notes?: string;
    title?: string;
  };

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds array is required' });
    return;
  }
  if (!stage) {
    res.status(400).json({ error: 'stage is required' });
    return;
  }

  // Find contacts that already have a deal in this pipeline
  const existingConditions = [
    eq(deals.tenantId, tenantId),
    sql`${deals.contactId} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
  ] as ReturnType<typeof eq>[];
  if (pipelineId) existingConditions.push(eq(deals.pipelineId, pipelineId));
  else if (serviceType) existingConditions.push(eq(deals.serviceType, serviceType));

  const existing = await db.select({ contactId: deals.contactId }).from(deals)
    .where(and(...existingConditions));
  const existingIds = new Set(existing.map((r) => r.contactId));
  const toCreate = contactIds.filter((id) => !existingIds.has(id));

  if (toCreate.length === 0) {
    res.json({ created: [], skipped: contactIds.length });
    return;
  }

  const created = await db.insert(deals)
    .values(toCreate.map((contactId) => ({
      tenantId, contactId, title, stage, serviceType, pipelineId, assignedTo, dealValue, notes,
    })))
    .returning();

  // Update lastActivityAt for created contacts
  await db.update(contacts).set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(sql`${contacts.id} = ANY(ARRAY[${sql.join(toCreate.map((id) => sql`${id}::uuid`), sql`, `)}])`);

  res.status(201).json({ created, skipped: contactIds.length - toCreate.length });
});

// ---------------------------------------------------------------------------
// POST /deals/bulk-update — update stage/assignedTo/pipelineId for multiple deals
// Body: { dealIds: string[], updates: { stage?, assignedTo?, pipelineId? } }
// ---------------------------------------------------------------------------
router.post('/bulk-update', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { dealIds, updates: upd } = req.body as {
    dealIds?: string[];
    updates?: { stage?: string; assignedTo?: string; pipelineId?: string };
  };

  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    res.status(400).json({ error: 'dealIds array is required' });
    return;
  }
  if (!upd || Object.keys(upd).length === 0) {
    res.status(400).json({ error: 'updates object is required' });
    return;
  }

  const updates: Partial<typeof deals.$inferInsert> = { updatedAt: new Date() };
  if (upd.stage !== undefined) updates.stage = upd.stage;
  if (upd.assignedTo !== undefined) updates.assignedTo = upd.assignedTo;
  if (upd.pipelineId !== undefined) updates.pipelineId = upd.pipelineId;

  await db.update(deals).set(updates).where(
    and(
      eq(deals.tenantId, tenantId),
      sql`${deals.id} = ANY(ARRAY[${sql.join(dealIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
    ),
  );

  res.json({ updated: dealIds.length });
});

// ---------------------------------------------------------------------------
// POST /deals/:id/add-or-update — upsert deal for contact in pipeline
// If contact already has a deal in this pipeline, update it; else create new
// ---------------------------------------------------------------------------
router.post('/add-or-update', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactId, pipelineId, stage, assignedTo, dealValue, notes, title = 'Opportunity' } = req.body;

  if (!contactId || !pipelineId || !stage) {
    res.status(400).json({ error: 'contactId, pipelineId, and stage are required' });
    return;
  }

  // Check if deal already exists for this contact in this pipeline
  const existing = await db.select().from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.contactId, contactId), eq(deals.pipelineId, pipelineId)))
    .limit(1);

  let result;
  if (existing.length > 0) {
    // Update existing deal
    const stageLC = stage.toLowerCase();
    const upd: Partial<typeof deals.$inferInsert> = {
      stage, updatedAt: new Date(),
      ...(assignedTo !== undefined ? { assignedTo } : {}),
      ...(dealValue !== undefined ? { dealValue } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
    if (stageLC === 'won' || stageLC === 'lost') upd.closedAt = new Date();

    const updated = await db.update(deals).set(upd)
      .where(eq(deals.id, existing[0].id)).returning();
    result = { deal: updated[0], action: 'updated' };
  } else {
    // Create new deal
    const inserted = await db.insert(deals).values({
      tenantId, contactId, pipelineId, stage, title, assignedTo, dealValue, notes,
    }).returning();
    result = { deal: inserted[0], action: 'created' };
  }

  // Update contact lastActivityAt
  await db.update(contacts).set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(contacts.id, contactId));

  res.json(result);
});

export default router;
