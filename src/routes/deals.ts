import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db, deals } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /deals?stage=&contactId=&serviceType=&limit=500&includeArchived=true
// tenantId is taken from JWT (req.user.tenantId)
// By default, archived deals (metadata.archived = 'true') are excluded.
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { stage, contactId, serviceType, limit = '500', includeArchived } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [eq(deals.tenantId, tenantId)];
  if (stage) conditions.push(eq(deals.stage, stage));
  if (contactId) conditions.push(eq(deals.contactId, contactId));
  if (serviceType) conditions.push(eq(deals.serviceType, serviceType));
  if (includeArchived !== 'true') {
    conditions.push(sql`(${deals.metadata}->>'archived') IS DISTINCT FROM 'true'` as any);
  }

  const rows = await db
    .select()
    .from(deals)
    .where(and(...conditions))
    .limit(Math.min(parseInt(limit, 10), 1000));

  res.json({ deals: rows });
});

// ---------------------------------------------------------------------------
// POST /deals
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactId, title, stage, value, serviceType, metadata } = req.body;

  if (!contactId || !title) {
    res.status(400).json({ error: 'contactId and title are required' });
    return;
  }

  const inserted = await db
    .insert(deals)
    .values({ tenantId, contactId, title, stage, value, serviceType, metadata })
    .returning();

  res.status(201).json(inserted[0]);
});

// ---------------------------------------------------------------------------
// PATCH /deals/:id
// Automatically sets closedAt when stage transitions to 'won' or 'lost'
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { stage, value, lostReason, closedAt, metadata } = req.body;

  const updates: Partial<typeof deals.$inferInsert> = { updatedAt: new Date() };
  if (stage !== undefined) updates.stage = stage;
  if (value !== undefined) updates.value = value;
  if (lostReason !== undefined) updates.lostReason = lostReason;
  if (metadata !== undefined) updates.metadata = metadata;

  // Auto-set closedAt when moving to a terminal stage
  if ((stage === 'won' || stage === 'lost') && !closedAt) {
    updates.closedAt = new Date();
  } else if (closedAt !== undefined) {
    updates.closedAt = new Date(closedAt);
  }

  const updated = await db
    .update(deals)
    .set(updates)
    .where(eq(deals.id, id))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: 'deal not found' });
    return;
  }

  res.json(updated[0]);
});

// ---------------------------------------------------------------------------
// POST /deals/bulk-create
// Body: { contactIds: string[], stage: string, serviceType: string, title?: string }
// Creates one deal per contact. Skips contacts that already have a deal in the same pipeline.
// ---------------------------------------------------------------------------
router.post('/bulk-create', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactIds, stage, serviceType, title = 'Manual Pipeline Entry' } = req.body as {
    contactIds?: string[];
    stage?: string;
    serviceType?: string;
    title?: string;
  };

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds array is required' });
    return;
  }
  if (!stage || !serviceType) {
    res.status(400).json({ error: 'stage and serviceType are required' });
    return;
  }

  // Find contacts that already have a deal in this pipeline
  const existing = await db
    .select({ contactId: deals.contactId })
    .from(deals)
    .where(
      and(
        eq(deals.tenantId, tenantId),
        eq(deals.serviceType, serviceType),
        sql`${deals.contactId} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
      ),
    );
  const existingIds = new Set(existing.map((r) => r.contactId));
  const toCreate = contactIds.filter((id) => !existingIds.has(id));

  if (toCreate.length === 0) {
    res.json({ created: [], skipped: contactIds.length });
    return;
  }

  const created = await db
    .insert(deals)
    .values(toCreate.map((contactId) => ({ tenantId, contactId, title, stage, serviceType })))
    .returning();

  res.status(201).json({ created, skipped: contactIds.length - toCreate.length });
});

export default router;
