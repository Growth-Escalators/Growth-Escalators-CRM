// Route-level contract for the two bulk endpoints the admin SPA codes against:
//   POST /api/wizmatch/signals/bulk-action
//   POST /api/wizmatch/contact-intelligence/contacts/bulk-review
//
// Both are inline Express handlers in src/routes/wizmatch.ts that reuse the
// exact per-item logic of their single-item siblings, so — following
// wizmatchRequirementDelete.test.ts — the db pool is mocked and the handler is
// pulled off the router stack and invoked directly. That keeps the real
// service/SQL layer in the test (it is what enforces tenant scoping) instead of
// stubbing away the thing most worth proving.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { client, poolQuery: vi.fn(), poolConnect: vi.fn(async () => client) };
});

vi.mock('../db/index', () => ({
  db: {},
  pool: { connect: mocks.poolConnect, query: mocks.poolQuery },
}));

// The outreach gate is a database-backed policy evaluation; the approve path of
// the contact review consults it. Stubbed permissive here so these cases test
// the bulk envelope rather than re-testing the gate (which has its own suites).
vi.mock('../modules/outreach/outreachGate', () => ({
  evaluateWizmatchOutreachGate: async () => ({ preparationAllowed: true, reasonCodes: [] }),
  shouldBlock: () => false,
  suppress: async () => {},
  isStatedContactPreference: () => false,
  resolveCompanyStatus: () => ({ status: 'unknown', reasonCodes: [] }),
  isEnforcementActive: () => false,
}));

import router from '../routes/wizmatch';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';

type Handler = (req: any, res: any) => Promise<void>;

function layerIndex(path: string, method: string): number {
  return (router as unknown as { stack: any[] }).stack.findIndex(
    (layer) => layer.route?.path === path && Boolean(layer.route?.methods?.[method]),
  );
}

function handlerFor(path: string, method: string): Handler {
  const index = layerIndex(path, method);
  if (index < 0) throw new Error(`route not registered: ${method.toUpperCase()} ${path}`);
  const stack = (router as unknown as { stack: any[] }).stack[index].route.stack;
  return stack[stack.length - 1].handle as Handler;
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  return res;
}

const req = (body: Record<string, unknown>, role = 'admin') => ({
  user: { tenantId: TENANT, id: 'user-1', role },
  params: {},
  body,
});

type Envelope = { results: Array<{ id: string; ok: boolean; error?: string }>; succeeded: number; failed: number };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.poolConnect.mockImplementation(async () => mocks.client);
});

// ---------------------------------------------------------------------------
// Registration order — a literal path registered AFTER its parameterised
// sibling is silently unreachable in Express. Pin it so nobody reorders these.
// ---------------------------------------------------------------------------
describe('bulk routes — registration order', () => {
  it('registers /signals/bulk-action ahead of /signals/:id/qualify', () => {
    expect(layerIndex('/signals/bulk-action', 'post')).toBeGreaterThan(-1);
    expect(layerIndex('/signals/bulk-action', 'post')).toBeLessThan(layerIndex('/signals/:id/qualify', 'post'));
  });

  it('registers /contact-intelligence/contacts/bulk-review ahead of the per-candidate review route', () => {
    const bulk = layerIndex('/contact-intelligence/contacts/bulk-review', 'post');
    expect(bulk).toBeGreaterThan(-1);
    expect(bulk).toBeLessThan(layerIndex('/contact-intelligence/contacts/:candidateId/review', 'post'));
  });
});

