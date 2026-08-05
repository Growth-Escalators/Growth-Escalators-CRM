import { describe, it, expect, vi, beforeEach } from 'vitest';

// invoiceNumberService.ts used to hardcode the invoice series prefix to
// 'GE/GST'/'GE/INV' regardless of which tenant was generating the invoice.
// These tests prove: (1) two different tenants get two different prefixes,
// and (2) Growth Escalators' own tenant still gets exactly 'GE/GST'/'GE/INV'
// — the literal it already had — so nothing changes for the one tenant that
// already has real invoices issued in that series.

const mockDbExecute = vi.fn();
const mockResolveTenantShortCode = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
}));

vi.mock('../services/tenantBrandingDefaults', () => ({
  resolveTenantShortCode: (...args: unknown[]) => mockResolveTenantShortCode(...args),
}));

beforeEach(() => {
  mockDbExecute.mockReset();
  mockResolveTenantShortCode.mockReset();
});

describe('invoiceNumberService — tenant-derived series prefix', () => {
  it('gives two different tenants two different, non-colliding prefixes', async () => {
    mockResolveTenantShortCode.mockImplementation(async (tenantId: string) =>
      (tenantId === 'tenant-ge' ? 'GE' : 'ACM'));
    mockDbExecute.mockResolvedValue({ rows: [{ last_number: 0 }] });

    const { peekNextInvoiceNumber } = await import('../services/invoiceNumberService');
    const geResult = await peekNextInvoiceNumber('tenant-ge', 'gst');
    const acmeResult = await peekNextInvoiceNumber('tenant-acme', 'gst');

    expect(geResult.number).toMatch(/^GE\/GST\//);
    expect(acmeResult.number).toMatch(/^ACM\/GST\//);
    expect(geResult.number).not.toBe(acmeResult.number);
    expect(mockResolveTenantShortCode).toHaveBeenCalledWith('tenant-ge');
    expect(mockResolveTenantShortCode).toHaveBeenCalledWith('tenant-acme');
  });

  it("keeps Growth Escalators' own prefix unchanged — GE/GST and GE/INV — for backward compatibility", async () => {
    mockResolveTenantShortCode.mockResolvedValue('GE');
    mockDbExecute.mockResolvedValue({ rows: [{ last_number: 4 }] });

    const { peekNextInvoiceNumber } = await import('../services/invoiceNumberService');
    const gst = await peekNextInvoiceNumber('tenant-ge', 'gst');
    const nonGst = await peekNextInvoiceNumber('tenant-ge', 'non_gst');

    expect(gst.number).toMatch(/^GE\/GST\//);
    expect(nonGst.number).toMatch(/^GE\/INV\//);
  });

  it('getNextInvoiceNumber (the mutating path) also uses the tenant-derived prefix', async () => {
    mockResolveTenantShortCode.mockResolvedValue('WIZ');
    mockDbExecute.mockResolvedValue({ rows: [{ last_number: 7 }] });

    const { getNextInvoiceNumber } = await import('../services/invoiceNumberService');
    const result = await getNextInvoiceNumber('tenant-wizmatch', 'non_gst');

    expect(result.number).toMatch(/^WIZ\/INV\//);
    expect(result.series).toBe(7);
  });
});
