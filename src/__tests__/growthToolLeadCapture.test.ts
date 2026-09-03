// Growth Tool lead capture.
//
// The website has always sent a block of Growth Tool context — which
// calculator ran, what it concluded, the visitor's own revenue and ad-spend
// figures, and the P1/P2 scored from them. src/routes/leads.ts read none of
// it, so the strongest qualification signal we hold ("₹25 lakh revenue, ₹3
// lakh ad spend") was discarded on arrival and the CRM rendered an empty
// revenue field.
//
// The parser is covered here rather than through the route because the failure
// it guards against is silent: nothing throws when a field is ignored, so only
// an assertion on the parsed shape catches a regression.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/contactService', () => ({
  findOrCreateContact: vi.fn(),
  normalizeChannelValue: (_t: string, v: string) => v,
}));
vi.mock('../services/tenantFeatures', () => ({
  getDefaultIngestTenant: vi.fn(),
  getSingleActiveTenantWithFeature: vi.fn(),
}));
vi.mock('../services/slackService', () => ({ sendSlackMessage: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../db/index', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: vi.fn() }) }) }),
    update: () => ({ set: () => ({ where: vi.fn() }) }),
    insert: () => ({ values: () => ({ returning: vi.fn(), onConflictDoNothing: vi.fn() }) }),
  },
  contacts: { id: 'id' },
  contactChannels: {},
  events: {},
}));

const FULL_PAYLOAD = {
  toolId: 'd2c-profit-calculator',
  intentCluster: 'd2c-unit-economics',
  leadPriority: 'P1',
  toolHeadline: 'Your contribution margin is 24% at current spend',
  toolMetrics: [
    { label: 'Contribution margin', value: '24%' },
    { label: 'Blended ROAS', value: '3.1x' },
  ],
  toolRecommendations: ['Cut spend on the two worst-performing ad sets'],
  sourceBlog: 'cac-vs-ltv-ecommerce-ad-spend-math',
  sourceBlogTitle: 'CAC vs LTV: the ad spend math',
  qualification: { revenueLakh: 25, adSpendLakh: 3, targetRevenueLakh: 40, score: 62, stage: 'scaling' },
};

describe('parseGrowthTool', () => {
  it('keeps the figures the CRM used to discard', async () => {
    const { parseGrowthTool } = await import('../routes/leads');
    const parsed = parseGrowthTool(FULL_PAYLOAD)!;

    expect(parsed.revenueLakh).toBe(25);
    expect(parsed.adSpendLakh).toBe(3);
    expect(parsed.score).toBe(62);
    expect(parsed.priority).toBe('P1');
    expect(parsed.toolId).toBe('d2c-profit-calculator');
    expect(parsed.sourceBlog).toBe('cac-vs-ltv-ecommerce-ad-spend-math');
    expect(parsed.metrics).toHaveLength(2);
    expect(parsed.headline).toContain('contribution margin');
  });

  // The same route serves the contact form and every industry landing page.
  // Returning a growthTool object for those would tag ordinary leads as tool
  // leads and pollute the per-article reporting.
  it('returns null for an ordinary website lead', async () => {
    const { parseGrowthTool } = await import('../routes/leads');
    expect(parseGrowthTool({ name: 'Priya', email: 'p@example.com', service: 'SEO' })).toBeNull();
    expect(parseGrowthTool({})).toBeNull();
    expect(parseGrowthTool(undefined)).toBeNull();
  });

  // Priority drives a contact tag, so an unrecognised value must not become
  // one — a stray "p3" tag would quietly break the P1 filter.
  it('accepts only P1 and P2 as a priority', async () => {
    const { parseGrowthTool } = await import('../routes/leads');
    expect(parseGrowthTool({ toolId: 't', leadPriority: 'p1' })!.priority).toBe('P1');
    expect(parseGrowthTool({ toolId: 't', leadPriority: 'P3' })!.priority).toBe('');
    expect(parseGrowthTool({ toolId: 't', leadPriority: 'urgent' })!.priority).toBe('');
    expect(parseGrowthTool({ toolId: 't' })!.priority).toBe('');
  });

  it('rejects nonsense numbers rather than storing them', async () => {
    const { parseGrowthTool } = await import('../routes/leads');
    const parsed = parseGrowthTool({
      toolId: 't',
      qualification: { revenueLakh: -5, adSpendLakh: 'abc', score: 900, targetRevenueLakh: null },
    })!;

    expect(parsed.revenueLakh).toBeNull();
    expect(parsed.adSpendLakh).toBeNull();
    expect(parsed.score).toBeNull();
    expect(parsed.targetRevenueLakh).toBeNull();
  });

  it('drops half-formed metrics instead of rendering blank rows', async () => {
    const { parseGrowthTool } = await import('../routes/leads');
    const parsed = parseGrowthTool({
      toolId: 't',
      toolMetrics: [
        { label: 'Good', value: '1' },
        { label: '', value: '2' },
        { label: 'No value', value: '' },
        'not an object',
      ],
    })!;

    expect(parsed.metrics).toEqual([{ label: 'Good', value: '1' }]);
  });

  it('survives a payload with no qualification block at all', async () => {
    const { parseGrowthTool } = await import('../routes/leads');
    const parsed = parseGrowthTool({ toolId: 'shopify-cro-scorecard', leadPriority: 'P2' })!;

    expect(parsed.priority).toBe('P2');
    expect(parsed.revenueLakh).toBeNull();
    expect(parsed.metrics).toEqual([]);
    expect(parsed.recommendations).toEqual([]);
  });
});
