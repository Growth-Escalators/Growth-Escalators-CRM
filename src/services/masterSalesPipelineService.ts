import { and, eq } from 'drizzle-orm';
import { db, pool, deals, pipelines } from '../db/index';
import logger from '../utils/logger';

export const MASTER_SALES_PIPELINE_SLUG = 'master-sales';
export const MASTER_SALES_PIPELINE_NAME = 'Master Sales Pipeline';
export const MASTER_SALES_ENTRY_STAGE = 'new-lead';

export const MASTER_SALES_STAGES = [
  { id: 'new-lead', name: 'New Lead', color: '#94A3B8', outcome: 'open' },
  { id: 'contacted', name: 'Contacted', color: '#3B82F6', outcome: 'open' },
  { id: 'follow-up', name: 'Follow-Up', color: '#6366F1', outcome: 'open' },
  { id: 'interested', name: 'Interested / Qualified', color: '#14B8A6', outcome: 'open' },
  { id: 'meeting-booked', name: 'Meeting Booked', color: '#8B5CF6', outcome: 'open' },
  { id: 'proposal-sent', name: 'Proposal Sent', color: '#F97316', outcome: 'open' },
  { id: 'negotiation', name: 'Negotiation / Decision', color: '#F59E0B', outcome: 'open' },
  { id: 'closed-won', name: 'Closed Won', color: '#22C55E', outcome: 'won' },
  { id: 'closed-lost', name: 'Closed Lost', color: '#DC2626', outcome: 'lost' },
] as const;

export type MasterSalesStageId = typeof MASTER_SALES_STAGES[number]['id'];

const MASTER_STAGE_CONFIG: Record<MasterSalesStageId, { probability: number }> = {
  'new-lead': { probability: 10 },
  contacted: { probability: 20 },
  'follow-up': { probability: 30 },
  interested: { probability: 45 },
  'meeting-booked': { probability: 60 },
  'proposal-sent': { probability: 75 },
  negotiation: { probability: 85 },
  'closed-won': { probability: 100 },
  'closed-lost': { probability: 0 },
};

const backfillStartedForTenant = new Set<string>();

async function findMasterSalesPipeline(tenantId: string) {
  const [row] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.slug, MASTER_SALES_PIPELINE_SLUG)))
    .limit(1);
  return row ?? null;
}

/**
 * Ensure the tenant has one canonical sales board. Existing boards are left
 * untouched: this creates the master board only when it does not already exist.
 */
export async function ensureMasterSalesPipeline(tenantId: string) {
  const existing = await findMasterSalesPipeline(tenantId);
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(pipelines)
      .values({
        tenantId,
        name: MASTER_SALES_PIPELINE_NAME,
        slug: MASTER_SALES_PIPELINE_SLUG,
        stages: MASTER_SALES_STAGES.map((stage) => ({ ...stage })),
        color: '#F97316',
        isActive: true,
        // Keep the master sales board first in the existing pipeline picker.
        sortOrder: -100,
      })
      .returning();

    // stage_config is a runtime JSONB column in this CRM rather than part of the
    // Drizzle schema. Failure here is non-fatal; drag/drop and stage outcomes do
    // not depend on probabilities being present.
    if (created?.id) {
      await pool.query(
        `UPDATE pipelines
            SET stage_config = $1::jsonb
          WHERE tenant_id = $2 AND id = $3`,
        [JSON.stringify(MASTER_STAGE_CONFIG), tenantId, created.id],
      ).catch((error) => logger.warn({ error }, '[master-sales] stage config defaults not applied'));
    }
    return created;
  } catch (error) {
    // Concurrent requests may both attempt first-time creation. Re-read after a
    // unique-key race instead of turning a perfectly valid lead into an error.
    const raced = await findMasterSalesPipeline(tenantId);
    if (raced) return raced;
    throw error;
  }
}

export interface MasterSalesLeadInput {
  tenantId: string;
  contactId: string;
  title: string;
  assignedTo?: string | null;
  service?: string | null;
  businessVertical?: string | null;
  source?: string | null;
}

/**
 * Idempotently put a CRM contact on the master sales board. One contact has at
 * most one active opportunity on this specific board; repeat website forms keep
 * enriching the same contact/deal instead of creating duplicate cards.
 */
export async function ensureContactInMasterSalesPipeline(input: MasterSalesLeadInput) {
  const pipeline = await ensureMasterSalesPipeline(input.tenantId);
  if (!pipeline?.id) throw new Error('master sales pipeline could not be created');

  const [existing] = await db
    .select()
    .from(deals)
    .where(and(
      eq(deals.tenantId, input.tenantId),
      eq(deals.contactId, input.contactId),
      eq(deals.pipelineId, pipeline.id),
    ))
    .limit(1);

  if (existing) {
    // Keep stage/value/history intact; only fill in operational context that may
    // have arrived on a later form submission.
    const nextMetadata = {
      ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
      latestInboundAt: new Date().toISOString(),
      latestInboundSource: input.source || 'website',
      latestService: input.service || input.businessVertical || null,
    };
    const [updated] = await db.update(deals).set({
      assignedTo: existing.assignedTo || input.assignedTo || undefined,
      serviceType: existing.serviceType || input.service || input.businessVertical || undefined,
      metadata: nextMetadata,
      updatedAt: new Date(),
    }).where(and(eq(deals.id, existing.id), eq(deals.tenantId, input.tenantId))).returning();
    return { pipeline, deal: updated ?? existing, created: false };
  }

  const [created] = await db.insert(deals).values({
    tenantId: input.tenantId,
    contactId: input.contactId,
    pipelineId: pipeline.id,
    stage: MASTER_SALES_ENTRY_STAGE,
    title: input.title || 'Inbound opportunity',
    assignedTo: input.assignedTo || undefined,
    serviceType: input.service || input.businessVertical || undefined,
    metadata: {
      autoCreatedFrom: input.source || 'website',
      latestInboundAt: new Date().toISOString(),
      latestService: input.service || input.businessVertical || null,
    },
  }).returning();

  if (created?.id) {
    // `source` is a runtime column in this CRM. Keep this best-effort so a
    // missing legacy column can never make lead capture fail.
    await pool.query(
      `UPDATE deals SET source = $1 WHERE tenant_id = $2 AND id = $3`,
      [input.source || 'website', input.tenantId, created.id],
    ).catch(() => {});
  }

  return { pipeline, deal: created, created: true };
}

