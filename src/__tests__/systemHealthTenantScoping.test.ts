// System Health used to be GE's own internal ops dashboard shown to every
// tenant — checkAllSystems() took no tenant parameter at all and
// unconditionally returned GE-global infra details (a specific n8n instance
// URL, GE's own Meta/Brevo/Cashfree/Cal.com credential health) and GE's own
// cron job names, and the CRM subsystem queried contacts/deals/invoices with
// no tenant_id filter whatsoever — mixing every tenant's data into one
// number. GET /api/intelligence/system-health had no tenant check in the
// handler at all.
//
// Fix mirrors the established "GE-tenant-only" gate convention used by
// canSendWhatsApp() (routes/inbox.ts) and canSendGrowthOSWhatsApp()
// (services/whatsappSendGuard.ts): checkAllSystems(tenantId?) now resolves
// whether the caller IS GE's own tenant (isGeOwnTenant()) and only includes
// the platform-global subsystems (infrastructure, cronJobs) for GE. A
// reseller tenant gets tenant-scoped subsystems only (SEO, CRM — scoped to
// ITS OWN data, not GE's), and the infra/cron keys are omitted from the
// response entirely rather than nulled out.
//
// These tests cover both layers: the service function directly (scoring/
// shape), and the real HTTP route handler end-to-end (no tenantId leak, no
// crash) — systemHealthMonitor.ts itself is NOT mocked here, only its DB/
// network dependencies, so this exercises the real gating logic.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

const GE_TENANT_ID = 'tenant-ge-00000000-0000-0000-0000-000000000000';
const RESELLER_TENANT_ID = 'tenant-acme-1111111-1111-1111-111111111111';

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
}));

// Not exercised by any test below (every call here passes an explicit
// tenantId, so checkSeo() never falls back to resolveDefaultSeoTenantId()),
// but routes/intelligence.ts and systemHealthMonitor.ts's import graph both
// reach modules that touch `db` (Drizzle) rather than `pool` — mock those
// away the same way intelligenceReportsTenantIsolation.test.ts does, so
// importing the real route module can't accidentally hit a real DB call.
vi.mock('../middleware/rbac', () => ({
  isAdminTier: (role: string | undefined) => ['admin', 'team_lead', 'viewer'].includes(role ?? ''),
}));
vi.mock('../services/intelligenceDataCollector', () => ({
  collectDailyData: vi.fn().mockResolvedValue({}),
}));
vi.mock('../services/intelligenceAnalyzer', () => ({
  analyzeWithClaude: vi.fn().mockResolvedValue({ scores: { overall: 50, ads: 50, seo: 50, sales: 50, ops: 50 }, tokensUsed: 0 }),
  ensureIntelligenceTable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/intelligenceDelivery', () => ({
  deliverDailyIntelligence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/metaAdsService', () => ({
  calculateMonthlyBenchmarks: vi.fn().mockResolvedValue(undefined),
}));

