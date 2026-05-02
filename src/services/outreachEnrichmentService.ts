import axios from 'axios';
import https from 'https';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackMessage } from './slackService';
import { SLACK_OUTREACH_CHANNEL } from '../config/constants';
import { findEmail } from './emailExtractorService';
import { getWebsiteSnippet } from './websiteCacheService';

// ---------------------------------------------------------------------------
// Claude Haiku icebreaker generation
// Uses the website content to write a personalised, human-sounding opener
// ---------------------------------------------------------------------------

async function generateIcebreaker(company: string, websiteUrl: string | null, country: string | null): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return buildFallbackIcebreaker(company);

  const { snippet: websiteContent, vertical } = await getWebsiteSnippet(websiteUrl);

  const systemPrompt = `You write the first sentence of a cold email from Jatin at Growth Escalators to a performance marketing agency founder. The sentence must feel like it was written by a human who actually visited their website, not a bot. Never start with "I", never use words like "impressive", "innovative", "passionate", "dedicated". Never use the word "cheaper" — if cost ever needs to come up, phrase it as "60–70% lower fulfilment costs". Maximum 20 words. Output the sentence only — no quotes, no punctuation at end. If website content is unavailable, write a natural opener referencing the agency's country and niche instead.`;

  const userPrompt = `Agency: ${company}
Website signal (meta description / og:title / h1 / h2): ${websiteContent || 'Not available — write based on agency name and country only'}
Detected vertical: ${vertical || 'Unknown'}
Country: ${country ?? 'Unknown'}

Write a single opening sentence. If website signal is available, reference something specific from it. If the detected vertical is set, you may lean on it. If nothing is available, write naturally based on the agency name and location.`;

  try {
    const bodyStr = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const result = await new Promise<string>((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        timeout: 20000,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(bodyStr),
        },
      }, (res) => {
        let body = '';
        res.on('data', (c: string) => { body += c; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as { content?: Array<{ text?: string }> };
            const text = data.content?.[0]?.text?.trim() ?? '';
            resolve(text || buildFallbackIcebreaker(company));
          } catch { resolve(buildFallbackIcebreaker(company)); }
        });
      });
      req.on('error', () => resolve(buildFallbackIcebreaker(company)));
      req.on('timeout', () => { req.destroy(); resolve(buildFallbackIcebreaker(company)); });
      req.write(bodyStr);
      req.end();
    });

    return result;
  } catch {
    return buildFallbackIcebreaker(company);
  }
}

