import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Coverage for the reseller-readiness fix: src/routes/billing.ts's three
// client-facing document routes (create, PDF download, email send) must
// block when the tenant hasn't configured its own legal/financial identity
// — never silently fall back to Growth Escalators' identity — and must pass
// that tenant's own values through when it has.
//
// isBillingIdentityConfigured is a pure function with no DB dependency, so
// it's imported for REAL here (not mocked) — these tests exercise the
// actual gating logic end-to-end, not a stand-in for it. Only
// getTenantDocumentIdentity (the DB read) is mocked.

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockGetTenantDocumentIdentity = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../db/schema', () => ({
  billingClients: { id: 'id', tenantId: 'tenant_id', name: 'name' },
  invoices: { id: 'id', tenantId: 'tenant_id', clientId: 'client_id' },
  invoiceLineItems: { id: 'id', invoiceId: 'invoice_id' },
  payments: { id: 'id', invoiceId: 'invoice_id', tenantId: 'tenant_id' },
  userPermissions: { userId: 'user_id' },
}));

vi.mock('../services/invoiceNumberService', () => ({
  getNextInvoiceNumber: vi.fn().mockResolvedValue({ number: 'INV/2026-27/001', series: 1, financialYear: '2025-26' }),
  peekNextInvoiceNumber: vi.fn().mockResolvedValue({ number: 'INV/2026-27/002', series: 2, financialYear: '2025-26' }),
}));

vi.mock('../services/amountInWordsService', () => ({
  amountInWords: () => 'Test Amount Only',
}));

const mockGenerateInvoicePDF = vi.fn().mockResolvedValue(Buffer.from('fake-pdf'));
vi.mock('../services/pdfService', () => ({
  generateInvoicePDF: (...args: unknown[]) => mockGenerateInvoicePDF(...args),
}));

vi.mock('../services/recurringInvoiceService', () => ({
  generateMonthlyDraftInvoices: vi.fn().mockResolvedValue({ generated: 0, errors: [] }),
}));

vi.mock('../services/tenantBrandingDefaults', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/tenantBrandingDefaults')>();
  return {
    ...actual,
    getTenantDocumentIdentity: (...args: unknown[]) => mockGetTenantDocumentIdentity(...args),
  };
});

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function makeReqRes(userId: string, tenantId: string, params: Record<string, string> = {}, body: Record<string, unknown> = {}, email = 'user@test.com') {
  const req = { user: { id: userId, tenantId, email }, params, body, query: {} } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn, setHeader: vi.fn(), send: vi.fn() } as any;
  return { req, res, jsonFn, statusFn };
}

function mockPerms(perms: Record<string, boolean>) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([perms]),
      }),
    }),
  });
}

function mockSelectOnce(rows: unknown[]) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
        orderBy: vi.fn().mockResolvedValue(rows),
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

// A second, fully-configured tenant identity, deliberately shaped like the
// default tenant's env-configured identity (see the FAKE_DEFAULT_TENANT_ENV
// fixture in tenantBrandingDefaults.test.ts) — fictitious values throughout,
// standard example GSTIN/IFSC formats. getTenantDocumentIdentity is mocked
// directly in this file (it doesn't read env vars — only
// seedTenantBrandingDefaults does), so what matters here is proving
// rendering treats this tenant exactly like any other: no special-casing,
// no fallback to a different identity.
const DEFAULT_TENANT_IDENTITY = {
  displayName: 'Example Operator', primaryColor: '#1A3A5C', accentColor: '#F97316',
  legalEntityName: 'Example Operator Pvt Ltd',
  registeredAddress: '1 Example Business Park, Sample City, Karnataka 560001',
  gstin: '22AAAAA0000A1Z5',
  bankName: 'Example Bank', bankAccountName: 'Example Operator Pvt Ltd',
  bankAccountNumber: '000123456789', bankIfsc: 'EXBK0001234',
  supportEmail: 'billing@example-operator.test', supportPhone: '+91 90000 00001',
  website: 'example-operator.test',
};

const RESELLER_IDENTITY = {
  displayName: 'Acme Recruiting', primaryColor: '#112233', accentColor: '#445566',
  legalEntityName: 'Acme Recruiting Pvt Ltd',
  registeredAddress: '1 MG Road, Bengaluru, Karnataka 560001',
  gstin: '29AABCU9603R1ZM',
  bankName: 'HDFC Bank', bankAccountName: 'Acme Recruiting Pvt Ltd',
  bankAccountNumber: '000111222333', bankIfsc: 'HDFC0000001',
  supportEmail: 'billing@acme.example', supportPhone: '+91 90000 00000',
  website: 'acme.example',
};

