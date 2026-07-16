import { beforeEach, describe, expect, it, vi } from 'vitest';

// GET /requirements filter contract: comma-separated multi-value params become
// `= ANY($::text[])`, budget/experience ranges map to COALESCE bounds, and the
// CI-tier filter targets the intelligence join. The route is an inline Express
// handler using pool.query(), so we mock pool and invoke the handler pulled off
// the router stack (same approach as wizmatchRequirementDelete.test.ts).

// vi.hoisted so the mock (hoisted above imports) can reference poolQuery safely.
const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }));
vi.mock('../db/index', () => ({
  db: {},
  pool: { connect: vi.fn(), query: poolQuery },
}));

import router from '../routes/wizmatch';

function listRequirementsHandler() {
  const layer = (router as unknown as { stack: any[] }).stack.find(
    (l) => l.route?.path === '/requirements' && l.route?.methods?.get,
  );
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

const req = (query: Record<string, unknown>) => ({ user: { tenantId: 'tenant-1', id: 'u1' }, query });

beforeEach(() => {
  poolQuery.mockReset();
  // data query resolves first, then the count query.
  poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });
});

describe('GET /requirements — filter params', () => {
  it('multi-value status/stage become = ANY($::text[]) with comma-split arrays', async () => {
    await listRequirementsHandler()(req({ status: 'draft,shared', stage: 'sourcing' }), mockRes());
    const [dataSql, dataParams] = poolQuery.mock.calls[0];
    expect(dataSql).toContain('r.status = ANY(');
    expect(dataSql).toContain('r.stage = ANY(');
    expect(dataParams).toContainEqual(['draft', 'shared']);
    expect(dataParams).toContainEqual(['sourcing']);
  });

  it('experience_max keeps requirements whose ask starts at/below the cap', async () => {
    await listRequirementsHandler()(req({ experience_max: '8' }), mockRes());
    const [dataSql, dataParams] = poolQuery.mock.calls[0];
    expect(dataSql).toContain('COALESCE(r.min_experience, r.max_experience) <=');
    expect(dataParams).toContain(8);
  });

  it('budget range maps to COALESCE bounds', async () => {
    await listRequirementsHandler()(req({ budget_min: '50000', budget_max: '120000' }), mockRes());
    const [dataSql, dataParams] = poolQuery.mock.calls[0];
    expect(dataSql).toContain('COALESCE(r.budget_max, r.budget_min) >=');
    expect(dataSql).toContain('COALESCE(r.budget_min, r.budget_max) <=');
    expect(dataParams).toContain(50000);
    expect(dataParams).toContain(120000);
  });

  it('tier filters on the company-intelligence join', async () => {
    await listRequirementsHandler()(req({ tier: 'A,B' }), mockRes());
    const [dataSql, dataParams] = poolQuery.mock.calls[0];
    expect(dataSql).toContain('ci.qualification_tier = ANY(');
    expect(dataParams).toContainEqual(['A', 'B']);
  });

  it('has_matches adds an EXISTS match subquery only when set to 1', async () => {
    await listRequirementsHandler()(req({ has_matches: '1' }), mockRes());
    const [withFlag] = poolQuery.mock.calls[0];
    expect(withFlag).toContain('EXISTS (SELECT 1 FROM wizmatch_candidate_requirement_matches');

    poolQuery.mockReset();
    poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await listRequirementsHandler()(req({ has_matches: '0' }), mockRes());
    const [withoutFlag] = poolQuery.mock.calls[0];
    expect(withoutFlag).not.toContain('EXISTS (SELECT 1 FROM wizmatch_candidate_requirement_matches');
  });
});
