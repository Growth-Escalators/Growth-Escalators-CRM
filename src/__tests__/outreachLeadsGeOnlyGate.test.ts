import { describe, it, expect, vi, beforeEach } from 'vitest';

// checkInternalSecret() in outreachLeads.ts previously accepted any
// admin-tier JWT regardless of tenant — outreach_leads is a GE-internal
// outbound-sales tool with no per-tenant data model. These tests assert a
// reseller admin now gets 403, a GE admin is unaffected, and the
// internal-secret path (automation, no JWT/tenant involved) still works
// exactly as before.

const GE_TENANT_ID = 'tenant-ge-aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RESELLER_TENANT_ID = 'tenant-reseller-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
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

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockImplementation(async (sqlText: string) => {
    if (sqlText.includes('FROM tenants WHERE slug')) return { rows: [{ id: GE_TENANT_ID }] };
    if (sqlText.includes('outreach_leads')) return { rows: [{ status: 'Active', count: 0 }] };
    return { rows: [] };
  });
});

describe('routes/outreachLeads.ts — GE-tenant-only gate', () => {
  it('a reseller admin with a valid JWT gets 403, not GE\'s outreach data', async () => {
    const router = (await import('../routes/outreachLeads')).default;
    const handler = invokeRouteHandler(router, '/dashboard', 'get');
    const req: any = { user: { tenantId: RESELLER_TENANT_ID, id: 'u1', role: 'admin' }, headers: {}, params: {}, query: {}, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/not available for this tenant/i);
  });

  it('a GE admin with a valid JWT is let through unchanged', async () => {
    const router = (await import('../routes/outreachLeads')).default;
    const handler = invokeRouteHandler(router, '/stats', 'get');
    const req: any = { user: { tenantId: GE_TENANT_ID, id: 'u1', role: 'admin' }, headers: {}, params: {}, query: {}, body: {} };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('the internal-secret path (no JWT — n8n) is unaffected by the tenant gate', async () => {
    const originalSecret = process.env.OUTREACH_INTERNAL_SECRET;
    process.env.OUTREACH_INTERNAL_SECRET = 'test-secret-value';
    try {
      const router = (await import('../routes/outreachLeads')).default;
      const handler = invokeRouteHandler(router, '/stats', 'get');
      const req: any = { user: undefined, headers: { 'x-internal-secret': 'test-secret-value' }, params: {}, query: {}, body: {} };
      const res = mockRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
    } finally {
      process.env.OUTREACH_INTERNAL_SECRET = originalSecret;
    }
  });

  it('a reseller admin cannot bypass the gate by also sending a stale/wrong internal secret', async () => {
    const originalSecret = process.env.OUTREACH_INTERNAL_SECRET;
    process.env.OUTREACH_INTERNAL_SECRET = 'test-secret-value';
    try {
      const router = (await import('../routes/outreachLeads')).default;
      const handler = invokeRouteHandler(router, '/dashboard', 'get');
      const req: any = {
        user: { tenantId: RESELLER_TENANT_ID, id: 'u1', role: 'admin' },
        headers: { 'x-internal-secret': 'wrong-secret' },
        params: {}, query: {}, body: {},
      };
      const res = mockRes();
      await handler(req, res);

      // JWT branch is checked first (isAdminTier is true) — it fails closed
      // with 403 rather than ever falling through to the secret check.
      expect(res.statusCode).toBe(403);
    } finally {
      process.env.OUTREACH_INTERNAL_SECRET = originalSecret;
    }
  });
});
