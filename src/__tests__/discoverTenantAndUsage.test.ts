import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockFindOrCreateContact = vi.fn();
const mockInsertOutreachLead = vi.fn().mockResolvedValue(undefined);

// Insert chain supporting .values().onConflictDoUpdate() for trackApiUsage.
const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
  },
}));

vi.mock('../db/schema', () => ({
  discoverySearches: { id: 'id', tenantId: 'tenant_id' },
  discoveryResults: { id: 'id', tenantId: 'tenant_id', imported: 'imported' },
  discoveryApiUsage: { id: 'id', tenantId: 'tenant_id', monthYear: 'month_year', apiCalls: 'api_calls', costUsd: 'cost_usd' },
  contacts: { id: 'id' },
}));

vi.mock('../services/contactService', () => ({
  findOrCreateContact: (...args: unknown[]) => mockFindOrCreateContact(...args),
}));

vi.mock('../services/outreachLeadsService', () => ({
  insertOutreachLead: (...args: unknown[]) => mockInsertOutreachLead(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('exceljs', () => ({ default: {} }));

function makeReqRes(tenantId: string, body: Record<string, unknown>) {
  const req = { user: { tenantId }, body } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

async function invokeImport(req: any, res: any) {
  const { default: router } = await import('../routes/discover');
  const layer = router.stack.find((l: any) => l.route?.path === '/import' && l.route?.methods?.post);
  await layer!.route!.stack[0].handle(req, res, vi.fn());
}

describe('POST /api/outreach/discover/import (H12/M20 — tenant fix + findOrCreateContact)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
    mockFindOrCreateContact.mockResolvedValue({
      contact: { id: 'new-contact-1', metadata: {} },
      channels: [],
      created: true,
    });
  });

  it('creates the contact under the CALLING tenant, not "the first tenant"', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 'result-1', companyName: 'Acme Ltd', phoneNumber: '+44 20 7946 0958', address: '1 Main St', imported: false },
        ]),
      }),
    });

    const { req, res } = makeReqRes('tenant-caller', { resultIds: ['result-1'] });
    await invokeImport(req, res);

    expect(mockFindOrCreateContact).toHaveBeenCalledTimes(1);
    // First positional arg to findOrCreateContact is the tenantId — must be
    // the AUTHENTICATED CALLER's tenant, never a "first tenant in the table"
    // lookup (the pre-fix bug: any second real tenant would have its leads
    // silently imported into tenant #1's CRM instead of the caller's own).
    expect(mockFindOrCreateContact.mock.calls[0][0]).toBe('tenant-caller');
  });

  it('passes the raw phone number as a channel — findOrCreateContact normalizes it, not this route', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 'result-1', companyName: 'Acme Ltd', phoneNumber: '+44 20 7946 0958', address: null, imported: false },
        ]),
      }),
    });

    const { req, res } = makeReqRes('tenant-caller', { resultIds: ['result-1'] });
    await invokeImport(req, res);

    const callArg = mockFindOrCreateContact.mock.calls[0][1];
    expect(callArg.channels).toEqual([
      { channelType: 'phone', channelValue: '+44 20 7946 0958', isPrimary: true },
    ]);
  });

  it('bumps lastActivityAt on every imported contact (the CRM sort invariant)', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 'result-1', companyName: 'Acme Ltd', phoneNumber: null, address: null, imported: false },
        ]),
      }),
    });

    const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbUpdate.mockReturnValue({ set: setSpy });

    const { req, res } = makeReqRes('tenant-caller', { resultIds: ['result-1'] });
    await invokeImport(req, res);

    const contactUpdateCall = setSpy.mock.calls.find((c) => 'lastActivityAt' in (c[0] as object));
    expect(contactUpdateCall).toBeDefined();
    expect(contactUpdateCall![0].lastActivityAt).toBeInstanceOf(Date);
  });

  it('does not overwrite status when the contact already existed (dedup match)', async () => {
    mockFindOrCreateContact.mockResolvedValue({
      contact: { id: 'existing-contact-1', metadata: {} },
      channels: [],
      created: false,
    });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 'result-1', companyName: 'Acme Ltd', phoneNumber: null, address: null, imported: false },
        ]),
      }),
    });

    const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbUpdate.mockReturnValue({ set: setSpy });

    const { req, res } = makeReqRes('tenant-caller', { resultIds: ['result-1'] });
    await invokeImport(req, res);

    const contactUpdateCall = setSpy.mock.calls.find((c) => 'lastActivityAt' in (c[0] as object));
    // status must be undefined (Drizzle omits it from the SQL) so an
    // existing won/qualified contact isn't silently reset to 'lead' just
    // because a fresh Places search rediscovered the same company.
    expect(contactUpdateCall![0].status).toBeUndefined();
  });
});

describe('trackApiUsage (correctness finding #14 — atomic upsert)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs a single insert().values().onConflictDoUpdate() call — no select-then-write race window', async () => {
    const { trackApiUsage } = await import('../routes/discover');
    await trackApiUsage('tenant-caller', 3, 0.128);

    // No SELECT precedes the write — the old racy version read costUsd,
    // computed the new total in JS, then wrote it back, leaving a window
    // where two concurrent calls could both read the same starting value.
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-caller', apiCalls: 3, costUsd: '0.128' }),
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const upsertArg = mockOnConflictDoUpdate.mock.calls[0][0];
    expect(upsertArg.target).toBeDefined();
    // The increments must be SQL expressions computed server-side
    // (col + $n), not JS-computed literals — that's what makes concurrent
    // increments safe.
    expect(upsertArg.set.apiCalls).toBeDefined();
    expect(upsertArg.set.costUsd).toBeDefined();
  });
});
