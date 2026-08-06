import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COMPANY_GSTIN } from '../config/constants';

// src/services/retainerService.ts's generateInvoiceFromRetainer() had literal
// JS (`process.env.COMPANY_GSTIN ?? '08DRYPA4899F2ZZ'`) pasted directly into
// a SQL VALUES clause — Postgres cannot parse that as SQL, so this function
// threw on every single call and the "generate invoice from retainer"
// feature was 100% broken. There was no test exercising this file at all, so
// nothing caught it. These tests call the real function end-to-end (with a
// mocked pool) and assert it succeeds and produces a correct invoice row —
// exactly what should have existed before the bug shipped.

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../services/invoiceNumberService', () => ({
  getNextInvoiceNumber: vi.fn().mockResolvedValue({ number: 'GE/GST/2026-27/005', series: 5, financialYear: '2026-27' }),
}));

vi.mock('../services/amountInWordsService', () => ({
  amountInWords: () => 'Eleven Thousand Eight Hundred Rupees Only',
}));

const mockResolveTenantShortCode = vi.fn();
vi.mock('../services/tenantBrandingDefaults', () => ({
  resolveTenantShortCode: (...args: unknown[]) => mockResolveTenantShortCode(...args),
}));

const RETAINER_ROW = {
  id: 42,
  tenant_id: 'tenant-a',
  client_id: 'client-99',
  client_name: 'Acme Co',
  tax_type: 'cgst_sgst',
  invoice_type: 'gst',
  gstin: 'RETAINER_GSTIN_1',
  billing_state: 'Rajasthan',
  billing_address_line1: 'Line 1',
  billing_address_line2: null,
  billing_city: 'Jaipur',
  billing_pincode: '302001',
  billing_country: 'India',
  notes: 'monthly retainer',
};

const LINE_ITEM_ROW = {
  description: 'SEO Retainer', sac_code: '9983', quantity: 1, unit: 'Month', rate: 10000, amount: 10000, sort_order: 0,
};

function setupPoolMock(opts: { clientId?: string | null; stateCode?: string | null } = {}) {
  const capturedInsertInvoiceCall: { sql: string; params: unknown[] }[] = [];
  const clientId = opts.clientId === undefined ? 'client-99' : opts.clientId;
  const stateCode = opts.stateCode === undefined ? '08' : opts.stateCode;

  mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
    const sql = String(sqlText);
    if (sql.includes('FROM client_retainers')) {
      return { rows: [{ ...RETAINER_ROW, client_id: clientId }] };
    }
    if (sql.includes('FROM retainer_line_items')) {
      return { rows: [LINE_ITEM_ROW] };
    }
    if (sql.includes('SELECT state_code FROM billing_clients')) {
      expect(params).toEqual([clientId]);
      return { rows: [{ state_code: stateCode }] };
    }
    if (sql.includes('INSERT INTO invoices')) {
      capturedInsertInvoiceCall.push({ sql, params });
      return { rows: [{ id: 'new-invoice-id' }] };
    }
    if (sql.includes('INSERT INTO invoice_line_items')) {
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  return capturedInsertInvoiceCall;
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockResolveTenantShortCode.mockReset();
});

