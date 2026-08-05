import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression test for the Growth OS Co-Pilot context-gathering leak (security
// audit follow-up, 2026-08-04): handleCopilotMessage() resolves the inbound
// WhatsApp sender to a growth_os_clients row (and that row's own tenant_id),
// but used to call gatherContext(clientName) with clientName alone — none of
// its five queries (brand_health_scores, money_on_table, creative_intelligence,
// deals, contacts) carried a tenant_id predicate. The deals/contacts
// aggregates in particular had NO predicate at all — not even client_name —
// so every Co-Pilot reply summed every tenant's deal-stage counts and 7-day
// contact growth into one number, regardless of which client asked. Fixed by
// threading tenantId into gatherContext() and adding the missing predicate to
// all five queries (see services/copilotService.ts). This test proves two
// clients with the SAME client_name in different tenants never see each
// other's data in the context handed to Claude.
//
// Same fake-filtered-database convention as growthOSTenantIsolation.test.ts:
// pool.query is mocked as a tiny filtered store keyed off the tenant_id
// actually bound in params — a query that regresses to being unscoped falls
// back to returning the union of both tenants' rows here too, so this test
// fails the same way the real leak would have surfaced.

const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'tenant-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PHONE_A = '917700000001';
const PHONE_B = '917700000002';

type Row = Record<string, unknown>;

const FIXTURES: Record<string, Record<string, Row[]>> = {
  brand_health_scores: {
    [TENANT_A]: [{ overall_score: 11, ads_score: 10, seo_score: 10, whatsapp_score: 10, email_score: 10, retention_score: 10, score_change: 1, alerts: [] }],
    [TENANT_B]: [{ overall_score: 99, ads_score: 90, seo_score: 90, whatsapp_score: 90, email_score: 90, retention_score: 90, score_change: 9, alerts: [] }],
  },
  money_on_table: {
    [TENANT_A]: [{ total_opportunity: 111, cart_abandonment_opportunity: 10, winback_opportunity: 10, detail: {} }],
    [TENANT_B]: [{ total_opportunity: 999, cart_abandonment_opportunity: 90, winback_opportunity: 90, detail: {} }],
  },
  creative_intelligence: {
    [TENANT_A]: [{ ad_name: 'tenantA-exclusive-ad', campaign_name: 'camp-a', fatigue_status: 'fatiguing', latest_roas: 1.1, latest_ctr: 1.1, days_running: 10 }],
    [TENANT_B]: [{ ad_name: 'tenantB-exclusive-ad', campaign_name: 'camp-b', fatigue_status: 'fatiguing', latest_roas: 9.9, latest_ctr: 9.9, days_running: 90 }],
  },
  deals: {
    [TENANT_A]: [{ stage: 'lead', cnt: '3' }],
    [TENANT_B]: [{ stage: 'won', cnt: '777' }],
  },
  contacts: {
    [TENANT_A]: [{ cnt: '5' }],
    [TENANT_B]: [{ cnt: '555' }],
  },
};

function fakeFilteredRead(sqlText: string, params: unknown[]): { rows: Row[] } {
  const table = Object.keys(FIXTURES).find((t) => sqlText.includes(t));
  if (!table) return { rows: [] };
  const matchedTenant = [TENANT_A, TENANT_B].find((t) => params.includes(t));
  if (!matchedTenant) return { rows: Object.values(FIXTURES[table]).flat() };
  return { rows: FIXTURES[table][matchedTenant] ?? [] };
}

function clientRow(tenantId: string, phone: string): Row {
  return {
    // Same client_name in both tenants on purpose — this is exactly the
    // collision scenario a client_name-only scope would get wrong.
    client_name: 'Acme',
    tenant_id: tenantId,
    founder_whatsapp: `+${phone}`,
    is_active: true,
    ad_account_id: 'act_shared', // same ad_account_id across tenants too
    industry: 'D2C',
    monthly_ad_spend: 100000,
    target_roas: 3,
  };
}

const CLIENTS_BY_PHONE: Record<string, Row> = {
  [PHONE_A]: clientRow(TENANT_A, PHONE_A),
  [PHONE_B]: clientRow(TENANT_B, PHONE_B),
};

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

// The WhatsApp-identity guard is a separate, already-fixed concern (see
// copilotWhatsAppGuard.test.ts) — mocked out here so this test stays focused
// on gatherContext's tenant scoping and doesn't need to also stand up the
// `tenants` lookup canSendGrowthOSWhatsApp depends on.
vi.mock('../services/whatsappSendGuard', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(true),
  canSendGrowthOSWhatsApp: vi.fn().mockResolvedValue(false),
}));

