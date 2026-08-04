// POST /api/reports/send-pdf sends a generated report PDF over WhatsApp
// using GE's own shared META_PHONE_NUMBER_ID/META_ACCESS_TOKEN — the same
// shared identity already guarded in routes/inbox.ts by canSendWhatsApp()
// (see inboxResellerWhatsAppBlock.test.ts) and in services/growthOSSetup.ts
// by canSendGrowthOSWhatsApp() (see growthOSResellerWhatsAppBlock.test.ts).
// This pins the equivalent guard added to routes/reports.ts: only GE's own
// tenant may have its report delivered over the shared number. The guard
// fires only once a send would actually be attempted (client has a phone
// number and META_PHONE_NUMBER_ID is configured) — a client with no phone
// number keeps generating its report exactly as before, for every tenant,
// matching the existing "no channel" contract preserved in
// inboxResellerWhatsAppBlock.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDbSelect = vi.fn();
const mockPoolQuery = vi.fn();
const mockGetTenantDocumentIdentity = vi.fn();

const billingClients = { id: 'id', tenantId: 'tenant_id', name: 'name', email: 'email', phone: 'phone', metaAdAccountId: 'meta_ad_account_id', isActive: 'is_active' };
const userPermissions = { userId: 'user_id' };

vi.mock('../db/index', () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
  billingClients,
  userPermissions,
}));

vi.mock('../services/tenantBrandingDefaults', () => ({
  getTenantDocumentIdentity: (...args: unknown[]) => mockGetTenantDocumentIdentity(...args),
  GENERIC_DEFAULT_BRANDING: { displayName: 'Client Workspace' },
}));

function mockPerms(perms: Record<string, boolean>) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([perms]),
      }),
    }),
  });
}

function mockClientRow(row: Record<string, unknown> | undefined) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(row ? [row] : []),
      }),
    }),
  });
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

function makeReqRes(tenantSlug: string | undefined, tenantId: string, query: Record<string, string>) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req = { user: { id: 'user-1', tenantId, tenantSlug, email: 'user@test.com' }, params: {}, query, body: {} } as any;
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

describe('POST /api/reports/send-pdf — reseller WhatsApp identity guard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockDbSelect.mockReset();
    mockPoolQuery.mockReset();
    mockGetTenantDocumentIdentity.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] }); // tasks/benchmarks — not under test here
    mockGetTenantDocumentIdentity.mockResolvedValue(null);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.META_ADS_TOKEN;
    process.env.META_PHONE_NUMBER_ID = 'ge-shared-phone-id';
    process.env.META_ACCESS_TOKEN = 'ge-shared-token';
    fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ id: 'media-1', messages: [{ id: 'wamid.1' }] }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.META_PHONE_NUMBER_ID;
    delete process.env.META_ACCESS_TOKEN;
  });

  it("GE's own tenant still sends the report over WhatsApp exactly as today", async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-1', name: 'Acme', phone: '+919876543210', metaAdAccountId: null });

    const { default: router } = await import('../routes/reports');
    const { req, res, jsonFn, statusFn } = makeReqRes('growth-escalators', 'tenant-ge', { clientId: 'client-1', weekOf: '2026-07-20' });

    await invokeRoute(router, '/send-pdf', 'post', req, res);

    expect(fetchMock).toHaveBeenCalled(); // media upload + message send
    expect(statusFn).not.toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ success: true, whatsappSent: true }));
  });

  it('a reseller tenant is blocked from the WhatsApp send — no Meta call, 403 returned', async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-2', name: 'Reseller Client', phone: '+911234567890', metaAdAccountId: null });

    const { default: router } = await import('../routes/reports');
    const { req, res, jsonFn, statusFn } = makeReqRes('acme-reseller', 'tenant-acme', { clientId: 'client-2', weekOf: '2026-07-20' });

    await invokeRoute(router, '/send-pdf', 'post', req, res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith({ error: "WhatsApp sending isn't configured for your workspace" });
  });

  it('a tenant with no tenantSlug claim (never GE) is blocked the same way', async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-2b', name: 'Reseller Client', phone: '+911234567890', metaAdAccountId: null });

    const { default: router } = await import('../routes/reports');
    const { req, res, statusFn } = makeReqRes(undefined, 'tenant-acme', { clientId: 'client-2b', weekOf: '2026-07-20' });

    await invokeRoute(router, '/send-pdf', 'post', req, res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(403);
  });

  it('a reseller tenant client with no phone number still generates the report normally — no send attempted, no 403 (existing contract preserved)', async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-3', name: 'Reseller Client', phone: null, metaAdAccountId: null });

    const { default: router } = await import('../routes/reports');
    const { req, res, jsonFn, statusFn } = makeReqRes('acme-reseller', 'tenant-acme', { clientId: 'client-3', weekOf: '2026-07-20' });

    await invokeRoute(router, '/send-pdf', 'post', req, res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(statusFn).not.toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ success: true, whatsappSent: false }));
  });

  it("GE's own tenant client with no phone number is also unaffected — no send attempted, no 403", async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-1b', name: 'Acme', phone: null, metaAdAccountId: null });

    const { default: router } = await import('../routes/reports');
    const { req, res, jsonFn, statusFn } = makeReqRes('growth-escalators', 'tenant-ge', { clientId: 'client-1b', weekOf: '2026-07-20' });

    await invokeRoute(router, '/send-pdf', 'post', req, res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(statusFn).not.toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ success: true, whatsappSent: false }));
  });
});

describe('GET /api/reports/generate — report generation itself is never gated by the WhatsApp guard', () => {
  beforeEach(() => {
    vi.resetModules();
    mockDbSelect.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.META_ADS_TOKEN;
    delete process.env.META_ACCESS_TOKEN;
  });

  it('a reseller tenant can still generate the JSON report preview — no WhatsApp involved, no 403', async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-4', name: 'Reseller Client', phone: '+911234567890', metaAdAccountId: null });

    const { default: router } = await import('../routes/reports');
    const { req, res, statusFn, jsonFn } = makeReqRes('acme-reseller', 'tenant-acme', { clientId: 'client-4', weekOf: '2026-07-20' });

    await invokeRoute(router, '/generate', 'get', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ weekOf: '2026-07-20' }));
  });
});
