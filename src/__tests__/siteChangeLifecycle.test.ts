// Phase 3's stated exit criterion: propose → stage → verify → awaiting_approval
// green on ALL THREE real platform adapters.
//
// The per-provider suites prove each adapter in isolation and
// siteChangeService.test.ts proves the state machine in isolation. Neither
// proves they fit together — that the service persists what the adapter
// actually returned, that a capability the adapter lacks does not end up in a
// column the approval UI branches on, and that a blocking verification issue
// stops the change short of the queue rather than landing in it.
//
// The whole lifecycle here is driven by ONE caller with no branch on
// `identity.name` anywhere. Only `capabilities` differs between the three runs
// — that is the ADR-007 seam, exercised against real adapters rather than the
// mock.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('../services/seoSiteRegistry', () => ({
  getSeoSiteById: vi.fn(),
}));

import { pool } from '../db/index';
import { getSeoSiteById, type SeoSite } from '../services/seoSiteRegistry';
import { GitSiteProvider, ShopifySiteProvider, WordPressSiteProvider, resetSiteProvider, setSiteProvider } from '../modules/site/providers';
import type { SitePlatform } from '../modules/site/providers/site-provider.interface';
import {
  createSiteChange,
  stageSiteChange,
  verifySiteChange,
} from '../services/siteChangeService';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SITE = '22222222-2222-2222-2222-222222222222';
const USER = '44444444-4444-4444-4444-444444444444';
const PAGE = 'https://example.com/about-us';

// ---------------------------------------------------------------------------
// an in-memory site_changes table
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function newRow(params: unknown[]): Row {
  const [tenantId, siteId, changeKind, pageUrl, payloadJson, source, createdBy] = params;
  return {
    id: `change-${Math.abs(String(pageUrl).length)}-${String(changeKind)}`,
    tenant_id: tenantId,
    site_id: siteId,
    change_kind: changeKind,
    page_url: pageUrl,
    status: 'proposed',
    version: 1,
    payload: JSON.parse(String(payloadJson)),
    staged_ref: null,
    preview_url: null,
    diff: null,
    staged_at: null,
    verify_passed: null,
    verify_issues: [],
    verified_at: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    decision_reason: null,
    publish_request_id: null,
    published_at: null,
    live_url: null,
    external_ref: null,
    publish_result: null,
    last_error: null,
    last_error_at: null,
    verified_live_at: null,
    superseded_by_change_id: null,
    source,
    created_by: createdBy,
    created_at: new Date('2026-08-05T08:00:00Z'),
    updated_at: new Date('2026-08-05T08:00:00Z'),
  };
}

