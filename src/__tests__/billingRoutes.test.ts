import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();
const mockDbExecute = vi.fn();
const mockDbTransaction = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
    transaction: (...args: unknown[]) => mockDbTransaction(...args),
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
  getNextInvoiceNumber: vi.fn().mockResolvedValue({ number: 'GE/GST/2025-26/001', series: 1, financialYear: '2025-26' }),
  peekNextInvoiceNumber: vi.fn().mockResolvedValue({ number: 'GE/GST/2025-26/002', series: 2, financialYear: '2025-26' }),
}));

vi.mock('../services/amountInWordsService', () => ({
  amountInWords: () => 'Test Amount Only',
}));

vi.mock('../services/pdfService', () => ({
  generateInvoicePDF: vi.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));

vi.mock('../services/recurringInvoiceService', () => ({
  generateMonthlyDraftInvoices: vi.fn().mockResolvedValue({ generated: 0, errors: [] }),
}));

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

async function invokeRoute(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

describe('billing.ts route fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('M23 — route registration order', () => {
    it('GET /invoices/export is registered before the parametric GET /invoices/:id', async () => {
      const { default: router } = await import('../routes/billing');
      const paths = router.stack
        .filter((l: any) => l.route?.methods?.get)
        .map((l: any) => l.route.path);
      const exportIdx = paths.indexOf('/invoices/export');
      const paramIdx = paths.indexOf('/invoices/:id');
      expect(exportIdx).toBeGreaterThanOrEqual(0);
      expect(paramIdx).toBeGreaterThanOrEqual(0);
      expect(exportIdx).toBeLessThan(paramIdx);
    });
  });

  describe('C2 — PATCH /invoices/:id/payment-status permission gate', () => {
    it('rejects with 403 when the caller lacks billingMarkPaid and is not owner', async () => {
      mockPerms({ billingMarkPaid: false, isOwner: false });
      const { default: router } = await import('../routes/billing');
      const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', { id: 'invoice-1' }, { status: 'paid' });

      await invokeRoute(router, '/invoices/:id/payment-status', 'patch', req, res);

      expect(statusFn).toHaveBeenCalledWith(403);
      expect(mockDbSelect).toHaveBeenCalledTimes(1); // only the perms lookup — never reached the invoice fetch
    });

    it('proceeds past the permission check when the caller has billingMarkPaid', async () => {
      mockPerms({ billingMarkPaid: true, isOwner: false });
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'invoice-1', tenantId: 'tenant-a', totalAmount: 100000, status: 'sent' }]),
          }),
        }),
      });
      mockDbExecute.mockResolvedValue({ rows: [] });
      const { default: router } = await import('../routes/billing');
      const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', { id: 'invoice-1' }, { status: 'paid' });

      await invokeRoute(router, '/invoices/:id/payment-status', 'patch', req, res);

      expect(statusFn).not.toHaveBeenCalledWith(403);
    });
  });

  describe('C3 — POST /invoices tenant-scoped client fetch', () => {
    it('client lookup is scoped to the caller tenant, not client ID alone', async () => {
      mockPerms({ billingCreate: true, isOwner: false });
      let capturedWhere: unknown;
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((cond: unknown) => {
            capturedWhere = cond;
            return { limit: vi.fn().mockResolvedValue([]) }; // not found → 404, no invoice created
          }),
        }),
      });
      const { default: router } = await import('../routes/billing');
      const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', {}, { clientId: 'client-in-tenant-b', lineItemsData: [] });

      await invokeRoute(router, '/invoices', 'post', req, res);

      expect(capturedWhere).toBeDefined();
      expect(statusFn).toHaveBeenCalledWith(404);
    });
  });

  describe('C3 — PATCH /invoices/:id tenant check happens before any line-item write', () => {
    it('404s immediately for a foreign-tenant invoice without touching invoiceLineItems', async () => {
      mockPerms({ billingEdit: true, isOwner: false });
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // tenant-scoped fetch finds nothing
          }),
        }),
      });
      const { default: router } = await import('../routes/billing');
      const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', { id: 'foreign-invoice' }, { lineItemsData: [{ description: 'x', amount: 100, sacCode: '9983', quantity: 1, unit: 'Month', rate: 100 }] });

      await invokeRoute(router, '/invoices/:id', 'patch', req, res);

      expect(statusFn).toHaveBeenCalledWith(404);
      // The critical regression guard: line items must never be touched for
      // an invoice that doesn't belong to the caller's tenant.
      expect(mockDbDelete).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });
  });

  describe('H7 — POST /invoices/:id/payment uses a transaction', () => {
    it('wraps the payment insert + invoice update in db.transaction (row-lock safety)', async () => {
      mockPerms({ billingMarkPaid: true, isOwner: false });
      mockDbTransaction.mockResolvedValue({ id: 'invoice-1', status: 'paid' });
      const { default: router } = await import('../routes/billing');
      const { req, res, jsonFn } = makeReqRes('user-1', 'tenant-a', { id: 'invoice-1' }, { amount: 500, paymentDate: '2026-07-01' });

      await invokeRoute(router, '/invoices/:id/payment', 'post', req, res);

      expect(mockDbTransaction).toHaveBeenCalledTimes(1);
      expect(jsonFn).toHaveBeenCalledWith({ invoice: { id: 'invoice-1', status: 'paid' } });
    });

    it('404s when the transaction resolves null (invoice not found in caller tenant)', async () => {
      mockPerms({ billingMarkPaid: true, isOwner: false });
      mockDbTransaction.mockResolvedValue(null);
      const { default: router } = await import('../routes/billing');
      const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', { id: 'foreign-invoice' }, { amount: 500, paymentDate: '2026-07-01' });

      await invokeRoute(router, '/invoices/:id/payment', 'post', req, res);

      expect(statusFn).toHaveBeenCalledWith(404);
    });
  });
});