function buildFallbackIcebreaker(company: string): string {
  return `Came across ${company} while looking at performance marketing agencies — wanted to reach out directly`;
}

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

  // Find leads to enrich (New or stuck Enriching >15min, max 3 total attempts).
  // Loop below gives up at retry_count >= 2 (i.e. the 3rd try); query must match.
  const result = await pool.query(`
    SELECT id, company, first_name, website_url, email, country, COALESCE(retry_count, 0) AS retry_count
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
    website_url: string | null; email: string | null; country: string | null; retry_count: number;
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
        await markActive(lead.id, lead.email, lead.first_name, lead.company, 'existing', lead.website_url, lead.country);
        active++;
        continue;
      }

      if (!lead.website_url) {
        await markNotFound(lead.id, 'No website URL');
        notFound++;
        continue;
      }

      const emailResult = await findEmail(lead.website_url, lead.first_name ?? undefined);

      if (emailResult) {
        await markActive(lead.id, emailResult.email, lead.first_name, lead.company, emailResult.source, lead.website_url, lead.country);
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
    // Track email source breakdown for this batch
    let sourceBreakdown = '';
    try {
      const sources = await pool.query(`
        SELECT email_source, COUNT(*)::int AS cnt
        FROM outreach_leads
        WHERE id = ANY($1) AND status = 'Active' AND email_source IS NOT NULL
        GROUP BY email_source ORDER BY cnt DESC
      `, [ids]);
      if (sources.rows.length > 0) {
        sourceBreakdown = '\n📊 Sources: ' + (sources.rows as Array<{ email_source: string; cnt: number }>)
          .map(r => `${r.email_source} (${r.cnt})`).join(', ');
      }
    } catch { /* non-critical */ }

    await sendSlackMessage(SLACK_OUTREACH_CHANNEL,
      `🔄 *Enrichment*: ${active} new Active leads found (${notFound} not found, ${errors} errors)${sourceBreakdown}`,
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

  // Daily cap safety-net: prevents a runaway enrichment surge from blowing
  // through a week of warmup capacity in one afternoon. Default 200/day;
  // override via env MAX_DAILY_UPLOADS. Setting to 0 fully halts uploads.
  const maxDaily = Math.max(0, parseInt(process.env.MAX_DAILY_UPLOADS || '200', 10));
  if (maxDaily === 0) {
    logger.info('[saleshandy] MAX_DAILY_UPLOADS=0 — uploads halted');
    return { uploaded: 0, errors: 0 };
  }
  const todayRow = await pool.query(
    `SELECT leads_uploaded FROM outreach_funnel_daily WHERE snapshot_date = CURRENT_DATE LIMIT 1`,
  ).catch(() => ({ rows: [] as Array<{ leads_uploaded: number }> }));
  const uploadedToday = todayRow.rows[0]?.leads_uploaded ?? 0;

  // Fall back to in-table count in case today's funnel row is not yet created
  const todayCount = uploadedToday > 0 ? uploadedToday : Number(
    (await pool.query(
      `SELECT COUNT(*)::int AS c FROM outreach_leads WHERE saleshandy_uploaded_at::date = CURRENT_DATE`,
    ).catch(() => ({ rows: [{ c: 0 }] }))).rows[0]?.c ?? 0,
  );

  const remaining = Math.max(0, maxDaily - todayCount);
  if (remaining === 0) {
    logger.info(`[saleshandy] Daily cap reached (${todayCount}/${maxDaily}) — skipping upload`);
    return { uploaded: 0, errors: 0 };
  }

  const batchLimit = Math.min(50, remaining);
  const result = await pool.query(`
    SELECT id, company, first_name, email, website_url, icebreaker, country
    FROM outreach_leads
    WHERE status = 'Active' AND email IS NOT NULL
      AND (saleshandy_uploaded IS NULL OR saleshandy_uploaded = FALSE)
    LIMIT $1
  `, [batchLimit]);

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

      // Use Node.js https module directly — axios/fetch add charset to Content-Type
      // which Saleshandy rejects with 406
      const bodyStr = JSON.stringify({ prospects });
      const res = await new Promise<{ status: number; data: unknown }>((resolve) => {
        const https = require('https');
        const urlObj = new URL(`https://api.saleshandy.com/api/v1/sequence/${sequenceId}/prospects`);
        const req = https.request({
          hostname: urlObj.hostname,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'X-Auth-Token': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
          },
          timeout: 15000,
        }, (resp: import('http').IncomingMessage) => {
          let body = '';
          resp.on('data', (c: string) => { body += c; });
          resp.on('end', () => {
            let data: unknown;
            try { data = JSON.parse(body); } catch { data = body; }
            resolve({ status: resp.statusCode ?? 500, data });
          });
        });
        req.on('error', () => resolve({ status: 500, data: 'request failed' }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 408, data: 'timeout' }); });
        req.write(bodyStr);
        req.end();
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

