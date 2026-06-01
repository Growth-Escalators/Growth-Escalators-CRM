/**
 * /api/outbound — outbound lead-gen module (Phase 1: data layer)
 *
 * Endpoints (all require admin-tier JWT — gated at mount in src/index.ts):
 *   POST   /prospects/import-csv            multipart CSV upload, dedupes by
 *                                           lower(email) + lower(linkedin_url)
 *   GET    /prospects                       ?status=&icp_segment=&limit=&offset=
 *   GET    /prospects/:id                   prospect + signals + replies
 *   PATCH  /prospects/:id/status            updates status, writes an
 *                                           outbound_events audit row
 *
 * Enrichment / validation / reply scoring belong to later phases — this file
 * only handles ingest + status tracking.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import { pool } from '../db/index';
import logger from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Constants — keep in sync with CHECK constraints in migration 0017
// (exported so tests can assert the canonical lists)
// ---------------------------------------------------------------------------
export const ICP_SEGMENTS = ['dev_saas', 'dev_agency', 'marketing_d2c', 'marketing_agency'] as const;
export const STATUSES = [
  'new', 'contacted', 'accepted', 'replied', 'meeting', 'pilot', 'client', 'recycled', 'suppressed',
] as const;
export type IcpSegment = typeof ICP_SEGMENTS[number];
export type ProspectStatus = typeof STATUSES[number];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — ample for tens of thousands of rows
});

// ---------------------------------------------------------------------------
// CSV parser — RFC4180-ish: handles quoted fields, escaped quotes, CRLF.
// Small inline implementation to avoid pulling in a new dependency. Returns
// rows as arrays of strings; caller maps to headers.
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; } // swallow CR; LF terminates the row
    if (ch === '\n') {
      row.push(field); rows.push(row);
      row = []; field = ''; i += 1; continue;
    }
    field += ch; i += 1;
  }
  // Tail: file may not end with newline
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.length > 0)); // drop fully-blank rows
}

// ---------------------------------------------------------------------------
// Helpers (exported for unit tests)
// ---------------------------------------------------------------------------
export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function s(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

export function normaliseEmail(v: string | undefined): string | null {
  const t = s(v);
  return t == null ? null : t.toLowerCase();
}

export function isValidIcpSegment(v: string | null): v is IcpSegment {
  return v != null && (ICP_SEGMENTS as readonly string[]).includes(v);
}

export function isValidStatus(v: string | null): v is ProspectStatus {
  return v != null && (STATUSES as readonly string[]).includes(v);
}

// Header aliases for forgiving CSV column names. Map of canonical → accepted.
export const HEADER_ALIASES: Record<string, string[]> = {
  first_name:   ['first_name', 'firstname', 'first', 'given_name'],
  last_name:    ['last_name', 'lastname', 'last', 'family_name', 'surname'],
  title:        ['title', 'job_title', 'position', 'role'],
  company:      ['company', 'company_name', 'organisation', 'organization', 'employer'],
  company_size: ['company_size', 'companysize', 'size', 'headcount'],
  linkedin_url: ['linkedin_url', 'linkedin', 'linkedinurl', 'li_url', 'profile_url'],
  email:        ['email', 'email_address', 'e_mail', 'work_email'],
  email_status: ['email_status', 'emailstatus', 'verification_status'],
  icp_segment:  ['icp_segment', 'icpsegment', 'segment', 'icp'],
  channel:      ['channel', 'outbound_channel'],
  source:       ['source', 'lead_source', 'origin'],
};

export function mapHeaderIndices(headerRow: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  const norm = headerRow.map(normaliseHeader);
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    const found = norm.findIndex((h) => aliases.includes(h));
    if (found >= 0) idx[canonical] = found;
  }
  return idx;
}

// ---------------------------------------------------------------------------
// POST /prospects/import-csv
//
// Accepts multipart/form-data with field name 'file', OR a raw text/csv body.
// Dedupe semantics: a row whose lower(email) OR lower(linkedin_url) already
// exists in prospects is skipped (not updated — Phase 1 is import-only).
// Bad rows (validation failure) are logged with their row number and skipped;
// they never abort the whole import.
// ---------------------------------------------------------------------------
router.post('/prospects/import-csv', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  let csvText = '';
  if (req.file?.buffer) {
    csvText = req.file.buffer.toString('utf8');
  } else if (typeof req.body === 'string') {
    csvText = req.body;
  } else if (req.is('text/csv') || req.is('text/plain')) {
    csvText = String(req.body ?? '');
  } else if (req.body && typeof req.body === 'object' && 'csv' in req.body) {
    csvText = String((req.body as { csv?: string }).csv ?? '');
  }

  if (!csvText || !csvText.trim()) {
    res.status(400).json({ error: 'CSV body required (multipart field "file" or text/csv body)' });
    return;
  }

  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch (err) {
    logger.error({ err }, '[outbound/import-csv] parse failed');
    res.status(400).json({ error: 'CSV parse failed', detail: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (rows.length < 2) {
    res.status(400).json({ error: 'CSV must have a header row and at least one data row' });
    return;
  }

  const [headerRow, ...dataRows] = rows;
  const idx = mapHeaderIndices(headerRow);

  if (Object.keys(idx).length === 0) {
    res.status(400).json({
      error: 'No recognised columns in header',
      expected: Object.keys(HEADER_ALIASES),
      received: headerRow,
    });
    return;
  }

  const summary = {
    total_rows: dataRows.length,
    inserted: 0,
    skipped_duplicate: 0,
    skipped_invalid: 0,
    skipped_empty: 0,
    errors: [] as Array<{ row: number; reason: string }>,
  };

  const get = (row: string[], col: string): string | undefined =>
    idx[col] != null ? row[idx[col]] : undefined;

  for (let rowNum = 0; rowNum < dataRows.length; rowNum += 1) {
    const r = dataRows[rowNum];
    const lineNo = rowNum + 2; // +1 for header, +1 for 1-based

    const email = normaliseEmail(get(r, 'email'));
    const linkedinUrl = s(get(r, 'linkedin_url'));

    if (!email && !linkedinUrl) {
      summary.skipped_empty += 1;
      summary.errors.push({ row: lineNo, reason: 'no email and no linkedin_url' });
      continue;
    }

    const icpSegmentRaw = s(get(r, 'icp_segment'));
    if (icpSegmentRaw && !isValidIcpSegment(icpSegmentRaw)) {
      summary.skipped_invalid += 1;
      summary.errors.push({
        row: lineNo,
        reason: `icp_segment must be one of ${ICP_SEGMENTS.join('|')} (got "${icpSegmentRaw}")`,
      });
      continue;
    }

    const firstName   = s(get(r, 'first_name'));
    const lastName    = s(get(r, 'last_name'));
    const title       = s(get(r, 'title'));
    const company     = s(get(r, 'company'));
    const companySize = s(get(r, 'company_size'));
    const emailStatus = s(get(r, 'email_status')) ?? 'unverified';
    const channel     = s(get(r, 'channel'));
    const source      = s(get(r, 'source'));

    try {
      const result = await pool.query(
        `INSERT INTO prospects (
            first_name, last_name, title, company, company_size,
            linkedin_url, email, email_status, icp_segment,
            status, channel, source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'new',$10,$11)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          firstName, lastName, title, company, companySize,
          linkedinUrl, email, emailStatus, icpSegmentRaw,
          channel, source,
        ],
      );

      if (result.rowCount && result.rowCount > 0) {
        summary.inserted += 1;
        const newId = (result.rows[0] as { id: string }).id;
        // Audit row: 'import' event records origin.
        await pool.query(
          `INSERT INTO outbound_events (prospect_id, event_type, to_status, note)
           VALUES ($1, 'import', 'new', $2)`,
          [newId, `csv:row-${lineNo}`],
        ).catch((e) => logger.warn({ err: e, newId }, '[outbound/import-csv] audit insert failed'));
      } else {
        summary.skipped_duplicate += 1;
      }
    } catch (err) {
      summary.skipped_invalid += 1;
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push({ row: lineNo, reason: msg });
      logger.warn({ row: lineNo, err }, '[outbound/import-csv] row insert failed');
    }
  }

  // Cap errors array to keep response small
  if (summary.errors.length > 50) {
    const truncated = summary.errors.length - 50;
    summary.errors = summary.errors.slice(0, 50);
    summary.errors.push({ row: -1, reason: `... ${truncated} more errors omitted` });
  }

  logger.info(summary, '[outbound/import-csv] done');
  res.json(summary);
});

// ---------------------------------------------------------------------------
// GET /prospects?status=&icp_segment=&limit=&offset=
// ---------------------------------------------------------------------------
router.get('/prospects', async (req: Request, res: Response): Promise<void> => {
  const status = s(req.query.status as string | undefined);
  const icpSegment = s(req.query.icp_segment as string | undefined);
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 500);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

  if (status && !isValidStatus(status)) {
    res.status(400).json({ error: `status must be one of ${STATUSES.join('|')}` });
    return;
  }
  if (icpSegment && !isValidIcpSegment(icpSegment)) {
    res.status(400).json({ error: `icp_segment must be one of ${ICP_SEGMENTS.join('|')}` });
    return;
  }

  const conds: string[] = [];
  const args: unknown[] = [];
  if (status)     { args.push(status);     conds.push(`status = $${args.length}`); }
  if (icpSegment) { args.push(icpSegment); conds.push(`icp_segment = $${args.length}`); }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

  args.push(limit);  const limitIdx  = args.length;
  args.push(offset); const offsetIdx = args.length;

  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, title, company, company_size,
              linkedin_url, email, email_status, icp_segment, status,
              channel, source, created_at, updated_at
         FROM prospects ${where}
         ORDER BY created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      args,
    );
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM prospects ${where}`,
      args.slice(0, conds.length),
    );
    res.json({
      total: (countResult.rows[0] as { count: number }).count,
      limit,
      offset,
      prospects: result.rows,
    });
  } catch (err) {
    logger.error({ err }, '[outbound] list error');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /prospects/:id  →  prospect + signals + replies
// ---------------------------------------------------------------------------
router.get('/prospects/:id', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id ?? '');
  // Defensive UUID guard so a typo doesn't yield an opaque 500 from postgres.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: 'invalid prospect id (uuid)' });
    return;
  }

  try {
    const [pRes, sRes, rRes] = await Promise.all([
      pool.query(
        `SELECT id, first_name, last_name, title, company, company_size,
                linkedin_url, email, email_status, icp_segment, status,
                channel, source, created_at, updated_at
           FROM prospects WHERE id = $1`,
        [id],
      ),
      pool.query(
        `SELECT id, signal_type, signal_detail, signal_date, is_fresh, created_at
           FROM signals WHERE prospect_id = $1 ORDER BY signal_date DESC NULLS LAST, created_at DESC`,
        [id],
      ),
      pool.query(
        `SELECT id, channel, body, classification, received_at, created_at
           FROM replies WHERE prospect_id = $1 ORDER BY received_at DESC NULLS LAST, created_at DESC`,
        [id],
      ),
    ]);

    if (pRes.rowCount === 0) {
      res.status(404).json({ error: 'prospect not found' });
      return;
    }

    res.json({
      prospect: pRes.rows[0],
      signals: sRes.rows,
      replies: rRes.rows,
    });
  } catch (err) {
    logger.error({ err, id }, '[outbound] detail error');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /prospects/:id/status  { status, note? }
// Atomically updates the prospect's status and records the transition in
// outbound_events. No-ops (same status → same status) still write an event
// row so the audit trail is honest about touch-points.
// ---------------------------------------------------------------------------
router.patch('/prospects/:id/status', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: 'invalid prospect id (uuid)' });
    return;
  }

  const body = (req.body ?? {}) as { status?: string; note?: string };
  const toStatus = s(body.status);
  const note = s(body.note);

  if (!isValidStatus(toStatus)) {
    res.status(400).json({ error: `status must be one of ${STATUSES.join('|')}` });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT status FROM prospects WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'prospect not found' });
      return;
    }
    const fromStatus = (current.rows[0] as { status: string }).status;

    await client.query(
      `UPDATE prospects SET status = $1, updated_at = NOW() WHERE id = $2`,
      [toStatus, id],
    );
    await client.query(
      `INSERT INTO outbound_events (prospect_id, event_type, from_status, to_status, note)
       VALUES ($1, 'status_change', $2, $3, $4)`,
      [id, fromStatus, toStatus, note],
    );

    await client.query('COMMIT');
    res.json({ id, from_status: fromStatus, to_status: toStatus, note });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* ignore — already errored */ });
    logger.error({ err, id }, '[outbound] status update error');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    client.release();
  }
});

export default router;