function defaultPoolImpl(sqlText: string, params: unknown[] = []): { rows: unknown[] } {
  const sql = String(sqlText);
  if (sql.includes('FROM tenants WHERE slug')) return { rows: [{ id: GE_TENANT_ID }] };
  if (sql.includes('FROM seo_weekly_metrics')) return { rows: [{ recent_metrics: 3, recent_rankings: 4 }] };
  if (sql.includes('FROM contacts')) {
    return { rows: [{ contacts_today: 2, deals_active: 5, pipeline_value: 100000, invoices_overdue: 0 }] };
  }
  if (sql.trim() === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
  if (sql.includes('FROM cron_job_logs')) return { rows: [] };
  void params;
  return { rows: [] };
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => defaultPoolImpl(sqlText, params));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  delete process.env.N8N_API_KEY; // skip the n8n branch entirely — no real network call
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('services/systemHealthMonitor.ts — checkAllSystems(tenantId) scoping', () => {
  it("returns the full platform view (infra + cronJobs) for GE's own tenant", async () => {
    const { checkAllSystems } = await import('../services/systemHealthMonitor');
    const report = await checkAllSystems(GE_TENANT_ID);

    expect(report.scope).toBe('full');
    expect(report.infrastructure).toBeDefined();
    expect(report.cronJobs).toBeDefined();
    expect(report.seo).toBeDefined();
    expect(report.crm).toBeDefined();
  });

  it('omits GE-global infra/cron subsystems entirely for a reseller tenant, with no crash', async () => {
    const { checkAllSystems } = await import('../services/systemHealthMonitor');
    const report = await checkAllSystems(RESELLER_TENANT_ID);

    expect(report.scope).toBe('tenant');
    expect('infrastructure' in report).toBe(false);
    expect('cronJobs' in report).toBe(false);
    expect(report.infrastructure).toBeUndefined();
    expect(report.cronJobs).toBeUndefined();

    // Still reports the tenant-scoped subsystems, and a usable score.
    expect(report.seo).toBeDefined();
    expect(report.crm).toBeDefined();
    expect(typeof report.overallScore).toBe('number');
    expect(Number.isNaN(report.overallScore)).toBe(false);

    // No GE-specific infra/cron detail anywhere in the payload — no n8n
    // instance URL, no GE cron job names.
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('primary-production-6c6f5.up.railway.app');
    expect(serialized).not.toContain('Monthly Client Benchmarks');
    expect(serialized).not.toContain('System Health Check');
  });

  it("scopes the CRM and SEO queries to the reseller's own tenant id, never GE's", async () => {
    const { checkAllSystems } = await import('../services/systemHealthMonitor');
    await checkAllSystems(RESELLER_TENANT_ID);

    const crmCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('FROM contacts'));
    expect(crmCall?.[1]).toEqual([RESELLER_TENANT_ID]);

    const seoCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('FROM seo_weekly_metrics'));
    expect(seoCall?.[1]).toEqual([RESELLER_TENANT_ID]);
  });

  it('treats an omitted tenantId (internal callers with no request context) as the full platform view', async () => {
    const { checkAllSystems } = await import('../services/systemHealthMonitor');
    const report = await checkAllSystems();

    expect(report.scope).toBe('full');
    expect(report.infrastructure).toBeDefined();
    expect(report.cronJobs).toBeDefined();
  });

  it('fails closed (tenant-scoped, no crash) if the GE tenant lookup itself comes back empty', async () => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      if (String(sqlText).includes('FROM tenants WHERE slug')) return { rows: [] }; // no GE tenant row at all
      return defaultPoolImpl(sqlText, params);
    });

    const { checkAllSystems } = await import('../services/systemHealthMonitor');
    const report = await checkAllSystems(RESELLER_TENANT_ID);

    expect(report.scope).toBe('tenant');
    expect('infrastructure' in report).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Route-level: GET /api/intelligence/system-health end-to-end (real router,
// real systemHealthMonitor — only DB/network mocked).
// ---------------------------------------------------------------------------
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

function reqAs(tenantId: string) {
  return { user: { tenantId, id: 'user-1', role: 'admin' }, params: {}, query: {}, body: {} };
}

let router: any;
beforeAll(async () => {
  // routes/intelligence.ts fires a few startup pool.query() calls at
  // module-load time (idempotent ALTER TABLE/UPDATE cleanup) — set the
  // default mock impl BEFORE importing (beforeEach below runs too late for
  // this one-time module-load), so those startup calls are harmless no-ops
  // instead of calling an unmocked vi.fn() that returns undefined.
  mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => defaultPoolImpl(sqlText, params));
  router = (await import('../routes/intelligence')).default;
});

describe('routes/intelligence.ts — GET /system-health is tenant-scoped end-to-end', () => {
  it("a reseller tenant gets no GE infra/cron details in the JSON response, and no error", async () => {
    const handler = invokeRouteHandler(router, '/system-health', 'get');
    const res = mockRes();
    await handler(reqAs(RESELLER_TENANT_ID), res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.body.scope).toBe('tenant');
    expect('infrastructure' in res.body).toBe(false);
    expect('cronJobs' in res.body).toBe(false);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('primary-production-6c6f5.up.railway.app');
    expect(serialized).not.toContain('Monthly Client Benchmarks');
  });

  it("GE's own tenant still gets the full platform report", async () => {
    const handler = invokeRouteHandler(router, '/system-health', 'get');
    const res = mockRes();
    await handler(reqAs(GE_TENANT_ID), res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.body.scope).toBe('full');
    expect(res.body.infrastructure).toBeDefined();
    expect(res.body.cronJobs).toBeDefined();
  });
});