describe('retainerService.generateInvoiceFromRetainer', () => {
  it('succeeds end-to-end and returns a real invoiceId (previously threw on every call)', async () => {
    setupPoolMock();
    const { generateInvoiceFromRetainer } = await import('../services/retainerService');

    const result = await generateInvoiceFromRetainer(42, 'tenant-a', 'user@test.com');

    expect(result.error).toBeUndefined();
    expect(result.invoiceId).toBe('new-invoice-id');
  });

  it('binds COMPANY_GSTIN as a real query parameter — the INSERT SQL text never contains raw JS', async () => {
    const captured = setupPoolMock();
    const { generateInvoiceFromRetainer } = await import('../services/retainerService');

    await generateInvoiceFromRetainer(42, 'tenant-a', 'user@test.com');

    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0];
    expect(sql).not.toMatch(/process\.env/);
    expect(sql).toMatch(/client_state_code/);
    expect(params).toContain(COMPANY_GSTIN);
  });

  it('sets client_state_code from the linked billing_clients row when the retainer has a client_id', async () => {
    const captured = setupPoolMock({ clientId: 'client-99', stateCode: '08' });
    const { generateInvoiceFromRetainer } = await import('../services/retainerService');

    await generateInvoiceFromRetainer(42, 'tenant-a', 'user@test.com');

    const { params } = captured[0];
    expect(params).toContain('08');
  });

  it('falls back to null client_state_code for a standalone retainer with no client_id, without querying billing_clients', async () => {
    const captured = setupPoolMock({ clientId: null });
    const { generateInvoiceFromRetainer } = await import('../services/retainerService');

    await generateInvoiceFromRetainer(42, 'tenant-a', 'user@test.com');

    const billingClientsCalls = mockPoolQuery.mock.calls.filter(([sql]) => String(sql).includes('billing_clients'));
    expect(billingClientsCalls).toHaveLength(0);
    const { params } = captured[0];
    expect(params).toContain(null);
  });

  it('computes correct CGST+SGST tax totals from the retainer line items', async () => {
    setupPoolMock();
    const { generateInvoiceFromRetainer } = await import('../services/retainerService');

    await generateInvoiceFromRetainer(42, 'tenant-a', 'user@test.com');

    const insertCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO invoices'));
    const params = insertCall![1] as unknown[];
    // subtotal 10000 -> cgst 900, sgst 900, total 11800 (matches $7 subtotal,
    // $8 cgstRate, $9 cgstAmount, $10 sgstRate, $11 sgstAmount, $14 total)
    expect(params).toEqual(expect.arrayContaining([10000, 9, 900, 9, 900, 11800]));
  });
});

// ---------------------------------------------------------------------------
// getNextRetainerNumber — tenant scoping fix
// ---------------------------------------------------------------------------
// retainer_number previously had NO tenant scoping at all — not even in this
// lookup query — so the second tenant to generate a retainer in a given
// year could collide with an already-issued number on client_retainers'
// (global) UNIQUE NOT NULL retainer_number constraint. Fixed by embedding a
// tenant-derived short code into the number itself (RET/<code>/<year>/<seq>)
// and by tenant-scoping the lookup query, rather than migrating the UNIQUE
// constraint (a schema change, deliberately out of scope / separately
// flagged per AGENTS.md).
describe('retainerService.getNextRetainerNumber', () => {
  const year = new Date().getFullYear();

  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockResolveTenantShortCode.mockReset();
  });

  it('embeds a tenant-derived code and starts a fresh tenant at 001', async () => {
    mockResolveTenantShortCode.mockResolvedValue('ACM');
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const { getNextRetainerNumber } = await import('../services/retainerService');
    const number = await getNextRetainerNumber('tenant-acme');

    expect(number).toBe(`RET/ACM/${year}/001`);
    expect(mockResolveTenantShortCode).toHaveBeenCalledWith('tenant-acme');
  });

  it('scopes the lookup query by tenant_id AND the tenant-derived code, so two tenants never share a counter', async () => {
    mockResolveTenantShortCode.mockImplementation(async (tenantId: string) =>
      (tenantId === 'tenant-ge' ? 'GE' : 'ACM'));
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[]) => {
      expect(String(sqlText)).toMatch(/tenant_id\s*=\s*\$1/);
      if (params[0] === 'tenant-ge') return { rows: [{ retainer_number: `RET/GE/${year}/002` }] };
      return { rows: [] };
    });

    const { getNextRetainerNumber } = await import('../services/retainerService');
    const geNext = await getNextRetainerNumber('tenant-ge');
    const acmeNext = await getNextRetainerNumber('tenant-acme');

    expect(geNext).toBe(`RET/GE/${year}/003`);
    expect(acmeNext).toBe(`RET/ACM/${year}/001`);
    expect(geNext).not.toBe(acmeNext);
  });
});
