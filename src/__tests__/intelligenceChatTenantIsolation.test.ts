import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// src/routes/intelligenceChat.ts's data fetchers (fetchMetaAds, fetchPipeline,
// fetchBilling, fetchTasksOverview) ran raw SQL with no tenant_id predicate at
// all, and cached the result in a bare process-global Map keyed only by
// category name (e.g. 'meta_ads') — so tenant A's numbers (and, for
// fetchTasksOverview, task titles) could leak into tenant B's AI chat
// context, and a warm cache would keep serving the wrong tenant's numbers for
// up to 5 minutes even after the query itself filtered correctly. These
// tests drive the real POST /chat handler (with the Anthropic API call
// stubbed out) so the actual buildDataSnapshot() fan-out that feeds the chat
// system prompt is exercised, not a reimplementation of it.

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

vi.mock('../middleware/rbac', () => ({
  isAdminTier: () => true,
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'tenant-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

let originalFetch: typeof global.fetch;

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({ rows: [{}] });
  process.env.CLAUDE_API_KEY = 'sk-ant-test-key';
  originalFetch = global.fetch;
  // Stub the Anthropic call so /chat returns immediately with a plain-text
  // reply (stop_reason: 'end_turn') — buildDataSnapshot() still runs first,
  // fanning out to every fetcher, which is what these tests assert on.
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.CLAUDE_API_KEY;
});

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

function findChatHandler(router: any) {
  const layer = router.stack.find((l: any) => l.route?.path === '/chat' && l.route?.methods?.post);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

function reqAs(tenantId: string, userId: string) {
  return { user: { tenantId, role: 'admin', id: userId, email: `${userId}@test.com` }, body: { message: 'how are we doing?' } };
}

describe('intelligenceChat.ts — data snapshot fetchers are tenant-scoped', () => {
  it('every ads_insights_cache / deals / invoices / tasks query issued during /chat is bound to the caller tenant_id', async () => {
    const seenQueries: Array<{ sql: string; params: unknown[] }> = [];
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      seenQueries.push({ sql: String(sqlText), params });
      return { rows: [{}] };
    });

    const router = (await import('../routes/intelligenceChat')).default;
    const handler = findChatHandler(router);
    const res = mockRes();

    await handler(reqAs(TENANT_A, 'u1'), res);

    const tenantBearingQueries = seenQueries.filter(q =>
      /ads_insights_cache|FROM deals|FROM invoices|FROM tasks/.test(q.sql),
    );
    expect(tenantBearingQueries.length).toBeGreaterThan(0);
    for (const q of tenantBearingQueries) {
      expect(q.sql).toMatch(/tenant_id/);
      expect(q.params).toContain(TENANT_A);
    }
  });

  it('the 5-minute cache is keyed per-tenant — tenant B\'s query is never skipped in favour of tenant A\'s cached entry', async () => {
    const router = (await import('../routes/intelligenceChat')).default;
    const handler = findChatHandler(router);

    // Tenant A warms the meta_ads cache.
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      if (String(sqlText).includes('ads_insights_cache')) {
        expect(params).toEqual([TENANT_A]);
        return { rows: [{ spend_today: '111', roas_avg: '1', accounts: '1' }] };
      }
      return { rows: [{}] };
    });
    await handler(reqAs(TENANT_A, 'u1'), mockRes());

    // Tenant B asks next — must issue its own fresh, tenant-B-bound query
    // (its own cache key), never a cache hit against tenant A's key.
    let tenantBQueried = false;
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      if (String(sqlText).includes('ads_insights_cache')) {
        tenantBQueried = true;
        expect(params).toEqual([TENANT_B]);
        return { rows: [{ spend_today: '222', roas_avg: '2', accounts: '2' }] };
      }
      return { rows: [{}] };
    });
    await handler(reqAs(TENANT_B, 'u2'), mockRes());

    expect(tenantBQueried).toBe(true);
  });
});
