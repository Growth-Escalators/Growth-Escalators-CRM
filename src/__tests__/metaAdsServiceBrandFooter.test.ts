import { describe, it, expect, vi } from 'vitest';

// buildDailyReport is only ever called from the manual dev scripts under
// src/scripts/ (sampleRunAll.ts, sampleMetaAdsLive.ts, testSlackFlows.ts) —
// never a live route or the production cron (the 9:30 AM cron sends
// buildAccountReport() messages instead) — but its footer used to hardcode
// "_Powered by Growth Escalators_" regardless of which tenant's data was
// being previewed. This covers the fix: the footer now takes the tenant's
// own displayName, with a generic (never GE-specific) fallback.

vi.mock('../db/index', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { buildDailyReport, type AccountInsights } from '../services/metaAdsService';

function sampleAccount(overrides: Partial<AccountInsights> = {}): AccountInsights {
  return {
    clientName: 'Test Brand',
    accountId: 'act_1',
    yesterday: { spend: 1000, purchases: 2, roas: 3, revenue: 3000, impressions: 100, clicks: 10, ctr: 0.1 },
    last7days: { spend: 7000, purchases: 14, roas: 3, revenue: 21000, impressions: 700, clicks: 70, ctr: 0.1 },
    thisMonth: null,
    bestCampaign: null,
    ...overrides,
  };
}

describe('buildDailyReport — tenant-branded footer', () => {
  it('uses a non-GE tenant\'s own displayName in the footer, never the literal "Growth Escalators"', () => {
    const report = buildDailyReport([sampleAccount()], 'Acme Recruiting');
    expect(report).toContain('Powered by Acme Recruiting');
    expect(report).not.toContain('Growth Escalators');
  });

  it("GE's own tenant still renders its own real (now-seeded) displayName unchanged", () => {
    const report = buildDailyReport([sampleAccount()], 'Growth Escalators');
    expect(report).toContain('Powered by Growth Escalators');
  });

  it('falls back to a generic placeholder — not "Growth Escalators" — when no tenant displayName is supplied', () => {
    const report = buildDailyReport([sampleAccount()]);
    expect(report).toContain('Powered by Client Workspace');
    expect(report).not.toContain('Growth Escalators');
  });
});
