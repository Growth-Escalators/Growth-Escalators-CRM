// Growth OS has no per-tenant WhatsApp Business number — every send in this
// module (health score, competitor pulse) goes out through GE's own
// META_PHONE_NUMBER_ID/META_ACCESS_TOKEN, the same shared identity guarded
// in routes/inbox.ts by canSendWhatsApp() (see inboxResellerWhatsAppBlock
// .test.ts). This pins the equivalent guard for Growth OS:
// canSendGrowthOSWhatsApp() in services/growthOSSetup.ts, applied inside
// sendHealthScoreWhatsApp (brandHealthService.ts) and sendCompetitorWhatsApp
// (competitorService.ts) — the shared point both the HTTP routes
// (POST /health/generate, POST /competitor/run) and the unscoped daily/
// weekly crons in worker.ts call through.
//
// Every test below asserts: GE's own tenant keeps sending exactly as
// before (transport mock called), a reseller tenant's client is blocked
// with no send attempt (transport mock never called), and the surrounding
// non-WhatsApp work (score/pulse calculation, DB save) still completes for
// every tenant — only the delivery step is gated.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const GE_TENANT_ID = 'tenant-ge-00000000-0000-0000-0000-000000000000';
const RESELLER_TENANT_ID = 'tenant-acme-1111111-1111-1111-111111111111';

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
}));

function mockGeTenantLookup() {
  mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
    if (String(sqlText).includes('FROM tenants WHERE slug')) {
      return { rows: [{ id: GE_TENANT_ID }] };
    }
    return { rows: [] }; // every other write (saveHealthScore, competitor_pulse insert, ...) — no-op success
  });
}

describe('services/growthOSSetup.ts — canSendGrowthOSWhatsApp', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockGeTenantLookup();
  });

  it("resolves true for GE's own tenant id", async () => {
    const { canSendGrowthOSWhatsApp } = await import('../services/whatsappSendGuard');
    await expect(canSendGrowthOSWhatsApp(GE_TENANT_ID)).resolves.toBe(true);
  });

  it('resolves false for a reseller tenant id', async () => {
    const { canSendGrowthOSWhatsApp } = await import('../services/whatsappSendGuard');
    await expect(canSendGrowthOSWhatsApp(RESELLER_TENANT_ID)).resolves.toBe(false);
  });

  it('fails closed for a null/undefined tenant id (never GE)', async () => {
    const { canSendGrowthOSWhatsApp } = await import('../services/whatsappSendGuard');
    await expect(canSendGrowthOSWhatsApp(null)).resolves.toBe(false);
    await expect(canSendGrowthOSWhatsApp(undefined)).resolves.toBe(false);
  });

  it('fails closed if the GE tenant lookup itself comes back empty', async () => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] }); // no tenants row at all
    const { canSendGrowthOSWhatsApp } = await import('../services/whatsappSendGuard');
    await expect(canSendGrowthOSWhatsApp(GE_TENANT_ID)).resolves.toBe(false);
  });
});

describe('services/brandHealthService.ts — sendHealthScoreWhatsApp', () => {
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

  function makeScore(tenantId: string | null, clientName = 'Paraiso') {
    return {
      client_name: clientName,
      ad_account_id: 'act_1',
      tenant_id: tenantId,
      score_date: '2026-08-04',
      overall_score: 80,
      ads_score: 80, email_score: 70, whatsapp_score: 80, seo_score: 80, retention_score: 80,
      ads_detail: {}, email_detail: {}, whatsapp_detail: {}, seo_detail: {}, retention_detail: {},
      previous_score: null,
      score_change: 0,
      alerts: [],
    };
  }

  it("GE's own tenant client still gets the WhatsApp send", async () => {
    const { sendHealthScoreWhatsApp } = await import('../services/brandHealthService');
    await sendHealthScoreWhatsApp(makeScore(GE_TENANT_ID) as any, '917733888883');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('ge-shared-phone-id');
  });

  it('a reseller tenant client is blocked — no WhatsApp send attempted', async () => {
    const { sendHealthScoreWhatsApp } = await import('../services/brandHealthService');
    await sendHealthScoreWhatsApp(makeScore(RESELLER_TENANT_ID) as any, '911234567890');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a score with no tenant_id at all (never GE) is blocked the same way', async () => {
    const { sendHealthScoreWhatsApp } = await import('../services/brandHealthService');
    await sendHealthScoreWhatsApp(makeScore(null) as any, '911234567890');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('services/competitorService.ts — runCompetitorPulse', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockGeTenantLookup();
    delete process.env.CLAUDE_API_KEY; // force analyzeWithClaude's fallback path — no Anthropic network call
    process.env.META_PHONE_NUMBER_ID = 'ge-shared-phone-id';
    process.env.META_ACCESS_TOKEN = 'ge-shared-token';
    fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('facebook.com/ads/library')) {
        return { ok: true, json: async () => ({ data: [] }) };
      }
      // graph.facebook.com/v19.0/{phoneId}/messages — the actual WhatsApp send
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.META_PHONE_NUMBER_ID;
    delete process.env.META_ACCESS_TOKEN;
  });

  function makeClient(tenantId: string | null, clientName = 'Paraiso') {
    return {
      id: 'client-1',
      client_name: clientName,
      ad_account_id: 'act_1',
      founder_whatsapp: '917733888883',
      founder_name: 'Jatin',
      monthly_ad_spend: 150000,
      target_roas: 3,
      competitors: ['Style Jaipur'],
      industry: 'D2C',
      is_active: true,
      tenant_id: tenantId,
    };
  }

  function whatsappSendCalls() {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes('graph.facebook.com'));
  }

  it("GE's own tenant client still gets the competitor-pulse WhatsApp send, and the pulse row is still saved", async () => {
    const { runCompetitorPulse } = await import('../services/competitorService');
    await runCompetitorPulse(makeClient(GE_TENANT_ID) as any);

    expect(whatsappSendCalls().length).toBe(1);
    const insertCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO competitor_pulse'));
    expect(insertCall).toBeDefined();
  });

  it('a reseller tenant client is blocked from the WhatsApp send, but the pulse row is still saved', async () => {
    const { runCompetitorPulse } = await import('../services/competitorService');
    await runCompetitorPulse(makeClient(RESELLER_TENANT_ID) as any);

    expect(whatsappSendCalls().length).toBe(0);
    const insertCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO competitor_pulse'));
    expect(insertCall).toBeDefined();
  });

  it('a client with no tenant_id at all (never GE) is blocked the same way', async () => {
    const { runCompetitorPulse } = await import('../services/competitorService');
    await runCompetitorPulse(makeClient(null) as any);

    expect(whatsappSendCalls().length).toBe(0);
  });
});
