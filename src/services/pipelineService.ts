import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackDM } from './slackService';
import { SLACK_SAKCHAM } from '../config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PipelinePlacementResult {
  success: boolean;
  pipeline: string;
  stage: string;
  tags: string[];
  contactId: string;
}

// ---------------------------------------------------------------------------
// Bootstrap — create Agency Owners + Freelancer pipelines if they don't exist
// Called at server startup so no manual Railway CLI run is needed.
// Safe to call multiple times — skips existing pipelines.
// ---------------------------------------------------------------------------
const AGENCY_STAGES = [
  'Paid ₹9', 'Paid ₹208', 'Paid ₹508', 'Paid ₹707',
  'Appointment Booked', 'No Show', 'WL Proposal Sent', 'WL Active Partner',
];

const FREELANCER_STAGES = [
  'Paid ₹9', 'Paid ₹208', 'Paid ₹508', 'Paid ₹707',
  'Appointment Booked', 'No Show', 'Workshop Waitlist', 'Workshop Paid',
];

const D2C_STAGES = [
  'Paid ₹9', 'Paid ₹208', 'Paid ₹508', 'Paid ₹707',
  'Appointment Booked', 'No Show', 'Converted', 'Lost',
];

export async function ensureOutreachPipelines(): Promise<void> {
  const tenantResult = await pool.query(
    `SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`,
  );
  if (tenantResult.rows.length === 0) {
    logger.warn('[pipeline] Tenant growth-escalators not found — skipping pipeline bootstrap');
    return;
  }
  const tenantId = tenantResult.rows[0].id as string;

  for (const [name, slug, stages, color, order] of [
    ['D2C Prospects', 'd2c-prospects', D2C_STAGES,       '#059669', 0] as const,
    ['Agency Owners', 'agency-owners', AGENCY_STAGES,    '#1B2E5E', 1] as const,
    ['Freelancer',    'freelancer',    FREELANCER_STAGES, '#7C3AED', 2] as const,
  ]) {
    const exists = await pool.query(
      `SELECT id FROM pipelines WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
      [tenantId, name],
    );
    if (exists.rows.length > 0) {
      logger.info(`[pipeline] "${name}" pipeline already exists — skipping`);
      continue;
    }
    await pool.query(
      `INSERT INTO pipelines (id, tenant_id, name, slug, stages, color, is_active, sort_order)
       VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, true, $6)`,
      [tenantId, name, slug, JSON.stringify(stages), color, order],
    );
    logger.info(`[pipeline] Created "${name}" pipeline with ${stages.length} stages`);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap — creates pipeline_contacts tracking table
// ---------------------------------------------------------------------------
export async function ensurePipelineContactsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_contacts (
      id           SERIAL PRIMARY KEY,
      contact_id   UUID NOT NULL,
      pipeline_id  UUID NOT NULL,
      pipeline_name VARCHAR(200) NOT NULL,
      stage_name   VARCHAR(200) NOT NULL,
      tenant_id    UUID NOT NULL,
      placed_at    TIMESTAMP DEFAULT NOW(),
      updated_at   TIMESTAMP DEFAULT NOW(),
      UNIQUE(contact_id, pipeline_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS pipeline_contacts_contact_id_idx ON pipeline_contacts(contact_id);
    CREATE INDEX IF NOT EXISTS pipeline_contacts_pipeline_id_idx ON pipeline_contacts(pipeline_id);
    CREATE INDEX IF NOT EXISTS pipeline_contacts_stage_name_idx ON pipeline_contacts(stage_name);
  `);
  logger.info('[pipeline] pipeline_contacts table ready');
}

// ---------------------------------------------------------------------------
// Segment → pipeline name
// ---------------------------------------------------------------------------
const PIPELINE_MAP: Record<string, string> = {
  d2c:        'D2C Prospects',
  agency:     'Agency Owners',
  freelancer: 'Freelancer',
  // Legacy segment IDs from old checkout
  ecom_brand:   'D2C Prospects',
  agency_owner: 'Agency Owners',
};

// ---------------------------------------------------------------------------
// Amount → stage name
// ---------------------------------------------------------------------------
function stageForAmount(amount: number): string {
  if (amount >= 700) return 'Paid ₹707';
  if (amount >= 500) return 'Paid ₹508';
  if (amount >= 200) return 'Paid ₹208';
  return 'Paid ₹9';
}

