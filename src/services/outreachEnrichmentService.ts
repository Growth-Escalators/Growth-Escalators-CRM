import axios from 'axios';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackMessage } from './slackService';
import { SLACK_OUTREACH_CHANNEL } from '../config/constants';
import { findEmail } from './emailExtractorService';

interface EnrichmentResult {
  processed: number;
  active: number;
  notFound: number;
  errors: number;
}

// Ensure columns exist (called once on startup)
export async function ensureEnrichmentColumns(): Promise<void> {
  const stmts = [
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS email_source VARCHAR(50)`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS saleshandy_uploaded BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS saleshandy_uploaded_at TIMESTAMP`,
  ];
  for (const s of stmts) await pool.query(s).catch(() => {});
}

/**
 * Backend enrichment: finds emails via scraping, MX guessing, and Google.
 * Processes batches of 25. Never leaves leads stuck.
 */
export async function enrichStuckLeads(): Promise<EnrichmentResult> {
  // Dead letter: force-resolve anything stuck > 60 minutes
  await pool.query(`
    UPDATE outreach_leads SET status = 'Not_Found', notes = 'Dead letter: stuck >60min', updated_at = NOW()
    WHERE status = 'Enriching' AND updated_at < NOW() - INTERVAL '60 minutes'
  `).catch(() => {});

  // Find leads to enrich (New or stuck Enriching >15min, max retries < 3)
  const result = await pool.query(`
    SELECT id, company, first_name, website_url, email, COALESCE(retry_count, 0) AS retry_count
    FROM outreach_leads
    WHERE (status = 'New' AND COALESCE(retry_count, 0) < 3)
       OR (status = 'Enriching' AND updated_at < NOW() - INTERVAL '15 minutes' AND COALESCE(retry_count, 0) < 3)
    ORDER BY COALESCE(retry_count, 0) ASC, created_at ASC
    LIMIT 25
  `);

  if (result.rows.length === 0) return { processed: 0, active: 0, notFound: 0, errors: 0 };

  let active = 0, notFound = 0, errors = 0;
  const leads = result.rows as Array<{
    id: number; company: string; first_name: string | null;
    website_url: string | null; email: string | null; retry_count: number;
  }>;

  // Set all to Enriching
  const ids = leads.map(l => l.id);
  await pool.query(
    `UPDATE outreach_leads SET status = 'Enriching', updated_at = NOW(), retry_count = COALESCE(retry_count, 0) + 1 WHERE id = ANY($1)`,
    [ids],
  );

  for (const lead of leads) {
    try {
      if (lead.email && lead.email.includes('@')) {
        await markActive(lead.id, lead.email, lead.first_name, lead.company, 'existing');
        active++;
        continue;
      }

      if (!lead.website_url) {
        await markNotFound(lead.id, 'No website URL');
        notFound++;
        continue;
      }

      const emailResult = await findEmail(lead.website_url);

      if (emailResult) {
        await markActive(lead.id, emailResult.email, lead.first_name, lead.company, emailResult.source);
        active++;
      } else if (lead.retry_count >= 2) {
        // 3rd attempt (retry_count was incremented above) — give up
        await markNotFound(lead.id, 'No email found after 3 attempts');
        notFound++;
      } else {
        // Not found this time but still has retries left — put back to New
        await pool.query(
          `UPDATE outreach_leads SET status = 'New', updated_at = NOW() WHERE id = $1`,
          [lead.id],
        );
        notFound++; // Count as notFound for this batch but will retry
      }

      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      logger.error(`[enrichment] Lead ${lead.id} failed:`, e instanceof Error ? e.message : String(e));
      await pool.query(
        `UPDATE outreach_leads SET status = 'New', updated_at = NOW() WHERE id = $1`,
        [lead.id],
      ).catch(() => {});
      errors++;
    }
  }

  const summary = { processed: leads.length, active, notFound, errors };
  logger.info(`[enrichment] Batch: ${JSON.stringify(summary)}`);

  if (active > 0) {
    await sendSlackMessage(SLACK_OUTREACH_CHANNEL,
      `🔄 *Enrichment*: ${active} new Active leads found (${notFound} not found, ${errors} errors)`,
    ).catch(() => {});
  }

  return summary;
}

