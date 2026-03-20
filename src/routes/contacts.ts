import { Router } from 'express';
import { eq, and, desc, ilike, or, gte, sql } from 'drizzle-orm';
import { db, contacts, contactChannels } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /contacts?status=&source=&search=&sort=newest&limit=50&offset=0&dateFrom=
// tenantId is taken from JWT (req.user.tenantId); query param is ignored for security
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { status, source, search, dateFrom, segment, limit = '50', offset = '0' } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [eq(contacts.tenantId, tenantId)];
  if (status) conditions.push(eq(contacts.status, status));
  if (source) conditions.push(eq(contacts.source, source));
  if (dateFrom) conditions.push(gte(contacts.createdAt, new Date(dateFrom)));
  if (segment) conditions.push(sql`${contacts.metadata}->>'segment' = ${segment}` as any);
  if (search) {
    conditions.push(
      or(
        ilike(contacts.firstName, `%${search}%`),
        ilike(contacts.lastName, `%${search}%`),
      ) as ReturnType<typeof eq>,
    );
  }

  const where = and(...conditions);
  const lim = Math.min(parseInt(limit, 10), 200);
  const off = parseInt(offset, 10);

  const [rows, countResult] = await Promise.all([
    db.select().from(contacts).where(where).orderBy(desc(contacts.createdAt)).limit(lim).offset(off),
    db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(where),
  ]);

  // Attach primary WhatsApp/phone number to each contact row
  const contactIds = rows.map((r) => r.id);
  const phoneMap: Record<string, string> = {};
  if (contactIds.length > 0) {
    const channelRows = await db
      .select({ contactId: contactChannels.contactId, channelValue: contactChannels.channelValue })
      .from(contactChannels)
      .where(
        and(
          sql`${contactChannels.contactId} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
          or(
            eq(contactChannels.channelType, 'whatsapp'),
            eq(contactChannels.channelType, 'phone'),
          ),
        ),
      );
    for (const ch of channelRows) {
      if (!phoneMap[ch.contactId]) phoneMap[ch.contactId] = ch.channelValue;
    }
  }

  const enriched = rows.map((r) => ({ ...r, phone: phoneMap[r.id] ?? null }));

  res.json({ contacts: enriched, total: countResult[0]?.count ?? 0 });
});

// ---------------------------------------------------------------------------
// GET /contacts/:id — returns contact with all channels
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const contactRows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (contactRows.length === 0) {
    res.status(404).json({ error: 'contact not found' });
    return;
  }

  const channels = await db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.contactId, id));

  res.json({ contact: contactRows[0], channels });
});

// ---------------------------------------------------------------------------
// GET /contacts/:id/channels
// ---------------------------------------------------------------------------
router.get('/:id/channels', async (req, res) => {
  const { id } = req.params;
  const channels = await db.select().from(contactChannels).where(eq(contactChannels.contactId, id));
  res.json({ channels });
});

// ---------------------------------------------------------------------------
// POST /contacts
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { firstName, lastName, source, sourceDetail, metadata, tags } = req.body;

  if (!firstName) {
    res.status(400).json({ error: 'firstName is required' });
    return;
  }

  const inserted = await db
    .insert(contacts)
    .values({ tenantId, firstName, lastName, source, sourceDetail, metadata, tags })
    .returning();

  res.status(201).json(inserted[0]);
});

// ---------------------------------------------------------------------------
// PATCH /contacts/:id
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    status,
    score,
    assignedTo,
    tags,
    metadata,
    optedInWa,
    optedInEmail,
    doNotContact,
    lastContactedAt,
  } = req.body;

  const updates: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  if (status !== undefined) updates.status = status;
  if (score !== undefined) updates.score = score;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo;
  if (tags !== undefined) updates.tags = tags;
  if (metadata !== undefined) updates.metadata = metadata;
  if (optedInWa !== undefined) updates.optedInWa = optedInWa;
  if (optedInEmail !== undefined) updates.optedInEmail = optedInEmail;
  if (doNotContact !== undefined) updates.doNotContact = doNotContact;
  if (lastContactedAt !== undefined) updates.lastContactedAt = new Date(lastContactedAt);

  const updated = await db
    .update(contacts)
    .set(updates)
    .where(eq(contacts.id, id))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: 'contact not found' });
    return;
  }

  res.json(updated[0]);
});

// ---------------------------------------------------------------------------
// POST /contacts/:id/channels
// ---------------------------------------------------------------------------
router.post('/:id/channels', async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  const { channelType, channelValue, isPrimary } = req.body;

  if (!channelType || !channelValue) {
    res.status(400).json({ error: 'channelType and channelValue are required' });
    return;
  }

  try {
    const inserted = await db
      .insert(contactChannels)
      .values({ tenantId, contactId: id, channelType, channelValue, isPrimary: isPrimary ?? false })
      .returning();

    res.status(201).json(inserted[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('unique') || message.includes('duplicate')) {
      res.status(409).json({ error: 'channel already exists for this contact' });
      return;
    }
    throw err;
  }
});

export default router;
