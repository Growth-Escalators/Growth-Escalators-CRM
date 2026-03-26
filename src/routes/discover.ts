import { Router, type Request, type Response } from 'express';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import {
  discoverySearches,
  discoveryResults,
  discoveryApiUsage,
  contacts,
  contactChannels,
  tenants,
} from '../db/schema';
import ExcelJS from 'exceljs';

const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PLACES_API_BASE = 'https://maps.googleapis.com/maps/api/place';
// Text Search: $0.032/request (returns up to 20 results)
// Place Details Contact: $0.003/request
const COST_TEXT_SEARCH = 0.032;
const COST_PLACE_DETAILS = 0.003;
const BUDGET_LIMIT_USD = 200;

// In-memory rate limit: max 10 searches per hour per tenant
const searchRateLimits = new Map<string, number[]>();

// Radius label → meters
const RADIUS_MAP: Record<string, number> = {
  '10km': 10000,
  '25km': 25000,
  '50km': 50000,
  '100km': 100000,
  'city-wide': 50000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not set');
  return key;
}

function currentMonthYear(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from Places API`);
  return resp.json() as Promise<Record<string, unknown>>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Compute a fit score 0-100 based on available place data.
 * Weights: website (25), phone (15), rating (25), review count (20), business type (15)
 */
function computeFitScore(place: {
  website?: string;
  phone?: string;
  rating?: number;
  reviewCount?: number;
  types?: string[];
}): number {
  let score = 0;

  if (place.website) score += 25;
  if (place.phone) score += 15;

  const rating = place.rating ?? 0;
  if (rating >= 4.5) score += 25;
  else if (rating >= 4.0) score += 20;
  else if (rating >= 3.5) score += 12;
  else if (rating > 0) score += 5;

  const reviews = place.reviewCount ?? 0;
  if (reviews >= 50) score += 20;
  else if (reviews >= 20) score += 15;
  else if (reviews >= 10) score += 10;
  else if (reviews >= 5) score += 5;

  // Business type relevance
  const marketingTypes = [
    'marketing', 'advertising', 'agency', 'digital', 'media', 'design',
    'consulting', 'seo', 'social', 'branding',
  ];
  const typeStr = (place.types ?? []).join(' ').toLowerCase();
  if (marketingTypes.some((t) => typeStr.includes(t))) score += 15;

  return Math.min(100, score);
}

function qualificationFromScore(score: number): string {
  if (score >= 70) return 'Qualified';
  if (score >= 40) return 'Review';
  return 'Disqualified';
}

/** Check rate limit: max 10 searches per hour per tenant */
function checkRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const times = (searchRateLimits.get(tenantId) ?? []).filter(
    (t) => now - t < windowMs,
  );
  if (times.length >= 10) return false;
  times.push(now);
  searchRateLimits.set(tenantId, times);
  return true;
}

/** Update or insert monthly API usage record */
async function trackApiUsage(
  tenantId: string,
  calls: number,
  costUsd: number,
): Promise<void> {
  const monthYear = currentMonthYear();
  const existing = await db
    .select()
    .from(discoveryApiUsage)
    .where(
      and(
        eq(discoveryApiUsage.tenantId, tenantId),
        eq(discoveryApiUsage.monthYear, monthYear),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(discoveryApiUsage)
      .set({
        apiCalls: (existing[0].apiCalls ?? 0) + calls,
        costUsd: String(parseFloat(existing[0].costUsd ?? '0') + costUsd),
        updatedAt: new Date(),
      })
      .where(eq(discoveryApiUsage.id, existing[0].id));
  } else {
    await db.insert(discoveryApiUsage).values({
      tenantId,
      monthYear,
      apiCalls: calls,
      costUsd: String(costUsd),
    });
  }
}

// ---------------------------------------------------------------------------
// POST /api/outreach/discover  — run a Places API search
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;

  if (!checkRateLimit(tenantId)) {
    return res.status(429).json({ error: 'Rate limit: max 10 searches per hour' });
  }

  const {
    query,
    location,
    country = 'UK',
    radius = '10km',
    maxResults = 20,
  } = req.body as {
    query: string;
    location: string;
    country?: string;
    radius?: string;
    maxResults?: number;
  };

  if (!query || !location) {
    return res.status(400).json({ error: 'query and location are required' });
  }

  const apiKey = getApiKey();
  const radiusMeters = RADIUS_MAP[radius] ?? 10000;
  const limit = Math.min(Number(maxResults) || 20, 60);

  // Check budget before starting
  const monthYear = currentMonthYear();
  const usageRows = await db
    .select()
    .from(discoveryApiUsage)
    .where(
      and(
        eq(discoveryApiUsage.tenantId, tenantId),
        eq(discoveryApiUsage.monthYear, monthYear),
      ),
    )
    .limit(1);
  const currentCost = parseFloat(usageRows[0]?.costUsd ?? '0');
  if (currentCost >= BUDGET_LIMIT_USD) {
    return res.status(402).json({ error: 'Monthly API budget limit reached ($200). Contact admin.' });
  }

  // Create search record
  const [search] = await db
    .insert(discoverySearches)
    .values({
      tenantId,
      query,
      location,
      country,
      radiusMeters,
      maxResults: limit,
    })
    .returning();

  try {
    // --- Phase 1: Text Search (collect place IDs + basic data) ---
    const fullQuery = encodeURIComponent(`${query} ${location}`);
    const textSearchUrl = `${PLACES_API_BASE}/textsearch/json?query=${fullQuery}&radius=${radiusMeters}&key=${apiKey}`;

    let totalApiCalls = 0;
    let totalCost = 0;

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
      totalCost += COST_TEXT_SEARCH;

      const results = (data.results as typeof rawPlaces) ?? [];
      rawPlaces.push(...results);
      nextPageToken = data.next_page_token as string | undefined;
      pagesFetched++;

      if (nextPageToken && rawPlaces.length < limit && pagesFetched < maxPages) {
        await sleep(2000); // Google requires delay before using next_page_token
      } else {
        nextPageToken = undefined;
      }
    } while (nextPageToken);

    const placesToProcess = rawPlaces.slice(0, limit);

    // --- Phase 2: Place Details (phone + website) ---
    // Get existing contacts to detect "already in pipeline"
    const existingContacts = await db
      .select({ companyName: contacts.companyName })
      .from(contacts)
      .where(eq(contacts.tenantId, tenantId));
    const existingNames = new Set(
      existingContacts.map((c) => (c.companyName ?? '').toLowerCase()),
    );

    const resultRows: (typeof discoveryResults.$inferInsert)[] = [];

    for (const place of placesToProcess) {
      let website: string | undefined;
      let phone: string | undefined;

      // Fetch Place Details for contact fields
      try {
        const detailUrl =
          `${PLACES_API_BASE}/details/json?place_id=${place.place_id}` +
          `&fields=website,formatted_phone_number&key=${apiKey}`;
        const detail = await fetchJson(detailUrl);
        totalApiCalls++;
        totalCost += COST_PLACE_DETAILS;
        const result = detail.result as Record<string, string> | undefined;
        website = result?.website;
        phone = result?.formatted_phone_number;
      } catch {
        // non-critical — continue without details
      }

      const fitScore = computeFitScore({
        website,
        phone,
        rating: place.rating,
        reviewCount: place.user_ratings_total,
        types: place.types,
      });

      const alreadyInPipeline = existingNames.has(place.name.toLowerCase());
      const status = alreadyInPipeline
        ? 'Already in pipeline'
        : qualificationFromScore(fitScore);

      resultRows.push({
        tenantId,
        searchId: search.id,
        placeId: place.place_id,
        companyName: place.name,
        websiteUrl: website ?? null,
        phoneNumber: phone ?? null,
        address: place.formatted_address ?? null,
        rating: place.rating != null ? String(place.rating) : null,
        reviewCount: place.user_ratings_total ?? 0,
        fitScore,
        qualificationStatus: status,
        metadata: { types: place.types ?? [] },
      });
    }

    // Batch insert results, get back rows with IDs
    let savedResults: (typeof discoveryResults.$inferSelect)[] = [];
    if (resultRows.length > 0) {
      savedResults = await db.insert(discoveryResults).values(resultRows).returning();
    }

    // Count qualified
    const qualifiedCount = savedResults.filter((r) => r.qualificationStatus === 'Qualified').length;

    // Update search record with final stats
    await db
      .update(discoverySearches)
      .set({
        totalFound: savedResults.length,
        qualifiedCount,
        apiCallsUsed: totalApiCalls,
        costUsd: String(totalCost),
      })
      .where(eq(discoverySearches.id, search.id));

    // Track monthly usage
    await trackApiUsage(tenantId, totalApiCalls, totalCost);

    return res.json({
      searchId: search.id,
      totalFound: savedResults.length,
      qualifiedCount,
      reviewCount: savedResults.filter((r) => r.qualificationStatus === 'Review').length,
      disqualifiedCount: savedResults.filter((r) => r.qualificationStatus === 'Disqualified').length,
      apiCallsUsed: totalApiCalls,
      costUsd: totalCost,
      results: savedResults,
    });
  } catch (err) {
    console.error('[discover] search error:', err);
    // Clean up empty search record
    await db.delete(discoverySearches).where(eq(discoverySearches.id, search.id));
    return res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/discover/searches  — list recent searches
// ---------------------------------------------------------------------------
router.get('/searches', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const rows = await db
      .select()
      .from(discoverySearches)
      .where(eq(discoverySearches.tenantId, tenantId))
      .orderBy(desc(discoverySearches.createdAt))
      .limit(20);
    return res.json({ searches: rows });
  } catch (err) {
    console.error('[discover] searches error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/discover/searches/:id/results
// ---------------------------------------------------------------------------
router.get('/searches/:id/results', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  try {
    const results = await db
      .select()
      .from(discoveryResults)
      .where(
        and(
          eq(discoveryResults.searchId, String(id)),
          eq(discoveryResults.tenantId, tenantId),
        ),
      )
      .orderBy(desc(discoveryResults.fitScore));
    return res.json({ results });
  } catch (err) {
    console.error('[discover] results error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/outreach/discover/results/:id  — update qualification status
// ---------------------------------------------------------------------------
router.patch('/results/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  const { qualificationStatus, disqualificationReason } = req.body as {
    qualificationStatus?: string;
    disqualificationReason?: string;
  };
  try {
    const [updated] = await db
      .update(discoveryResults)
      .set({
        ...(qualificationStatus && { qualificationStatus }),
        ...(disqualificationReason !== undefined && { disqualificationReason }),
      })
      .where(
        and(eq(discoveryResults.id, String(id)), eq(discoveryResults.tenantId, tenantId)),
      )
      .returning();
    return res.json({ result: updated });
  } catch (err) {
    console.error('[discover] patch result error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/outreach/discover/import  — import selected leads to contacts
// ---------------------------------------------------------------------------
router.post('/import', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { resultIds, assignedTo = 'Jatin' } = req.body as {
    resultIds: string[];
    assignedTo?: string;
  };

  if (!resultIds?.length) {
    return res.status(400).json({ error: 'resultIds array is required' });
  }

  try {
    // Get selected results
    const rows = await db
      .select()
      .from(discoveryResults)
      .where(
        and(
          inArray(discoveryResults.id, resultIds),
          eq(discoveryResults.tenantId, tenantId),
        ),
      );

    const imported: string[] = [];
    const skipped: string[] = [];

    // Get the tenant ID for import (use the first tenant for now)
    const tenantRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .limit(1);
    const tId = tenantRows[0]?.id ?? tenantId;

    for (const row of rows) {
      if (row.imported) {
        skipped.push(row.id);
        continue;
      }

      // Create contact
      const nameParts = row.companyName.split(' ');
      const [newContact] = await db
        .insert(contacts)
        .values({
          tenantId: tId,
          firstName: nameParts[0] ?? row.companyName,
          lastName: nameParts.slice(1).join(' ') || undefined,
          companyName: row.companyName,
          source: 'lead_discovery',
          sourceDetail: `Google Places — ${row.address ?? ''}`,
          assignedTo,
          status: 'lead',
          tags: ['discovery'],
          metadata: {
            placeId: row.placeId,
            address: row.address,
            rating: row.rating,
            reviewCount: row.reviewCount,
            fitScore: row.fitScore,
          },
        })
        .returning();

      // Add phone channel if available
      if (row.phoneNumber) {
        await db.insert(contactChannels).values({
          tenantId: tId,
          contactId: newContact.id,
          channelType: 'phone',
          channelValue: row.phoneNumber,
          isPrimary: true,
        }).onConflictDoNothing();
      }

      // Add website as metadata
      if (row.websiteUrl) {
        await db
          .update(contacts)
          .set({ metadata: { ...(newContact.metadata as Record<string, unknown> ?? {}), websiteUrl: row.websiteUrl } })
          .where(eq(contacts.id, newContact.id));
      }

      // Mark result as imported
      await db
        .update(discoveryResults)
        .set({ imported: true, importedContactId: newContact.id })
        .where(eq(discoveryResults.id, row.id));

      imported.push(row.id);
    }

    // Update search importedCount
    if (imported.length > 0 && rows[0]) {
      const searchRow = await db
        .select()
        .from(discoverySearches)
        .where(eq(discoverySearches.id, rows[0].searchId))
        .limit(1);
      if (searchRow[0]) {
        await db
          .update(discoverySearches)
          .set({ importedCount: (searchRow[0].importedCount ?? 0) + imported.length })
          .where(eq(discoverySearches.id, rows[0].searchId));
      }
    }

    return res.json({
      imported: imported.length,
      skipped: skipped.length,
      importedIds: imported,
    });
  } catch (err) {
    console.error('[discover] import error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/discover/export  — export Excel or CSV
// ---------------------------------------------------------------------------
router.get('/export', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { searchId, format = 'csv', status } = req.query as {
    searchId?: string;
    format?: 'csv' | 'excel';
    status?: string;
  };

  try {
    let query = db
      .select()
      .from(discoveryResults)
      .where(eq(discoveryResults.tenantId, tenantId))
      .$dynamic();

    if (searchId) {
      query = query.where(
        and(
          eq(discoveryResults.tenantId, tenantId),
          eq(discoveryResults.searchId, searchId),
        ),
      );
    }

    const rows = await query.orderBy(desc(discoveryResults.fitScore));
    const filtered = status
      ? rows.filter((r) => r.qualificationStatus === status)
      : rows;

    const columns = [
      'Company Name', 'Website', 'Phone', 'Address', 'Rating',
      'Reviews', 'Fit Score', 'Status', 'Disqualification Reason', 'Imported',
    ];

    const getData = (r: typeof filtered[0]) => [
      r.companyName,
      r.websiteUrl ?? '',
      r.phoneNumber ?? '',
      r.address ?? '',
      r.rating ?? '',
      r.reviewCount ?? 0,
      r.fitScore ?? 0,
      r.qualificationStatus ?? '',
      r.disqualificationReason ?? '',
      r.imported ? 'Yes' : 'No',
    ];

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Lead Discovery');

      sheet.addRow(columns);
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      for (const r of filtered) {
        const row = sheet.addRow(getData(r));
        // Color-code fit score cell (col 7)
        const scoreCell = row.getCell(7);
        const score = r.fitScore ?? 0;
        if (score >= 70) scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } };
        else if (score >= 40) scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } };
        else scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
        scoreCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      }

      // Auto column widths
      sheet.columns.forEach((col) => {
        col.width = 20;
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="lead-discovery.xlsx"');
      await workbook.xlsx.write(res);
      return res.end();
    }

    // CSV
    const csv = [
      columns.join(','),
      ...filtered.map((r) =>
        getData(r)
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(','),
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="lead-discovery.csv"');
    return res.send(csv);
  } catch (err) {
    console.error('[discover] export error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/discover/budget  — monthly API usage
// ---------------------------------------------------------------------------
router.get('/budget', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const monthYear = currentMonthYear();
    const usageRows = await db
      .select()
      .from(discoveryApiUsage)
      .where(
        and(
          eq(discoveryApiUsage.tenantId, tenantId),
          eq(discoveryApiUsage.monthYear, monthYear),
        ),
      )
      .limit(1);

    const usage = usageRows[0] ?? { apiCalls: 0, costUsd: '0' };
    const costUsd = parseFloat(usage.costUsd ?? '0');
    const pctUsed = Math.min(100, (costUsd / BUDGET_LIMIT_USD) * 100);

    let status = 'Safe';
    if (costUsd >= BUDGET_LIMIT_USD) status = 'Over limit';
    else if (pctUsed >= 80) status = 'Warning';

    return res.json({
      monthYear,
      apiCalls: usage.apiCalls ?? 0,
      costUsd,
      budgetLimitUsd: BUDGET_LIMIT_USD,
      pctUsed: Math.round(pctUsed * 10) / 10,
      status,
    });
  } catch (err) {
    console.error('[discover] budget error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/outreach/discover/stats  — aggregate stats across all searches
// ---------------------------------------------------------------------------
router.get('/stats', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const searches = await db
      .select()
      .from(discoverySearches)
      .where(eq(discoverySearches.tenantId, tenantId));

    const totalDiscovered = searches.reduce((a, s) => a + (s.totalFound ?? 0), 0);
    const totalImported = searches.reduce((a, s) => a + (s.importedCount ?? 0), 0);
    const queriesRun = searches.length;

    // Cost this month
    const monthYear = currentMonthYear();
    const usageRows = await db
      .select()
      .from(discoveryApiUsage)
      .where(
        and(
          eq(discoveryApiUsage.tenantId, tenantId),
          eq(discoveryApiUsage.monthYear, monthYear),
        ),
      )
      .limit(1);
    const costThisMonth = parseFloat(usageRows[0]?.costUsd ?? '0');

    return res.json({ totalDiscovered, totalImported, queriesRun, costThisMonth });
  } catch (err) {
    console.error('[discover] stats error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
