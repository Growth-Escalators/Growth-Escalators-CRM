import { Router } from 'express';
import { eq, and, desc, ilike, or, gte, sql } from 'drizzle-orm';
import { db, contacts, contactChannels, sequences, sequenceEnrolments } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /contacts — list contacts with filters + enriched phone/email
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const {
    status,
    source,
    search,
    dateFrom,
    segment,
    assignedTo,
    tags,
    limit = '50',
    offset = '0',
  } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [eq(contacts.tenantId, tenantId)];
  if (status) conditions.push(eq(contacts.status, status));
  if (source) conditions.push(eq(contacts.source, source));
  if (assignedTo) conditions.push(eq(contacts.assignedTo, assignedTo));
  if (dateFrom) conditions.push(gte(contacts.createdAt, new Date(dateFrom)));
  if (segment) conditions.push(sql`${contacts.metadata}->>'segment' = ${segment}` as any);
  if (tags) {
    // tags is a comma-separated list; match contacts that have ANY of those tags
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      conditions.push(sql`${contacts.tags} && ARRAY[${sql.join(tagList.map((t) => sql`${t}`), sql`, `)}]::text[]` as any);
    }
  }
  if (search) {
    conditions.push(
      or(
        ilike(contacts.firstName, `%${search}%`),
        ilike(contacts.lastName, `%${search}%`),
        ilike(contacts.companyName, `%${search}%`),
      ) as ReturnType<typeof eq>,
    );
  }

  const where = and(...conditions);
  const lim = Math.min(parseInt(limit, 10), 200);
  const off = parseInt(offset, 10);

  const [rows, countResult] = await Promise.all([
    db.select().from(contacts).where(where)
      .orderBy(desc(contacts.lastActivityAt), desc(contacts.createdAt))
      .limit(lim).offset(off),
    db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  // Attach primary phone and email
  const contactIds = rows.map((r) => r.id);
  const phoneMap: Record<string, string> = {};
  const emailMap: Record<string, string> = {};
  if (contactIds.length > 0) {
    const channelRows = await db
      .select({ contactId: contactChannels.contactId, channelType: contactChannels.channelType, channelValue: contactChannels.channelValue })
      .from(contactChannels)
      .where(
        and(
          sql`${contactChannels.contactId} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
          sql`${contactChannels.channelType} IN ('whatsapp', 'phone', 'email')`,
        ),
      );
    for (const ch of channelRows) {
      if ((ch.channelType === 'whatsapp' || ch.channelType === 'phone') && !phoneMap[ch.contactId]) {
        phoneMap[ch.contactId] = ch.channelValue;
      }
      if (ch.channelType === 'email' && !emailMap[ch.contactId]) {
        emailMap[ch.contactId] = ch.channelValue;
      }
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    phone: phoneMap[r.id] ?? null,
    email: emailMap[r.id] ?? null,
  }));

  res.setHeader('X-Total-Count', String(total));
  res.json({ contacts: enriched, total });
});

// ---------------------------------------------------------------------------
// GET /contacts/:id — single contact with all channels
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const contactRows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (contactRows.length === 0) {
    res.status(404).json({ error: 'contact not found' });
    return;
  }

  const channels = await db.select().from(contactChannels).where(eq(contactChannels.contactId, id));
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
// POST /contacts — create contact
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { firstName, lastName, companyName, source, sourceDetail, assignedTo, metadata, tags } = req.body;

  if (!firstName) {
    res.status(400).json({ error: 'firstName is required' });
    return;
  }

  const inserted = await db
    .insert(contacts)
    .values({ tenantId, firstName, lastName, companyName, source, sourceDetail, assignedTo, metadata, tags })
    .returning();

  res.status(201).json(inserted[0]);
});

// ---------------------------------------------------------------------------
// PATCH /contacts/:id — update contact
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    status,
    score,
    assignedTo,
    companyName,
    tags,
    notes,
    metadata,
    optedInWa,
    optedInEmail,
    doNotContact,
    lastContactedAt,
    lastActivityAt,
  } = req.body;

  const updates: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  if (status !== undefined) updates.status = status;
  if (score !== undefined) updates.score = score;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo;
  if (companyName !== undefined) updates.companyName = companyName;
  if (tags !== undefined) updates.tags = tags;
  if (notes !== undefined) updates.notes = notes;
  if (metadata !== undefined) updates.metadata = metadata;
  if (optedInWa !== undefined) updates.optedInWa = optedInWa;
  if (optedInEmail !== undefined) updates.optedInEmail = optedInEmail;
  if (doNotContact !== undefined) updates.doNotContact = doNotContact;
  if (lastContactedAt !== undefined) updates.lastContactedAt = new Date(lastContactedAt);
  if (lastActivityAt !== undefined) updates.lastActivityAt = new Date(lastActivityAt);

  const updated = await db.update(contacts).set(updates).where(eq(contacts.id, id)).returning();

  if (updated.length === 0) {
    res.status(404).json({ error: 'contact not found' });
    return;
  }

  res.json(updated[0]);
});

// ---------------------------------------------------------------------------
// POST /contacts/:id/channels — add a channel
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

// ---------------------------------------------------------------------------
// POST /contacts/bulk-tag
// Body: { contactIds: string[], tags: string[], mode?: 'add' | 'replace' | 'remove' }
// ---------------------------------------------------------------------------
router.post('/bulk-tag', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactIds, tags, mode = 'add' } = req.body as {
    contactIds?: string[];
    tags?: string[];
    mode?: 'add' | 'replace' | 'remove';
  };

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds array is required' });
    return;
  }
  if (!Array.isArray(tags)) {
    res.status(400).json({ error: 'tags array is required' });
    return;
  }

  const idFilter = sql`${contacts.id} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`;

  if (mode === 'replace') {
    await db.update(contacts).set({ tags, updatedAt: new Date() })
      .where(and(eq(contacts.tenantId, tenantId), idFilter));
  } else if (mode === 'remove') {
    // Remove specified tags from existing tags array
    await db.update(contacts).set({
      tags: sql`array(SELECT unnest(COALESCE(${contacts.tags}, '{}')) EXCEPT SELECT unnest(${tags}::text[]))`,
      updatedAt: new Date(),
    }).where(and(eq(contacts.tenantId, tenantId), idFilter));
  } else {
    // 'add' mode: union
    await db.update(contacts).set({
      tags: sql`array(SELECT DISTINCT unnest(COALESCE(${contacts.tags}, '{}') || ${tags}::text[]))`,
      updatedAt: new Date(),
    }).where(and(eq(contacts.tenantId, tenantId), idFilter));
  }

  res.json({ updated: contactIds.length });
});

// ---------------------------------------------------------------------------
// POST /contacts/bulk-assign
// Body: { contactIds: string[], assignedTo: string }
// ---------------------------------------------------------------------------
router.post('/bulk-assign', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactIds, assignedTo } = req.body as { contactIds?: string[]; assignedTo?: string };

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds array is required' });
    return;
  }
  if (!assignedTo) {
    res.status(400).json({ error: 'assignedTo is required' });
    return;
  }

  await db.update(contacts).set({ assignedTo, updatedAt: new Date() })
    .where(and(
      eq(contacts.tenantId, tenantId),
      sql`${contacts.id} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
    ));

  res.json({ updated: contactIds.length });
});

// ---------------------------------------------------------------------------
// POST /contacts/bulk-delete — soft delete (status = 'deleted')
// Body: { contactIds: string[] }
// ---------------------------------------------------------------------------
router.post('/bulk-delete', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactIds } = req.body as { contactIds?: string[] };

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds array is required' });
    return;
  }

  await db.update(contacts).set({ status: 'deleted', updatedAt: new Date() })
    .where(and(
      eq(contacts.tenantId, tenantId),
      sql`${contacts.id} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
    ));

  res.json({ deleted: contactIds.length });
});

// ---------------------------------------------------------------------------
// POST /contacts/export — returns CSV
// Body: { contactIds?: string[] } — if empty, exports all contacts for tenant
// ---------------------------------------------------------------------------
router.post('/export', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactIds } = req.body as { contactIds?: string[] };

  let rows;
  if (Array.isArray(contactIds) && contactIds.length > 0) {
    rows = await db.select().from(contacts)
      .where(and(
        eq(contacts.tenantId, tenantId),
        sql`${contacts.id} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
      ));
  } else {
    rows = await db.select().from(contacts).where(eq(contacts.tenantId, tenantId))
      .orderBy(desc(contacts.createdAt)).limit(5000);
  }

  // Fetch channels for all contacts
  const ids = rows.map((r) => r.id);
  const phoneMap: Record<string, string> = {};
  const emailMap: Record<string, string> = {};
  if (ids.length > 0) {
    const channelRows = await db.select().from(contactChannels).where(
      sql`${contactChannels.contactId} = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}])`,
    );
    for (const ch of channelRows) {
      if ((ch.channelType === 'whatsapp' || ch.channelType === 'phone') && !phoneMap[ch.contactId]) {
        phoneMap[ch.contactId] = ch.channelValue;
      }
      if (ch.channelType === 'email' && !emailMap[ch.contactId]) {
        emailMap[ch.contactId] = ch.channelValue;
      }
    }
  }

  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const headers = ['Name', 'Phone', 'Email', 'Company', 'Source', 'Score', 'Tags', 'Assigned To', 'Last Activity', 'Created At'];
  const csvRows = rows.map((r) => [
    escape(`${r.firstName} ${r.lastName ?? ''}`.trim()),
    escape(phoneMap[r.id] ?? ''),
    escape(emailMap[r.id] ?? ''),
    escape(r.companyName ?? ''),
    escape(r.source ?? ''),
    escape(r.score ?? 0),
    escape((r.tags ?? []).join(', ')),
    escape(r.assignedTo ?? ''),
    escape(r.lastActivityAt ? r.lastActivityAt.toISOString() : ''),
    escape(r.createdAt ? r.createdAt.toISOString() : ''),
  ].join(','));

  const csv = [headers.join(','), ...csvRows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
  res.send(csv);
});

