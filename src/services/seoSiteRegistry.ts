/**
 * seo_sites registry (migration 0046) — the tenant-isolation boundary for the
 * multi-site SEO module.
 *
 * Every SEO table pre-0046 keys on the *string* `project_name`/`client_domain`.
 * That worked while SEO was single-tenant with three hand-maintained domains
 * hardcoded across the codebase. It breaks the moment a reseller tenant
 * registers a client site that legitimately shares a domain string with
 * another tenant's — a string key cannot tell them apart, a `site_id` FK can.
 *
 * EVERY query in this file binds tenant_id. That is not a style preference —
 * it is the entire point of this module. A query here without a tenant_id
 * predicate is the cross-tenant leak this registry exists to prevent.
 *
 * `adapter_config` is NON-SECRET config only (site URL, theme snippet, etc).
 * Per AGENTS.md credential hygiene ("never store passwords, API keys, access
 * tokens... in source files... or other sensitive values"), any credential
 * belongs in `tenant_integrations`, encrypted, referenced here only by the
 * `credential_provider` pointer. `assertNoSecretKeys` below is the guard that
 * keeps a caller from smuggling a real secret into this plaintext jsonb column.
 */

import { pool } from '../db/index';
import logger from '../utils/logger';

export interface SeoSite {
  id: string;
  tenantId: string;
  clientId: string | null;
  label: string;
  domain: string;
  platform: string;
  adapterConfig: Record<string, unknown>;
  credentialProvider: string | null;
  gscProperty: string | null;
  ga4PropertyId: string | null;
  riskProfile: string;
  requiredChecks: string[];
  autoPublishAllowed: boolean;
  observationWindowDays: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSeoSiteInput {
  label: string;
  /** Raw domain/URL/GSC property string — normalised via `normaliseDomain` before storage. */
  domain: string;
  clientId?: string | null;
  /** 'git' | 'wordpress' | 'shopify' | 'unknown'. Not enum-validated here — the route owns that. */
  platform?: string;
  /** NON-SECRET adapter config only. See module doc. */
  adapterConfig?: Record<string, unknown>;
  credentialProvider?: string | null;
  gscProperty?: string | null;
  ga4PropertyId?: string | null;
  /** 'low' | 'standard' | 'high'. Not enum-validated here — the route owns that. */
  riskProfile?: string;
  requiredChecks?: string[];
  autoPublishAllowed?: boolean;
  observationWindowDays?: number;
  /** 'active' | 'paused' | 'archived'. Defaults to 'active'; archival should normally go through `archiveSeoSite`. */
  status?: string;
}

export type UpdateSeoSiteInput = Partial<CreateSeoSiteInput>;

// ---------------------------------------------------------------------------
// Typed error — the route layer turns this into an HTTP response using
// `status`/`code`; never let a raw pg error (or a value out of adapter_config)
// reach the client. Mirrors StaffingDomainError's (status, code, message)
// shape (src/services/wizmatchStaffingDomain.ts), the closest existing
// convention in this codebase for a service-level typed HTTP error.
// ---------------------------------------------------------------------------
export class SeoSiteRegistryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SeoSiteRegistryError';
    this.status = status;
    this.code = code;
  }
}

const SITE_COLUMNS = [
  'id', 'tenant_id', 'client_id', 'label', 'domain', 'platform', 'adapter_config',
  'credential_provider', 'gsc_property', 'ga4_property_id', 'risk_profile',
  'required_checks', 'auto_publish_allowed', 'observation_window_days', 'status',
  'created_at', 'updated_at',
].join(', ');

