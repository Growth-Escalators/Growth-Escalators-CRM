// services/opportunityService.ts's sendMoneyOnTableWhatsApp() had no caller
// anywhere in the codebase as of this fix — routes/growthOS.ts's
// POST /opportunity/generate only calls calculateMoneyOnTable(), never the
// WhatsApp send. It's dead code today, but it sends over the same shared
// GE-only WhatsApp identity as its sibling functions in brandHealthService
// .ts and competitorService.ts (see growthOSResellerWhatsAppBlock.test.ts),
// both of which already gate on canSendGrowthOSWhatsApp() — this one didn't.
// Fixed defensively to match the sibling pattern so the same landmine can't
// reappear the moment someone wires the send in.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const GE_TENANT_ID = 'tenant-ge-00000000-0000-0000-0000-000000000000';
const RESELLER_TENANT_ID = 'tenant-acme-1111111-1111-1111-111111111111';

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

function mockGeTenantLookup() {
  mockPoolQuery.mockImplementation(async (sqlText: string) => {
    if (String(sqlText).includes('FROM tenants WHERE slug')) return { rows: [{ id: GE_TENANT_ID }] };
    return { rows: [] };
  });
}

function makeReport(tenantId: string | null, clientName = 'Paraiso') {
  return {
    client_name: clientName,
    ad_account_id: 'act_1',
    tenant_id: tenantId,
    week_start: '2026-07-27',
    cart_abandonment_opportunity: 10000,
    winback_opportunity: 5000,
    whatsapp_optin_opportunity: 2000,
    email_sequence_opportunity: 1000,
    upsell_opportunity: 3000,
    total_opportunity: 21000,
    detail: { has_cart_sequence: false, has_winback_sequence: true, missed_optins_per_month: 40, missing_sequences: [] },
  };
}

describe('services/opportunityService.ts — sendMoneyOnTableWhatsApp', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockGeTenantLookup();
    process.env.META_PHONE_NUMBER_ID = 'ge-shared-phone-id';
    process.env.META_ACCESS_TOKEN = 'ge-shared-token';
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.META_PHONE_NUMBER_ID;
    delete process.env.META_ACCESS_TOKEN;
  });

  it("GE's own tenant report still sends the WhatsApp summary", async () => {
    const { sendMoneyOnTableWhatsApp } = await import('../services/opportunityService');
    await sendMoneyOnTableWhatsApp(makeReport(GE_TENANT_ID) as any, '917733888883');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('ge-shared-phone-id');
  });

  it('a reseller tenant report is blocked — no WhatsApp send attempted', async () => {
    const { sendMoneyOnTableWhatsApp } = await import('../services/opportunityService');
    await sendMoneyOnTableWhatsApp(makeReport(RESELLER_TENANT_ID) as any, '911234567890');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a report with no tenant_id at all (never GE) is blocked the same way', async () => {
    const { sendMoneyOnTableWhatsApp } = await import('../services/opportunityService');
    await sendMoneyOnTableWhatsApp(makeReport(null) as any, '911234567890');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
