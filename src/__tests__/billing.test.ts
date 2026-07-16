import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateTax } from '../services/recurringInvoiceService';
import { getCurrentFinancialYear } from '../services/invoiceNumberService';

// ---------------------------------------------------------------------------
// GST calculation — imports the REAL calculateTax from
// recurringInvoiceService.ts (M2 fix). The previous version of this file
// re-implemented the function inline, so a real change to the production
// tax math could break silently while every test stayed green.
// ---------------------------------------------------------------------------

describe('GST Tax Calculation (real calculateTax)', () => {
  describe('CGST + SGST (intra-state)', () => {
    it('calculates 9% CGST + 9% SGST on subtotal', () => {
      const result = calculateTax(100000, 'cgst_sgst'); // 1000 INR in paise
      expect(result.cgstRate).toBe(9);
      expect(result.sgstRate).toBe(9);
      expect(result.cgstAmount).toBe(9000);  // 90 INR
      expect(result.sgstAmount).toBe(9000);  // 90 INR
      expect(result.igstRate).toBe(0);
      expect(result.igstAmount).toBe(0);
      expect(result.total).toBe(118000);     // 1180 INR
    });

    it('handles rounding for odd amounts', () => {
      const result = calculateTax(33333, 'cgst_sgst'); // 333.33 INR
      expect(result.cgstAmount).toBe(Math.round(33333 * 0.09)); // 3000
      expect(result.sgstAmount).toBe(Math.round(33333 * 0.09)); // 3000
      expect(result.total).toBe(33333 + result.cgstAmount + result.sgstAmount);
    });
  });

  describe('IGST (inter-state)', () => {
    it('calculates 18% IGST on subtotal', () => {
      const result = calculateTax(100000, 'igst'); // 1000 INR in paise
      expect(result.igstRate).toBe(18);
      expect(result.igstAmount).toBe(18000);  // 180 INR
      expect(result.cgstRate).toBe(0);
      expect(result.cgstAmount).toBe(0);
      expect(result.sgstRate).toBe(0);
      expect(result.sgstAmount).toBe(0);
      expect(result.total).toBe(118000);       // 1180 INR
    });

    it('IGST total matches CGST+SGST total for same subtotal', () => {
      const subtotal = 500000; // 5000 INR
      const igst = calculateTax(subtotal, 'igst');
      const cgstSgst = calculateTax(subtotal, 'cgst_sgst');
      expect(igst.total).toBe(cgstSgst.total);
    });
  });

  describe('No tax (null taxType)', () => {
    it('returns subtotal as total with zero taxes', () => {
      const result = calculateTax(100000, null);
      expect(result.total).toBe(100000);
      expect(result.cgstAmount).toBe(0);
      expect(result.sgstAmount).toBe(0);
      expect(result.igstAmount).toBe(0);
    });
  });

  describe('Paise to rupee conversion', () => {
    it('100 paise = 1 rupee', () => {
      const rupeesToPaise = (rupees: number) => rupees * 100;
      const paiseToRupees = (paise: number) => paise / 100;

      const subtotalRupees = 25000; // 25,000 INR retainer
      const subtotalPaise = rupeesToPaise(subtotalRupees);
      expect(subtotalPaise).toBe(2500000);

      const result = calculateTax(subtotalPaise, 'cgst_sgst');
      expect(paiseToRupees(result.total)).toBe(29500); // 25000 + 4500
    });
  });

  describe('Invoice number format', () => {
    it('GST format: GE/GST/YYYY-YY/NNN', () => {
      const num = 'GE/GST/2026-27/001';
      expect(num).toMatch(/^GE\/GST\/\d{4}-\d{2}\/\d{3}$/);
    });

    it('Non-GST format: GE/INV/YYYY-YY/NNN', () => {
      const num = 'GE/INV/2025-26/042';
      expect(num).toMatch(/^GE\/INV\/\d{4}-\d{2}\/\d{3}$/);
    });
  });
});

// ---------------------------------------------------------------------------
// Financial year boundary — the REAL getCurrentFinancialYear (H6 fix).
// Computed in IST regardless of server-local timezone; Railway runs UTC,
// which put the April 1 FY boundary 5.5 hours late under the old
// server-local implementation.
// ---------------------------------------------------------------------------
describe('getCurrentFinancialYear (IST boundary, H6)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('March 2026 (well inside FY) → 2025-26', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T10:00:00Z'));
    expect(getCurrentFinancialYear()).toBe('2025-26');
  });

  it('May 2026 (well inside next FY) → 2026-27', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T10:00:00Z'));
    expect(getCurrentFinancialYear()).toBe('2026-27');
  });

  it('2026-03-31 23:59 IST (= 2026-03-31 18:29 UTC) → still 2025-26', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T18:29:00Z'));
    expect(getCurrentFinancialYear()).toBe('2025-26');
  });

  it('2026-04-01 00:01 IST (= 2026-03-31 18:31 UTC) → rolls to 2026-27, not late', () => {
    // This is the exact failure scenario from the review: under the old
    // server-local (UTC) implementation, this UTC instant still reads
    // month=3 (March) and would incorrectly return 2025-26.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T18:31:00Z'));
    expect(getCurrentFinancialYear()).toBe('2026-27');
  });

  it('2026-04-01 05:29 IST (= 2026-03-31 23:59 UTC) → still correctly 2026-27', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T23:59:00Z'));
    expect(getCurrentFinancialYear()).toBe('2026-27');
  });
});

// ---------------------------------------------------------------------------
// peek vs claim (H5) — mocked at the db layer since these hit invoice_series.
// ---------------------------------------------------------------------------
const mockDbExecute = vi.fn();
vi.mock('../db/index', () => ({
  db: { execute: (...args: unknown[]) => mockDbExecute(...args) },
}));

// drizzle-orm's sql`` tagged template doesn't stringify usefully via
// String(); the literal text lives in .queryChunks as StringChunk objects
// (shape { value: string[] }) interleaved with raw parameter values.
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

describe('peekNextInvoiceNumber vs getNextInvoiceNumber (H5)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockDbExecute.mockReset();
  });

  it('peek reads the current series without writing (SELECT only)', async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ last_number: 5 }] });
    const { peekNextInvoiceNumber } = await import('../services/invoiceNumberService');

    const result = await peekNextInvoiceNumber('tenant-1', 'gst');

    expect(result.series).toBe(6); // preview of what WOULD be claimed next
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    const queryText = extractSqlText(mockDbExecute.mock.calls[0][0]);
    expect(queryText.toUpperCase()).toContain('SELECT');
    expect(queryText.toUpperCase()).not.toContain('INSERT');
  });

  it('peek defaults to series 1 when no row exists yet for this tenant/type/year', async () => {
    mockDbExecute.mockResolvedValue({ rows: [] });
    const { peekNextInvoiceNumber } = await import('../services/invoiceNumberService');

    const result = await peekNextInvoiceNumber('tenant-1', 'gst');
    expect(result.series).toBe(1);
  });

  it('claim performs an INSERT ... ON CONFLICT upsert (mutates the series)', async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ last_number: 1 }] });
    const { getNextInvoiceNumber } = await import('../services/invoiceNumberService');

    await getNextInvoiceNumber('tenant-1', 'gst');

    const queryText = extractSqlText(mockDbExecute.mock.calls[0][0]);
    expect(queryText.toUpperCase()).toContain('INSERT');
    expect(queryText.toUpperCase()).toContain('ON CONFLICT');
  });
});