/**
 * Upload Active leads to Saleshandy sequence.
 */
export async function uploadToSaleshandy(): Promise<{ uploaded: number; errors: number }> {
  const apiKey = process.env.SALESHANDY_API_KEY;
  const sequenceId = process.env.SALESHANDY_SEQUENCE_ID;
  if (!apiKey || !sequenceId) return { uploaded: 0, errors: 0 };

  const result = await pool.query(`
    SELECT id, company, first_name, email, website_url, icebreaker, country
    FROM outreach_leads
    WHERE status = 'Active' AND email IS NOT NULL
      AND (saleshandy_uploaded IS NULL OR saleshandy_uploaded = FALSE)
    LIMIT 50
  `);

  if (result.rows.length === 0) return { uploaded: 0, errors: 0 };

  let uploaded = 0, uploadErrors = 0;
  const leads = result.rows as Array<{
    id: number; company: string; first_name: string | null;
    email: string; website_url: string | null; icebreaker: string | null; country: string | null;
  }>;

  // Batch upload 10 at a time
  for (let i = 0; i < leads.length; i += 10) {
    const batch = leads.slice(i, i + 10);
    try {
      const prospects = batch.map(l => ({
        emailAddress: l.email,
        firstName: l.first_name || l.company.split(' ')[0],
        lastName: l.company,
        customFields: { icebreaker: l.icebreaker || '', website: l.website_url || '', country: l.country || '' },
      }));

      const bodyStr = JSON.stringify({ prospects });
      const res = await axios({
        method: 'POST',
        url: `https://api.saleshandy.com/api/v1/sequence/${sequenceId}/prospects`,
        data: bodyStr,
        headers: {
          'X-Auth-Token': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': String(Buffer.byteLength(bodyStr)),
        },
        timeout: 15000,
        validateStatus: () => true,
        transformRequest: [(data: string) => data],
      });

      if (res.status >= 200 && res.status < 300) {
        uploaded += batch.length;
        await pool.query(
          `UPDATE outreach_leads SET saleshandy_uploaded = TRUE, saleshandy_uploaded_at = NOW() WHERE id = ANY($1)`,
          [batch.map(l => l.id)],
        );
      } else {
        uploadErrors += batch.length;
        const errBody = typeof res.data === 'string' ? res.data.slice(0, 100) : JSON.stringify(res.data).slice(0, 100);
        logger.warn(`[saleshandy] Upload failed: ${res.status} — ${errBody}`);
      }
    } catch (e) {
      uploadErrors += batch.length;
      logger.error('[saleshandy] Upload error:', e instanceof Error ? e.message : String(e));
    }
  }

  if (uploaded > 0) {
    const totalActive = await pool.query(`SELECT COUNT(*)::int AS c FROM outreach_leads WHERE status = 'Active'`);
    await sendSlackMessage(SLACK_OUTREACH_CHANNEL,
      `📤 *Outreach*: Uploaded ${uploaded} new prospects to Saleshandy. Total active: ${(totalActive.rows[0] as { c: number }).c} leads.`,
    ).catch(() => {});
  }

  return { uploaded, errors: uploadErrors };
}

async function markActive(leadId: number, email: string, firstName: string | null, company: string, emailSource: string): Promise<void> {
  const name = firstName || 'there';
  const icebreaker = `Hi ${name}, came across ${company} — impressive work in performance marketing. We help agencies like yours deliver Meta Ads for D2C clients at 60-70% lower cost. Worth a quick chat?`;

  await pool.query(`
    UPDATE outreach_leads
    SET status = 'Active', email = $1, first_name = COALESCE($2, first_name),
        icebreaker = $3, email_source = $4, enriched_at = NOW(), updated_at = NOW()
    WHERE id = $5
  `, [email, firstName, icebreaker, emailSource, leadId]);
}

async function markNotFound(leadId: number, reason: string): Promise<void> {
  await pool.query(
    `UPDATE outreach_leads SET status = 'Not_Found', notes = $1, updated_at = NOW() WHERE id = $2`,
    [reason, leadId],
  );
}
