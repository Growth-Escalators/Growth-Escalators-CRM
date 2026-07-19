import { describe, it, expect, vi, beforeEach } from 'vitest';

// H18 (Fable review) — 10 SEO automation tables (keyword_rankings, backlink_data,
// content_gap_analysis, seo_opportunities, site_health_metrics, brand_mentions,
// client_pages, client_knowledge_base, seo_weekly_metrics, seo_alerts_log) had no
// tenant_id at all. These tests assert every touch-point now filters/stamps on
// the caller's tenant (request-scoped routes) or the resolved default SEO tenant
// (crons/services with no req).
//
// The mocked pool.query / db.execute implementations below are deliberately NOT
// canned per-call responses — they behave like a tiny filtered database, keyed
// off the actual bound tenant_id parameter the code under test passes in. If a
// route/service ever stopped binding tenant_id, these mocks would fall back to
// returning BOTH tenants' rows (simulating the real leak), which would fail the
// "never contains the other tenant's row" assertions below. A row-count-only
// assertion would not catch a broken filter when both tenants have equal counts,
// so every assertion here checks a distinguishing field VALUE instead.

const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'tenant-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

type Row = Record<string, unknown> & { tenant_id: string };

// One row per tenant per table (10 tables x 2 tenants), each with a distinguishing
// marker field unique to that tenant so cross-tenant leaks are unambiguous.
const FIXTURES: Record<string, Record<string, Row[]>> = {
  keyword_rankings: {
    [TENANT_A]: [{ id: 'kr-a', keyword: 'tenantA-exclusive-keyword', client_domain: 'shared.com', current_position: 3, tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'kr-b', keyword: 'tenantB-exclusive-keyword', client_domain: 'shared.com', current_position: 7, tenant_id: TENANT_B }],
  },
  backlink_data: {
    [TENANT_A]: [{ id: 'bl-a', source_url: 'https://tenantA-exclusive-source.example', status: 'active', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'bl-b', source_url: 'https://tenantB-exclusive-source.example', status: 'active', tenant_id: TENANT_B }],
  },
  content_gap_analysis: {
    [TENANT_A]: [{ id: 'cg-a', target_keyword: 'tenantA-exclusive-gap', project_name: 'A', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'cg-b', target_keyword: 'tenantB-exclusive-gap', project_name: 'B', tenant_id: TENANT_B }],
  },
  seo_opportunities: {
    [TENANT_A]: [{ id: 'op-a', description: 'tenantA-exclusive-opportunity', status: 'open', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'op-b', description: 'tenantB-exclusive-opportunity', status: 'open', tenant_id: TENANT_B }],
  },
  site_health_metrics: {
    [TENANT_A]: [{ id: 'sh-a', project_name: 'tenantA-exclusive-site', pagespeed_mobile: 91, tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'sh-b', project_name: 'tenantB-exclusive-site', pagespeed_mobile: 42, tenant_id: TENANT_B }],
  },
  brand_mentions: {
    [TENANT_A]: [{ id: 'bm-a', mention_url: 'https://tenantA-exclusive-mention.example', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'bm-b', mention_url: 'https://tenantB-exclusive-mention.example', tenant_id: TENANT_B }],
  },
  // Highest-risk case: both tenants share the EXACT same client_domain + page_slug —
  // a realistic collision (same programmatic page slug generated for two tenants).
  client_pages: {
    [TENANT_A]: [{ id: 'cp-a', client_domain: 'shared.com', page_slug: 'shared-slug', page_title: 'Tenant A Exclusive Page', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'cp-b', client_domain: 'shared.com', page_slug: 'shared-slug', page_title: 'Tenant B Exclusive Page', tenant_id: TENANT_B }],
  },
  client_knowledge_base: {
    [TENANT_A]: [{ id: 'kb-a', client_domain: 'shared.com', brand_name: 'Tenant A Exclusive Brand', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'kb-b', client_domain: 'shared.com', brand_name: 'Tenant B Exclusive Brand', tenant_id: TENANT_B }],
  },
  seo_weekly_metrics: {
    [TENANT_A]: [{ id: 'wm-a', client_domain: 'shared.com', client_name: 'tenantA-exclusive-weekly', total_clicks: 100, tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'wm-b', client_domain: 'shared.com', client_name: 'tenantB-exclusive-weekly', total_clicks: 200, tenant_id: TENANT_B }],
  },
  seo_alerts_log: {
    [TENANT_A]: [{ id: 'al-a', message: 'tenantA-exclusive-alert', alert_type: 'rank_drop', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'al-b', message: 'tenantB-exclusive-alert', alert_type: 'rank_drop', tenant_id: TENANT_B }],
  },
};

