import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackMessage } from './slackService';
import { SLACK_OUTREACH_CHANNEL } from '../config/constants';
import { extractEmailFromWebsite } from './emailExtractorService';

interface EnrichmentResult {
  processed: number;
  active: number;
  notFound: number;
  errors: number;
}

/**
 * Backend enrichment: scrapes emails from agency websites.
 * Falls back to Hunter.io if available. Processes batches of 20.
 */
export async function enrichStuckLeads(): Promise<EnrichmentResult> {
  const hunterKey = process.env.HUNTER_API_KEY;

  // Find leads that need enrichment
  const result = await pool.query(`
    SELECT id, company, first_name, website_url, email
    FROM outreach_leads
    WHERE status IN ('New', 'Enriching')
       OR (status = 'Not_Found' AND notes LIKE '%not configured%')
    ORDER BY
      CASE WHEN status = 'New' THEN 0
           WHEN status = 'Enriching' THEN 1
           ELSE 2 END,
      created_at ASC
    LIMIT 20
  `);

  if (result.rows.length === 0) return { processed: 0, active: 0, notFound: 0, errors: 0 };

  let active = 0, notFound = 0, errors = 0;
  const leads = result.rows as Array<{
    id: number; company: string; first_name: string | null;
    website_url: string | null; email: string | null;
  }>;

  // Set all to Enriching
  const ids = leads.map(l => l.id);
  await pool.query(
    `UPDATE outreach_leads SET status = 'Enriching', updated_at = NOW() WHERE id = ANY($1)`,
    [ids],
  );

  for (const lead of leads) {
    try {
      // Skip if already has email
      if (lead.email && lead.email.includes('@')) {
        await markActive(lead.id, lead.email, lead.first_name, lead.company);
        active++;
        continue;
      }

      if (!lead.website_url) {
        await markNotFound(lead.id, 'No website URL');
        notFound++;
        continue;
      }

      let email: string | null = null;
      let firstName = lead.first_name;

      // Strategy 1: Scrape website directly (free, no API key)
      try {
        const extracted = await extractEmailFromWebsite(lead.website_url);
        if (extracted) {
          email = extracted.email;
          logger.info(`[enrichment] Scraped email for ${lead.company}: ${email} (from ${extracted.source})`);
        }
      } catch (e) {
        logger.warn(`[enrichment] Scrape failed for ${lead.company}: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Strategy 2: Hunter.io fallback (if key available and scrape found nothing)
      if (!email && hunterKey) {
        try {
          const domain = extractDomain(lead.website_url);
          if (domain) {
            const hunterUrl = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${hunterKey}&limit=5`;
            const res = await fetch(hunterUrl, { signal: AbortSignal.timeout(10000) });
            if (res.ok) {
              const data = await res.json() as { data?: { emails?: Array<{ value: string; first_name?: string }> } };
              const emails = data.data?.emails ?? [];
              if (emails.length > 0) {
                email = emails[0].value;
                if (!firstName && emails[0].first_name) firstName = emails[0].first_name;
              }
            }
          }
        } catch (e) {
          logger.warn(`[enrichment] Hunter failed for ${lead.company}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (email) {
        await markActive(lead.id, email, firstName, lead.company);
        active++;
      } else {
        await markNotFound(lead.id, 'No email found on website or via Hunter');
        notFound++;
      }

      // 1.5s between leads to be polite to target websites
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      logger.error(`[enrichment] Lead ${lead.id} failed:`, e instanceof Error ? e.message : String(e));
      await pool.query(
        `UPDATE outreach_leads SET status = 'Not_Found', notes = $1, updated_at = NOW() WHERE id = $2`,
        [`Error: ${e instanceof Error ? e.message : String(e)}`, lead.id],
      ).catch(() => {});
      errors++;
    }
  }

  const summary = { processed: leads.length, active, notFound, errors };
  logger.info(`[enrichment] Batch complete: ${JSON.stringify(summary)}`);

  if (leads.length > 0) {
    await sendSlackMessage(SLACK_OUTREACH_CHANNEL,
      `🔄 *Enrichment batch complete*\n` +
      `Processed: ${leads.length} · ✅ Active: ${active} · ❌ Not Found: ${notFound} · ⚠️ Errors: ${errors}`,
    ).catch(() => {});
  }

  return summary;
}

async function markActive(leadId: number, email: string, firstName: string | null, company: string): Promise<void> {
  const name = firstName || 'there';
  const icebreaker = `Hi ${name}, came across ${company} — impressive work in performance marketing. We help agencies like yours deliver Meta Ads for D2C clients at 60-70% lower cost. Worth a quick chat?`;

  await pool.query(`
    UPDATE outreach_leads
    SET status = 'Active',
        email = $1,
        first_name = COALESCE($2, first_name),
        icebreaker = $3,
        enriched_at = NOW(),
        updated_at = NOW()
    WHERE id = $4
  `, [email, firstName, icebreaker, leadId]);
}

async function markNotFound(leadId: number, reason: string): Promise<void> {
  await pool.query(`
    UPDATE outreach_leads
    SET status = 'Not_Found', notes = $1, updated_at = NOW()
    WHERE id = $2
  `, [reason, leadId]);

  await pool.query(`
    INSERT INTO outreach_errors (lead_id, workflow, error_type, error_message)
    VALUES ($1, 'backend-enrichment', 'Permanent', $2)
  `, [leadId, reason]).catch(() => {});
}

function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    let u = url.trim();
    if (!u.startsWith('http')) u = 'https://' + u;
    const parsed = new URL(u);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    const match = url.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
    return match ? match[1] : null;
  }
}
