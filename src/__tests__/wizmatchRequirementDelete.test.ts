import { beforeEach, describe, expect, it, vi } from 'vitest';

// The requirement hard-delete refinement: a DRAFT requirement with only
// algorithm-computed, undecided matches (and no submissions) is deletable and
// cascades its match rows + snapshots; a human-decided match or a submission
// still 409s, and a non-draft requirement still 409s. The route is an inline
// Express handler using pool.connect(), so we mock the client and invoke the
// handler pulled off the router stack.

const client = { query: vi.fn(), release: vi.fn() };
vi.mock('../db/index', () => ({
  db: {},
  pool: { connect: vi.fn(async () => client), query: vi.fn() },
}));

import router from '../routes/wizmatch';

function deleteRequirementHandler() {
  const layer = (router as unknown as { stack: any[] }).stack.find(
    (l) => l.route?.path === '/requirements/:id' && l.route?.methods?.delete,
  );
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

const req = (overrides: Record<string, unknown> = {}) => ({
  user: { tenantId: 'tenant-1', id: 'lead-1', role: 'admin' },
  params: { id: 'req-1' },
  body: {},
  ...overrides,
});

function install(responder: (sql: string) => { rows?: any[]; rowCount?: number }) {
  client.query.mockReset();
  client.release.mockReset();
  client.query.mockImplementation(async (sql: string) => {
    const r = responder(sql);
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? r.rows?.length ?? 1 };
  });
}

const draftRow = { rows: [{ id: 'req-1', title: 'Senior Java Developer', status: 'draft', company_id: 'co-1' }], rowCount: 1 };

beforeEach(() => vi.clearAllMocks());

describe('DELETE /requirements/:id — draft match-cascade refinement', () => {
  it('deletes a draft with only undecided matches and cascades snapshots then matches then the requirement', async () => {
    install((sql) => {
      if (sql.includes('FOR UPDATE')) return draftRow;
      if (sql.includes('human_decision')) return { rows: [{ n: 0 }] };   // no reviewed matches
      if (sql.includes('FROM wizmatch_submissions')) return { rows: [{ n: 0 }] };
      return { rows: [], rowCount: 1 };
    });
    const res = mockRes();
    await deleteRequirementHandler()(req(), res);

    expect(res.json).toHaveBeenCalledWith({ deleted: true, id: 'req-1' });
    const order = client.query.mock.calls.map((c) => String(c[0]));
    const iSnap = order.findIndex((s) => s.includes('DELETE FROM wizmatch_match_snapshots'));
    const iMatch = order.findIndex((s) => s.includes('DELETE FROM wizmatch_candidate_requirement_matches'));
    const iReq = order.findIndex((s) => s.includes('DELETE FROM wizmatch_requirements'));
    expect(iSnap).toBeGreaterThan(-1);
    expect(iSnap).toBeLessThan(iMatch);   // snapshots FK to matches → must go first
    expect(iMatch).toBeLessThan(iReq);
    expect(order.some((s) => s === 'COMMIT')).toBe(true);
  });

  it('blocks (409) a draft that has a human-decided match, and never deletes the requirement', async () => {
    install((sql) => {
      if (sql.includes('FOR UPDATE')) return draftRow;
      if (sql.includes('human_decision')) return { rows: [{ n: 1 }] };   // a reviewed (shortlisted) match
      if (sql.includes('FROM wizmatch_submissions')) return { rows: [{ n: 0 }] };
      return { rows: [], rowCount: 1 };
    });
    const res = mockRes();
    await deleteRequirementHandler()(req(), res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: 'has_dependencies' });
    expect(res.body.message).toMatch(/reviewed candidate match/);
    const order = client.query.mock.calls.map((c) => String(c[0]));
    expect(order.some((s) => s.includes('DELETE FROM wizmatch_requirements'))).toBe(false);
    expect(order.some((s) => s === 'ROLLBACK')).toBe(true);
  });

  it('blocks (409) a draft that has a submission', async () => {
    install((sql) => {
      if (sql.includes('FOR UPDATE')) return draftRow;
      if (sql.includes('human_decision')) return { rows: [{ n: 0 }] };
      if (sql.includes('FROM wizmatch_submissions')) return { rows: [{ n: 2 }] };
      return { rows: [], rowCount: 1 };
    });
    const res = mockRes();
    await deleteRequirementHandler()(req(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/submission/);
  });

  it('blocks (409) a non-draft requirement regardless of matches', async () => {
    install((sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'req-1', title: 'T', status: 'sheet_ready', company_id: 'co-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const res = mockRes();
    await deleteRequirementHandler()(req(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: 'not_draft' });
  });
});
