/**
 * /api/outreach/leads
 *
 * Internal endpoints protected by OUTREACH_INTERNAL_SECRET (no JWT required).
 * Used by n8n WF-06 (Auto Discovery) and manual CLI discovery runs.
 *
 * POST /api/outreach/leads/run-discovery
 *   Runs a Google Places search, auto-imports qualified leads (fitScore ≥ minFitScore)
 *   into outreach_leads with status='New', then returns a summary.
 *
 * POST /api/outreach/leads/insert
 *   Inserts a single lead directly (used for manual/testing imports).
 *
 * GET /api/outreach/leads/stats
 *   Returns pipeline stats grouped by status.
 */

import axios from 'axios';
import { Router, type Request, type Response } from 'express';
import logger from '../utils/logger';
import { insertOutreachLead } from '../services/outreachLeadsService';
import { pool } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// Internal-secret auth (same pattern as imapReplies.ts)
// ---------------------------------------------------------------------------
function checkInternalSecret(req: Request, res: Response): boolean {
  const secret = process.env.OUTREACH_INTERNAL_SECRET;
  if (!secret) {
    logger.error('[outreach-leads] OUTREACH_INTERNAL_SECRET not set — blocking request');
    res.status(401).json({ error: 'internal secret not configured' });
    return false;
  }
  const provided = req.headers['x-internal-secret'];
  if (provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers (mirrors discover.ts — kept local to avoid circular deps)
// ---------------------------------------------------------------------------
const PLACES_API_BASE = 'https://maps.googleapis.com/maps/api/place';
const COST_TEXT_SEARCH  = 0.032;
const COST_PLACE_DETAILS = 0.003;

const RADIUS_MAP: Record<string, number> = {
  '10km': 10000, '25km': 25000, '50km': 50000, '100km': 100000, 'city-wide': 50000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from Places API`);
  return resp.json() as Promise<Record<string, unknown>>;
}

function computeFitScore(place: {
  website?: string; phone?: string; rating?: number; reviewCount?: number; types?: string[];
}): number {
  let score = 0;
  if (place.website) score += 25;
  if (place.phone)   score += 15;
  const rating = place.rating ?? 0;
  if (rating >= 4.5) score += 25;
  else if (rating >= 4.0) score += 20;
  else if (rating >= 3.5) score += 12;
  else if (rating > 0)    score += 5;
  const reviews = place.reviewCount ?? 0;
  if (reviews >= 50) score += 20;
  else if (reviews >= 20) score += 15;
  else if (reviews >= 10) score += 10;
  else if (reviews >= 5)  score += 5;
  const marketingTypes = ['marketing','advertising','agency','digital','media','design','consulting','seo','social','branding'];
  const typeStr = (place.types ?? []).join(' ').toLowerCase();
  if (marketingTypes.some((t) => typeStr.includes(t))) score += 15;
  return Math.min(100, score);
}

// ---------------------------------------------------------------------------
// POST /api/outreach/leads/run-discovery
// ---------------------------------------------------------------------------
router.post('/run-discovery', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  const {
    query,
    location,
    country = 'UK',
    radius = '10km',
    maxResults = 20,
    minFitScore = 70,
  } = req.body as {
    query: string;
    location: string;
    country?: string;
    radius?: string;
    maxResults?: number;
    minFitScore?: number;
  };

  if (!query || !location) {
    return res.status(400).json({ error: 'query and location are required' });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not set' });
  }

  const radiusMeters = RADIUS_MAP[radius] ?? 10000;
  const limit = Math.min(Number(maxResults) || 20, 60);
  const minScore = Number(minFitScore) || 70;

  logger.info({ query, location, country, radius, limit, minScore }, '[run-discovery] starting');

  try {
    // Phase 1: Text Search
    const fullQuery = encodeURIComponent(`${query} ${location}`);
    const textSearchUrl = `${PLACES_API_BASE}/textsearch/json?query=${fullQuery}&radius=${radiusMeters}&key=${apiKey}`;

    let totalApiCalls = 0;
    let totalCostUsd = 0;

    const rawPlaces: Array<{
      place_id: string;
      name: string;
      formatted_address?: string;
      rating?: number;
      user_ratings_total?: number;
      types?: string[];
    }> = [];

    let nextPageToken: string | undefined;
    let pagesFetched = 0;
    const maxPages = Math.ceil(limit / 20);

    do {
      const url = nextPageToken
        ? `${PLACES_API_BASE}/textsearch/json?pagetoken=${nextPageToken}&key=${apiKey}`
        : textSearchUrl;
      const data = await fetchJson(url);
      totalApiCalls++;
      totalCostUsd += COST_TEXT_SEARCH;
      const results = (data.results as typeof rawPlaces) ?? [];
      rawPlaces.push(...results);
      nextPageToken = data.next_page_token as string | undefined;
      pagesFetched++;
      if (nextPageToken && rawPlaces.length < limit && pagesFetched < maxPages) {
        await sleep(2000);
      } else {
        nextPageToken = undefined;
      }
    } while (nextPageToken);

    const placesToProcess = rawPlaces.slice(0, limit);

    // Phase 2: Place Details + import
    const inserted: string[] = [];
    const skipped: string[] = [];
    const lowScore: string[] = [];

    for (const place of placesToProcess) {
      let website: string | undefined;
      let phone: string | undefined;

      try {
        const detailUrl =
          `${PLACES_API_BASE}/details/json?place_id=${place.place_id}` +
          `&fields=website,formatted_phone_number&key=${apiKey}`;
        const detail = await fetchJson(detailUrl);
        totalApiCalls++;
        totalCostUsd += COST_PLACE_DETAILS;
        const result = detail.result as Record<string, string> | undefined;
        website = result?.website;
        phone = result?.formatted_phone_number;
      } catch {
        // non-critical
      }

      const fitScore = computeFitScore({
        website, phone,
        rating: place.rating,
        reviewCount: place.user_ratings_total,
        types: place.types,
      });

      if (fitScore < minScore) {
        lowScore.push(place.name);
        continue;
      }

      const result = await insertOutreachLead({
        company: place.name,
        phone:   phone ?? null,
        websiteUrl: website ?? null,
        address: place.formatted_address ?? null,
        country,
        fitScore,
        sourceDetail: `${query} — ${location}, ${country}`,
      });

      if (result.inserted) {
        inserted.push(place.name);
      } else {
        skipped.push(place.name);
      }
    }

    logger.info({ query, location, inserted: inserted.length, skipped: skipped.length, lowScore: lowScore.length, totalApiCalls, totalCostUsd }, '[run-discovery] done');

    return res.json({
      query,
      location,
      country,
      totalFound: placesToProcess.length,
      qualifiedCount: inserted.length + skipped.length,
      inserted: inserted.length,
      skipped_duplicates: skipped.length,
      below_threshold: lowScore.length,
      apiCallsUsed: totalApiCalls,
      costUsd: Math.round(totalCostUsd * 10000) / 10000,
      inserted_companies: inserted,
    });
  } catch (err) {
    logger.error({ err }, '[run-discovery] error');
    return res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/outreach/leads/insert — manual single-lead insert
// ---------------------------------------------------------------------------
router.post('/insert', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  const { company, firstName, phone, websiteUrl, address, country, fitScore, sourceDetail } = req.body as {
    company: string;
    firstName?: string;
    phone?: string;
    websiteUrl?: string;
    address?: string;
    country?: string;
    fitScore?: number;
    sourceDetail?: string;
  };

  if (!company) {
    return res.status(400).json({ error: 'company is required' });
  }

  try {
    const result = await insertOutreachLead({ company, firstName, phone, websiteUrl, address, country, fitScore, sourceDetail });
    return res.json(result);
  } catch (err) {
    logger.error({ err }, '[outreach-leads] insert error');
    return res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/leads/stats — pipeline counts by status
// ---------------------------------------------------------------------------
router.get('/stats', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  try {
    const result = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM outreach_leads GROUP BY status ORDER BY count DESC`,
    );
    const total = result.rows.reduce((a: number, r: { count: number }) => a + r.count, 0) as number;
    return res.json({ total, by_status: result.rows });
  } catch (err) {
    logger.error({ err }, '[outreach-leads] stats error');
    return res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/leads/digest-stats — full digest data for daily Slack post
// Used by n8n WF-03 and CRM admin UI. Requires internal secret.
// ---------------------------------------------------------------------------
router.get('/digest-stats', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  try {
    const today = new Date().toISOString().slice(0, 10);

    // Status breakdown
    const statusResult = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM outreach_leads GROUP BY status ORDER BY count DESC`,
    );
    const statusCounts: Record<string, number> = {};
    for (const row of statusResult.rows as Array<{ status: string; count: number }>) {
      statusCounts[row.status] = row.count;
    }

    // Total active
    const totalActive = statusCounts['Active'] ?? 0;

    // Leads added today
    const todayResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM outreach_leads WHERE created_at::date = $1`,
      [today],
    );
    const leadsToday = (todayResult.rows[0] as { count: number }).count;

    // By owner
    const ownerResult = await pool.query(
      `SELECT LOWER(assigned_to) AS owner, COUNT(*)::int AS count
       FROM outreach_leads WHERE status IN ('New','Enriching','Active')
       GROUP BY LOWER(assigned_to)`,
    );
    const byOwner: Record<string, number> = {};
    for (const row of ownerResult.rows as Array<{ owner: string; count: number }>) {
      byOwner[row.owner || 'unassigned'] = row.count;
    }

    // Replies today
    const repliesResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM outreach_leads
       WHERE status = 'Replied' AND updated_at::date = $1`,
      [today],
    );
    const repliesToday = (repliesResult.rows[0] as { count: number }).count;

    // Total leads
    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

    res.json({
      date: today,
      total,
      totalActive,
      leadsToday,
      repliesToday,
      statusCounts,
      byOwner,
    });
  } catch (err) {
    logger.error({ err }, '[outreach-leads] digest-stats error');
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/leads/replied — all replied leads with category summary
// ---------------------------------------------------------------------------
router.get('/replied', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  try {
    const leadsResult = await pool.query(`
      SELECT first_name, company, email, country,
             reply_category, notes, updated_at
      FROM outreach_leads
      WHERE status = 'Replied'
      ORDER BY updated_at DESC
    `);

    const summaryResult = await pool.query(`
      SELECT COALESCE(reply_category, 'UNCATEGORIZED') AS category, COUNT(*)::int AS count
      FROM outreach_leads
      WHERE status = 'Replied'
      GROUP BY reply_category
      ORDER BY count DESC
    `);

    res.json({
      total: leadsResult.rows.length,
      summary: summaryResult.rows,
      leads: leadsResult.rows,
    });
  } catch (err) {
    logger.error({ err }, '[outreach-leads] replied error');
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/leads/pipeline-summary — full pipeline overview
// ---------------------------------------------------------------------------
router.get('/pipeline-summary', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  try {
    const statusResult = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM outreach_leads GROUP BY status ORDER BY count DESC
    `);

    const totalResult = await pool.query(`SELECT COUNT(*)::int AS count FROM outreach_leads`);

    const last7dResult = await pool.query(`
      SELECT COUNT(*)::int AS count FROM outreach_leads
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);

    const countryResult = await pool.query(`
      SELECT COALESCE(country, 'Unknown') AS country, COUNT(*)::int AS count
      FROM outreach_leads GROUP BY country ORDER BY count DESC LIMIT 20
    `);

    res.json({
      total: (totalResult.rows[0] as { count: number }).count,
      addedLast7Days: (last7dResult.rows[0] as { count: number }).count,
      byStatus: statusResult.rows,
      byCountry: countryResult.rows,
    });
  } catch (err) {
    logger.error({ err }, '[outreach-leads] pipeline-summary error');
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/outreach/leads/reset-stuck — reset stuck Enriching leads to New
// ---------------------------------------------------------------------------
router.post('/reset-stuck', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  try {
    // Reset leads stuck in Enriching for more than 1 hour back to New
    const result = await pool.query(`
      UPDATE outreach_leads
      SET status = 'New', updated_at = NOW()
      WHERE status = 'Enriching'
        AND updated_at < NOW() - INTERVAL '1 hour'
      RETURNING id, company
    `);

    res.json({
      reset: result.rows.length,
      leads: result.rows,
    });
  } catch (err) {
    logger.error({ err }, '[outreach-leads] reset-stuck error');
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/outreach/leads/enrich-now — manually trigger backend enrichment
// ---------------------------------------------------------------------------
router.post('/enrich-now', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  try {
    // Reset Not_Found leads that were marked due to missing API key so they can be re-scraped
    const resetResult = await pool.query(`
      UPDATE outreach_leads SET status = 'New', notes = NULL, updated_at = NOW()
      WHERE status = 'Not_Found'
      RETURNING id
    `);
    const resetCount = resetResult.rows.length;

    // Run enrichment (processes batches of 20)
    const { enrichStuckLeads } = await import('../services/outreachEnrichmentService');
    const result = await enrichStuckLeads();
    res.json({ ...result, resetFromNotFound: resetCount });
  } catch (err) {
    logger.error({ err }, '[outreach-leads] enrich-now error');
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/leads/active — list all Active leads with full details
// ---------------------------------------------------------------------------
router.get('/active', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;
  try {
    const result = await pool.query(`
      SELECT id, company, first_name, last_name, email, website_url, icebreaker,
             country, phone, fit_score, enriched_at
      FROM outreach_leads WHERE status = 'Active'
      ORDER BY enriched_at DESC
    `);
    res.json({ total: result.rows.length, leads: result.rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/outreach/leads/upload-saleshandy — push Active leads to Saleshandy
// ---------------------------------------------------------------------------
router.post('/upload-saleshandy', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;

  const apiKey = process.env.SALESHANDY_API_KEY;
  const sequenceId = process.env.SALESHANDY_SEQUENCE_ID;

  if (!apiKey || !sequenceId) {
    res.status(400).json({
      error: 'SALESHANDY_API_KEY and SALESHANDY_SEQUENCE_ID must be set in Railway env vars',
      apiKeySet: !!apiKey,
      sequenceIdSet: !!sequenceId,
    });
    return;
  }

  try {
    const result = await pool.query(`
      SELECT id, company, first_name, last_name, email, website_url, icebreaker
      FROM outreach_leads WHERE status = 'Active' AND email IS NOT NULL
      ORDER BY enriched_at DESC
    `);

    const leads = result.rows as Array<{
      id: number; company: string; first_name: string | null; last_name: string | null;
      email: string; website_url: string | null; icebreaker: string | null;
    }>;

    if (leads.length === 0) {
      res.json({ uploaded: 0, message: 'No Active leads with emails to upload' });
      return;
    }

    let uploaded = 0;
    const errors: string[] = [];

    // Upload in batches of 10
    for (let i = 0; i < leads.length; i += 10) {
      const batch = leads.slice(i, i + 10);
      const prospects = batch.map(lead => ({
        emailAddress: lead.email,
        firstName: lead.first_name || lead.company.split(' ')[0],
        lastName: lead.last_name || lead.company,
        customFields: {
          icebreaker: lead.icebreaker || '',
          website: lead.website_url || '',
          company: lead.company,
        },
      }));

      try {
        const bodyStr = JSON.stringify({ prospects });
        const shRes = await new Promise<{ status: number; data: unknown }>((resolve) => {
          const https = require('https');
          const urlObj = new URL(`https://api.saleshandy.com/api/v1/sequence/${sequenceId}/prospects`);
          const req = https.request({
            hostname: urlObj.hostname, path: urlObj.pathname, method: 'POST',
            headers: {
              'X-Auth-Token': apiKey, 'Content-Type': 'application/json',
              'Accept': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr),
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

        if (shRes.status >= 200 && shRes.status < 300) {
          uploaded += batch.length;
          const ids = batch.map(l => l.id);
          await pool.query(
            `UPDATE outreach_leads SET status = 'Uploaded', updated_at = NOW() WHERE id = ANY($1)`,
            [ids],
          );
        } else {
          const errBody = typeof shRes.data === 'string' ? shRes.data.slice(0, 100) : JSON.stringify(shRes.data).slice(0, 100);
          errors.push(`Batch ${i / 10 + 1}: HTTP ${shRes.status} — ${errBody}`);
        }
      } catch (e) {
        errors.push(`Batch ${i / 10 + 1}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    res.json({ uploaded, total: leads.length, errors });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/leads/dashboard — complete outreach overview
// ---------------------------------------------------------------------------
router.get('/dashboard', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;
  try {
    const [statusR, recentR, interestedR, countryR, weeklyR] = await Promise.all([
      pool.query(`SELECT status, COUNT(*)::int AS count FROM outreach_leads GROUP BY status`),
      pool.query(`SELECT id, company, status, email, email_source, reply_category, country, updated_at FROM outreach_leads ORDER BY updated_at DESC LIMIT 20`),
      pool.query(`SELECT id, company, email, country, notes, updated_at FROM outreach_leads WHERE reply_category = 'INTERESTED' ORDER BY updated_at DESC`),
      pool.query(`SELECT COALESCE(country, 'Unknown') AS country, COUNT(*)::int AS count FROM outreach_leads GROUP BY country ORDER BY count DESC`),
      pool.query(`SELECT created_at::date AS date, COUNT(*)::int AS count FROM outreach_leads WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY created_at::date ORDER BY date`),
    ]);

    const sc: Record<string, number> = {};
    for (const r of statusR.rows as Array<{ status: string; count: number }>) sc[r.status] = r.count;
    const total = Object.values(sc).reduce((a, b) => a + b, 0);

    res.json({
      pipeline: {
        total, new: sc.New ?? 0, enriching: sc.Enriching ?? 0, active: sc.Active ?? 0,
        notFound: sc.Not_Found ?? 0, uploaded: sc.Uploaded ?? 0, replied: sc.Replied ?? 0,
        closed: sc.Closed ?? 0, interested: (interestedR.rows as unknown[]).length,
      },
      recentActivity: recentR.rows,
      interestedLeads: interestedR.rows,
      byCountry: countryR.rows,
      weeklyTrend: weeklyR.rows,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/outreach/leads/sync-crm — manually trigger CRM sync
// ---------------------------------------------------------------------------
router.post('/sync-crm', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;
  try {
    const { syncOutreachToCrm } = await import('../services/outreachCrmSyncService');
    const result = await syncOutreachToCrm();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/outreach/leads/:id/reply — set reply category + auto-promote
// ---------------------------------------------------------------------------
router.patch('/:id/reply', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;
  try {
    const leadId = parseInt(req.params.id as string, 10);
    const { reply_category, notes } = req.body as { reply_category: string; notes?: string };

    await pool.query(
      `UPDATE outreach_leads SET status = 'Replied', reply_category = $1, notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3`,
      [reply_category, notes ?? null, leadId],
    );

    // Auto-promote INTERESTED leads
    if (reply_category === 'INTERESTED') {
      const { promoteInterestedLead } = await import('../services/outreachCrmSyncService');
      await promoteInterestedLead(leadId);
    }

    res.json({ success: true, reply_category });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