// ---------------------------------------------------------------------------
// POST /contacts/bulk-sequence — enrol contacts in a sequence by name
// Body: { contactIds: string[], sequenceName: string }
// ---------------------------------------------------------------------------
router.post('/bulk-sequence', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactIds, sequenceName } = req.body as { contactIds?: string[]; sequenceName?: string };

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds array is required' });
    return;
  }
  if (!sequenceName) {
    res.status(400).json({ error: 'sequenceName is required' });
    return;
  }

  // Find sequence by name
  const seqRows = await db.select().from(sequences)
    .where(and(eq(sequences.tenantId, tenantId), eq(sequences.name, sequenceName)))
    .limit(1);

  if (seqRows.length === 0) {
    res.status(404).json({ error: `sequence "${sequenceName}" not found` });
    return;
  }

  const sequence = seqRows[0];

  // Find contacts already enrolled (active) in this sequence
  const existingEnrolments = await db.select({ contactId: sequenceEnrolments.contactId })
    .from(sequenceEnrolments)
    .where(and(
      eq(sequenceEnrolments.sequenceId, sequence.id),
      eq(sequenceEnrolments.status, 'active'),
      sql`${sequenceEnrolments.contactId} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
    ));

  const alreadyEnrolled = new Set(existingEnrolments.map((e) => e.contactId));
  const toEnrol = contactIds.filter((id) => !alreadyEnrolled.has(id));

  if (toEnrol.length === 0) {
    res.json({ enrolled: 0, skipped: contactIds.length });
    return;
  }

  const now = new Date();
  await db.insert(sequenceEnrolments).values(
    toEnrol.map((contactId) => ({
      tenantId,
      contactId,
      sequenceId: sequence.id,
      currentStep: 0,
      status: 'active' as const,
      nextStepAt: now,
    })),
  );

  res.json({ enrolled: toEnrol.length, skipped: contactIds.length - toEnrol.length });
});

export default router;
