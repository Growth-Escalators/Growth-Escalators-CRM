import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelect = vi.fn();
const mockDbExecute = vi.fn();
const mockDbInsertValues = vi.fn();
const mockDbInsert = vi.fn();
const mockGetNextInvoiceNumber = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
  },
}));

vi.mock('../db/schema', () => ({
  billingClients: { tenantId: 'tenant_id', isActive: 'is_active' },
  invoices: {},
  invoiceLineItems: {},
}));

vi.mock('./invoiceNumberService', () => ({
  getNextInvoiceNumber: (...args: unknown[]) => mockGetNextInvoiceNumber(...args),
}));

vi.mock('../services/invoiceNumberService', () => ({
  getNextInvoiceNumber: (...args: unknown[]) => mockGetNextInvoiceNumber(...args),
}));

vi.mock('../services/amountInWordsService', () => ({
  amountInWords: () => 'Test Amount Only',
}));

vi.mock('../config/constants', () => ({
  COMPANY_GSTIN: '08DRYPA4899F2ZZ',
}));

function extractSqlText(sqlObj: unknown): string {
  const chunks = (sqlObj as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === 'string') return c;
      const value = (c as { value?: unknown[] })?.value;
      return Array.isArray(value) ? value.join('') : '';
    })
    .join(' ');
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    name: 'Acme Ltd',
    tenantId: 'tenant-1',
    isActive: true,
    retainerAmount: 1000000, // 10,000 INR in paise
    isGst: true,
    taxType: 'cgst_sgst',
    invoiceDayOfMonth: 1,
    gstin: null,
    state: null,
    stateCode: null,
    serviceDescription: 'Marketing services',
    sacCode: '9983',
    ...overrides,
  };
}

describe('generateMonthlyDraftInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    mockDbExecute.mockResolvedValue({ rows: [] });
    mockGetNextInvoiceNumber.mockResolvedValue({ number: 'GE/GST/2025-26/001', series: 1, financialYear: '2025-26' });
    const insertChain: any = Promise.resolve([{ id: 'invoice-1' }]);
    insertChain.values = vi.fn().mockReturnValue(insertChain);
    insertChain.returning = vi.fn().mockResolvedValue([{ id: 'invoice-1' }]);
    mockDbInsert.mockReturnValue(insertChain);
  });

  it('H8: clamps invoiceDayOfMonth to the last real day of a short month instead of rolling into next month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T10:00:00Z')); // April = 30 days
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([makeClient({ invoiceDayOfMonth: 31 })]),
      }),
    });

    const { generateMonthlyDraftInvoices } = await import('../services/recurringInvoiceService');
    await generateMonthlyDraftInvoices('tenant-1');

    const insertCall = mockDbInsert.mock.results[0].value.values.mock.calls[0][0];
    // April has 30 days — must NOT roll into May 1st.
    expect(insertCall.invoiceDate.getMonth()).toBe(3); // April (0-indexed)
    expect(insertCall.invoiceDate.getDate()).toBe(30);
    vi.useRealTimers();
  });

  it('H8: dedup query scopes to is_recurring=true and excludes cancelled invoices', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([makeClient()]),
      }),
    });

    const { generateMonthlyDraftInvoices } = await import('../services/recurringInvoiceService');
    await generateMonthlyDraftInvoices('tenant-1');

    const dedupQuery = extractSqlText(mockDbExecute.mock.calls[0][0]);
    expect(dedupQuery).toContain('is_recurring');
    expect(dedupQuery).toContain("status != 'cancelled'");
  });

  it('H8: a manual one-off invoice does not block the recurring draft (dedup only matches is_recurring rows)', async () => {
    // The dedup SELECT itself is mocked to return empty (simulating that no
    // is_recurring row exists this month, even though — pre-fix — a manual
    // invoice would have blocked this by matching on client+month alone).
    mockDbExecute.mockResolvedValue({ rows: [] });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([makeClient()]),
      }),
    });

    const { generateMonthlyDraftInvoices } = await import('../services/recurringInvoiceService');
    const result = await generateMonthlyDraftInvoices('tenant-1');

    expect(result.generated).toBe(1);
    expect(mockGetNextInvoiceNumber).toHaveBeenCalledTimes(1);
  });

  it('H9: does not apply a stale taxType when the client is not GST-registered', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([makeClient({ isGst: false, taxType: 'cgst_sgst' })]),
      }),
    });

    const { generateMonthlyDraftInvoices } = await import('../services/recurringInvoiceService');
    await generateMonthlyDraftInvoices('tenant-1');

    const insertCall = mockDbInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertCall.invoiceType).toBe('non_gst');
    expect(insertCall.taxType).toBeNull();
    // No tax should have been calculated at all — a non-GST invoice must
    // not silently carry CGST/SGST/IGST amounts from a stale client field.
    expect(insertCall.cgstAmount).toBe(0);
    expect(insertCall.sgstAmount).toBe(0);
    expect(insertCall.igstAmount).toBe(0);
    expect(insertCall.totalAmount).toBe(insertCall.subtotal);
  });

  it('GST client still gets its configured tax type applied normally', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([makeClient({ isGst: true, taxType: 'cgst_sgst' })]),
      }),
    });

    const { generateMonthlyDraftInvoices } = await import('../services/recurringInvoiceService');
    await generateMonthlyDraftInvoices('tenant-1');

    const insertCall = mockDbInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertCall.taxType).toBe('cgst_sgst');
    expect(insertCall.cgstAmount).toBeGreaterThan(0);
    expect(insertCall.sgstAmount).toBeGreaterThan(0);
  });
});
