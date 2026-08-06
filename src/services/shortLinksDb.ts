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
 *
 * [NEEDS HUMAN SIGN-OFF — schema-adjacent change, see PR description]
 * `slug` used to be the table's global PRIMARY KEY — a namespace shared
 * across every tenant, so a reseller tenant could overwrite or delete
 * another tenant's short link by reusing the same slug via the admin CRUD
 * API (src/routes/links.ts). ensureShortLinksTable() below now backfills a
 * `tenant_id` column (defaulting every pre-existing row to GE's own
 * tenant — the only tenant this feature has ever served) and replaces the
 * global PK with a composite (tenant_id, slug) PK, and every function in
 * this file is now tenant-scoped accordingly.
 *
 * KNOWN LIMITATION this does NOT solve (flagged for human review, not
 * silently ignored): the PUBLIC redirect (src/routes/shortLinks.ts,
 * GET /s/:slug and the links.growthescalators.com host handler) has no
 * tenant context to scope by — a bare "/abc" request carries no signal
 * about which tenant's "abc" is meant. `lookupShortLinkDbAnyTenant()`
 * below preserves today's behaviour (resolve by slug alone, first match)
 * for that one caller. If/when a reseller tenant is given its own
 * short-link surface, slug collisions across tenants need a real product
 * decision (per-tenant subdomain, or a documented shared namespace) before
 * this table can be considered fully multi-tenant-safe end-to-end.
 */

import { pool } from '../db/index';
import logger from '../utils/logger';
import { SEED_SHORT_LINKS } from '../config/shortLinks';
import { DEFAULT_TENANT_SLUG } from '../config/constants';

export interface ShortLinkRow {
  slug: string;
  tenantId: string;
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
    // tenant_id is added as a nullable column here (not NOT NULL directly)
    // so this same CREATE statement is safe on both a brand-new install and
    // an existing one — the backfill + constraint-tightening steps below
    // run uniformly for both cases instead of branching on "is this fresh".
    await pool.query(`
      CREATE TABLE IF NOT EXISTS short_links (
        slug TEXT NOT NULL,
        destination TEXT NOT NULL,
        description TEXT,
        tags TEXT[] DEFAULT '{}',
        created_by_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        click_count INTEGER DEFAULT 0,
        last_clicked_at TIMESTAMP,
        tenant_id UUID REFERENCES tenants(id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS short_links_created_idx ON short_links(created_at DESC)`);
    await pool.query(`ALTER TABLE short_links ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS short_links_tenant_idx ON short_links(tenant_id)`);

