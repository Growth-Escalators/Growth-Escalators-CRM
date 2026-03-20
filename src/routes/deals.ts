import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, deals } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /deals?stage=&contactId=&limit=500
// tenantId is taken from JWT (req.user.tenantId)
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { stage, contactId, serviceType, limit = '500' } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [eq(deals.tenantId, tenantId)];
  if (stage) conditions.push(eq(deals.stage, stage));
  if (contactId) conditions.push(eq(deals.contactId, contactId));
  if (serviceType) conditions.push(eq(deals.serviceType, serviceType));

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

export default router;
