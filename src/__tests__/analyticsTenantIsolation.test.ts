import { describe, it, expect, vi, beforeEach } from 'vitest';

// Security audit (2026-08-04): GET /api/analytics/team-performance and
// GET /api/analytics/attribution were both unscoped. team-performance backs
// onto a hardcoded GE staff roster (TEAM_MEMBERS_BASE — Jatin/Sakcham/Keshav
// growthescalators.com emails) with no tenant dimension, so it's gated to
// GE's own tenant instead of being made per-tenant. attribution queries
// `contacts`, which genuinely has tenant_id, so it's now properly scoped by
// req.user.tenantId instead of being gated.

const GE_TENANT_ID = 'tenant-ge-aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RESELLER_TENANT_ID = 'tenant-reseller-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

type Row = Record<string, unknown>;

const ATTRIBUTION_ROWS: Record<string, Row[]> = {
  [GE_TENANT_ID]: [{ source: 'tenantGE-exclusive-source', purchases: 5 }],
  [RESELLER_TENANT_ID]: [{ source: 'tenantReseller-exclusive-source', purchases: 2 }],
};

const mockPoolQuery = vi.fn();
const mockDbExecute = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
  db: { execute: (...args: unknown[]) => mockDbExecute(...args) },
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
  vi.resetModules();
  mockPoolQuery.mockReset();
  mockDbExecute.mockReset();
  mockPoolQuery.mockImplementation(async (sqlText: string) => {
    if (sqlText.includes('FROM tenants WHERE slug')) return { rows: [{ id: GE_TENANT_ID }] };
    if (sqlText.includes('FROM contacts')) return { rows: [] }; // overridden per-test where relevant
    return { rows: [] };
  });
});

describe('routes/analytics.ts — GET /team-performance is GE-tenant-only', () => {
  it('a reseller tenant gets 403, never GE\'s staff roster', async () => {
    const router = (await import('../routes/analytics')).default;
    const handler = invokeRouteHandler(router, '/team-performance', 'get');
    const res = mockRes();
    await handler(reqAs(RESELLER_TENANT_ID), res);

    expect(res.statusCode).toBe(403);
  });

  it('GE\'s own tenant is unaffected (gate lets it through to the real handler)', async () => {
    const router = (await import('../routes/analytics')).default;
    const handler = invokeRouteHandler(router, '/team-performance', 'get');
    const res = mockRes();
    await handler(reqAs(GE_TENANT_ID), res);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
  });
});

describe('routes/analytics.ts — GET /attribution is tenant-scoped (contacts has real tenant_id)', () => {
  it('never returns the other tenant\'s attribution rows', async () => {
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      if (sqlText.includes('FROM contacts')) {
        const tenantId = params[0] as string | undefined;
        return { rows: tenantId ? ATTRIBUTION_ROWS[tenantId] ?? [] : [] };
      }
      return { rows: [] };
    });
    const router = (await import('../routes/analytics')).default;
    const handler = invokeRouteHandler(router, '/attribution', 'get');
    const res = mockRes();
    await handler(reqAs(RESELLER_TENANT_ID), res);

    const sources = (res.body as Row[]).map((r) => r.source);
    expect(sources).toEqual(['tenantReseller-exclusive-source']);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/tenant_id = \$1/);
    expect(params).toEqual([RESELLER_TENANT_ID]);
  });

  it('GE\'s own tenant sees only its own attribution rows (unchanged behavior)', async () => {
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      if (sqlText.includes('FROM contacts')) {
        const tenantId = params[0] as string | undefined;
        return { rows: tenantId ? ATTRIBUTION_ROWS[tenantId] ?? [] : [] };
      }
      return { rows: [] };
    });
    const router = (await import('../routes/analytics')).default;
    const handler = invokeRouteHandler(router, '/attribution', 'get');
    const res = mockRes();
    await handler(reqAs(GE_TENANT_ID), res);

    const sources = (res.body as Row[]).map((r) => r.source);
    expect(sources).toEqual(['tenantGE-exclusive-source']);
  });
});