describe('POST /api/billing/invoices — billing identity gate', () => {
  beforeEach(() => { vi.clearAllMocks(); (global as any).fetch = vi.fn(); });

  it('blocks with 422 (no invoice row created) when the tenant has nothing configured', async () => {
    mockPerms({ billingCreate: true, isOwner: false });
    mockSelectOnce([{ id: 'client-1', tenantId: 'tenant-a', isGst: false, taxType: null }]); // client lookup
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(null);

    const { default: router } = await import('../routes/billing');
    const { req, res, statusFn, jsonFn } = makeReqRes('user-1', 'tenant-a', {}, {
      clientId: 'client-1', invoiceDate: '2026-07-01', dueDate: '2026-07-15', lineItemsData: [],
    });
    await invokeRoute(router, '/invoices', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(422);
    expect(jsonFn).toHaveBeenCalledWith({ error: expect.stringContaining('Configure your billing details') });
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('blocks a GST invoice specifically for missing bank details even when legal name/address ARE configured', async () => {
    mockPerms({ billingCreate: true, isOwner: false });
    mockSelectOnce([{ id: 'client-1', tenantId: 'tenant-a', isGst: true, taxType: 'cgst_sgst' }]);
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({
      ...RESELLER_IDENTITY, gstin: null, bankIfsc: null, // legal name/address present, GST fields missing
    });

    const { default: router } = await import('../routes/billing');
    const { req, res, statusFn, jsonFn } = makeReqRes('user-1', 'tenant-a', {}, {
      clientId: 'client-1', invoiceDate: '2026-07-01', dueDate: '2026-07-15', invoiceType: 'gst', lineItemsData: [],
    });
    await invokeRoute(router, '/invoices', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(422);
    expect(jsonFn).toHaveBeenCalledWith({ error: expect.stringContaining('GSTIN, and bank details') });
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('a non-GST invoice does NOT require GSTIN/bank details, only legal name + address', async () => {
    mockPerms({ billingCreate: true, isOwner: false });
    mockSelectOnce([{ id: 'client-1', tenantId: 'tenant-a', isGst: false, taxType: null, serviceDescription: 'x', sacCode: '9983' }]);
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({
      ...RESELLER_IDENTITY, gstin: null, bankIfsc: null, bankAccountNumber: null, bankAccountName: null, bankName: null,
    });
    const { values } = insertChain([{ id: 'inv-1', tenantId: 'tenant-a', companyGstin: null }]);
    mockDbInsert.mockReturnValueOnce({ values });

    const { default: router } = await import('../routes/billing');
    const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', {}, {
      clientId: 'client-1', invoiceDate: '2026-07-01', dueDate: '2026-07-15', invoiceType: 'non_gst', lineItemsData: [],
    });
    await invokeRoute(router, '/invoices', 'post', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(422);
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it('a fully-configured tenant creates the invoice with companyGstin sourced from ITS OWN gstin, never the hardcoded GE default', async () => {
    mockPerms({ billingCreate: true, isOwner: false });
    mockSelectOnce([{ id: 'client-1', tenantId: 'tenant-a', isGst: true, taxType: 'cgst_sgst', serviceDescription: 'x', sacCode: '9983' }]);
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(RESELLER_IDENTITY);
    const { values } = insertChain([{ id: 'inv-1' }]);
    mockDbInsert.mockReturnValueOnce({ values });

    const { default: router } = await import('../routes/billing');
    const { req, res } = makeReqRes('user-1', 'tenant-a', {}, {
      clientId: 'client-1', invoiceDate: '2026-07-01', dueDate: '2026-07-15', invoiceType: 'gst', lineItemsData: [],
    });
    await invokeRoute(router, '/invoices', 'post', req, res);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ companyGstin: RESELLER_IDENTITY.gstin }));
    // Never the default tenant's own GSTIN — this call never even resolved
    // the default tenant's identity, so this also guards against a copy-paste
    // mistake reusing the wrong mock's return value.
    expect(values).not.toHaveBeenCalledWith(expect.objectContaining({ companyGstin: DEFAULT_TENANT_IDENTITY.gstin }));
  });
});

describe('GET /api/billing/invoices/:id/pdf — billing identity gate', () => {
  beforeEach(() => { vi.clearAllMocks(); (global as any).fetch = vi.fn(); });

  it('blocks with 422 (never calls generateInvoicePDF) when the tenant has nothing configured', async () => {
    mockPerms({ billingView: true, isOwner: false });
    mockSelectOnce([{ id: 'inv-1', tenantId: 'tenant-a', invoiceType: 'gst', clientId: 'client-1' }]); // invoice
    mockSelectOnce([{ id: 'client-1', name: 'Client Co', addressLine1: 'x' }]); // client — fetched before the gate
    mockDbSelect.mockReturnValueOnce({ // line items — also fetched before the gate
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
      }),
    });
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(null);

    const { default: router } = await import('../routes/billing');
    const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', { id: 'inv-1' });
    await invokeRoute(router, '/invoices/:id/pdf', 'get', req, res);

    expect(statusFn).toHaveBeenCalledWith(422);
    expect(mockGenerateInvoicePDF).not.toHaveBeenCalled();
  });

  it('a fully-configured tenant renders a PDF using ITS OWN identity, not Growth Escalators\'', async () => {
    mockPerms({ billingView: true, isOwner: false });
    mockSelectOnce([{ id: 'inv-1', tenantId: 'tenant-a', invoiceType: 'gst', clientId: 'client-1', invoiceNumber: 'INV/001', invoiceDate: new Date(), dueDate: new Date(), companyGstin: '29AABCU9603R1ZM', subtotal: 1000, totalAmount: 1000, amountInWords: 'x' }]); // invoice
    mockSelectOnce([{ id: 'client-1', name: 'Client Co', addressLine1: 'x' }]); // client
    mockDbSelect.mockReturnValueOnce({ // line items (uses .orderBy chain)
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
      }),
    });
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(RESELLER_IDENTITY);

    const { default: router } = await import('../routes/billing');
    const { req, res } = makeReqRes('user-1', 'tenant-a', { id: 'inv-1' });
    await invokeRoute(router, '/invoices/:id/pdf', 'get', req, res);

    expect(mockGenerateInvoicePDF).toHaveBeenCalledWith(expect.objectContaining({
      companyName: 'Acme Recruiting Pvt Ltd',
      companyAddress: '1 MG Road, Bengaluru, Karnataka 560001',
      companyGstin: '29AABCU9603R1ZM',
      companyBank: expect.objectContaining({ accountNo: '000111222333', ifsc: 'HDFC0000001', bankName: 'HDFC Bank' }),
      primaryColor: '#112233',
      accentColor: '#445566',
    }));
    const pdfData = mockGenerateInvoicePDF.mock.calls[0][0];
    expect(pdfData.companyName).not.toBe('Growth Escalators');
  });

  it('the default tenant\'s own configured identity renders through into PDF data exactly as configured — no special-casing vs. any other tenant', async () => {
    mockPerms({ billingView: true, isOwner: false });
    mockSelectOnce([{ id: 'inv-1', tenantId: 'tenant-default', invoiceType: 'gst', clientId: 'client-1', invoiceNumber: 'INV/GST/2026-27/001', invoiceDate: new Date(), dueDate: new Date(), companyGstin: DEFAULT_TENANT_IDENTITY.gstin, subtotal: 1000, totalAmount: 1000, amountInWords: 'x' }]);
    mockSelectOnce([{ id: 'client-1', name: 'Client Co', addressLine1: 'x' }]);
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
      }),
    });
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(DEFAULT_TENANT_IDENTITY);

    const { default: router } = await import('../routes/billing');
    const { req, res } = makeReqRes('user-1', 'tenant-default', { id: 'inv-1' });
    await invokeRoute(router, '/invoices/:id/pdf', 'get', req, res);

    expect(mockGenerateInvoicePDF).toHaveBeenCalledWith(expect.objectContaining({
      companyName: DEFAULT_TENANT_IDENTITY.legalEntityName,
      companyAddress: DEFAULT_TENANT_IDENTITY.registeredAddress,
      companyGstin: DEFAULT_TENANT_IDENTITY.gstin,
      companyBank: {
        accountNo: DEFAULT_TENANT_IDENTITY.bankAccountNumber,
        name: DEFAULT_TENANT_IDENTITY.bankAccountName,
        ifsc: DEFAULT_TENANT_IDENTITY.bankIfsc,
        type: 'Current Account',
        bankName: DEFAULT_TENANT_IDENTITY.bankName,
      },
    }));
  });
});