function installFakeTable() {
  const rows = new Map<string, Row>();

  const applyUpdate = (sql: string, params: unknown[]): Row | undefined => {
    const id = String(params[1]);
    const row = rows.get(id);
    if (!row) return undefined;
    const setClause = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
    for (const assignment of setClause.split(',').map((s) => s.trim())) {
      const match = /^([a-z_]+)\s*=\s*\$(\d+)$/.exec(assignment);
      if (match) {
        const raw = params[Number(match[2]) - 1];
        // jsonb columns arrive pre-stringified from the service.
        row[match[1]] =
          (match[1] === 'verify_issues' || match[1] === 'publish_result') && typeof raw === 'string'
            ? JSON.parse(raw)
            : raw;
      } else if (/^version\s*=\s*version \+ 1$/.test(assignment)) {
        row.version = Number(row.version) + 1;
      }
    }
    return row;
  };

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 };
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }], rowCount: 1 };

    if (sql.trimStart().startsWith('INSERT INTO site_changes')) {
      const row = newRow(params);
      rows.set(String(row.id), row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.includes("SET\n          status = 'superseded'") || sql.includes("status = 'superseded'")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.trimStart().startsWith('UPDATE site_changes')) {
      const row = applyUpdate(sql, params);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('FROM site_changes')) {
      const row = rows.get(String(params[1]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  const client = { query, release: vi.fn() };
  vi.mocked(pool.connect).mockResolvedValue(client as never);
  vi.mocked(pool.query).mockImplementation(query as never);
  return { rows };
}

function site(platform: SitePlatform, adapterConfig: Record<string, unknown>): SeoSite {
  return {
    id: SITE,
    tenantId: TENANT,
    clientId: null,
    label: 'Example',
    domain: 'example.com',
    platform,
    adapterConfig,
    credentialProvider: platform,
    gscProperty: null,
    ga4PropertyId: null,
    riskProfile: 'standard',
    requiredChecks: [],
    autoPublishAllowed: false,
    observationWindowDays: 21,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const GOOD_PAYLOAD = {
  pageUrl: PAGE,
  isNewPage: true,
  title: 'About us',
  metaTitle: 'About us | Example',
  metaDescription: 'Who we are and what we build, in a sentence long enough to be plausible.',
  bodyHtml: '<p>About us.</p>',
};

describe('propose → stage → verify → awaiting_approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSiteProvider();
  });

  it('works end to end on a git site, and records the diff but no preview url', async () => {
    installFakeTable();
    vi.mocked(getSeoSiteById).mockResolvedValue(site('git', { repo: 'org/site', branch: 'main' }));
    // A git site has no remote draft to fetch, but the adapter reads the live
    // page to build a real before/after diff.
    const fetchImpl = vi.fn(async () =>
      new Response('<title>Old title</title><h1>Old</h1>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    setSiteProvider('git', new GitSiteProvider(fetchImpl as unknown as typeof fetch));

    const proposed = await createSiteChange(TENANT, {
      siteId: SITE,
      changeKind: 'page_create',
      payload: GOOD_PAYLOAD,
      createdBy: USER,
    });
    expect(proposed.status).toBe('proposed');

    const staged = await stageSiteChange(TENANT, proposed.id);
    expect(staged.status).toBe('staged');
    expect(staged.stagedRef).toBeTruthy();
    // producesReviewableDiff: true, stagesRemoteDraft: false — the service must
    // persist exactly that split, whatever the adapter happens to return.
    expect(staged.diff).toContain('+++');
    expect(staged.previewUrl).toBeNull();

    const verified = await verifySiteChange(TENANT, proposed.id);
    expect(verified.status).toBe('awaiting_approval');
    expect(verified.verifyPassed).toBe(true);
    // Still unapproved — reaching the queue is not approval.
    expect(verified.approvedBy).toBeNull();
    expect(verified.approvedAt).toBeNull();
  });

  it('works end to end on a WordPress site, and records the preview url but no diff', async () => {
    installFakeTable();
    vi.mocked(getSeoSiteById).mockResolvedValue(site('wordpress', { baseUrl: 'https://example.com' }));
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      init?.method === 'POST'
        ? jsonResponse(201, { id: 42, status: 'draft', link: 'https://example.com/about-us/', slug: 'about-us' })
        : jsonResponse(200, { id: 42, status: 'draft', link: 'https://example.com/about-us/', slug: 'about-us' }),
    );
    setSiteProvider(
      'wordpress',
      new WordPressSiteProvider({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadCredentials: (async () => ({ username: 'svc', applicationPassword: 'x' })) as never,
      }),
    );

    const proposed = await createSiteChange(TENANT, {
      siteId: SITE,
      changeKind: 'page_create',
      payload: GOOD_PAYLOAD,
      createdBy: USER,
    });
    const staged = await stageSiteChange(TENANT, proposed.id);
    expect(staged.status).toBe('staged');
    expect(staged.stagedRef).toBe('42');
    // stagesRemoteDraft: true, producesReviewableDiff: false.
    expect(staged.previewUrl).toBeTruthy();
    expect(staged.diff).toBeNull();

    const verified = await verifySiteChange(TENANT, proposed.id);
    expect(verified.status).toBe('awaiting_approval');
    expect(verified.verifyPassed).toBe(true);
    // A platform that cannot verify offline must say so rather than imply a
    // clean check happened.
    expect(verified.verifyIssues.some((i) => i.code === 'no_offline_verification')).toBe(true);
    expect(verified.approvedBy).toBeNull();
  });

  it('works end to end on a Shopify site', async () => {
    installFakeTable();
    vi.mocked(getSeoSiteById).mockResolvedValue(site('shopify', { themeSnippetInstalled: true }));
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      jsonResponse(init?.method === 'POST' ? 201 : 200, {
        page: { id: 111, handle: 'about-us', published_at: null },
      }),
    );
    setSiteProvider(
      'shopify',
      new ShopifySiteProvider({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadCredentials: async () => ({ shop: 'example.myshopify.com', accessToken: 'x' }),
      }),
    );

    const proposed = await createSiteChange(TENANT, {
      siteId: SITE,
      changeKind: 'page_create',
      payload: GOOD_PAYLOAD,
      createdBy: USER,
    });
    const staged = await stageSiteChange(TENANT, proposed.id);
    expect(staged.status).toBe('staged');
    expect(staged.stagedRef).toBe('111');
    expect(staged.previewUrl).toBeTruthy();
    expect(staged.diff).toBeNull();

    const verified = await verifySiteChange(TENANT, proposed.id);
    expect(verified.status).toBe('awaiting_approval');
    expect(verified.verifyPassed).toBe(true);
    expect(verified.approvedBy).toBeNull();
  });

  it('stops a change with a blocking verification issue short of the approval queue', async () => {
    installFakeTable();
    vi.mocked(getSeoSiteById).mockResolvedValue(site('git', { repo: 'org/site', branch: 'main' }));
    const fetchImpl = vi.fn(async () => new Response('', { status: 200, headers: { 'content-type': 'text/html' } }));
    setSiteProvider('git', new GitSiteProvider(fetchImpl as unknown as typeof fetch));

    const proposed = await createSiteChange(TENANT, {
      siteId: SITE,
      changeKind: 'page_create',
      payload: {
        ...GOOD_PAYLOAD,
        // Off-domain canonical: a blocking issue on a platform that CAN check
        // it offline. An operator must never be asked to approve this.
        canonicalUrl: 'https://not-our-site.invalid/about-us',
      },
      createdBy: USER,
    });
    await stageSiteChange(TENANT, proposed.id);
    const verified = await verifySiteChange(TENANT, proposed.id);

    expect(verified.status).toBe('verification_failed');
    expect(verified.verifyPassed).toBe(false);
    // Assert the SPECIFIC issue, not merely "something blocking" — otherwise
    // an unrelated blocking check firing for an unrelated reason would keep
    // this test green while the canonical check silently stopped working.
    expect(verified.verifyIssues).toContainEqual(
      expect.objectContaining({ severity: 'blocking', code: 'canonical_off_domain' }),
    );
  });

  it('refuses to stage onto a site whose platform is still "unknown"', async () => {
    installFakeTable();
    // seo_sites.platform defaults to 'unknown' — a site can be registered for
    // reporting long before anyone decides how it publishes. Staging a change
    // onto it must fail loudly rather than pick an adapter.
    vi.mocked(getSeoSiteById).mockResolvedValue(site('unknown' as SitePlatform, {}));

    const proposed = await createSiteChange(TENANT, {
      siteId: SITE,
      changeKind: 'page_update',
      payload: GOOD_PAYLOAD,
      createdBy: USER,
    });
    await expect(stageSiteChange(TENANT, proposed.id)).rejects.toMatchObject({
      code: 'unsupported_platform',
    });
  });
});
