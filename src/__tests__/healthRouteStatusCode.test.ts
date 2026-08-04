import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Security-hardening sweep, 2026-08 — regression guard for QA-8
// (docs/testing/WIZMATCH_BREAKAGE_AND_FIX_REGISTER.md): `GET /health` always
// returned HTTP 200 regardless of the `status` field in its own JSON body
// (`res.json()` with no `.status()` call), so Railway's healthcheckPath
// (railway.json) could never see a DB outage.
//
// This guards the fix: the HTTP status code must now track `overallStatus` —
// 503 when the DB check fails ("unhealthy"), 200 otherwise (including
// "degraded", which is still serving traffic and must not fail a deploy or
// trigger a restart over a transient stuck-job backlog).
// ---------------------------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbExecute = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
  contacts: {},
  jobs: { status: 'status', processingStartedAt: 'processing_started_at' },
  bookings: { qualificationTier: 'qualification_tier' },
  sequences: {},
  sequenceEnrolments: { status: 'status' },
  messages: { direction: 'direction', sentAt: 'sent_at' },
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Same minimal handler-chain harness used in seoLearningLoop.test.ts /
// billingRoutes.test.ts — walks router.stack and invokes the real handler
// chain directly, without needing supertest or a live HTTP server.
async function invokeRoute(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

function makeReqRes() {
  const req = { params: {}, query: {}, body: {} } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

// A select() chain generic enough to serve both call shapes healthRoute makes:
//   - stuck jobs:    await db.select().from(jobs).where(cond)                    -> destructured directly
//   - last inbound:  await db.select().from(messages).where(cond).orderBy(x).limit(1) -> destructured after .limit()
// `.where()` must therefore return something that is BOTH directly awaitable to
// `rows` (arrays are non-thenable, so `await arr` resolves to `arr` itself) AND
// exposes `.orderBy().limit()` for the second shape — hence attaching `orderBy`
// onto the array instance rather than returning a plain object.
function selectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => {
        const arr: any = [...rows];
        arr.orderBy = () => ({ limit: async () => rows });
        return arr;
      },
    }),
  };
}

describe('GET /health — HTTP status code tracks overallStatus (QA-8)', () => {
  let healthRouter: any;

  beforeEach(async () => {
    vi.resetModules();
    mockDbSelect.mockReset();
    mockDbExecute.mockReset();
    const mod = await import('../routes/healthRoute');
    healthRouter = mod.default;
  });

  it('returns 503 when the DB connectivity check fails (unhealthy)', async () => {
    mockDbExecute.mockRejectedValue(new Error('connection refused'));
    mockDbSelect.mockReturnValue(selectChain([]));

    const { req, res, statusFn, jsonFn } = makeReqRes();
    await invokeRoute(healthRouter, '/health', 'get', req, res);

    expect(statusFn).toHaveBeenCalledWith(503);
    expect(jsonFn.mock.calls[0][0]).toMatchObject({ status: 'unhealthy' });
  });

  it('returns 200 when everything is healthy', async () => {
    mockDbExecute.mockResolvedValue(undefined);
    mockDbSelect.mockReturnValue(selectChain([]));

    const { req, res, statusFn, jsonFn } = makeReqRes();
    await invokeRoute(healthRouter, '/health', 'get', req, res);

    expect(statusFn).toHaveBeenCalledWith(200);
    expect(jsonFn.mock.calls[0][0]).toMatchObject({ status: 'healthy' });
  });

  it('returns 200 (not 503) when only degraded — stuck jobs present but DB is up', async () => {
    mockDbExecute.mockResolvedValue(undefined);
    // First select() call in the route is the stuck-jobs count; return a
    // non-zero count so overallStatus computes to "degraded".
    mockDbSelect.mockReturnValueOnce(selectChain([{ count: 3 }]));
    mockDbSelect.mockReturnValue(selectChain([]));

    const { req, res, statusFn, jsonFn } = makeReqRes();
    await invokeRoute(healthRouter, '/health', 'get', req, res);

    expect(statusFn).toHaveBeenCalledWith(200);
    expect(jsonFn.mock.calls[0][0]).toMatchObject({ status: 'degraded' });
  });
});