// ---------------------------------------------------------------------------
// POST /signals/bulk-action
// ---------------------------------------------------------------------------
describe('POST /signals/bulk-action', () => {
  const bulkSignals = () => handlerFor('/signals/bulk-action', 'post');

  /** Real qualify/reject SQL, answered per (signalId, tenantId) — the tenant match IS the test. */
  function installSignals(knownSignalIds: string[]) {
    const known = new Set(knownSignalIds);
    mocks.client.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes("UPDATE wizmatch_job_signals SET status='scored'")) {
        const [signalId, tenantId] = params as [string, string];
        if (tenantId !== TENANT || !known.has(signalId)) return { rows: [], rowCount: 0 };
        return { rows: [{ id: signalId, job_title: 'Senior Java Developer', company_id: 'co-1' }], rowCount: 1 };
      }
      // An open "Find Main POC" task already exists, so the qualify path takes
      // its no-insert branch — nothing here depends on which branch it takes.
      if (sql.includes('FROM tasks t JOIN')) return { rows: [{ id: 'task-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    mocks.poolQuery.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes("UPDATE wizmatch_job_signals SET status='dead'")) {
        const [signalId, tenantId] = params as [string, string];
        if (tenantId !== TENANT || !known.has(signalId)) return { rows: [], rowCount: 0 };
        return { rows: [{ id: signalId, status: 'dead' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  it('qualifies every id and reports succeeded=n, failed=0', async () => {
    installSignals(['sig-1', 'sig-2', 'sig-3']);
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-1', 'sig-2', 'sig-3'], action: 'qualify' }), res);

    const body = res.body as Envelope;
    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ succeeded: 3, failed: 0 });
    expect(body.results).toEqual([
      { id: 'sig-1', ok: true },
      { id: 'sig-2', ok: true },
      { id: 'sig-3', ok: true },
    ]);
    // Every write was scoped to the CALLER's tenant, never a body-supplied one.
    const updates = mocks.client.query.mock.calls.filter(
      (call) => String(call[0]).includes("UPDATE wizmatch_job_signals SET status='scored'"),
    );
    expect(updates).toHaveLength(3);
    expect(updates.every((call) => (call[1] as string[])[1] === TENANT)).toBe(true);
    expect(mocks.client.query.mock.calls.filter((call) => call[0] === 'COMMIT')).toHaveLength(3);
  });

  it('rejects every id via the same service the single-item route uses, passing the reason through', async () => {
    installSignals(['sig-1']);
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-1'], action: 'reject', reason: 'wrong geography' }), res);

    expect(res.body).toMatchObject({ succeeded: 1, failed: 0 });
    const update = mocks.poolQuery.mock.calls.find((call) => String(call[0]).includes("status='dead'"))!;
    expect(JSON.parse((update[1] as string[])[2])).toMatchObject({ rejectionReason: 'wrong geography' });
  });

  // The core promise of the envelope: one bad id neither aborts the run nor
  // undoes the ids that already committed.
  it('isolates a failing id — the good ids either side of it still apply', async () => {
    installSignals(['sig-1', 'sig-3']);
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-1', 'sig-missing', 'sig-3'], action: 'reject' }), res);

    const body = res.body as Envelope;
    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ succeeded: 2, failed: 1 });
    expect(body.results[0]).toEqual({ id: 'sig-1', ok: true });
    expect(body.results[1].ok).toBe(false);
    expect(body.results[1].error).toBe('Signal not found');
    // sig-3 was attempted AFTER the failure, i.e. the loop did not abort...
    expect(body.results[2]).toEqual({ id: 'sig-3', ok: true });
    // ...and both good ids really reached the database.
    const attempted = mocks.poolQuery.mock.calls
      .filter((call) => String(call[0]).includes("status='dead'"))
      .map((call) => (call[1] as string[])[0]);
    expect(attempted).toEqual(['sig-1', 'sig-missing', 'sig-3']);
  });

  it("treats another tenant's signal as not-found, and never widens the tenant scope to find it", async () => {
    installSignals([]); // 'sig-foreign' exists, but only under OTHER_TENANT
    mocks.poolQuery.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes("UPDATE wizmatch_job_signals SET status='dead'")) {
        const [signalId, tenantId] = params as [string, string];
        if (signalId === 'sig-foreign' && tenantId === OTHER_TENANT) return { rows: [{ id: signalId }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-foreign'], action: 'reject' }), res);

    const body = res.body as Envelope;
    expect(body).toMatchObject({ succeeded: 0, failed: 1 });
    expect(body.results[0].ok).toBe(false);
    // Byte-identical to the message a genuinely non-existent id gets, so the
    // response cannot be used to probe another tenant for existence.
    expect(body.results[0].error).toBe('Signal not found');
    const tenantsQueried = mocks.poolQuery.mock.calls
      .filter((call) => String(call[0]).includes("status='dead'"))
      .map((call) => (call[1] as string[])[1]);
    expect(tenantsQueried).toEqual([TENANT]);
  });

  it('400s an empty ids array', async () => {
    const res = mockRes();
    await bulkSignals()(req({ ids: [], action: 'qualify' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/non-empty array/);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('400s more than 200 ids and applies none of them', async () => {
    const res = mockRes();
    const ids = Array.from({ length: 201 }, (_, i) => `sig-${i}`);
    await bulkSignals()(req({ ids, action: 'qualify' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/capped at 200/);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.poolConnect).not.toHaveBeenCalled();
  });

  it('accepts exactly 200 ids (the cap is inclusive)', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `sig-${i}`);
    installSignals(ids);
    const res = mockRes();
    await bulkSignals()(req({ ids, action: 'reject' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ succeeded: 200, failed: 0 });
  });

  it('400s an action outside the allow-list', async () => {
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-1'], action: 'delete' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/action must be one of: qualify, reject/);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('400s a missing action rather than defaulting to one', async () => {
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-1'] }), res);
    expect(res.statusCode).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('de-duplicates repeated ids so a double-selected row is not counted twice', async () => {
    installSignals(['sig-1']);
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-1', 'sig-1'], action: 'reject' }), res);
    expect(res.body).toMatchObject({ succeeded: 1, failed: 0 });
    expect((res.body as Envelope).results).toHaveLength(1);
  });

  // Same split as the reference bulk surface, POST /today/actions.
  it('403s a team_lead on a multi-id request (bulk is admin-only)', async () => {
    installSignals(['sig-1', 'sig-2']);
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-1', 'sig-2'], action: 'reject' }, 'team_lead'), res);
    expect(res.statusCode).toBe(403);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('allows a team_lead on a single-id request (matching the per-signal routes)', async () => {
    installSignals(['sig-1']);
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-1'], action: 'reject' }, 'team_lead'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it('403s a staff role even on a single id', async () => {
    const res = mockRes();
    await bulkSignals()(req({ ids: ['sig-1'], action: 'reject' }, 'staff'), res);
    expect(res.statusCode).toBe(403);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /contact-intelligence/contacts/bulk-review
// ---------------------------------------------------------------------------
describe('POST /contact-intelligence/contacts/bulk-review', () => {
  const bulkReview = () => handlerFor('/contact-intelligence/contacts/bulk-review', 'post');

  function installCandidates(knownCandidateIds: string[]) {
    const known = new Set(knownCandidateIds);
    mocks.poolQuery.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('SELECT company_id FROM wizmatch_contact_candidates')) {
        const [tenantId, candidateId] = params as [string, string];
        if (tenantId !== TENANT || !known.has(candidateId)) return { rows: [], rowCount: 0 };
        return { rows: [{ company_id: 'co-1' }], rowCount: 1 };
      }
      if (sql.includes('UPDATE wizmatch_contact_candidates')) {
        const [, , , tenantId, candidateId] = params as string[];
        if (tenantId !== TENANT || !known.has(candidateId)) return { rows: [], rowCount: 0 };
        return { rows: [{ company_id: 'co-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  it('approves every id, writing the approved status the single-item route writes', async () => {
    installCandidates(['cand-1', 'cand-2']);
    const res = mockRes();
    await bulkReview()(req({ ids: ['cand-1', 'cand-2'], decision: 'approve' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ succeeded: 2, failed: 0 });
    const updates = mocks.poolQuery.mock.calls.filter(
      (call) => String(call[0]).includes('UPDATE wizmatch_contact_candidates'),
    );
    expect(updates).toHaveLength(2);
    expect((updates[0][1] as string[])[0]).toBe('approved');
    expect((updates[0][1] as string[])[3]).toBe(TENANT);
  });

  it('rejects every id and threads `reason` into rejection_reason', async () => {
    installCandidates(['cand-1']);
    const res = mockRes();
    await bulkReview()(req({ ids: ['cand-1'], decision: 'reject', reason: 'left the company' }), res);

    expect(res.body).toMatchObject({ succeeded: 1, failed: 0 });
    const update = mocks.poolQuery.mock.calls.find(
      (call) => String(call[0]).includes('UPDATE wizmatch_contact_candidates'),
    )!;
    expect((update[1] as string[])[0]).toBe('rejected');
    expect((update[1] as string[])[2]).toBe('left the company');
  });

  it('isolates a failing id — the good ids either side of it still apply', async () => {
    installCandidates(['cand-1', 'cand-3']);
    const res = mockRes();
    await bulkReview()(req({ ids: ['cand-1', 'cand-gone', 'cand-3'], decision: 'reject' }), res);

    const body = res.body as Envelope;
    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ succeeded: 2, failed: 1 });
    expect(body.results[0]).toEqual({ id: 'cand-1', ok: true });
    expect(body.results[1]).toEqual({ id: 'cand-gone', ok: false, error: 'Contact candidate not found' });
    expect(body.results[2]).toEqual({ id: 'cand-3', ok: true });
    // The two good ids committed and stayed committed — nothing rolled them back.
    const updated = mocks.poolQuery.mock.calls
      .filter((call) => String(call[0]).includes('UPDATE wizmatch_contact_candidates'))
      .map((call) => (call[1] as string[])[4]);
    expect(updated).toEqual(['cand-1', 'cand-3']);
  });

  it("treats another tenant's candidate as not-found and never reads outside the caller's tenant", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('SELECT company_id FROM wizmatch_contact_candidates')) {
        const [tenantId, candidateId] = params as [string, string];
        if (tenantId === OTHER_TENANT && candidateId === 'cand-foreign') {
          return { rows: [{ company_id: 'co-9' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await bulkReview()(req({ ids: ['cand-foreign'], decision: 'approve' }), res);

    const body = res.body as Envelope;
    expect(body).toMatchObject({ succeeded: 0, failed: 1 });
    expect(body.results[0]).toEqual({ id: 'cand-foreign', ok: false, error: 'Contact candidate not found' });
    // No UPDATE was even attempted, and the only tenant read was the caller's.
    expect(mocks.poolQuery.mock.calls.some((call) => String(call[0]).includes('UPDATE'))).toBe(false);
    expect(mocks.poolQuery.mock.calls.map((call) => (call[1] as string[])[0])).toEqual([TENANT]);
  });

  it('400s an empty ids array', async () => {
    const res = mockRes();
    await bulkReview()(req({ ids: [], decision: 'approve' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/non-empty array/);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('400s more than 200 ids and applies none of them', async () => {
    const res = mockRes();
    await bulkReview()(req({ ids: Array.from({ length: 201 }, (_, i) => `cand-${i}`), decision: 'approve' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/capped at 200/);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('400s a decision outside the allow-list', async () => {
    const res = mockRes();
    await bulkReview()(req({ ids: ['cand-1'], decision: 'mark_do_not_contact' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/decision must be one of: approve, reject/);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('400s a non-string id rather than silently dropping it', async () => {
    const res = mockRes();
    await bulkReview()(req({ ids: ['cand-1', 42], decision: 'approve' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('403s a team_lead on a multi-id request and allows one on a single id', async () => {
    installCandidates(['cand-1', 'cand-2']);
    const many = mockRes();
    await bulkReview()(req({ ids: ['cand-1', 'cand-2'], decision: 'reject' }, 'team_lead'), many);
    expect(many.statusCode).toBe(403);
    expect(mocks.poolQuery).not.toHaveBeenCalled();

    const one = mockRes();
    await bulkReview()(req({ ids: ['cand-1'], decision: 'reject' }, 'team_lead'), one);
    expect(one.statusCode).toBe(200);
    expect(one.body).toMatchObject({ succeeded: 1, failed: 0 });
  });
});