// Simulates a filtered database read: finds which of the 10 tables the SQL
// text references, then returns only the fixture rows for whichever tenant_id
// appears among the bound params. If NO known tenant_id is bound at all, it
// returns the union of every tenant's rows for that table — i.e. exactly what
// an unscoped (broken) query would actually leak.
function fakeFilteredRead(sqlText: string, params: unknown[]): { rows: Row[] } {
  const table = Object.keys(FIXTURES).find((t) => sqlText.includes(t));
  if (!table) return { rows: [] };
  const matchedTenant = [TENANT_A, TENANT_B].find((t) => params.includes(t));
  if (!matchedTenant) return { rows: Object.values(FIXTURES[table]).flat() };
  return { rows: FIXTURES[table][matchedTenant] ?? [] };
}

// drizzle-orm's `sql\`...\`` tagged template exposes its interpolated values and
// text segments via the public `queryChunks` array (alternating text-chunk
// objects `{ value: string[] }` and raw bound values). This reconstructs both
// the flattened SQL text and the ordered bound params from that array so the
// same fakeFilteredRead() logic above can drive db.execute(...) mocks too.
function extractFromDrizzleSql(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  let text = '';
  const params: unknown[] = [];
  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && 'value' in (chunk as Record<string, unknown>)) {
      text += (chunk as { value: string[] }).value.join('');
    } else {
      params.push(chunk);
    }
  }
  return { text, params };
}

const mockPoolQuery = vi.fn();
const mockDbExecute = vi.fn();
const mockResolveTenant = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
  db: { execute: (...args: unknown[]) => mockDbExecute(...args), select: vi.fn() },
}));

vi.mock('../services/seoTenantContext', () => ({
  resolveDefaultSeoTenantId: (...args: unknown[]) => mockResolveTenant(...args),
}));

vi.mock('../services/slackService', () => ({
  sendSlackMessage: vi.fn().mockResolvedValue(undefined),
  sendSlackDM: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../config/constants', () => ({
  SLACK_SEO_CHANNEL: 'C_SEO_TEST',
  DEFAULT_TENANT_SLUG: 'growth-escalators',
}));

function invokeRouteHandler(router: any, path: string, method: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

function reqAs(tenantId: string, overrides: Record<string, unknown> = {}) {
  return { user: { tenantId, id: 'user-1', role: 'admin' }, params: {}, query: {}, body: {}, ...overrides };
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockDbExecute.mockReset();
  mockResolveTenant.mockReset();

  mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) =>
    fakeFilteredRead(sqlText, params),
  );
  mockDbExecute.mockImplementation(async (query: unknown) => {
    const { text, params } = extractFromDrizzleSql(query);
    return fakeFilteredRead(text, params);
  });
});

// Note: seoTenantContext.resolveDefaultSeoTenantId()'s REAL implementation
// (the db.select().from(tenants) chain + memoization + not-found error) is
// covered separately in seoTenantContext.test.ts — testing the real
// implementation needs vi.resetModules()/vi.doMock(), which corrupts the
// persistent top-level mocks the rest of this file's tests depend on if run
// in the same file.