async function markActive(
  leadId: number,
  email: string,
  firstName: string | null,
  company: string,
  emailSource: string,
  websiteUrl?: string | null,
  country?: string | null,
): Promise<void> {
  const icebreaker = await generateIcebreaker(company, websiteUrl ?? null, country ?? null);

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

// ---------------------------------------------------------------------------
// AI Reply Classification using Claude Haiku
// ---------------------------------------------------------------------------

export async function classifyReplyWithAI(
  replyBody: string,
  originalIcebreaker: string,
  companyName: string,
): Promise<{
  category: string;
  confidence: number;
  summary: string;
  draftReply: string | null;
}> {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!ANTHROPIC_KEY) {
    return { category: 'UNCATEGORIZED', confidence: 0, summary: 'No API key', draftReply: null };
  }

  try {
    const prompt = `Classify this email reply and generate a response if appropriate.

Original outreach icebreaker: "${originalIcebreaker}"
Company: ${companyName}

Reply received:
"${replyBody}"

Respond in JSON format:
{
  "category": one of "INTERESTED", "NOT_NOW", "NOT_INTERESTED", "UNSUBSCRIBE", "UNCATEGORIZED",
  "confidence": number 0-100,
  "summary": "one sentence summary of what the reply says",
  "draftReply": "if INTERESTED, write a short professional follow-up (2-3 sentences max) suggesting a quick call. Otherwise null"
}

Classification rules (pick exactly one of the 5):
- INTERESTED: they want to learn more, asked questions, agreed to a call, requested pricing/details
- NOT_NOW: polite defer — "not right now", "try next quarter", out-of-office auto-reply, on holiday, ask us to circle back
- NOT_INTERESTED: polite rejection, already sorted, wrong person, referral to someone else, objection with no open door
- UNSUBSCRIBE: asks to be removed, stop emailing, GDPR removal request
- UNCATEGORIZED: cannot determine intent from the reply

Draft-reply rules:
- Only produce a draftReply when category = "INTERESTED"; otherwise set it to null.
- Never use the word "cheaper". When cost advantages come up, phrase it as "60–70% lower fulfilment costs".
- Keep the draft reply under 3 sentences, written in Jatin's voice — direct, human, no corporate filler.
- Do NOT include a booking link in your draft — the backend appends it automatically.

Return ONLY the JSON, no other text.`;

    const bodyStr = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const result = await new Promise<{
      category: string;
      confidence: number;
      summary: string;
      draftReply: string | null;
    }>((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        timeout: 20000,
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(bodyStr),
        },
      }, (res) => {
        let body = '';
        res.on('data', (c: string) => { body += c; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as { content?: Array<{ text?: string }> };
            const text = data.content?.[0]?.text?.trim() ?? '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              resolve({ category: 'UNCATEGORIZED', confidence: 0, summary: 'Failed to parse', draftReply: null });
              return;
            }
            const parsed = JSON.parse(jsonMatch[0]) as {
              category?: string; confidence?: number; summary?: string; draftReply?: string | null;
            };
            resolve({
              category: parsed.category || 'UNCATEGORIZED',
              confidence: parsed.confidence || 0,
              summary: parsed.summary || '',
              draftReply: parsed.draftReply || null,
            });
          } catch {
            resolve({ category: 'UNCATEGORIZED', confidence: 0, summary: 'Parse error', draftReply: null });
          }
        });
      });
      req.on('error', () => resolve({ category: 'UNCATEGORIZED', confidence: 0, summary: 'Request error', draftReply: null }));
      req.on('timeout', () => { req.destroy(); resolve({ category: 'UNCATEGORIZED', confidence: 0, summary: 'Timeout', draftReply: null }); });
      req.write(bodyStr);
      req.end();
    });

    // Append self-book link on INTERESTED replies so the prospect can book
    // a slot directly — eliminates the calendar-back-and-forth that ghosts
    // 40-60% of interested leads.
    if (result.category === 'INTERESTED' && result.draftReply) {
      const bookingUrl = process.env.MEETING_BOOKING_URL;
      if (bookingUrl) {
        result.draftReply =
          `${result.draftReply.trim()}\n\nFeel free to grab a 20-min slot directly here: ${bookingUrl} — or reply with a time that works.`;
      }
    }

    return result;
  } catch (e) {
    logger.error('[outreach] AI classification failed:', e instanceof Error ? e.message : String(e));
    return { category: 'UNCATEGORIZED', confidence: 0, summary: 'Classification error', draftReply: null };
  }
}

/**
 * Regenerate icebreakers for existing Active leads using Claude Haiku.
 * Pass limit to control how many to regenerate per call.
 */
export async function regenerateIcebreakers(limit = 10): Promise<Array<{ id: number; company: string; before: string; after: string }>> {
  const result = await pool.query(`
    SELECT id, company, website_url, country, COALESCE(icebreaker, '') AS icebreaker
    FROM outreach_leads
    WHERE status = 'Active' AND email IS NOT NULL
    ORDER BY enriched_at DESC NULLS LAST
    LIMIT $1
  `, [limit]);

  const leads = result.rows as Array<{
    id: number; company: string; website_url: string | null;
    country: string | null; icebreaker: string;
  }>;

  const updates: Array<{ id: number; company: string; before: string; after: string }> = [];

  for (const lead of leads) {
    const before = lead.icebreaker;
    const after = await generateIcebreaker(lead.company, lead.website_url, lead.country);
    await pool.query(
      `UPDATE outreach_leads SET icebreaker = $1, updated_at = NOW() WHERE id = $2`,
      [after, lead.id],
    );
    updates.push({ id: lead.id, company: lead.company, before, after });
    await new Promise(r => setTimeout(r, 500));
  }

  return updates;
}