function extractClaudeContext(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { system: string };
  const match = body.system.match(/Current brand data:\n([\s\S]*?)\n\nBrand details:/);
  if (!match) throw new Error('Could not find context JSON in Claude system prompt');
  return JSON.parse(match[1]);
}

describe('services/copilotService.ts — gatherContext tenant isolation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      const sql = String(sqlText);
      if (sql.includes('FROM growth_os_clients WHERE replace')) {
        const phone = params[0] as string;
        const row = CLIENTS_BY_PHONE[phone];
        return { rows: row ? [row] : [] };
      }
      return fakeFilteredRead(sql, params);
    });
    // A real-looking key forces callClaude down the Anthropic branch instead
    // of the offline fallback, so the exact `context` object is observable in
    // the outgoing request body.
    process.env.CLAUDE_API_KEY = 'sk-ant-test-key-0000000000';
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLAUDE_API_KEY;
  });

  it("tenant A's Co-Pilot context never contains tenant B's health/opportunity/creative/deal/contact data, even though both clients share the SAME client_name", async () => {
    const { handleCopilotMessage } = await import('../services/copilotService');
    const handled = await handleCopilotMessage(`+${PHONE_A}`, 'how is my brand doing?');

    expect(handled).toBe(true);
    const context = extractClaudeContext(fetchMock);

    expect((context.recentHealth as Row).overall_score).toBe(11);
    expect((context.recentOpportunity as Row).total_opportunity).toBe(111);
    expect((context.activeCreatives as Row[]).map((c) => c.ad_name)).toEqual(['tenantA-exclusive-ad']);
    expect(context.pipelineData).toEqual([{ stage: 'lead', cnt: '3' }]);
    expect(context.contactsGrowth).toBe('5');
  });

  it("tenant B's Co-Pilot context never contains tenant A's data — same client_name, opposite direction", async () => {
    const { handleCopilotMessage } = await import('../services/copilotService');
    const handled = await handleCopilotMessage(`+${PHONE_B}`, 'what is my ROAS?');

    expect(handled).toBe(true);
    const context = extractClaudeContext(fetchMock);

    expect((context.recentHealth as Row).overall_score).toBe(99);
    expect((context.recentOpportunity as Row).total_opportunity).toBe(999);
    expect((context.activeCreatives as Row[]).map((c) => c.ad_name)).toEqual(['tenantB-exclusive-ad']);
    expect(context.pipelineData).toEqual([{ stage: 'won', cnt: '777' }]);
    expect(context.contactsGrowth).toBe('555');
  });

  it('the deals and contacts aggregate queries are bound to the caller tenant_id — before the fix they had no predicate at all', async () => {
    const { handleCopilotMessage } = await import('../services/copilotService');
    await handleCopilotMessage(`+${PHONE_A}`, 'how is my brand doing?');

    const dealsCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('FROM deals'));
    expect(dealsCall).toBeDefined();
    expect(dealsCall![0]).toMatch(/WHERE tenant_id = \$1/);
    expect(dealsCall![1]).toEqual([TENANT_A]);

    const contactsCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('FROM contacts'));
    expect(contactsCall).toBeDefined();
    expect(contactsCall![0]).toMatch(/tenant_id = \$1/);
    expect(contactsCall![1]).toEqual([TENANT_A]);
  });
});
