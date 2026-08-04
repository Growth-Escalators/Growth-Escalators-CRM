import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/clients/:clientId/quick-update built its share text with a
// hardcoded "📊 Growth Escalators — {client}" header regardless of which
// tenant owned the billing client. This covers the fix: the header now
// reads the tenant's own tenant_branding.displayName (via
// getTenantDocumentIdentity), falling back to the same generic placeholder
// used elsewhere when a tenant has no branding row configured yet.

const mockDbSelect = vi.fn();
const mockPoolQuery = vi.fn();
const mockGetTenantDocumentIdentity = vi.fn();

vi.mock('../db/index', () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
  // Plain stand-ins, not real Drizzle columns — the route only ever passes
  // these through eq()/and() into a fully-mocked db.select() chain below, so
  // nothing downstream inspects their shape (same technique as
  // billingRoutes.test.ts).
  billingClients: { id: 'id', tenantId: 'tenant_id', name: 'name', metaAdAccountId: 'meta_ad_account_id' },
}));

vi.mock('../services/tenantBrandingDefaults', () => ({
  getTenantDocumentIdentity: (...args: unknown[]) => mockGetTenantDocumentIdentity(...args),
  GENERIC_DEFAULT_BRANDING: { displayName: 'Client Workspace' },
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function selectClientChain(client: Record<string, unknown> | null) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(client ? [client] : []),
      }),
    }),
  };
}

async function invokeRoute(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

function makeReqRes(tenantId: string, clientId: string) {
  const req = { user: { id: 'u1', tenantId, role: 'admin' }, params: { clientId }, query: {} } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn };
}

describe('GET /api/clients/:clientId/quick-update — tenant-branded share text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it('uses a non-GE reseller tenant\'s own displayName in the header, never the literal "Growth Escalators"', async () => {
    const { default: router } = await import('../routes/clientDetail');
    mockDbSelect.mockReturnValueOnce(selectClientChain({ id: 'client-1', name: 'Acme Client', metaAdAccountId: null }));
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({ displayName: 'Acme Recruiting' });

    const { req, res, jsonFn } = makeReqRes('tenant-reseller', 'client-1');
    await invokeRoute(router, '/:clientId/quick-update', 'get', req, res);

    expect(jsonFn).toHaveBeenCalledTimes(1);
    const body = jsonFn.mock.calls[0][0];
    expect(body.text).toContain('📊 Acme Recruiting — Acme Client');
    expect(body.text).not.toContain('Growth Escalators');
  });

  it("GE's own tenant still renders its own real (now-seeded) displayName unchanged", async () => {
    const { default: router } = await import('../routes/clientDetail');
    mockDbSelect.mockReturnValueOnce(selectClientChain({ id: 'client-2', name: 'GE Client', metaAdAccountId: null }));
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({ displayName: 'Growth Escalators' });

    const { req, res, jsonFn } = makeReqRes('tenant-ge', 'client-2');
    await invokeRoute(router, '/:clientId/quick-update', 'get', req, res);

    const body = jsonFn.mock.calls[0][0];
    expect(body.text).toContain('📊 Growth Escalators — GE Client');
  });

  it('falls back to the generic placeholder — not "Growth Escalators" — when the tenant has no branding row configured yet', async () => {
    const { default: router } = await import('../routes/clientDetail');
    mockDbSelect.mockReturnValueOnce(selectClientChain({ id: 'client-3', name: 'New Client', metaAdAccountId: null }));
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(null);

    const { req, res, jsonFn } = makeReqRes('tenant-new', 'client-3');
    await invokeRoute(router, '/:clientId/quick-update', 'get', req, res);

    const body = jsonFn.mock.calls[0][0];
    expect(body.text).toContain('📊 Client Workspace — New Client');
    expect(body.text).not.toContain('Growth Escalators');
  });
});
