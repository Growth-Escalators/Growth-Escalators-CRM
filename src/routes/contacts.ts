import logger from '../utils/logger';
import { Router } from 'express';
import { eq, and, desc, ilike, or, gte, sql } from 'drizzle-orm';
import { db, contacts, contactChannels, sequences, sequenceEnrolments, contactNotes, wizmatchCandidates } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /contacts — list contacts with filters + enriched phone/email
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
  const tenantId = req.user!.tenantId;
  const {
    status,
    source,
    search,
    dateFrom,
    segment,
    assignedTo,
    businessType,
    tags,
    excludeSources,
    limit = '50',
    offset = '0',
  } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [eq(contacts.tenantId, tenantId)];
  // Always exclude deleted contacts unless explicitly requested
  if (status) {
    conditions.push(eq(contacts.status, status));
  } else {
    conditions.push(sql`${contacts.status} IS DISTINCT FROM 'deleted'` as ReturnType<typeof eq>);
  }
  if (source) conditions.push(eq(contacts.source, source));
  if (assignedTo) conditions.push(eq(contacts.assignedTo, assignedTo));
  if (businessType) conditions.push(eq(contacts.businessType, businessType));
  if (dateFrom) conditions.push(gte(contacts.createdAt, new Date(dateFrom)));
  if (segment) conditions.push(sql`${contacts.metadata}->>'segment' = ${segment}` as any);
  if (tags) {
    // tags is a comma-separated list; match contacts that have ANY of those tags
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      conditions.push(sql`${contacts.tags} && ARRAY[${sql.join(tagList.map((t) => sql`${t}`), sql`, `)}]::text[]` as any);
    }
  }
  if (excludeSources) {
    const excludeList = excludeSources.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (excludeList.length > 0) {
      conditions.push(sql`COALESCE(${contacts.source}, '') NOT IN (${sql.join(excludeList.map(s => sql`${s}`), sql`, `)})` as ReturnType<typeof eq>);
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

  const dealMap: Record<string, { pipelineName: string; stage: string }> = {};
  if (contactIds.length > 0) {
    const dealRows = await db.execute(sql`
      SELECT DISTINCT ON (d.contact_id)
        d.contact_id::text AS contact_id,
        p.name AS pipeline_name,
        d.stage
      FROM deals d
      JOIN pipelines p ON p.id = d.pipeline_id
      WHERE d.contact_id = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])
        AND d.stage NOT IN ('won', 'lost')
      ORDER BY d.contact_id, d.created_at DESC
    `);
    for (const row of dealRows.rows as Array<{ contact_id: string; pipeline_name: string; stage: string }>) {
      dealMap[row.contact_id] = { pipelineName: row.pipeline_name, stage: row.stage };
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    phone: phoneMap[r.id] ?? null,
    email: emailMap[r.id] ?? null,
    activeDeal: dealMap[r.id] ?? null,
  }));

  res.setHeader('X-Total-Count', String(total));
  res.json({ contacts: enriched, total });
  } catch (e: unknown) {
    logger.error('[contacts] GET / error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /contacts/counts — single-query smart list counts (must be before /:id)
// ---------------------------------------------------------------------------
router.get('/counts', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'qualified') AS hot,
        COUNT(*) FILTER (WHERE status = 'lead')      AS uncontacted,
        COUNT(*) FILTER (WHERE source = 'checkout')  AS ecom,
        COUNT(*) FILTER (WHERE source = 'calcom')    AS consulting,
        COUNT(*) FILTER (WHERE source = 'discovery') AS discover,
        COUNT(*) FILTER (WHERE source IN ('outreach', 'cold_outreach')) AS outreach
      FROM contacts WHERE tenant_id = ${tenantId}::uuid AND status IS DISTINCT FROM 'deleted'
    `);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('[contacts] counts error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /contacts/tags — list all unique tags across contacts (must be before /:id)
// ---------------------------------------------------------------------------
router.get('/tags', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const result = await db.execute(sql`
      SELECT DISTINCT unnest(tags) AS tag
      FROM contacts
      WHERE tenant_id = ${tenantId}::uuid AND tags IS NOT NULL AND array_length(tags, 1) > 0
      ORDER BY 1
    `);
    res.json((result.rows as Array<{ tag: string }>).map(r => r.tag));
  } catch (err) {
    logger.error('[contacts] tags error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /contacts/:id/conversation — unified timeline
// ---------------------------------------------------------------------------
router.get('/:id/conversation', async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  try {
  // Verify contact belongs to tenant
  const [owner] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId))).limit(1);
  if (!owner) { res.status(404).json({ error: 'contact not found' }); return; }
  const [msgs, evts, bkgs, nts] = await Promise.all([
    db.execute(sql`
      SELECT id::text, 'message' as item_type, channel, direction, content,
             template_name as "templateName", created_at, status, NULL as "scheduledAt",
             NULL as tier, NULL as score, NULL as "bookingUid",
             NULL as "eventType", NULL as data,
             NULL as "createdBy", NULL as "updatedAt"
      FROM messages WHERE contact_id = ${id}::uuid
    `),
    db.execute(sql`
      SELECT id::text, 'event' as item_type, NULL as channel, NULL as direction,
             NULL as content, NULL as "templateName", created_at, NULL as status,
             NULL as "scheduledAt", NULL as tier, NULL as score, NULL as "bookingUid",
             type as "eventType", data, NULL as "createdBy", NULL as "updatedAt"
      FROM events WHERE contact_id = ${id}::uuid
    `),
    db.execute(sql`
      SELECT id::text, 'booking' as item_type, NULL as channel, NULL as direction,
             NULL as content, NULL as "templateName", created_at, NULL as status,
             scheduled_at as "scheduledAt", qualification_tier as tier,
             qualification_score as score, cal_booking_uid as "bookingUid",
             NULL as "eventType", NULL as data, NULL as "createdBy", NULL as "updatedAt"
      FROM bookings WHERE contact_id = ${id}::uuid
    `),
    db.execute(sql`
      SELECT id::text, 'note' as item_type, NULL as channel, NULL as direction,
             content, NULL as "templateName", created_at, NULL as status,
             NULL as "scheduledAt", NULL as tier, NULL as score, NULL as "bookingUid",
             NULL as "eventType", NULL as data,
             created_by as "createdBy", updated_at as "updatedAt"
      FROM contact_notes WHERE contact_id = ${id}::uuid
    `),
  ]);

  const all = [
    ...(msgs.rows as any[]),
    ...(evts.rows as any[]),
    ...(bkgs.rows as any[]),
    ...(nts.rows as any[]),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
   .slice(0, 100);

  res.json({ items: all });
  } catch (err) {
    logger.error('[contacts] conversation error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /contacts/:id/notes
// ---------------------------------------------------------------------------
router.get('/:id/notes', async (req, res) => {
  try {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  const notes = await db.select().from(contactNotes)
    .where(and(eq(contactNotes.contactId, id), eq(contactNotes.tenantId, tenantId)))
    .orderBy(desc(contactNotes.createdAt));
  res.json({ notes });
  } catch (e: unknown) {
    logger.error('[contacts] GET /:id/notes error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /contacts/:id/notes
// ---------------------------------------------------------------------------
router.post('/:id/notes', async (req, res) => {
  try {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;
  const { content, createdBy = 'jatin' } = req.body;
  if (!content) { res.status(400).json({ error: 'content is required' }); return; }
  const [note] = await db.insert(contactNotes).values({ tenantId, contactId: id, content, createdBy }).returning();
  await db.update(contacts).set({ lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(contacts.id, id));
  res.status(201).json(note);
  } catch (e: unknown) {
    logger.error('[contacts] POST /:id/notes error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /contacts/:id/notes/:noteId
// ---------------------------------------------------------------------------
router.patch('/:id/notes/:noteId', async (req, res) => {
  try {
  const { noteId } = req.params;
  const { content } = req.body;
  if (!content) { res.status(400).json({ error: 'content is required' }); return; }
  const [updated] = await db.update(contactNotes).set({ content, updatedAt: new Date() }).where(eq(contactNotes.id, noteId)).returning();
  if (!updated) { res.status(404).json({ error: 'note not found' }); return; }
  res.json(updated);
  } catch (e: unknown) {
    logger.error('[contacts] PATCH /:id/notes/:noteId error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /contacts/:id/notes/:noteId
// ---------------------------------------------------------------------------
router.delete('/:id/notes/:noteId', async (req, res) => {
  try {
  const { id, noteId } = req.params;
  await db.delete(contactNotes).where(and(eq(contactNotes.id, noteId), eq(contactNotes.contactId, id)));
  res.json({ deleted: true });
  } catch (e: unknown) {
    logger.error('[contacts] DELETE /:id/notes/:noteId error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /contacts/:id — single contact with all channels
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;

  const contactRows = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId))).limit(1);
  if (contactRows.length === 0) {
    res.status(404).json({ error: 'contact not found' });
    return;
  }

  const channels = await db.select().from(contactChannels).where(eq(contactChannels.contactId, id));

  // Wizmatch-sourced contacts have a linked candidate row (skills, GitHub/LinkedIn
  // URL, visa status, rate) that the generic contacts table doesn't carry.
  const candidateRows = await db.select().from(wizmatchCandidates).where(eq(wizmatchCandidates.contactId, id)).limit(1);

  res.json({ contact: contactRows[0], channels, wizmatchCandidate: candidateRows[0] ?? null });
  } catch (e: unknown) {
    logger.error('[contacts] GET /:id error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /contacts/:id/channels
// ---------------------------------------------------------------------------
router.get('/:id/channels', async (req, res) => {
  try {
  const { id } = req.params;
  const channels = await db.select().from(contactChannels).where(eq(contactChannels.contactId, id));
  res.json({ channels });
  } catch (e: unknown) {
    logger.error('[contacts] GET /:id/channels error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /contacts — create contact
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
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

  // ClickUp outreach task hook removed — ClickUp dropped 2026-05-09
  const contact = inserted[0];

  res.status(201).json(contact);
  } catch (e: unknown) {
    logger.error('[contacts] POST / error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /contacts/:id — update contact
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  try {
  const { id } = req.params;
  const {
    status,
    score,
    assignedTo,
    businessType,
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
  if (businessType !== undefined) updates.businessType = businessType;
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
  } catch (e: unknown) {
    logger.error('[contacts] PATCH /:id error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
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
  try {
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
  if (contactIds.length > 500) {
    res.status(400).json({ error: 'maximum 500 contacts per bulk operation' });
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
  } catch (e: unknown) {
    logger.error('[contacts] POST /bulk-tag error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /contacts/bulk-assign
// Body: { contactIds: string[], assignedTo: string }
// ---------------------------------------------------------------------------
router.post('/bulk-assign', async (req, res) => {
  try {
  const tenantId = req.user!.tenantId;
  const { contactIds, assignedTo } = req.body as { contactIds?: string[]; assignedTo?: string };

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds array is required' });
    return;
  }
  if (contactIds.length > 500) {
    res.status(400).json({ error: 'maximum 500 contacts per bulk operation' });
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
  } catch (e: unknown) {
    logger.error('[contacts] POST /bulk-assign error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /contacts/bulk-delete — soft delete (status = 'deleted')
// Body: { contactIds: string[] }
// ---------------------------------------------------------------------------
router.post('/bulk-delete', async (req, res) => {
  try {
  const tenantId = req.user!.tenantId;
  const { contactIds } = req.body as { contactIds?: string[] };

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds array is required' });
    return;
  }
  if (contactIds.length > 500) {
    res.status(400).json({ error: 'maximum 500 contacts per bulk operation' });
    return;
  }

  await db.update(contacts).set({ status: 'deleted', updatedAt: new Date() })
    .where(and(
      eq(contacts.tenantId, tenantId),
      sql`${contacts.id} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
    ));

  res.json({ deleted: contactIds.length });
  } catch (e: unknown) {
    logger.error('[contacts] POST /bulk-delete error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /contacts/bulk-email — send email template to selected contacts
// ---------------------------------------------------------------------------
router.post('/bulk-email', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { contactIds, templateId } = req.body as { contactIds?: string[]; templateId?: string };

    if (!Array.isArray(contactIds) || contactIds.length === 0 || !templateId) {
      res.status(400).json({ error: 'contactIds array and templateId are required' });
      return;
    }
    if (contactIds.length > 200) {
      res.status(400).json({ error: 'maximum 200 contacts per bulk email' });
      return;
    }

    const brevoKey = process.env.BREVO_API_KEY;
    if (!brevoKey) {
      res.status(500).json({ error: 'BREVO_API_KEY not configured' });
      return;
    }

    // Fetch template
    const { emailTemplates } = await import('../db/index');
    const tplRows = await db.select().from(emailTemplates)
      .where(and(eq(emailTemplates.id, templateId), eq(emailTemplates.tenantId, tenantId)))
      .limit(1);
    if (tplRows.length === 0) {
      res.status(404).json({ error: 'template not found' });
      return;
    }
    const template = tplRows[0];

    // Fetch contact emails
    const emailRows = await db.select({ contactId: contactChannels.contactId, email: contactChannels.channelValue })
      .from(contactChannels)
      .where(and(
        sql`${contactChannels.contactId} = ANY(ARRAY[${sql.join(contactIds.map(id => sql`${id}::uuid`), sql`, `)}])`,
        eq(contactChannels.channelType, 'email'),
      ));

    // Fetch contact first names for personalization
    const contactRows = await db.select({ id: contacts.id, firstName: contacts.firstName })
      .from(contacts)
      .where(sql`${contacts.id} = ANY(ARRAY[${sql.join(contactIds.map(id => sql`${id}::uuid`), sql`, `)}])`);
    const nameMap: Record<string, string> = {};
    for (const c of contactRows) nameMap[c.id] = c.firstName ?? 'there';

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of emailRows) {
      const firstName = nameMap[row.contactId] ?? 'there';
      const subject = (template.subject ?? '').replace(/\{\{firstName\}\}/g, firstName);
      const htmlContent = (template.bodyHtml || (template.bodyText ?? '').replace(/\n/g, '<br>')).replace(/\{\{firstName\}\}/g, firstName);

      try {
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            sender: { name: template.fromName ?? 'Jatin from Growth Escalators', email: 'jatin@growthescalators.com' },
            to: [{ email: row.email, name: firstName }],
            subject,
            htmlContent,
          }),
        });
        if (brevoRes.ok) sent++;
        else { failed++; errors.push(`${row.email}: HTTP ${brevoRes.status}`); }
      } catch (e) {
        failed++;
        errors.push(`${row.email}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Update template sent count
    await db.execute(sql`UPDATE email_templates SET sent_count = COALESCE(sent_count, 0) + ${sent} WHERE id = ${templateId}`);

    res.json({ sent, failed, skipped: contactIds.length - emailRows.length, errors: errors.slice(0, 10) });
  } catch (e: unknown) {
    logger.error('[contacts] POST /bulk-email error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /contacts/export — returns CSV
// Body: { contactIds?: string[] } — if empty, exports all contacts for tenant
// ---------------------------------------------------------------------------
router.post('/export', async (req, res) => {
  try {
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
  } catch (e: unknown) {
    logger.error('[contacts] POST /export error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /contacts/import — import contacts from CSV text
// Expects JSON body: { csv: "Name,Email,Phone,Company\nJohn,john@x.com,..." }
// ---------------------------------------------------------------------------
router.post('/import', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { csv } = req.body as { csv?: string };
    if (!csv || typeof csv !== 'string') {
      res.status(400).json({ error: 'csv field is required' });
      return;
    }

    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      res.status(400).json({ error: 'CSV must have a header row and at least one data row' });
      return;
    }

    // Parse header
    const header = lines[0].toLowerCase().split(',').map(h => h.replace(/"/g, '').trim());
    const nameIdx = header.findIndex(h => h === 'name' || h === 'first name' || h === 'firstname');
    const emailIdx = header.findIndex(h => h === 'email');
    const phoneIdx = header.findIndex(h => h === 'phone' || h === 'whatsapp');
    const companyIdx = header.findIndex(h => h === 'company' || h === 'company name');

    // Dedup: collect all emails from CSV and check existing
    const csvEmails: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i].match(/("([^"]|"")*"|[^,]*)/g)?.map(f => f.replace(/^"|"$/g, '').replace(/""/g, '"').trim()) ?? [];
      const email = emailIdx >= 0 ? (fields[emailIdx] ?? '').toLowerCase().trim() : '';
      if (email) csvEmails.push(email);
    }
    const existingEmails = new Set<string>();
    if (csvEmails.length > 0) {
      const existResult = await db.execute(
        sql`SELECT LOWER(cv.channel_value) AS email FROM contact_channels cv
            WHERE cv.channel_type = 'email' AND cv.tenant_id = ${tenantId}
              AND LOWER(cv.channel_value) = ANY(ARRAY[${sql.join(csvEmails.map(e => sql`${e}`), sql`, `)}])`
      );
      for (const r of existResult.rows as Array<{ email: string }>) existingEmails.add(r.email);
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        // Simple CSV parse (handles quoted fields)
        const fields = lines[i].match(/("([^"]|"")*"|[^,]*)/g)?.map(f => f.replace(/^"|"$/g, '').replace(/""/g, '"').trim()) ?? [];

        const fullName = (nameIdx >= 0 ? fields[nameIdx] : '') || '';
        const nameParts = fullName.split(/\s+/);
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || null;
        const email = emailIdx >= 0 ? fields[emailIdx] : null;
        const phone = phoneIdx >= 0 ? fields[phoneIdx] : null;
        const company = companyIdx >= 0 ? fields[companyIdx] : null;

        if (!firstName && !email && !phone) continue;

        // Dedup: skip if email already exists
        if (email && existingEmails.has(email.toLowerCase().trim())) {
          skipped++;
          continue;
        }

        const [contact] = await db.insert(contacts).values({
          tenantId,
          firstName,
          lastName,
          companyName: company,
          source: 'csv_import',
          status: 'lead',
          tags: ['csv-import'],
        }).returning();

        if (email) {
          await db.insert(contactChannels).values({
            tenantId, contactId: contact.id, channelType: 'email', channelValue: email, isPrimary: true,
          }).catch(() => {});
        }
        if (phone) {
          const cleanPhone = phone.replace(/[^\d+]/g, '');
          if (cleanPhone) {
            await db.insert(contactChannels).values({
              tenantId, contactId: contact.id, channelType: 'whatsapp', channelValue: cleanPhone, isPrimary: true,
            }).catch(() => {});
          }
        }

        imported++;
      } catch (e) {
        errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    res.json({ imported, skipped, errors: errors.slice(0, 10), totalRows: lines.length - 1 });
  } catch (e: unknown) {
    logger.error('[contacts] POST /import error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /contacts/bulk-sequence — enrol contacts in a sequence by name
// Body: { contactIds: string[], sequenceName: string }
// ---------------------------------------------------------------------------
router.post('/bulk-sequence', async (req, res) => {
  try {
  const tenantId = req.user!.tenantId;
  const { contactIds, sequenceName } = req.body as { contactIds?: string[]; sequenceName?: string };

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds array is required' });
    return;
  }
  if (contactIds.length > 500) {
    res.status(400).json({ error: 'maximum 500 contacts per bulk operation' });
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
  } catch (e: unknown) {
    logger.error('[contacts] POST /bulk-sequence error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
