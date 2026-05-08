/**
 * shortLinksDb.ts — DB-backed short link store. Replaces the external
 * shlink Railway service (decommissioned 2026-05).
 *
 * Lives in main Postgres so we don't need a separate Railway service.
 * Click stats kept simple: one counter + last-clicked timestamp on the
 * row. If we ever need per-day breakdowns, add a `short_link_clicks`
 * append-only log table.
 *
 * Pattern matches the other ensure*() helpers in the repo
 * (ensureCronJobLogsTable, ensureAttendanceColumns).
 */

import { pool } from '../db/index';
import logger from '../utils/logger';
import { SEED_SHORT_LINKS } from '../config/shortLinks';

export interface ShortLinkRow {
  slug: string;
  destination: string;
  description: string | null;
  tags: string[];
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  clickCount: number;
  lastClickedAt: string | null;
}

// ---------------------------------------------------------------------------
// Schema bootstrap — runs at web boot.
// ---------------------------------------------------------------------------
export async function ensureShortLinksTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS short_links (
        slug TEXT PRIMARY KEY,
        destination TEXT NOT NULL,
        description TEXT,
        tags TEXT[] DEFAULT '{}',
        created_by_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        click_count INTEGER DEFAULT 0,
        last_clicked_at TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS short_links_created_idx ON short_links(created_at DESC)`);

    // Seed initial slugs from src/config/shortLinks.ts on first boot.
    // ON CONFLICT DO NOTHING — never overwrites a row the user has edited.
    if (SEED_SHORT_LINKS.length > 0) {
      for (const seed of SEED_SHORT_LINKS) {
        await pool.query(
          `INSERT INTO short_links (slug, destination, description, tags)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (slug) DO NOTHING`,
          [seed.slug, seed.destination, seed.description ?? null, seed.tags ?? []],
        );
      }
    }
    logger.info('[short-links] table ensured');
  } catch (e) {
    logger.warn(`[short-links] ensure failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
function rowToLink(row: Record<string, unknown>): ShortLinkRow {
  return {
    slug: row.slug as string,
    destination: row.destination as string,
    description: (row.description as string | null) ?? null,
    tags: (row.tags as string[] | null) ?? [],
    createdByUserId: (row.created_by_user_id as number | null) ?? null,
    createdAt: (row.created_at as Date | string)?.toString() ?? '',
    updatedAt: (row.updated_at as Date | string)?.toString() ?? '',
    clickCount: (row.click_count as number) ?? 0,
    lastClickedAt: row.last_clicked_at ? (row.last_clicked_at as Date | string).toString() : null,
  };
}

export async function lookupShortLinkDb(slug: string): Promise<ShortLinkRow | null> {
  if (!slug) return null;
  const normalised = slug.toLowerCase().trim();
  const r = await pool.query(`SELECT * FROM short_links WHERE slug = $1 LIMIT 1`, [normalised]);
  if (r.rows.length === 0) return null;
  return rowToLink(r.rows[0] as Record<string, unknown>);
}

export async function listShortLinksDb(): Promise<ShortLinkRow[]> {
  const r = await pool.query(`SELECT * FROM short_links ORDER BY created_at DESC`);
  return (r.rows as Array<Record<string, unknown>>).map(rowToLink);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
export async function createShortLinkDb(opts: {
  slug: string;
  destination: string;
  description?: string;
  tags?: string[];
  createdByUserId?: number | null;
}): Promise<ShortLinkRow> {
  const slug = opts.slug.toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    throw new Error(`Invalid slug "${slug}" — use lowercase letters, digits, and dashes (max 64 chars)`);
  }
  if (!opts.destination || !/^https?:\/\//i.test(opts.destination)) {
    throw new Error(`Invalid destination "${opts.destination}" — must be an http(s) URL`);
  }

  const r = await pool.query(
    `INSERT INTO short_links (slug, destination, description, tags, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [slug, opts.destination, opts.description ?? null, opts.tags ?? [], opts.createdByUserId ?? null],
  );
  return rowToLink(r.rows[0] as Record<string, unknown>);
}

export async function updateShortLinkDb(slug: string, patch: {
  destination?: string;
  description?: string | null;
  tags?: string[];
}): Promise<ShortLinkRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.destination !== undefined) {
    if (!/^https?:\/\//i.test(patch.destination)) {
      throw new Error(`Invalid destination "${patch.destination}" — must be an http(s) URL`);
    }
    fields.push(`destination = $${i++}`); values.push(patch.destination);
  }
  if (patch.description !== undefined) { fields.push(`description = $${i++}`); values.push(patch.description); }
  if (patch.tags !== undefined) { fields.push(`tags = $${i++}`); values.push(patch.tags); }

  if (fields.length === 0) return lookupShortLinkDb(slug);

  fields.push(`updated_at = NOW()`);
  values.push(slug.toLowerCase().trim());

  const r = await pool.query(
    `UPDATE short_links SET ${fields.join(', ')} WHERE slug = $${i} RETURNING *`,
    values,
  );
  if (r.rows.length === 0) return null;
  return rowToLink(r.rows[0] as Record<string, unknown>);
}

export async function deleteShortLinkDb(slug: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM short_links WHERE slug = $1`, [slug.toLowerCase().trim()]);
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Click tracking — fire-and-forget from /s/:slug handler
// ---------------------------------------------------------------------------
export async function incrementClickCount(slug: string): Promise<void> {
  await pool.query(
    `UPDATE short_links SET click_count = click_count + 1, last_clicked_at = NOW() WHERE slug = $1`,
    [slug.toLowerCase().trim()],
  ).catch(e => logger.warn(`[short-links] click increment failed for ${slug}: ${e instanceof Error ? e.message : String(e)}`));
}