// ---------------------------------------------------------------------------
// Request-scoped routes (src/routes/seo.ts) — behind requireAuth, req.user
// available. Each test asserts the response contains ONLY the calling
// tenant's distinguishing value.
// ---------------------------------------------------------------------------
describe('routes/seo.ts — tenant isolation', () => {
  it('GET /pages (client_pages) returns only the caller tenant\'s page, even with an identical client_domain+page_slug collision on the other tenant', async () => {
    const seoRouter = (await import('../routes/seo')).default;
    const handler = invokeRouteHandler(seoRouter, '/pages', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A), res);

    const titles = (res.body.pages as Row[]).map((p) => p.page_title);
    expect(titles).toContain('Tenant A Exclusive Page');
    expect(titles).not.toContain('Tenant B Exclusive Page');
  });

  it('GET /client/:domain (seo_opportunities, keyword_rankings, site_health_metrics, seo_alerts_log, content_gap_analysis, backlink_data, seo_weekly_metrics) scopes every sub-query to the caller tenant', async () => {
    const seoRouter = (await import('../routes/seo')).default;
    const handler = invokeRouteHandler(seoRouter, '/client/:domain', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B, { params: { domain: 'shared.com' } }), res);

    expect((res.body.opportunities as Row[]).map((o) => o.description)).toEqual(['tenantB-exclusive-opportunity']);
    expect((res.body.keywords as Row[]).map((k) => k.keyword)).toEqual(['tenantB-exclusive-keyword']);
    expect((res.body.alerts as Row[]).map((a) => a.message)).toEqual(['tenantB-exclusive-alert']);
    expect((res.body.content as Row[]).map((c) => c.target_keyword)).toEqual(['tenantB-exclusive-gap']);
    expect(res.body.health.project_name).toBe('tenantB-exclusive-site');
    expect((res.body.weekly as Row[]).map((w) => w.client_name)).toEqual(['tenantB-exclusive-weekly']);
  });

  it('GET /keywords-all (keyword_rankings) never leaks the other tenant\'s keyword', async () => {
    const seoRouter = (await import('../routes/seo')).default;
    const handler = invokeRouteHandler(seoRouter, '/keywords-all', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A), res);

    const keywords = (res.body.keywords as Row[]).map((k) => k.keyword);
    expect(keywords).toEqual(['tenantA-exclusive-keyword']);
  });

  it('GET /backlinks (backlink_data) never leaks the other tenant\'s backlink', async () => {
    const seoRouter = (await import('../routes/seo')).default;
    const handler = invokeRouteHandler(seoRouter, '/backlinks', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B), res);

    const sources = (res.body.backlinks as Row[]).map((b) => b.source_url);
    expect(sources).toEqual(['https://tenantB-exclusive-source.example']);
  });

  it('GET /content-gaps (content_gap_analysis) never leaks the other tenant\'s gap', async () => {
    const seoRouter = (await import('../routes/seo')).default;
    const handler = invokeRouteHandler(seoRouter, '/content-gaps', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A), res);

    const gaps = (res.body.gaps as Row[]).map((g) => g.target_keyword);
    expect(gaps).toEqual(['tenantA-exclusive-gap']);
  });

  it('GET /alerts (seo_alerts_log) never leaks the other tenant\'s alert', async () => {
    const seoRouter = (await import('../routes/seo')).default;
    const handler = invokeRouteHandler(seoRouter, '/alerts', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B), res);

    const messages = (res.body.alerts as Row[]).map((a) => a.message);
    expect(messages).toEqual(['tenantB-exclusive-alert']);
  });

  it('POST /regenerate-pages scopes its raw DELETE to the resolved default SEO tenant, not an arbitrary caller tenant', async () => {
    mockResolveTenant.mockResolvedValue(TENANT_A);
    vi.doMock('../services/programmaticSeoService', () => ({
      generateLocationPages: vi.fn().mockResolvedValue({ generated: 0, wpPublished: 0, errors: 0 }),
    }));
    const seoRouter = (await import('../routes/seo')).default;
    const handler = invokeRouteHandler(seoRouter, '/regenerate-pages', 'post');
    const res = mockRes();
    await handler(reqAs(TENANT_A), res);

    const deleteCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes('DELETE FROM client_pages'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual([TENANT_A]);
  });
});

// ---------------------------------------------------------------------------
// src/routes/systemHealth.ts — GET /health/seo-data has NO auth (out of scope
// to fix per H18); it must fall back to the resolved default SEO tenant.
// ---------------------------------------------------------------------------
describe('routes/systemHealth.ts — unauthenticated seo-data diagnostic', () => {
  it('GET /health/seo-data scopes every table count/latest query to the resolved default SEO tenant', async () => {
    mockResolveTenant.mockResolvedValue(TENANT_A);
    vi.doMock('../services/seoWorkflowHealthService', () => ({
      ensureSeoTables: vi.fn().mockResolvedValue(undefined),
    }));
    const systemHealthRouter = (await import('../routes/systemHealth')).default;
    const handler = invokeRouteHandler(systemHealthRouter, '/health/seo-data', 'get');
    const res = mockRes();
    await handler({} as any, res);

    // Every pool.query call made by this route must carry the resolved tenant id.
    const seoDataCalls = mockPoolQuery.mock.calls.filter((c) => /SELECT (COUNT|MAX)/.test(String(c[0])));
    expect(seoDataCalls.length).toBeGreaterThan(0);
    for (const call of seoDataCalls) {
      expect(call[1]).toEqual([TENANT_A]);
    }
  });
});