    // --- tenant_id backfill + composite-key migration (2026-08 hardening) ---
    const geTenant = await pool.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [DEFAULT_TENANT_SLUG]);
    const geTenantId = (geTenant.rows[0] as { id?: string } | undefined)?.id ?? null;

    if (geTenantId) {
      await pool.query(`UPDATE short_links SET tenant_id = $1 WHERE tenant_id IS NULL`, [geTenantId]);
    } else {
      logger.warn(
        `[short-links] could not resolve default tenant "${DEFAULT_TENANT_SLUG}" — ` +
        `any row left with NULL tenant_id will block the NOT NULL constraint below until this resolves`,
      );
    }

    const remainingNulls = await pool.query(`SELECT COUNT(*)::int AS c FROM short_links WHERE tenant_id IS NULL`);
    const nullCount = (remainingNulls.rows[0] as { c: number } | undefined)?.c ?? 0;

    if (nullCount === 0) {
      await pool.query(`ALTER TABLE short_links ALTER COLUMN tenant_id SET NOT NULL`).catch((e) => {
        logger.warn(`[short-links] SET NOT NULL on tenant_id failed (will retry next boot): ${e instanceof Error ? e.message : String(e)}`);
      });

      // Swap the global slug-only PK for a composite (tenant_id, slug) PK.
      // Both statements are safe to re-run: DROP...IF EXISTS is a no-op once
      // already applied, and the ADD CONSTRAINT failure (already exists) is
      // swallowed below the same way the rest of this file's ALTERs are.
      await pool.query(`ALTER TABLE short_links DROP CONSTRAINT IF EXISTS short_links_pkey`).catch(() => {});
      await pool.query(
        `ALTER TABLE short_links ADD CONSTRAINT short_links_tenant_slug_pkey PRIMARY KEY (tenant_id, slug)`,
      ).catch(() => { /* already applied on a previous boot */ });
    } else {
      logger.warn(`[short-links] ${nullCount} row(s) still have NULL tenant_id — skipping NOT NULL/PK tightening this boot`);
    }

    // Seed initial slugs from src/config/shortLinks.ts on first boot, into
    // GE's own tenant (the only tenant this static seed list has ever
    // targeted). ON CONFLICT DO NOTHING — never overwrites a row the user has edited.
    if (SEED_SHORT_LINKS.length > 0 && geTenantId) {
      for (const seed of SEED_SHORT_LINKS) {
        await pool.query(
          `INSERT INTO short_links (tenant_id, slug, destination, description, tags)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, slug) DO NOTHING`,
          [geTenantId, seed.slug, seed.destination, seed.description ?? null, seed.tags ?? []],
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
    tenantId: row.tenant_id as string,
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

export async function lookupShortLinkDb(tenantId: string, slug: string): Promise<ShortLinkRow | null> {
  if (!slug) return null;
  const normalised = slug.toLowerCase().trim();
  const r = await pool.query(`SELECT * FROM short_links WHERE tenant_id = $1 AND slug = $2 LIMIT 1`, [tenantId, normalised]);
  if (r.rows.length === 0) return null;
  return rowToLink(r.rows[0] as Record<string, unknown>);
}

// Tenant-agnostic lookup for the PUBLIC redirect only (src/routes/shortLinks.ts)
// — a bare "/s/:slug" request carries no tenant signal to scope by. See the
// KNOWN LIMITATION note at the top of this file: this preserves today's
// behaviour (GE is currently the only tenant this feature serves) rather
// than silently picking a tenant. Never call this from an authenticated
// admin code path — use lookupShortLinkDb(tenantId, slug) there.
export async function lookupShortLinkDbAnyTenant(slug: string): Promise<ShortLinkRow | null> {
  if (!slug) return null;
  const normalised = slug.toLowerCase().trim();
  const r = await pool.query(`SELECT * FROM short_links WHERE slug = $1 ORDER BY created_at ASC LIMIT 1`, [normalised]);
  if (r.rows.length === 0) return null;
  return rowToLink(r.rows[0] as Record<string, unknown>);
}

export async function listShortLinksDb(tenantId: string): Promise<ShortLinkRow[]> {
  const r = await pool.query(`SELECT * FROM short_links WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
  return (r.rows as Array<Record<string, unknown>>).map(rowToLink);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
export async function createShortLinkDb(opts: {
  tenantId: string;
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
    `INSERT INTO short_links (tenant_id, slug, destination, description, tags, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [opts.tenantId, slug, opts.destination, opts.description ?? null, opts.tags ?? [], opts.createdByUserId ?? null],
  );
  return rowToLink(r.rows[0] as Record<string, unknown>);
}

export async function updateShortLinkDb(tenantId: string, slug: string, patch: {
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

  if (fields.length === 0) return lookupShortLinkDb(tenantId, slug);

  fields.push(`updated_at = NOW()`);
  values.push(tenantId, slug.toLowerCase().trim());

  const r = await pool.query(
    `UPDATE short_links SET ${fields.join(', ')} WHERE tenant_id = $${i} AND slug = $${i + 1} RETURNING *`,
    values,
  );
  if (r.rows.length === 0) return null;
  return rowToLink(r.rows[0] as Record<string, unknown>);
}

export async function deleteShortLinkDb(tenantId: string, slug: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM short_links WHERE tenant_id = $1 AND slug = $2`, [tenantId, slug.toLowerCase().trim()]);
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Click tracking — fire-and-forget from /s/:slug handler. Takes the specific
// tenantId the redirect handler just resolved via lookupShortLinkDbAnyTenant()
// — now that slug is no longer globally unique, a slug-only UPDATE would
// increment click_count on every tenant's row sharing that slug, not just
// the one that was actually visited.
// ---------------------------------------------------------------------------
export async function incrementClickCount(tenantId: string, slug: string): Promise<void> {
  await pool.query(
    `UPDATE short_links SET click_count = click_count + 1, last_clicked_at = NOW() WHERE tenant_id = $1 AND slug = $2`,
    [tenantId, slug.toLowerCase().trim()],
  ).catch(e => logger.warn(`[short-links] click increment failed for ${slug}: ${e instanceof Error ? e.message : String(e)}`));
}