function rowToSeoSite(row: Record<string, unknown>): SeoSite {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    clientId: (row.client_id as string | null) ?? null,
    label: row.label as string,
    domain: row.domain as string,
    platform: row.platform as string,
    adapterConfig: (row.adapter_config as Record<string, unknown> | null) ?? {},
    credentialProvider: (row.credential_provider as string | null) ?? null,
    gscProperty: (row.gsc_property as string | null) ?? null,
    ga4PropertyId: (row.ga4_property_id as string | null) ?? null,
    riskProfile: row.risk_profile as string,
    requiredChecks: (row.required_checks as string[] | null) ?? [],
    autoPublishAllowed: Boolean(row.auto_publish_allowed),
    observationWindowDays: Number(row.observation_window_days),
    status: row.status as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

// ---------------------------------------------------------------------------
// normaliseDomain — MUST match migration 0046's SQL exactly, or the seed/
// backfill in that migration and every write this service makes disagree
// about what a domain is:
//
//   regexp_replace(regexp_replace(split_part(regexp_replace(lower(btrim(v)),
//     '^[a-z][a-z0-9+.-]*:(//)?', ''), '/', 1), '^www\.', ''), '\.$', '')
//
// i.e. lowercase -> trim -> strip scheme (this also strips GSC's non-URL
// `sc-domain:` prefix, since the scheme regex doesn't require `//`) -> take
// everything before the first '/' -> strip a leading 'www.' -> strip a
// trailing dot.
// ---------------------------------------------------------------------------
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:(\/\/)?/;
const WWW_RE = /^www\./;
const TRAILING_DOT_RE = /\.$/;

export function normaliseDomain(raw: string): string {
  const lowered = (raw ?? '').toLowerCase().trim();
  const noScheme = lowered.replace(SCHEME_RE, '');
  const beforeFirstSlash = noScheme.split('/')[0] ?? '';
  const noWww = beforeFirstSlash.replace(WWW_RE, '');
  const domain = noWww.replace(TRAILING_DOT_RE, '');
  // A result that's empty or has no dot is a project name ("blackpanda"), not
  // a domain — reject rather than silently registering junk. Matches
  // migration 0046 step 3's seed filter (`d.domain <> '' AND d.domain LIKE '%.%'`).
  if (!domain || !domain.includes('.')) {
    throw new SeoSiteRegistryError(
      400,
      'invalid_domain',
      `"${raw}" does not normalise to a registrable domain — looks like a project name, not a domain`,
    );
  }
  return domain;
}

// Non-secret guard for adapter_config — see module doc. Only key NAMES are
// ever included in the thrown error, never the values, per AGENTS.md
// credential hygiene ("never store... in error logs").
const SECRET_KEY_RE = /pass|secret|token|key|credential|auth/i;

function assertNoSecretKeys(adapterConfig: Record<string, unknown> | undefined): void {
  if (!adapterConfig) return;
  const offending = Object.keys(adapterConfig).filter((k) => SECRET_KEY_RE.test(k));
  if (offending.length > 0) {
    throw new SeoSiteRegistryError(
      400,
      'adapter_config_secret_rejected',
      `adapterConfig must not contain secret-shaped keys: ${offending.join(', ')}. Credentials belong in tenant_integrations, encrypted.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List sites for a tenant. Defaults to `status <> 'archived'`
 * (active + paused); `includeInactive: true` returns everything, archived included.
 */
export async function listSeoSites(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<SeoSite[]> {
  const statusFilter = opts.includeInactive ? '' : `AND status <> 'archived'`;
  const { rows } = await pool.query(
    `SELECT ${SITE_COLUMNS} FROM seo_sites WHERE tenant_id = $1 ${statusFilter} ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows.map(rowToSeoSite);
}

/** Bare domain strings for this tenant's `status = 'active'` sites, alphabetical. */
export async function listSeoSiteDomains(tenantId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT domain FROM seo_sites WHERE tenant_id = $1 AND status = 'active' ORDER BY domain`,
    [tenantId],
  );
  return rows.map((r) => r.domain as string);
}

/**
 * Single site by id, tenant-scoped. Takes tenantId precisely so that an id
 * belonging to another tenant returns null rather than that tenant's row —
 * the WHERE clause enforces ownership, not a check performed after the load.
 */
export async function getSeoSiteById(tenantId: string, id: string): Promise<SeoSite | null> {
  const { rows } = await pool.query(
    `SELECT ${SITE_COLUMNS} FROM seo_sites WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id],
  );
  return rows[0] ? rowToSeoSite(rows[0]) : null;
}

/** Single site by domain, tenant-scoped. `domain` is normalised before lookup. */
export async function getSeoSiteByDomain(tenantId: string, domain: string): Promise<SeoSite | null> {
  const normalised = normaliseDomain(domain);
  const { rows } = await pool.query(
    `SELECT ${SITE_COLUMNS} FROM seo_sites WHERE tenant_id = $1 AND domain = $2 LIMIT 1`,
    [tenantId, normalised],
  );
  return rows[0] ? rowToSeoSite(rows[0]) : null;
}

/** Count of this tenant's non-archived sites — what a plan's `limits.seoSites` counts against. */
export async function countSeoSites(tenantId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM seo_sites WHERE tenant_id = $1 AND status <> 'archived'`,
    [tenantId],
  );
  return Number(rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create a site. Normalises `domain`, rejects secret-shaped `adapterConfig`
 * keys, and turns a unique-violation (tenant_id, domain already registered)
 * into a typed 409 rather than letting the raw pg error reach the caller.
 */
export async function createSeoSite(tenantId: string, input: CreateSeoSiteInput): Promise<SeoSite> {
  const label = (input.label ?? '').trim();
  if (!label) throw new SeoSiteRegistryError(400, 'validation_error', 'label is required');
  const domain = normaliseDomain(input.domain);
  assertNoSecretKeys(input.adapterConfig);

  const platform = input.platform ?? 'unknown';
  const adapterConfig = input.adapterConfig ?? {};
  const riskProfile = input.riskProfile ?? 'standard';
  const requiredChecks = input.requiredChecks ?? [];
  const autoPublishAllowed = input.autoPublishAllowed ?? false;
  const observationWindowDays = input.observationWindowDays ?? 21;
  const status = input.status ?? 'active';

  try {
    const { rows } = await pool.query(
      `INSERT INTO seo_sites
         (tenant_id, client_id, label, domain, platform, adapter_config, credential_provider,
          gsc_property, ga4_property_id, risk_profile, required_checks, auto_publish_allowed,
          observation_window_days, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::text[], $12, $13, $14)
       RETURNING ${SITE_COLUMNS}`,
      [
        tenantId,
        input.clientId ?? null,
        label,
        domain,
        platform,
        JSON.stringify(adapterConfig),
        input.credentialProvider ?? null,
        input.gscProperty ?? null,
        input.ga4PropertyId ?? null,
        riskProfile,
        requiredChecks,
        autoPublishAllowed,
        observationWindowDays,
        status,
      ],
    );
    return rowToSeoSite(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === '23505') {
      throw new SeoSiteRegistryError(
        409,
        'seo_site_domain_conflict',
        `A site for domain "${domain}" is already registered for this tenant`,
      );
    }
    // Never include adapterConfig (or any of its values) here — key names only, never logged.
    logger.error('[seoSiteRegistry] createSeoSite failed', {
      tenantId, domain, error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Partial update, tenant-scoped. Returns null if the id doesn't belong to
 * this tenant (no such row matched the WHERE clause) rather than throwing.
 * Same 23505 -> 409 translation as createSeoSite (a PATCH can change domain
 * into one this tenant already has registered).
 */
export async function updateSeoSite(tenantId: string, id: string, patch: UpdateSeoSiteInput): Promise<SeoSite | null> {
  if (patch.adapterConfig !== undefined) assertNoSecretKeys(patch.adapterConfig);

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const set = (column: string, value: unknown, cast?: string): void => {
    sets.push(`${column} = $${i}${cast ? `::${cast}` : ''}`);
    values.push(value);
    i += 1;
  };

  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) throw new SeoSiteRegistryError(400, 'validation_error', 'label cannot be empty');
    set('label', label);
  }
  if (patch.domain !== undefined) set('domain', normaliseDomain(patch.domain));
  if (patch.clientId !== undefined) set('client_id', patch.clientId);
  if (patch.platform !== undefined) set('platform', patch.platform);
  if (patch.adapterConfig !== undefined) set('adapter_config', JSON.stringify(patch.adapterConfig), 'jsonb');
  if (patch.credentialProvider !== undefined) set('credential_provider', patch.credentialProvider);
  if (patch.gscProperty !== undefined) set('gsc_property', patch.gscProperty);
  if (patch.ga4PropertyId !== undefined) set('ga4_property_id', patch.ga4PropertyId);
  if (patch.riskProfile !== undefined) set('risk_profile', patch.riskProfile);
  if (patch.requiredChecks !== undefined) set('required_checks', patch.requiredChecks, 'text[]');
  if (patch.autoPublishAllowed !== undefined) set('auto_publish_allowed', patch.autoPublishAllowed);
  if (patch.observationWindowDays !== undefined) set('observation_window_days', patch.observationWindowDays);
  if (patch.status !== undefined) set('status', patch.status);

  if (sets.length === 0) {
    return getSeoSiteById(tenantId, id);
  }
  sets.push('updated_at = now()');

  const tenantParam = i;
  const idParam = i + 1;
  values.push(tenantId, id);

  try {
    const { rows } = await pool.query(
      `UPDATE seo_sites SET ${sets.join(', ')}
       WHERE tenant_id = $${tenantParam} AND id = $${idParam}
       RETURNING ${SITE_COLUMNS}`,
      values,
    );
    return rows[0] ? rowToSeoSite(rows[0]) : null;
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === '23505') {
      throw new SeoSiteRegistryError(
        409,
        'seo_site_domain_conflict',
        'Another site for this tenant already uses that domain',
      );
    }
    logger.error('[seoSiteRegistry] updateSeoSite failed', {
      tenantId, id, error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Archive (soft-delete), tenant-scoped. Sets status='archived' — never a
 * DELETE. Nine tables (backlink_data, client_knowledge_base, client_pages,
 * keyword_rankings, seo_alerts_log, seo_content_calendar, seo_opportunities,
 * seo_weekly_metrics, site_health_metrics) carry an FK pointing at seo_sites.id;
 * a DELETE would either fail on the FK or (were the FK ever relaxed) orphan
 * years of data. Returns whether a row was actually archived.
 */
export async function archiveSeoSite(tenantId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE seo_sites SET status = 'archived', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return (rowCount ?? 0) > 0;
}