// ---------------------------------------------------------------------------
// Crons/services with no req — assert the resolved default SEO tenant id
// appears in the bound params of every relevant pool.query call.
// ---------------------------------------------------------------------------
describe('services — cron tenant scoping via resolveDefaultSeoTenantId()', () => {
  it('rankTrackingService.runRankChecks() binds the resolved tenant id on the keyword_rankings INSERT', async () => {
    // The earlier "GET /health/seo-data" test stubbed this whole module via
    // vi.doMock (ensureSeoTables only) — that registration persists until
    // explicitly undone, and rankTrackingService's Serper-cap check dynamically
    // imports this same module, so restore the real implementation first.
    vi.doUnmock('../services/seoWorkflowHealthService');
    mockResolveTenant.mockResolvedValue(TENANT_A);
    process.env.SERPER_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic: [{ position: 4, title: 't', link: 'https://shared.com/p', domain: 'shared.com' }] }),
    }));

    const { runRankChecks } = await import('../services/rankTrackingService');
    await runRankChecks();

    const insertCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO keyword_rankings'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain(TENANT_A);

    vi.unstubAllGlobals();
    delete process.env.SERPER_API_KEY;
  });

  it('seoAlertService.runSeoAlertChecks() binds the resolved tenant id on the seo_alerts_log dedup + insert', async () => {
    mockResolveTenant.mockResolvedValue(TENANT_B);
    // Force past the pre-flight empty-upstream guard.
    mockPoolQuery.mockImplementationOnce(async () => ({ rows: [{ rankings: 1, health: 0, gsc: 0 }] }));

    const { runSeoAlertChecks } = await import('../services/seoAlertService');
    await runSeoAlertChecks();

    const dedupOrInsertCalls = mockPoolQuery.mock.calls.filter((c) => String(c[0]).includes('seo_alerts_log'));
    expect(dedupOrInsertCalls.length).toBeGreaterThan(0);
    for (const call of dedupOrInsertCalls) {
      expect(call[1]).toContain(TENANT_B);
    }
  });

  it('programmaticSeoService.generateLocationPages() (client_pages) stamps tenant_id on the INSERT and scopes the existence check — the same collision-risk table as the route test above', async () => {
    // The earlier "/regenerate-pages" test stubbed this whole module via
    // vi.doMock — that registration persists until explicitly undone, so
    // restore the real implementation before importing it here.
    vi.doUnmock('../services/programmaticSeoService');
    mockResolveTenant.mockResolvedValue(TENANT_A);
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      if (sqlText.includes('SELECT id FROM client_pages')) return { rows: [] };
      if (sqlText.includes('INSERT INTO client_pages')) return { rows: [], rowCount: 1 };
      if (sqlText.includes('ALTER TABLE')) return { rows: [] };
      return fakeFilteredRead(sqlText, params);
    });
    vi.doMock('../services/slackService', () => ({ sendSlackMessage: vi.fn().mockResolvedValue(undefined) }));

    // generateLocationPages() awaits a real 2s setTimeout between each of the
    // 15 AGED_PAGES entries (rate-limiting for the real WordPress API) — fake
    // timers avoid a genuine 30s test.
    vi.useFakeTimers();
    try {
      const { generateLocationPages } = await import('../services/programmaticSeoService');
      const resultPromise = generateLocationPages();
      await vi.runAllTimersAsync();
      await resultPromise;
    } finally {
      vi.useRealTimers();
    }

    const insertCalls = mockPoolQuery.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO client_pages'));
    expect(insertCalls.length).toBeGreaterThan(0);
    for (const call of insertCalls) {
      expect(call[1]).toContain(TENANT_A);
    }
    const existenceCalls = mockPoolQuery.mock.calls.filter((c) => String(c[0]).includes('SELECT id FROM client_pages'));
    for (const call of existenceCalls) {
      expect(call[1]).toContain(TENANT_A);
    }
  });
});

// ---------------------------------------------------------------------------
// brand_mentions — confirmed zero code touch-points; only the migration +
// schema.ts need the fix. Assert schema.ts actually carries tenant_id for it
// (and the other 9 tables), since that's the only place this table is touched.
// ---------------------------------------------------------------------------
describe('schema.ts — tenant_id present on all 10 H18 tables', () => {
  it('every SEO automation table has a tenantId column defined', async () => {
    vi.doUnmock('../db/index');
    const schema = await import('../db/schema');
    const tables = {
      keywordRankings: schema.keywordRankings,
      backlinkData: schema.backlinkData,
      contentGapAnalysis: schema.contentGapAnalysis,
      seoOpportunities: schema.seoOpportunities,
      siteHealthMetrics: schema.siteHealthMetrics,
      brandMentions: schema.brandMentions,
      clientPages: schema.clientPages,
      clientKnowledgeBase: schema.clientKnowledgeBase,
      seoWeeklyMetrics: schema.seoWeeklyMetrics,
      seoAlertsLog: schema.seoAlertsLog,
    };
    for (const [name, table] of Object.entries(tables)) {
      expect(table, `${name} should be exported from schema.ts`).toBeDefined();
      expect((table as any).tenantId, `${name}.tenantId should be defined`).toBeDefined();
    }
  });
});
