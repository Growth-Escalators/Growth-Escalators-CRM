// services/copilotService.ts's handleCopilotMessage() replies to an inbound
// Growth OS Co-Pilot WhatsApp message via sendWhatsAppMessage() — the same
// shared GE-only WhatsApp identity guarded elsewhere by canSendWhatsApp()
// (routes/inbox.ts) and canSendGrowthOSWhatsApp() (services/growthOSSetup
// .ts, see growthOSResellerWhatsAppBlock.test.ts). The Co-Pilot poller cron
// (worker.ts, every 10 minutes) sweeps founder_whatsapp across every
// tenant's growth_os_clients with no tenant filter — by design, so it can
// match the inbound message regardless of which client sent it — so the
// reply itself was the only ungated point. This pins the guard added at
// Step 4 of handleCopilotMessage: only GE's own tenant's client gets a
// WhatsApp reply; a reseller tenant's client is blocked with no Meta call,
// while the conversation is still logged for every tenant.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const GE_TENANT_ID = 'tenant-ge-00000000-0000-0000-0000-000000000000';
const RESELLER_TENANT_ID = 'tenant-acme-1111111-1111-1111-111111111111';

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

function makeClientRow(tenantId: string | null, clientName = 'Paraiso') {
  return {
    client_name: clientName,
    tenant_id: tenantId,
    founder_whatsapp: '+917733888883',
    is_active: true,
    industry: 'D2C',
    monthly_ad_spend: 100000,
    target_roas: 3,
  };
}

function mockClientLookup(row: Record<string, unknown> | undefined) {
  mockPoolQuery.mockImplementation(async (sqlText: string) => {
    const sql = String(sqlText);
    if (sql.includes('FROM tenants WHERE slug')) return { rows: [{ id: GE_TENANT_ID }] };
    if (sql.includes('FROM growth_os_clients WHERE replace')) return { rows: row ? [row] : [] };
    // gatherContext's health/opportunity/creatives/pipeline/contacts queries
    // and the copilot_conversations insert — none are under test here.
    return { rows: [] };
  });
}

describe('services/copilotService.ts — handleCopilotMessage WhatsApp reply guard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    delete process.env.CLAUDE_API_KEY; // force the offline fallback response — no Anthropic network call
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

  it("GE's own tenant client still gets a WhatsApp reply", async () => {
    mockClientLookup(makeClientRow(GE_TENANT_ID));

    const { handleCopilotMessage } = await import('../services/copilotService');
    const handled = await handleCopilotMessage('+917733888883', 'how is my brand doing?');

    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('ge-shared-phone-id');
    const logCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO copilot_conversations'));
    expect(logCall).toBeDefined();
  });

  it('a reseller tenant client is blocked from the WhatsApp reply — conversation is still logged', async () => {
    mockClientLookup(makeClientRow(RESELLER_TENANT_ID));

    const { handleCopilotMessage } = await import('../services/copilotService');
    const handled = await handleCopilotMessage('+917733888883', 'what is my ROAS?');

    expect(handled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    const logCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO copilot_conversations'));
    expect(logCall).toBeDefined();
  });

  it('a client with no tenant_id at all (never GE) is blocked the same way', async () => {
    mockClientLookup(makeClientRow(null));

    const { handleCopilotMessage } = await import('../services/copilotService');
    const handled = await handleCopilotMessage('+917733888883', 'why is my spend high?');

    expect(handled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no client match for the phone still routes to inbox normally (unaffected by the guard)', async () => {
    mockClientLookup(undefined);

    const { handleCopilotMessage } = await import('../services/copilotService');
    const handled = await handleCopilotMessage('+919999999999', 'is this an unknown sender?');

    expect(handled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
