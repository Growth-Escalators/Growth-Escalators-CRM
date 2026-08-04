// Companion to growthOSResellerWhatsAppBlock.test.ts (which pins the actual
// guard, canSendGrowthOSWhatsApp, against the real brandHealthService /
// competitorService functions). This file stays at the routes/growthOS.ts
// layer with those services mocked wholesale — it only asserts the route
// CONTRACT didn't change: POST /health/generate and POST /competitor/run
// still respond 200 and still kick off generation for a reseller tenant.
// (The WhatsApp gating itself lives one layer down and isn't re-asserted
// here — that's what the other file's mocked-transport tests are for.)
//
// Split into its own file because vi.mock(...) factories hoist to the top
// of the whole test file — mocking these services here would otherwise
// clobber the real-module tests in growthOSResellerWhatsAppBlock.test.ts.

import { describe, it, expect, vi } from 'vitest';

const RESELLER_TENANT_ID = 'tenant-acme-1111111-1111-1111-111111111111';

const mockGetActiveGrowthOSClients = vi.fn().mockResolvedValue([]);
const mockCalculateBrandHealth = vi.fn().mockResolvedValue({ overall_score: 80 });
const mockSendHealthScoreWhatsApp = vi.fn().mockResolvedValue(undefined);
const mockRunCompetitorPulse = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/growthOSSetup', () => ({
  getActiveGrowthOSClients: (...args: unknown[]) => mockGetActiveGrowthOSClients(...args),
}));
vi.mock('../services/brandHealthService', () => ({
  calculateBrandHealth: (...args: unknown[]) => mockCalculateBrandHealth(...args),
  sendHealthScoreWhatsApp: (...args: unknown[]) => mockSendHealthScoreWhatsApp(...args),
}));
vi.mock('../services/opportunityService', () => ({ calculateMoneyOnTable: vi.fn() }));
vi.mock('../services/creativeIntelligenceService', () => ({ trackCreativePerformance: vi.fn() }));
vi.mock('../services/competitorService', () => ({
  runCompetitorPulse: (...args: unknown[]) => mockRunCompetitorPulse(...args),
}));

function invokeRouteHandler(router: any, path: string, method: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

function reqAsReseller(overrides: Record<string, unknown> = {}) {
  return { user: { tenantId: RESELLER_TENANT_ID, id: 'user-1', role: 'admin' }, params: {}, query: {}, body: {}, ...overrides };
}

describe('routes/growthOS.ts — WhatsApp-gated routes still succeed for a reseller', () => {
  it('POST /health/generate returns 200 "generating" for a reseller admin (health-score generation is not blocked)', async () => {
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/health/generate', 'post');
    const res = mockRes();
    await handler(reqAsReseller(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('generating');
  });

  it('POST /competitor/run returns 200 "running" for a reseller admin (pulse generation is not blocked)', async () => {
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/competitor/run', 'post');
    const res = mockRes();
    await handler(reqAsReseller(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('running');
  });
});