// ---------------------------------------------------------------------------
// placePipelineContact
// Places a contact into the correct pipeline and stage based on segment + amount.
// Called by the background pipeline placement job in worker.ts (not cashfree.ts).
// ---------------------------------------------------------------------------
export async function placePipelineContact(params: {
  contactId: string;   // UUID — matches contacts.id
  segment: string;
  amount: number;
  bump1: boolean;
  bump2: boolean;
  tenantId?: string;
  funnelSlug?: string;
}): Promise<PipelinePlacementResult> {
  const { contactId, segment, amount, bump1, bump2, funnelSlug } = params;

  // Config-driven pipeline lookup — if funnelSlug provided, check funnel_configs first
  let pipelineName: string;
  let stageName: string;

  if (funnelSlug) {
    try {
      const configR = await pool.query(
        `SELECT pipeline_name, base_price, bump1_price, bump2_price FROM funnel_configs WHERE slug = $1 AND is_active = TRUE LIMIT 1`,
        [funnelSlug],
      );
      if (configR.rows.length > 0) {
        const cfg = configR.rows[0] as { pipeline_name: string; base_price: number; bump1_price: number | null; bump2_price: number | null };
        pipelineName = cfg.pipeline_name;
        // Calculate stage from config prices
        const base = cfg.base_price;
        const b1 = cfg.bump1_price ?? 0;
        const b2 = cfg.bump2_price ?? 0;
        const allCombo = base + b1 + b2;
        const baseB2 = base + b2;
        const baseB1 = base + b1;
        if (b1 > 0 && b2 > 0 && Math.abs(amount - allCombo) <= 5) stageName = `Paid ₹${allCombo}`;
        else if (b2 > 0 && Math.abs(amount - baseB2) <= 5) stageName = `Paid ₹${baseB2}`;
        else if (b1 > 0 && Math.abs(amount - baseB1) <= 5) stageName = `Paid ₹${baseB1}`;
        else stageName = `Paid ₹${base}`;
      } else {
        pipelineName = PIPELINE_MAP[segment] ?? 'D2C Prospects';
        stageName = stageForAmount(amount);
      }
    } catch {
      pipelineName = PIPELINE_MAP[segment] ?? 'D2C Prospects';
      stageName = stageForAmount(amount);
    }
  } else {
    pipelineName = PIPELINE_MAP[segment] ?? 'D2C Prospects';
    stageName = stageForAmount(amount);
  }

  // Build tags
  const tags: string[] = ['slo_buyer', `seg:${segment}`];
  if (bump1) tags.push('bump1');
  if (bump2) tags.push('bump2', 'hot_lead');
  if (segment === 'agency' || segment === 'agency_owner') tags.push('wl_prospect');
  if (segment === 'freelancer') tags.push('waitlist');

  // ---------------------------------------------------------------------------
  // 1. Look up the pipeline (need tenant from contact if not provided)
  // ---------------------------------------------------------------------------
  let tenantId = params.tenantId;
  if (!tenantId) {
    const contactRow = await pool.query(
      `SELECT tenant_id FROM contacts WHERE id = $1 LIMIT 1`,
      [contactId],
    );
    if (contactRow.rows.length === 0) {
      logger.warn({ contactId }, '[pipeline] contact not found — skipping placement');
      return { success: false, pipeline: pipelineName, stage: stageName, tags, contactId };
    }
    tenantId = contactRow.rows[0].tenant_id as string;
  }

  const pipelineRow = await pool.query(
    `SELECT id, name FROM pipelines WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
    [tenantId, pipelineName],
  );
  if (pipelineRow.rows.length === 0) {
    logger.warn({ pipelineName, tenantId }, '[pipeline] pipeline not found — run migration first');
    return { success: false, pipeline: pipelineName, stage: stageName, tags, contactId };
  }
  const pipelineId = pipelineRow.rows[0].id as string;

  // ---------------------------------------------------------------------------
  // 2. Upsert into pipeline_contacts
  // ---------------------------------------------------------------------------
  await pool.query(
    `INSERT INTO pipeline_contacts (contact_id, pipeline_id, pipeline_name, stage_name, tenant_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (contact_id, pipeline_id)
     DO UPDATE SET stage_name = EXCLUDED.stage_name, updated_at = NOW()`,
    [contactId, pipelineId, pipelineName, stageName, tenantId],
  );

  // ---------------------------------------------------------------------------
  // 3. Update existing deal to link to this pipeline (most recent dealless deal)
  // ---------------------------------------------------------------------------
  await pool.query(
    `UPDATE deals SET pipeline_id = $1, stage = $2, updated_at = NOW()
     WHERE id = (
       SELECT id FROM deals
       WHERE contact_id = $3 AND pipeline_id IS NULL
       ORDER BY created_at DESC LIMIT 1
     )`,
    [pipelineId, stageName, contactId],
  );

  // ---------------------------------------------------------------------------
  // 4. Merge tags onto contact (append new, deduplicate)
  // ---------------------------------------------------------------------------
  await pool.query(
    `UPDATE contacts
     SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::text[]) || $1::text[])),
         updated_at = NOW()
     WHERE id = $2`,
    [tags, contactId],
  );

  // ---------------------------------------------------------------------------
  // 5. Agency segment: fire hot lead DM to Sakcham
  // ---------------------------------------------------------------------------
  if (segment === 'agency' || segment === 'agency_owner') {
    const contactInfo = await pool.query(
      `SELECT first_name, last_name,
              (SELECT channel_value FROM contact_channels
               WHERE contact_id = $1 AND channel_type = 'whatsapp' LIMIT 1) AS phone
       FROM contacts WHERE id = $1 LIMIT 1`,
      [contactId],
    );
    if (contactInfo.rows.length > 0) {
      const row = contactInfo.rows[0] as { first_name: string; last_name: string | null; phone: string | null };
      const name = `${row.first_name}${row.last_name ? ' ' + row.last_name : ''}`;
      const phone = row.phone ?? 'unknown';
      const msg =
        `🏢 *Agency buyer:* ${name} | ${phone} | Bought: ₹${amount}` +
        (bump2 ? ' | Includes audit call ⚡' : '') +
        `\n*Stage:* ${stageName}\nFollow up within 24 hours.`;
      sendSlackDM(SLACK_SAKCHAM, msg).catch(e =>
        logger.error({ e }, '[pipeline] Sakcham DM failed'),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // NOTE: WhatsApp template personalisation
  // The ge_welcome_d2c template is fired in cashfree.ts (which cannot be modified)
  // without passing components/variables — it fires as a static template.
  // To personalise variables by segment, cashfree.ts must be updated to pass
  // template components with segment-specific copy. Flagged for manual update.
  // ---------------------------------------------------------------------------

  logger.info({ contactId, pipelineName, stageName, tags }, '[pipeline] contact placed');
  return { success: true, pipeline: pipelineName, stage: stageName, tags, contactId };
}