/**
 * Move the contact's canonical sales opportunity to a stage from a trusted
 * internal event (for example a confirmed Cal.com booking). Manual movement
 * still happens through the normal deal PATCH route/drag-and-drop UI.
 */
export async function moveMasterSalesContactToStage(input: {
  tenantId: string;
  contactId: string;
  stage: MasterSalesStageId;
  createdBy?: string;
}) {
  const pipeline = await ensureMasterSalesPipeline(input.tenantId);
  if (!pipeline?.id) return null;

  const [current] = await db.select().from(deals).where(and(
    eq(deals.tenantId, input.tenantId),
    eq(deals.contactId, input.contactId),
    eq(deals.pipelineId, pipeline.id),
  )).limit(1);
  if (!current || current.stage === input.stage) return current ?? null;

  const [updated] = await db.update(deals).set({
    stage: input.stage,
    updatedAt: new Date(),
  }).where(and(eq(deals.id, current.id), eq(deals.tenantId, input.tenantId))).returning();

  const probability = MASTER_STAGE_CONFIG[input.stage]?.probability;
  if (probability !== undefined) {
    await pool.query(
      `UPDATE deals SET probability = $1 WHERE tenant_id = $2 AND id = $3`,
      [probability, input.tenantId, current.id],
    ).catch(() => {});
  }

  await pool.query(
    `INSERT INTO deal_activities
       (tenant_id, deal_id, contact_id, activity_type, from_stage, to_stage, created_by)
     VALUES ($1, $2, $3, 'stage_change', $4, $5, $6)`,
    [input.tenantId, current.id, input.contactId, current.stage, input.stage, input.createdBy || 'automation'],
  ).catch((error) => logger.warn({ error }, '[master-sales] stage activity log failed'));

  return updated ?? current;
}

/**
 * Catch up historical website/agency contacts that pre-date automatic deal
 * creation. Idempotent and deliberately bounded; the next process restart or
 * lead intake can continue any unusually large backlog.
 */
export async function backfillInboundContactsToMasterSalesPipeline(tenantId: string, limit = 500) {
  const pipeline = await ensureMasterSalesPipeline(tenantId);
  if (!pipeline?.id) return 0;

  const boundedLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const result = await pool.query(
    `INSERT INTO deals (
       tenant_id, contact_id, pipeline_id, title, stage, service_type,
       assigned_to, metadata, created_at, updated_at
     )
     SELECT
       c.tenant_id,
       c.id,
       $2::uuid,
       CASE
         WHEN NULLIF(c.company_name, '') IS NOT NULL THEN c.company_name || ' — opportunity'
         ELSE TRIM(c.first_name || ' ' || COALESCE(c.last_name, '')) || ' — opportunity'
       END,
       $3,
       COALESCE(
         NULLIF(c.metadata->'latestWebsiteLead'->>'service', ''),
         NULLIF(c.metadata->'latestWebsiteLead'->>'businessVertical', ''),
         NULL
       ),
       c.assigned_to,
       jsonb_build_object(
         'autoCreatedFrom', CASE WHEN c.source = 'agency_landing' THEN 'agency_landing' ELSE 'website' END,
         'historicalBackfill', true,
         'latestInboundAt', COALESCE(c.metadata->'latestWebsiteLead'->>'capturedAt', c.updated_at::text)
       ),
       NOW(),
       NOW()
     FROM contacts c
     WHERE c.tenant_id = $1
       AND (
         c.source IN ('website', 'agency_landing')
         OR 'website_lead' = ANY(COALESCE(c.tags, ARRAY[]::text[]))
         OR 'agency_lead' = ANY(COALESCE(c.tags, ARRAY[]::text[]))
       )
       AND NOT EXISTS (
         SELECT 1
         FROM deals d
         WHERE d.tenant_id = $1
           AND d.contact_id = c.id
           AND d.pipeline_id = $2::uuid
       )
     ORDER BY c.created_at ASC
     LIMIT $4
     RETURNING id`,
    [tenantId, pipeline.id, MASTER_SALES_ENTRY_STAGE, boundedLimit],
  );

  const createdIds = result.rows.map((row) => String(row.id));
  if (createdIds.length > 0) {
    await pool.query(
      `UPDATE deals d
          SET source = CASE WHEN c.source = 'agency_landing' THEN 'agency_landing' ELSE 'website' END
         FROM contacts c
        WHERE d.tenant_id = $1
          AND c.tenant_id = $1
          AND c.id = d.contact_id
          AND d.id = ANY($2::uuid[])`,
      [tenantId, createdIds],
    ).catch(() => {});
  }
  return createdIds.length;
}

/** Run the historical catch-up at most once per tenant per server process. */
export function scheduleMasterSalesBackfill(tenantId: string) {
  if (backfillStartedForTenant.has(tenantId)) return;
  backfillStartedForTenant.add(tenantId);
  void backfillInboundContactsToMasterSalesPipeline(tenantId).catch((error) => {
    logger.error({ error }, '[master-sales] historical inbound backfill failed');
  });
}
