import logger from '../utils/logger';
import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db, pool, deals, contacts, pipelines } from '../db/index';
import { findPipelineStageOutcome } from '../services/pipelineStages';
import { requirePerm } from '../middleware/requirePerm';

const router = Router();

async function getPipelineStageOutcome(tenantId: string, pipelineId: string | null | undefined, stage: unknown) {
  if (!pipelineId) return 'open';
  const pipelineRows = await db
    .select({ stages: pipelines.stages })
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId)))
    .limit(1);
  return findPipelineStageOutcome(pipelineRows[0]?.stages, stage);
}

// ---------------------------------------------------------------------------
// GET /deals — list deals with optional filters
// ---------------------------------------------------------------------------
router.get('/', requirePerm('deals.view'), async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { stage, contactId, serviceType, pipelineId, assignedTo, limit = '100', offset = '0', includeArchived } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [eq(deals.tenantId, tenantId)];
  if (stage) conditions.push(eq(deals.stage, stage));
  if (contactId) conditions.push(eq(deals.contactId, contactId));
  if (serviceType) conditions.push(eq(deals.serviceType, serviceType));
  if (pipelineId) conditions.push(eq(deals.pipelineId, pipelineId));
  if (assignedTo) conditions.push(eq(deals.assignedTo, assignedTo));
  if (includeArchived !== 'true') {
    conditions.push(sql`(${deals.metadata}->>'archived') IS DISTINCT FROM 'true'` as any);
  }

  try {
    const rows = await db
      .select({
        deal: deals,
        pipelineName: pipelines.name,
        pipelineColor: pipelines.color,
      })
      .from(deals)
      .leftJoin(pipelines, and(eq(deals.pipelineId, pipelines.id), eq(pipelines.tenantId, tenantId)))
      .where(and(...conditions))
      .limit(Math.min(parseInt(limit, 10), 1000))
      .offset(parseInt(offset, 10));

    const enriched = rows.map((r) => ({
      ...r.deal,
      pipelineName: r.pipelineName ?? null,
      pipelineColor: r.pipelineColor ?? null,
    }));

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(deals).where(and(...conditions));
    const total = countResult?.count ?? enriched.length;
    res.json({ deals: enriched, total });
  } catch (err) {
    logger.error('[deals] GET / error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /deals — create a deal
// ---------------------------------------------------------------------------
router.post('/', requirePerm('deals.create'), async (req, res) => {
  try {
  const tenantId = req.user!.tenantId;
  const { contactId, title, stage, value, dealValue, serviceType, pipelineId, assignedTo, notes, lostReason, wonNotes, metadata, source, probability } = req.body;

  if (!contactId || !title) {
    res.status(400).json({ error: 'contactId and title are required' });
    return;
  }

  // Validate numeric fields
  if (value !== undefined && value !== null) {
    const parsed = Number(value);
    if (isNaN(parsed) || parsed < 0) {
      res.status(400).json({ error: 'Deal value must be a positive number' });
      return;
    }
  }
  if (dealValue !== undefined && dealValue !== null) {
    const parsed = Number(dealValue);
    if (isNaN(parsed) || parsed < 0) {
      res.status(400).json({ error: 'Deal value must be a positive number' });
      return;
    }
  }

  // Contact and pipeline ids are tenant-owned foreign keys from the UI. Fail
  // closed rather than allowing a guessed cross-tenant id to be attached.
  const contactRows = await db.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId))).limit(1);
  if (contactRows.length === 0) {
    res.status(404).json({ error: 'contact not found' });
    return;
  }
  if (pipelineId) {
    const pipelineRows = await db.select({ id: pipelines.id }).from(pipelines)
      .where(and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId))).limit(1);
    if (pipelineRows.length === 0) {
      res.status(404).json({ error: 'pipeline not found' });
      return;
    }
  }

  const inserted = await db
    .insert(deals)
    .values({
      tenantId, contactId, title, stage,
      value: value !== undefined ? String(value) : undefined,
      dealValue: dealValue !== undefined ? Number(dealValue) : undefined,
      serviceType, pipelineId, assignedTo, notes, lostReason, wonNotes, metadata,
    })
    .returning();

  // Update contact's lastActivityAt
  await db.update(contacts).set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));

  // Set source/probability via raw SQL (runtime columns, not in schema)
  if ((source !== undefined || probability !== undefined) && inserted[0]?.id) {
    const setClauses: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (source !== undefined) { setClauses.push(`source = $${idx++}`); vals.push(source || null); }
    if (probability !== undefined) { setClauses.push(`probability = $${idx++}`); vals.push(probability); }
    vals.push(tenantId);
    const tenantIdx = idx++;
    vals.push(inserted[0].id);
    const idIdx = idx;
    await pool.query(
      `UPDATE deals SET ${setClauses.join(', ')} WHERE tenant_id = $${tenantIdx} AND id = $${idIdx}`,
      vals,
    ).catch(() => {});
  }

  res.status(201).json(inserted[0]);
  } catch (e: unknown) {
    logger.error('[deals] POST / error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /deals/:id — update deal stage, value, metadata, etc.
// Auto-sets closedAt when the target pipeline stage has a terminal outcome
// Updates contact lastActivityAt on stage change
// ---------------------------------------------------------------------------
router.patch('/:id', requirePerm('deals.edit'), async (req, res) => {
  try {
  const { id } = req.params as { id: string };
  const tenantId = req.user!.tenantId;
  const { stage, value, dealValue, lostReason, wonNotes, closedAt, metadata, assignedTo, pipelineId, notes, source, probability, expectedCloseDate } = req.body;

  // Get current deal to check stage change
  const existing = await db.select().from(deals).where(and(eq(deals.id, id), eq(deals.tenantId, tenantId))).limit(1);
  if (existing.length === 0) {
    res.status(404).json({ error: 'deal not found' });
    return;
  }

  if (pipelineId !== undefined && pipelineId !== null) {
    const pipelineRows = await db.select({ id: pipelines.id }).from(pipelines)
      .where(and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId))).limit(1);
    if (pipelineRows.length === 0) {
      res.status(404).json({ error: 'pipeline not found' });
      return;
    }
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
  if (expectedCloseDate !== undefined) updates.expectedCloseDate = expectedCloseDate ? String(expectedCloseDate) : null;

  // Auto-set closedAt on terminal stages based on normalized pipeline stage outcome.
  const stageOutcome = stage !== undefined
    ? await getPipelineStageOutcome(tenantId, pipelineId ?? existing[0].pipelineId, stage)
    : 'open';
  if (stage !== undefined && stageOutcome !== 'open' && !closedAt) {
    updates.closedAt = new Date();
  } else if (stage !== undefined && stageOutcome === 'open') {
    // Reopening/moving a deal out of a terminal stage should clear stale close
    // dates; otherwise cycle/forecast analytics continue treating it as closed.
    updates.closedAt = null;
  } else if (closedAt !== undefined) {
    updates.closedAt = new Date(closedAt);
  }

  const updated = await db.update(deals).set(updates)
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId))).returning();

  // Update source/probability via raw SQL (columns added at runtime, not in schema)
  if (source !== undefined || probability !== undefined) {
    const setClauses: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (source !== undefined) { setClauses.push(`source = $${idx++}`); vals.push(source || null); }
    if (probability !== undefined) { setClauses.push(`probability = $${idx++}`); vals.push(probability); }
    vals.push(tenantId);
    const tenantIdx = idx++;
    vals.push(id);
    const idIdx = idx;
    await pool.query(
      `UPDATE deals SET ${setClauses.join(', ')} WHERE tenant_id = $${tenantIdx} AND id = $${idIdx}`,
      vals,
    );
  }

  // Log stage change to deal_activities
  if (stage !== undefined && stage !== existing[0].stage) {
    pool.query(
      `INSERT INTO deal_activities (tenant_id, deal_id, contact_id, activity_type, from_stage, to_stage, created_by)
       VALUES ($1, $2, $3, 'stage_change', $4, $5, 'system')`,
      [tenantId, id, existing[0].contactId, existing[0].stage, stage],
    ).catch(() => {});
  }

  // Update contact lastActivityAt when stage changes
  if (stage !== undefined && stage !== existing[0].stage) {
    await db.update(contacts).set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(and(eq(contacts.id, existing[0].contactId), eq(contacts.tenantId, tenantId)));

    // ClickUp stage-transition tasks removed — ClickUp dropped 2026-05-09
  }

  // Stage automation: fire email + task if stage_config defines automations
  if (stage !== undefined && stage !== existing[0].stage && updated[0]?.pipelineId) {
    const activePipelineId = updated[0].pipelineId;
    pool.query(`SELECT stage_config FROM pipelines WHERE id = $1 AND tenant_id = $2`, [activePipelineId, tenantId])
      .then(async (pcRes) => {
        const stageConfig = pcRes.rows[0]?.stage_config ?? {};
        const cfg = stageConfig[stage as string] as { probability?: number; automation?: { sendEmailTemplateId?: string; createTask?: { title: string; dueInDays?: number } } } | undefined;
        if (!cfg) return;

        // Apply the configured probability for this stage. This intentionally
        // follows stage movement rather than only filling NULL so the weighted
        // forecast reflects the deal's current position.
        if (cfg.probability !== undefined) {
          await pool.query(
            `UPDATE deals SET probability = $1 WHERE id = $2 AND tenant_id = $3`,
            [cfg.probability, id, tenantId],
          );
        }

        // Send email automation
        if (cfg.automation?.sendEmailTemplateId) {
          try {
            // Get contact email
            const contactRes = await pool.query(
              `SELECT cc.channel_value AS email, c.first_name
               FROM contacts c
               LEFT JOIN contact_channels cc
                 ON cc.contact_id = c.id
                AND cc.tenant_id = c.tenant_id
                AND cc.channel_type = 'email'
                AND cc.is_primary = true
               WHERE c.id = $1 AND c.tenant_id = $2 LIMIT 1`,
              [existing[0].contactId, tenantId]
            );
            const contactRow = contactRes.rows[0];
            const templateRes = await pool.query(
              `SELECT subject, body_html AS body FROM email_templates WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
              [cfg.automation.sendEmailTemplateId, tenantId]
            );
            const tpl = templateRes.rows[0];
            if (contactRow?.email && tpl) {
              const { sendTransactionalEmail, automatedEmailsEnabled } = await import('../services/emailService');
              if (!automatedEmailsEnabled()) {
                // Deal stage-change auto-email is an automated send to a contact —
                // blocked unless the master kill-switch is on.
                logger.warn('[deals] stage-automation email suppressed — AUTOMATED_EMAILS_ENABLED is off');
              } else {
                const firstName = contactRow.first_name || 'there';
                const htmlContent = (tpl.body || '').replace(/\{\{firstName\}\}/g, firstName);
                await sendTransactionalEmail(contactRow.email, firstName, tpl.subject, htmlContent, htmlContent.replace(/<[^>]+>/g, ''), tenantId);
                await pool.query(
                  `INSERT INTO deal_activities (tenant_id, deal_id, contact_id, activity_type, note, created_by)
                   VALUES ($1, $2, $3, 'automation_email', $4, 'automation')`,
                  [tenantId, id, existing[0].contactId, `Auto-email sent: ${tpl.subject}`]
                );
              }
            }
          } catch (e) { logger.error('[deals] Stage automation email error:', e); }
        }

        // Create CRM task automation (dropped ClickUp — write to internal tasks table)
        if (cfg.automation?.createTask?.title) {
          try {
            const dueInDays = cfg.automation.createTask.dueInDays ?? 3;
            const dueAt = new Date(Date.now() + dueInDays * 86400000);
            await pool.query(
              `INSERT INTO tasks (tenant_id, contact_id, deal_id, title, due_at, status, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 'open', NOW(), NOW())`,
              [tenantId, existing[0].contactId, id, cfg.automation.createTask.title, dueAt]
            );
            await pool.query(
              `INSERT INTO deal_activities (tenant_id, deal_id, contact_id, activity_type, note, created_by)
               VALUES ($1, $2, $3, 'automation_task', $4, 'automation')`,
              [tenantId, id, existing[0].contactId, `Auto-task created: ${cfg.automation.createTask.title}`]
            );
          } catch (e) { logger.error('[deals] Stage automation task error:', e); }
        }
      })
      .catch(() => {}); // fire-and-forget, never block the main response
  }

  res.json(updated[0]);
  } catch (e: unknown) {
    logger.error('[deals] PATCH /:id error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /deals/bulk-create — create deals for multiple contacts
// Skips contacts already in the same pipeline
// ---------------------------------------------------------------------------
router.post('/bulk-create', requirePerm('deals.bulk'), async (req, res) => {
  try {
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

  // Only create for contacts owned by the current tenant. Invalid/cross-tenant
  // ids are treated as skipped rather than being allowed into a deal row.
  const ownedContacts = await db.select({ id: contacts.id }).from(contacts).where(and(
    eq(contacts.tenantId, tenantId),
    sql`${contacts.id} = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
  ));
  const ownedIds = new Set(ownedContacts.map((row) => row.id));
  const validContactIds = contactIds.filter((id) => ownedIds.has(id));
  if (validContactIds.length === 0) {
    res.json({ created: [], skipped: contactIds.length });
    return;
  }

  if (pipelineId) {
    const pipelineRows = await db.select({ id: pipelines.id }).from(pipelines)
      .where(and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId))).limit(1);
    if (pipelineRows.length === 0) {
      res.status(404).json({ error: 'pipeline not found' });
      return;
    }
  }

  // Find contacts that already have a deal in this pipeline
  const existingConditions = [
    eq(deals.tenantId, tenantId),
    sql`${deals.contactId} = ANY(ARRAY[${sql.join(validContactIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
  ] as ReturnType<typeof eq>[];
  if (pipelineId) existingConditions.push(eq(deals.pipelineId, pipelineId));
  else if (serviceType) existingConditions.push(eq(deals.serviceType, serviceType));

  const existing = await db.select({ contactId: deals.contactId }).from(deals)
    .where(and(...existingConditions));
  const existingIds = new Set(existing.map((r) => r.contactId));
  const toCreate = validContactIds.filter((id) => !existingIds.has(id));

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
    .where(and(
      eq(contacts.tenantId, tenantId),
      sql`${contacts.id} = ANY(ARRAY[${sql.join(toCreate.map((id) => sql`${id}::uuid`), sql`, `)}])`,
    ));

  res.status(201).json({ created, skipped: contactIds.length - toCreate.length });
  } catch (e: unknown) {
    logger.error('[deals] POST /bulk-create error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /deals/bulk-update — update stage/assignedTo/pipelineId/archived for multiple deals
// Body: { dealIds: string[], updates: { stage?, assignedTo?, pipelineId?, archived? } }
//
// `archived: true` sets metadata.archived = true (and clears it on false). Uses
// jsonb_set so other metadata keys are preserved. Runs as a separate SQL pass
// because Drizzle's set-builder doesn't support partial jsonb mutation.
// ---------------------------------------------------------------------------
router.post('/bulk-update', requirePerm('deals.bulk'), async (req, res) => {
  try {
  const tenantId = req.user!.tenantId;
  const { dealIds, updates: upd } = req.body as {
    dealIds?: string[];
    updates?: { stage?: string; assignedTo?: string; pipelineId?: string; archived?: boolean };
  };

  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    res.status(400).json({ error: 'dealIds array is required' });
    return;
  }
  if (!upd || Object.keys(upd).length === 0) {
    res.status(400).json({ error: 'updates object is required' });
    return;
  }

  if (upd.pipelineId !== undefined) {
    const pipelineRows = await db.select({ id: pipelines.id }).from(pipelines)
      .where(and(eq(pipelines.id, upd.pipelineId), eq(pipelines.tenantId, tenantId))).limit(1);
    if (pipelineRows.length === 0) {
      res.status(404).json({ error: 'pipeline not found' });
      return;
    }
  }

  const updates: Partial<typeof deals.$inferInsert> = { updatedAt: new Date() };
  if (upd.stage !== undefined) updates.stage = upd.stage;
  if (upd.assignedTo !== undefined) updates.assignedTo = upd.assignedTo;
  if (upd.pipelineId !== undefined) updates.pipelineId = upd.pipelineId;

  const hasColumnUpdate = upd.stage !== undefined || upd.assignedTo !== undefined || upd.pipelineId !== undefined;
  if (hasColumnUpdate) {
    await db.update(deals).set(updates).where(
      and(
        eq(deals.tenantId, tenantId),
        sql`${deals.id} = ANY(ARRAY[${sql.join(dealIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
      ),
    );
  }

  if (upd.archived !== undefined) {
    await pool.query(
      `UPDATE deals
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{archived}', to_jsonb($1::boolean), true),
             updated_at = NOW()
       WHERE tenant_id = $2 AND id = ANY($3::uuid[])`,
      [upd.archived, tenantId, dealIds],
    );
  }

  res.json({ updated: dealIds.length });
  } catch (e: unknown) {
    logger.error('[deals] POST /bulk-update error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /deals/:id/add-or-update — upsert deal for contact in pipeline
// If contact already has a deal in this pipeline, update it; else create new
// ---------------------------------------------------------------------------
router.post('/add-or-update', requirePerm('deals.bulk'), async (req, res) => {
  try {
  const tenantId = req.user!.tenantId;
  const { contactId, pipelineId, stage, assignedTo, dealValue, notes, source, title = 'Opportunity' } = req.body;

  if (!contactId || !pipelineId || !stage) {
    res.status(400).json({ error: 'contactId, pipelineId, and stage are required' });
    return;
  }

  const [ownedContact] = await db.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId))).limit(1);
  if (!ownedContact) {
    res.status(404).json({ error: 'contact not found' });
    return;
  }
  const [ownedPipeline] = await db.select({ id: pipelines.id }).from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId))).limit(1);
  if (!ownedPipeline) {
    res.status(404).json({ error: 'pipeline not found' });
    return;
  }

  // Check if deal already exists for this contact in this pipeline
  const existing = await db.select().from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.contactId, contactId), eq(deals.pipelineId, pipelineId)))
    .limit(1);

  let result;
  const stageOutcome = await getPipelineStageOutcome(tenantId, pipelineId, stage);
  if (existing.length > 0) {
    const upd: Partial<typeof deals.$inferInsert> = {
      stage, updatedAt: new Date(),
      ...(assignedTo !== undefined ? { assignedTo } : {}),
      ...(dealValue !== undefined ? { dealValue } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(stageOutcome !== 'open' ? { closedAt: new Date() } : { closedAt: null }),
    };

    const updated = await db.update(deals).set(upd)
      .where(and(eq(deals.id, existing[0].id), eq(deals.tenantId, tenantId))).returning();
    result = { deal: updated[0], action: 'updated' };
  } else {
    const inserted = await db.insert(deals).values({
      tenantId, contactId, pipelineId, stage, title, assignedTo, dealValue, notes,
      ...(stageOutcome !== 'open' ? { closedAt: new Date() } : {}),
    }).returning();
    result = { deal: inserted[0], action: 'created' };
  }

  // Source is a runtime column in this CRM. The Add Deal modal exposes it, so
  // persist it here rather than silently ignoring the selected value.
  if (source !== undefined && result.deal?.id) {
    await pool.query(
      `UPDATE deals SET source = $1 WHERE tenant_id = $2 AND id = $3`,
      [source || null, tenantId, result.deal.id],
    );
  }

  // Update contact lastActivityAt
  await db.update(contacts).set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));

  res.json(result);
  } catch (e: unknown) {
    logger.error('[deals] POST /add-or-update error:', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /deals/export — CSV export of all deals
// ---------------------------------------------------------------------------
router.get('/export', requirePerm('deals.export'), async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const rows = await db.execute(sql`
      SELECT d.title, d.stage, p.name AS pipeline_name,
             c.first_name || ' ' || COALESCE(c.last_name, '') AS contact_name,
             d.deal_value, d.assigned_to, d.created_at, d.closed_at
      FROM deals d
      LEFT JOIN pipelines p ON p.id = d.pipeline_id AND p.tenant_id = d.tenant_id
      LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
      WHERE d.tenant_id = ${tenantId}
      ORDER BY d.created_at DESC LIMIT 5000
    `);

    const esc = (v: unknown) => { const s = v == null ? '' : String(v).replace(/"/g, '""'); return `"${s}"`; };
    const headers = 'Title,Stage,Pipeline,Contact,Value,Assigned To,Created,Closed';
    const csvRows = (rows.rows as Array<Record<string, unknown>>).map(r =>
      [esc(r.title), esc(r.stage), esc(r.pipeline_name), esc(r.contact_name),
       esc(r.deal_value ?? ''), esc(r.assigned_to),
       esc(r.created_at ? new Date(r.created_at as string).toISOString().slice(0, 10) : ''),
       esc(r.closed_at ? new Date(r.closed_at as string).toISOString().slice(0, 10) : ''),
      ].join(',')
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="deals.csv"');
    res.send([headers, ...csvRows].join('\n'));
  } catch (e: unknown) {
    logger.error('[deals] export error:', e);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /deals/:id — fetch single deal with contact + pipeline info
// ---------------------------------------------------------------------------
router.get('/:id', requirePerm('deals.view'), async (req, res) => {
  const { id } = req.params as { id: string };
  const tenantId = req.user!.tenantId;
  try {
    const result = await pool.query(`
      SELECT d.*,
        c.first_name, c.last_name, c.company_name,
        (SELECT channel_value FROM contact_channels
          WHERE tenant_id = $2 AND contact_id = d.contact_id AND channel_type IN ('email') LIMIT 1) AS email,
        (SELECT channel_value FROM contact_channels
          WHERE tenant_id = $2 AND contact_id = d.contact_id AND channel_type IN ('whatsapp','phone') LIMIT 1) AS phone,
        p.name AS pipeline_name, p.color AS pipeline_color
      FROM deals d
      LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
      LEFT JOIN pipelines p ON p.id = d.pipeline_id AND p.tenant_id = d.tenant_id
      WHERE d.id = $1 AND d.tenant_id = $2
    `, [id, tenantId]);
    if (!result.rows[0]) { res.status(404).json({ error: 'deal not found' }); return; }
    res.json(result.rows[0]);
  } catch (e) {
    logger.error('[deals] GET /:id error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /deals/:id/activities — fetch activity timeline for a deal
// ---------------------------------------------------------------------------
router.get('/:id/activities', requirePerm('deals.view'), async (req, res) => {
  const { id } = req.params as { id: string };
  const tenantId = req.user!.tenantId;
  try {
    const result = await pool.query(`
      SELECT * FROM deal_activities
      WHERE deal_id = $1 AND tenant_id = $2
      ORDER BY created_at ASC
    `, [id, tenantId]);
    res.json(result.rows);
  } catch (e) {
    logger.error('[deals] GET /:id/activities error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /deals/:id/activities — add a note or manual activity to a deal
// ---------------------------------------------------------------------------
router.post('/:id/activities', requirePerm('deals.edit'), async (req, res) => {
  const { id } = req.params as { id: string };
  const tenantId = req.user!.tenantId;
  const { note, activityType = 'note' } = req.body as { note?: string; activityType?: string };
  if (!note?.trim()) { res.status(400).json({ error: 'note is required' }); return; }
  try {
    const deal = await db.select({ contactId: deals.contactId })
      .from(deals).where(and(eq(deals.id, id), eq(deals.tenantId, tenantId))).limit(1);
    if (!deal[0]) { res.status(404).json({ error: 'deal not found' }); return; }
    await pool.query(
      `INSERT INTO deal_activities (tenant_id, deal_id, contact_id, activity_type, note, created_by)
       VALUES ($1, $2, $3, $4, $5, 'admin')`,
      [tenantId, id, deal[0].contactId, activityType, note.trim()],
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    logger.error('[deals] POST /:id/activities error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
