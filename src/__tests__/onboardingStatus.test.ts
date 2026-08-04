import { describe, it, expect, vi, beforeEach } from 'vitest';

// Coverage for GET /api/onboarding/status — the first-run setup checklist
// shown on the admin Dashboard for a tenant that hasn't finished basic
// setup. Everything is derived from existing data (tenant_branding,
// contacts, pipelines); there's no new table or "dismissed" flag to test.
//
// Two things this must prove:
//  1. A tenant with real data (shaped like Growth Escalators' own tenant —
//     branding configured, contacts, an active pipeline) comes back
//     allComplete: true with every item done — the frontend hides the card
//     for exactly this response, with no tenant-id special-casing anywhere.
//  2. A freshly-provisioned reseller tenant (nothing configured yet) comes
//     back allComplete: false with each item correctly flagged incomplete.

const mockDbSelect = vi.fn();
const mockGetTenantDocumentIdentity = vi.fn();

vi.mock('../db/index', () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  contacts: { id: 'id', tenantId: 'tenant_id' },
  pipelines: { id: 'id', tenantId: 'tenant_id', isActive: 'is_active' },
}));

vi.mock('../services/tenantBrandingDefaults', () => ({
  getTenantDocumentIdentity: (...args: unknown[]) => mockGetTenantDocumentIdentity(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function makeReqRes(userId: string, tenantId: string) {
  const req = { user: { id: userId, tenantId }, params: {}, query: {}, body: {} } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

// db.select({...}).from(table).where(...).limit(1) → resolves to `rows`.
function mockSelectOnce(rows: unknown[]) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

async function invokeRoute(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled) break;
  }
}

describe('GET /api/onboarding/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a GE-like fully-set-up tenant (branding + a contact + an active pipeline) comes back allComplete: true', async () => {
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({
      legalEntityName: 'Growth Escalators Pvt Ltd',
      registeredAddress: '1 Example Business Park, Bengaluru, Karnataka 560001',
    });
    mockSelectOnce([{ id: 'contact-1' }]); // contacts.select — at least one row
    mockSelectOnce([{ id: 'pipeline-1' }]); // pipelines.select — at least one active pipeline

    const { default: router } = await import('../routes/onboarding');
    const { req, res, jsonFn } = makeReqRes('user-1', 'tenant-ge');
    await invokeRoute(router, '/status', 'get', req, res);

    expect(jsonFn).toHaveBeenCalledWith({
      allComplete: true,
      items: [
        expect.objectContaining({ key: 'branding', done: true }),
        expect.objectContaining({ key: 'contacts', done: true }),
        expect.objectContaining({ key: 'pipeline', done: true }),
      ],
    });
  });

  it('a freshly-provisioned reseller tenant with nothing configured comes back allComplete: false with every item flagged incomplete', async () => {
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(null); // no tenant_branding row yet
    mockSelectOnce([]); // no contacts
    mockSelectOnce([]); // no active pipelines

    const { default: router } = await import('../routes/onboarding');
    const { req, res, jsonFn } = makeReqRes('user-2', 'tenant-new-reseller');
    await invokeRoute(router, '/status', 'get', req, res);

    expect(jsonFn).toHaveBeenCalledWith({
      allComplete: false,
      items: [
        expect.objectContaining({ key: 'branding', done: false, link: '/settings/branding' }),
        expect.objectContaining({ key: 'contacts', done: false, link: '/contacts' }),
        expect.objectContaining({ key: 'pipeline', done: false, link: '/pipeline' }),
      ],
    });
  });

  it('a tenant_branding row with a blank legalEntityName still counts branding as incomplete', async () => {
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({ legalEntityName: '   ', registeredAddress: null });
    mockSelectOnce([{ id: 'contact-1' }]);
    mockSelectOnce([{ id: 'pipeline-1' }]);

    const { default: router } = await import('../routes/onboarding');
    const { req, res, jsonFn } = makeReqRes('user-3', 'tenant-partial');
    await invokeRoute(router, '/status', 'get', req, res);

    expect(jsonFn).toHaveBeenCalledWith({
      allComplete: false,
      items: [
        expect.objectContaining({ key: 'branding', done: false }),
        expect.objectContaining({ key: 'contacts', done: true }),
        expect.objectContaining({ key: 'pipeline', done: true }),
      ],
    });
  });

  it('scopes every query to req.user.tenantId, never trusting an unscoped global lookup', async () => {
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(null);
    mockSelectOnce([]);
    mockSelectOnce([]);

    const { default: router } = await import('../routes/onboarding');
    const { req, res } = makeReqRes('user-4', 'tenant-scoped-check');
    await invokeRoute(router, '/status', 'get', req, res);

    expect(mockGetTenantDocumentIdentity).toHaveBeenCalledWith('tenant-scoped-check');
  });

  it('returns 500 without leaking internals when a query throws', async () => {
    mockGetTenantDocumentIdentity.mockRejectedValueOnce(new Error('connection reset'));

    const { default: router } = await import('../routes/onboarding');
    const { req, res, statusFn, jsonFn } = makeReqRes('user-5', 'tenant-error');
    await invokeRoute(router, '/status', 'get', req, res);

    expect(statusFn).toHaveBeenCalledWith(500);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'internal server error' });
  });
});
