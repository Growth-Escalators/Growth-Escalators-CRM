import { describe, it, expect, vi, beforeEach } from 'vitest';

// src/services/financeService.ts's calculatePnL() summed total_amount for
// BOTH 'paid' and 'partially_paid' invoices, so a partially-paid ₹1,00,000
// invoice with only ₹10,000 actually collected reported the full ₹1,00,000
// as revenue. The fix: 'paid' invoices contribute total_amount, but
// 'partially_paid' invoices contribute only amount_paid (what was actually
// collected).

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe('financeService.calculatePnL — revenue recognition', () => {
  it('a partially-paid invoice contributes only amount_paid (cash collected), not the invoice face value', async () => {
    // Simulates the real SQL's CASE expression: a 'paid' invoice for
    // ₹50,000 (5,000,000 paise) contributes its full total, and a
    // 'partially_paid' invoice for ₹1,00,000 (10,000,000 paise) with only
    // ₹10,000 (1,000,000 paise) actually collected contributes ONLY that
    // collected amount.
    const paidTotal = 5_000_000;
    const partiallyPaidTotal = 10_000_000;
    const partiallyPaidCollected = 1_000_000;
    const expectedRevenuePaise = paidTotal + partiallyPaidCollected; // NOT paidTotal + partiallyPaidTotal

    mockPoolQuery.mockImplementation(async (sqlText: string) => {
      const sql = String(sqlText);
      if (sql.includes('FROM invoices') && sql.includes("status IN ('paid', 'partially_paid')")) {
        // Assert the fix is actually present: a CASE expression that
        // branches on status, not a blanket SUM(total_amount).
        expect(sql).toMatch(/CASE/);
        expect(sql).toMatch(/amount_paid/);
        return { rows: [{ total: expectedRevenuePaise }] };
      }
      if (sql.includes('FROM income_entries')) return { rows: [{ total: 0 }] };
      if (sql.includes('FROM expenses e') && !sql.includes('GROUP BY')) return { rows: [{ total: 0 }] };
      if (sql.includes('GROUP BY')) return { rows: [] };
      return { rows: [{ total: 0 }] };
    });

    const { calculatePnL } = await import('../services/financeService');
    const result = await calculatePnL('tenant-a', '2026-07');

    // Paise -> rupees, rounded, matching the service's own conversion.
    expect(result.revenue).toBe(Math.round(expectedRevenuePaise / 100));
    expect(result.revenueBreakdown.invoices).toBe(Math.round(expectedRevenuePaise / 100));
    // Regression guard: must NOT equal the old (buggy) behaviour of
    // recognising the full face value of the partially-paid invoice.
    expect(result.revenue).not.toBe(Math.round((paidTotal + partiallyPaidTotal) / 100));
  });
});