describe('POST /api/billing/invoices/:id/send — billing identity gate', () => {
  const originalBrevoKey = process.env.BREVO_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    process.env.BREVO_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (originalBrevoKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalBrevoKey;
  });

  it('blocks with 422 and never calls Brevo when the tenant has nothing configured (but client has an email)', async () => {
    mockPerms({ billingEdit: true, isOwner: false });
    mockSelectOnce([{ id: 'inv-1', tenantId: 'tenant-a', invoiceType: 'gst', clientId: 'client-1', invoiceNumber: 'INV/001', invoiceDate: new Date(), dueDate: new Date(), totalAmount: 1000, amountInWords: 'x' }]);
    mockSelectOnce([{ id: 'client-1', name: 'Client Co', email: 'client@example.com' }]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }); // line items
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(null);

    const { default: router } = await import('../routes/billing');
    const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', { id: 'inv-1' });
    await invokeRoute(router, '/invoices/:id/send', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(422);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks specifically for a missing supportEmail even when everything else is configured', async () => {
    mockPerms({ billingEdit: true, isOwner: false });
    mockSelectOnce([{ id: 'inv-1', tenantId: 'tenant-a', invoiceType: 'non_gst', clientId: 'client-1', invoiceNumber: 'INV/001', invoiceDate: new Date(), dueDate: new Date(), totalAmount: 1000, amountInWords: 'x' }]);
    mockSelectOnce([{ id: 'client-1', name: 'Client Co', email: 'client@example.com' }]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({ ...RESELLER_IDENTITY, supportEmail: null });

    const { default: router } = await import('../routes/billing');
    const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', { id: 'inv-1' });
    await invokeRoute(router, '/invoices/:id/send', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(422);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends using the tenant\'s own legalEntityName/supportEmail as sender, HTML-escaped, never falling back to Growth Escalators\' address', async () => {
    mockPerms({ billingEdit: true, isOwner: false });
    mockSelectOnce([{ id: 'inv-1', tenantId: 'tenant-a', invoiceType: 'gst', clientId: 'client-1', invoiceNumber: 'INV/001', invoiceDate: new Date(), dueDate: new Date(), totalAmount: 1000, amountInWords: 'x' }]);
    mockSelectOnce([{ id: 'client-1', name: 'Client Co', email: 'client@example.com', contactPerson: '<b>Evil</b> Client' }]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({ ...RESELLER_IDENTITY, legalEntityName: '<script>alert(1)</script>' });
    mockDbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'inv-1', status: 'sent' }]) }) }),
    });

    const { default: router } = await import('../routes/billing');
    const { req, res } = makeReqRes('user-1', 'tenant-a', { id: 'inv-1' });
    await invokeRoute(router, '/invoices/:id/send', 'post', req, res);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        body: expect.stringContaining('"email":"billing@acme.example"'),
      }),
    );
    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.sender).toEqual({ name: '<script>alert(1)</script>', email: 'billing@acme.example' });
    expect(callBody.subject).toBe('Invoice INV/001 from <script>alert(1)</script>');
    // The HTML BODY must escape the dangerous legal name and the client's
    // contact-person string — never emit either as raw markup.
    expect(callBody.htmlContent).not.toContain('<script>alert(1)</script>');
    expect(callBody.htmlContent).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(callBody.htmlContent).not.toContain('<b>Evil</b> Client');
    expect(callBody.htmlContent).toContain('&lt;b&gt;Evil&lt;/b&gt; Client');
    // Never falls back to the operator's own sender address — the mock for
    // this call never resolved DEFAULT_TENANT_IDENTITY at all, so any value
    // matching it would mean the wrong identity leaked in from somewhere.
    expect(callBody.sender.email).not.toBe(DEFAULT_TENANT_IDENTITY.supportEmail);
    expect(callBody.sender.email).toBe(RESELLER_IDENTITY.supportEmail);
  });

  it('does not require the send-time gate at all when Brevo isn\'t configured or the client has no email — marks sent without touching identity', async () => {
    delete process.env.BREVO_API_KEY; // override this describe block's beforeEach — testing the "not configured" branch
    mockPerms({ billingEdit: true, isOwner: false });
    mockSelectOnce([{ id: 'inv-1', tenantId: 'tenant-a', invoiceType: 'gst', clientId: 'client-1', invoiceNumber: 'INV/001', invoiceDate: new Date(), dueDate: new Date(), totalAmount: 1000, amountInWords: 'x' }]);
    mockSelectOnce([{ id: 'client-1', name: 'Client Co', email: null }]); // no client email
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
    mockDbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'inv-1', status: 'sent' }]) }) }),
    });

    const { default: router } = await import('../routes/billing');
    const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', { id: 'inv-1' });
    await invokeRoute(router, '/invoices/:id/send', 'post', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(422);
    expect(mockGetTenantDocumentIdentity).not.toHaveBeenCalled();
  });
});

function insertChain(returnedRows: unknown[]) {
  const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(returnedRows) });
  return { values };
}
