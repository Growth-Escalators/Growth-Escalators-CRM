import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, sequences, sequenceEnrolments } from '../db/index';
import {
  enrolContact,
  cancelEnrolment,
  getActiveEnrolments,
} from '../services/sequenceService';

const router = Router();

// ---------------------------------------------------------------------------
// POST /sequences — create a sequence
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const { tenantId, name, channel, steps } = req.body;

  if (!tenantId || !name || !channel) {
    res.status(400).json({ error: 'tenantId, name, and channel are required' });
    return;
  }

  const [created] = await db
    .insert(sequences)
    .values({ tenantId, name, channel, steps: steps ?? [] })
    .returning();

  res.status(201).json(created);
});

// ---------------------------------------------------------------------------
// GET /sequences — list sequences for the authenticated tenant
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const rows = await db.select().from(sequences).where(eq(sequences.tenantId, tenantId));
  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /sequences/stats — sequences with active/completed/cancelled enrolment counts
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  const tenantId = req.user!.tenantId;

  const seqs = await db.select().from(sequences).where(eq(sequences.tenantId, tenantId));

  const counts = await db
    .select({
      sequenceId: sequenceEnrolments.sequenceId,
      status: sequenceEnrolments.status,
      count: sql<number>`count(*)::int`,
    })
    .from(sequenceEnrolments)
    .where(eq(sequenceEnrolments.tenantId, tenantId))
    .groupBy(sequenceEnrolments.sequenceId, sequenceEnrolments.status);

  const countMap: Record<string, { active: number; completed: number; cancelled: number }> = {};
  for (const row of counts) {
    if (!countMap[row.sequenceId]) countMap[row.sequenceId] = { active: 0, completed: 0, cancelled: 0 };
    if (row.status === 'active') countMap[row.sequenceId].active = row.count;
    else if (row.status === 'completed') countMap[row.sequenceId].completed = row.count;
    else if (row.status === 'cancelled') countMap[row.sequenceId].cancelled = row.count;
  }

  const stats = seqs.map((s) => ({
    ...s,
    stepCount: Array.isArray(s.steps) ? s.steps.length : 0,
    active: countMap[s.id]?.active ?? 0,
    completed: countMap[s.id]?.completed ?? 0,
    cancelled: countMap[s.id]?.cancelled ?? 0,
  }));

  res.json(stats);
});

// ---------------------------------------------------------------------------
// POST /sequences/enrol — enrol a contact into a sequence
// ---------------------------------------------------------------------------
router.post('/enrol', async (req, res) => {
  const { tenantId, contactId, sequenceName, startAfterMinutes } = req.body;

  if (!tenantId || !contactId || !sequenceName) {
    res.status(400).json({ error: 'tenantId, contactId, and sequenceName are required' });
    return;
  }

  try {
    const enrolment = await enrolContact(tenantId, contactId, sequenceName, startAfterMinutes ?? 0);
    res.status(201).json(enrolment);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /sequences/enrolments/:id — cancel an enrolment
// ---------------------------------------------------------------------------
router.delete('/enrolments/:id', async (req, res) => {
  const { id } = req.params;

  const cancelled = await cancelEnrolment(id);
  if (!cancelled) {
    res.status(404).json({ error: 'enrolment not found' });
    return;
  }

  res.json(cancelled);
});

// ---------------------------------------------------------------------------
// GET /sequences/enrolments?contactId= — get active enrolments for a contact
// ---------------------------------------------------------------------------
router.get('/enrolments', async (req, res) => {
  const { contactId } = req.query as Record<string, string>;

  if (!contactId) {
    res.status(400).json({ error: 'contactId is required' });
    return;
  }

  const enrolments = await getActiveEnrolments(contactId);
  res.json(enrolments);
});

export default router;
