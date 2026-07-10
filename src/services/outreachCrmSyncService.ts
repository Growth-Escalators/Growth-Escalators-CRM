import { pool } from '../db/index';
import { db, contacts, contactChannels, deals } from '../db/index';
import logger from '../utils/logger';
import { sendSlackMessage, sendSlackDM } from './slackService';
import { SLACK_SALES_BD_CHANNEL, SLACK_JATIN } from '../config/constants';

const WL_PIPELINE_NAME = 'White-Label Partner Pipeline';
const WL_STAGES = ['Outreach Active', 'Replied — Interested', 'Discovery Call Booked', 'Proposal Sent', 'Partner Signed'];
const DEAL_VALUE_USD = 900;

// ---------------------------------------------------------------------------
// Ensure pipeline + columns exist
// ---------------------------------------------------------------------------
export async function ensureOutreachCrmSetup(): Promise<void> {
  // Add CRM sync columns to outreach_leads
  const stmts = [
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS crm_contact_id UUID`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS crm_deal_id UUID`,
  ];
  for (const s of stmts) await pool.query(s).catch(() => {});

  // Create White-Label Partner Pipeline if it doesn't exist
  const tenantResult = await pool.query(`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
  if (tenantResult.rows.length === 0) return;
  const tenantId = (tenantResult.rows[0] as { id: string }).id;

  const existing = await pool.query(
    `SELECT id FROM pipelines WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
    [tenantId, WL_PIPELINE_NAME],
  );
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO pipelines (id, tenant_id, name, slug, stages, color, is_active, sort_order)
       VALUES (gen_random_uuid(), $1, $2, 'white-label-partner', $3::jsonb, '#1B2E5E', true, 3)`,
      [tenantId, WL_PIPELINE_NAME, JSON.stringify(WL_STAGES)],
    );
    logger.info(`[crm-sync] Created "${WL_PIPELINE_NAME}" pipeline`);
  }
}

// ---------------------------------------------------------------------------
// Sync Active outreach leads → CRM contacts + deals
// ---------------------------------------------------------------------------
export async function syncOutreachToCrm(): Promise<{ synced: number; errors: number }> {
  const tenantResult = await pool.query(`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
  if (tenantResult.rows.length === 0) return { synced: 0, errors: 0 };
  const tenantId = (tenantResult.rows[0] as { id: string }).id;

  // Get pipeline ID
  const pipelineResult = await pool.query(
    `SELECT id FROM pipelines WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
    [tenantId, WL_PIPELINE_NAME],
  );
  if (pipelineResult.rows.length === 0) {
    await ensureOutreachCrmSetup();
    return { synced: 0, errors: 0 };
  }
  const pipelineId = (pipelineResult.rows[0] as { id: string }).id;

  // Find leads to sync (Active, with email, not yet synced)
  const leadsResult = await pool.query(`
    SELECT id, company, first_name, email, website_url, country, icebreaker, phone
    FROM outreach_leads
    WHERE status = 'Active' AND email IS NOT NULL
      AND crm_contact_id IS NULL
    ORDER BY enriched_at DESC
    LIMIT 50
  `);

  if (leadsResult.rows.length === 0) return { synced: 0, errors: 0 };

  let synced = 0, errors = 0;
  const leads = leadsResult.rows as Array<{
    id: number; company: string; first_name: string | null; email: string;
    website_url: string | null; country: string | null; icebreaker: string | null; phone: string | null;
  }>;

  for (const lead of leads) {
    try {
      // Create CRM contact
      const [contact] = await db.insert(contacts).values({
        tenantId,
        firstName: lead.first_name || lead.company.split(' ')[0],
        lastName: lead.company,
        companyName: lead.company,
        source: 'whitelabel_outreach',
        status: 'lead',
        tags: ['outreach_lead', (lead.country ?? 'unknown').toLowerCase(), 'whitelabel'],
      }).returning();

      // Add email channel
      await db.insert(contactChannels).values({
        tenantId,
        contactId: contact.id,
        channelType: 'email',
        channelValue: lead.email,
        isPrimary: true,
      }).catch(() => {});

      // Add phone if available
      if (lead.phone) {
        await db.insert(contactChannels).values({
          tenantId,
          contactId: contact.id,
          channelType: 'phone',
          channelValue: lead.phone,
          isPrimary: false,
        }).catch(() => {});
      }

      // Create deal in White-Label Partner Pipeline
      const [deal] = await db.insert(deals).values({
        tenantId,
        contactId: contact.id,
        pipelineId,
        title: `${lead.company} — White-Label`,
        stage: 'Outreach Active',
        dealValue: DEAL_VALUE_USD * 100, // paise/cents
        notes: `Auto-created from outreach. Email: ${lead.email}. Country: ${lead.country ?? 'Unknown'}.`,
      }).returning();

      // Link back to outreach lead
      await pool.query(
        `UPDATE outreach_leads SET crm_contact_id = $1, crm_deal_id = $2, updated_at = NOW() WHERE id = $3`,
        [contact.id, deal.id, lead.id],
      );

      synced++;
    } catch (e) {
      logger.error(`[crm-sync] Failed to sync lead ${lead.id}:`, e instanceof Error ? e.message : String(e));
      errors++;
    }
  }

  if (synced > 0) {
    await sendSlackMessage(SLACK_SALES_BD_CHANNEL,
      `📋 *CRM Sync*: Added ${synced} new white-label prospects to contacts and pipeline.`,
      undefined,
      { allowDuringPause: true }, // new client prospects — fires even while routine Slack is paused
    ).catch(() => {});
  }

  logger.info(`[crm-sync] Synced ${synced} leads to CRM (${errors} errors)`);
  return { synced, errors };
}

// ---------------------------------------------------------------------------
// Promote INTERESTED replies to hot deals
// ---------------------------------------------------------------------------
export async function promoteInterestedLead(leadId: number): Promise<void> {
  const tenantResult = await pool.query(`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
  if (tenantResult.rows.length === 0) return;
  const tenantId = (tenantResult.rows[0] as { id: string }).id;

  const leadResult = await pool.query(
    `SELECT id, company, first_name, email, country, notes, crm_contact_id, crm_deal_id
     FROM outreach_leads WHERE id = $1`,
    [leadId],
  );
  if (leadResult.rows.length === 0) return;
  const lead = leadResult.rows[0] as {
    id: number; company: string; first_name: string | null; email: string;
    country: string | null; notes: string | null; crm_contact_id: string | null; crm_deal_id: string | null;
  };

  // If no CRM contact yet, sync first
  if (!lead.crm_contact_id) {
    await syncOutreachToCrm();
    // Re-read
    const updated = await pool.query(`SELECT crm_contact_id, crm_deal_id FROM outreach_leads WHERE id = $1`, [leadId]);
    if (updated.rows.length > 0) {
      lead.crm_contact_id = (updated.rows[0] as { crm_contact_id: string | null }).crm_contact_id;
      lead.crm_deal_id = (updated.rows[0] as { crm_deal_id: string | null }).crm_deal_id;
    }
  }

  // Update deal stage to "Replied — Interested"
  if (lead.crm_deal_id) {
    await pool.query(
      `UPDATE deals SET stage = 'Replied — Interested', updated_at = NOW() WHERE id = $1`,
      [lead.crm_deal_id],
    );
  }

  // Add contact note
  if (lead.crm_contact_id) {
    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    await pool.query(
      `INSERT INTO contact_notes (id, tenant_id, contact_id, content, created_by, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'system', NOW())`,
      [tenantId, lead.crm_contact_id, `INTERESTED reply received on ${date}. ${lead.notes ? 'Message: ' + lead.notes : ''}`],
    ).catch(() => {});
  }

  // Alert Jatin
  await sendSlackDM(SLACK_JATIN,
    `🔥 *HOT LEAD: ${lead.company}* from ${lead.country ?? 'Unknown'} replied INTERESTED to white-label outreach.\n` +
    `Email: ${lead.email}\n` +
    `CRM: https://crm.growthescalators.com/contacts\n` +
    `Reply within 2 hours for best conversion.`,
  ).catch(() => {});
}
