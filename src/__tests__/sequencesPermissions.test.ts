import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Proves src/routes/sequences.ts is correctly wired to requirePerm(...) —
// see src/middleware/requirePerm.ts for the middleware itself (already unit
// tested in requirePerm.test.ts) and src/services/permissionResolver.ts's
// isOwner bypass (already unit tested in permissionResolver.test.ts). This
// file only tests the INTEGRATION: does each route in sequences.ts demand
// the correct registry key, and does a granted/denied/shadow/owner effective
// set actually flow through to the real route handler as expected.

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

const { mockSelect, mockInsert, mockUpdate } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    sequences: schema.sequences,
    sequenceEnrolments: schema.sequenceEnrolments,
  };
});

const mockEnrolContact = vi.fn();
const mockCancelEnrolment = vi.fn();
const mockGetActiveEnrolments = vi.fn();
vi.mock('../services/sequenceService', () => ({
  enrolContact: (...args: unknown[]) => mockEnrolContact(...args),
  cancelEnrolment: (...args: unknown[]) => mockCancelEnrolment(...args),
  getActiveEnrolments: (...args: unknown[]) => mockGetActiveEnrolments(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import sequencesRouter from '../routes/sequences';
import { ALL_PERMISSIONS } from '../config/permissions';

// Generic chainable Drizzle mock — every method returns the same object;
// the object is itself thenable so a bare `await db.select()...where(...)`
// resolves, matching how sequences.ts consumes these calls. Mirrors the
// `resultChain` helper already established in tenantIsolationIDOR.test.ts.
function resultChain(rows: unknown[]) {
  const c: Record<string, unknown> = {
    from: () => c,
    where: () => c,
    groupBy: () => c,
    limit: () => c,
    values: () => c,
    set: () => c,
    returning: () => Promise.resolve(rows),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return c;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'u1', tenantId: 'tenant-a', role: 'staff' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as any;
}

function makeRes() {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  return { json: jsonFn, status: statusFn } as any;
}

async function invoke(method: 'get' | 'post' | 'patch' | 'delete', path: string, req: any, res: any) {
  const layer = sequencesRouter.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route!.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

// Every route in sequences.ts and the single registry key it must demand.
const ROUTES: Array<{ method: 'get' | 'post' | 'patch' | 'delete'; path: string; perm: string }> = [
  { method: 'post', path: '/', perm: 'sequences.manage' },
  { method: 'get', path: '/', perm: 'sequences.view' },
  { method: 'get', path: '/stats', perm: 'sequences.view' },
  { method: 'post', path: '/enrol', perm: 'sequences.enrol' },
  { method: 'delete', path: '/enrolments/:id', perm: 'sequences.enrolments.remove' },
  { method: 'get', path: '/enrolments', perm: 'sequences.view' },
  { method: 'patch', path: '/:id', perm: 'sequences.manage' },
];

describe('routes/sequences.ts — requirePerm wiring', () => {
  const originalShadow = process.env.PERMISSION_SHADOW_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERMISSION_SHADOW_MODE;
  });

  afterEach(() => {
    if (originalShadow === undefined) delete process.env.PERMISSION_SHADOW_MODE;
    else process.env.PERMISSION_SHADOW_MODE = originalShadow;
  });

  describe('every route demands its exact registry key (denied when the effective set is empty)', () => {
    for (const { method, path, perm } of ROUTES) {
      it(`${method.toUpperCase()} ${path} requires '${perm}'`, async () => {
        mockGetEffectivePermissions.mockResolvedValue(new Set());
        const req = makeReq();
        const res = makeRes();

        await invoke(method, path, req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.status().json).toHaveBeenCalledWith(
          expect.objectContaining({ required: [perm] }),
        );
        // The handler's own DB/service calls must never run for a denied request.
        expect(mockSelect).not.toHaveBeenCalled();
        expect(mockInsert).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockEnrolContact).not.toHaveBeenCalled();
        expect(mockCancelEnrolment).not.toHaveBeenCalled();
        expect(mockGetActiveEnrolments).not.toHaveBeenCalled();
      });
    }
  });

  describe('a granted permission succeeds', () => {
    it('GET / (sequences.view) returns the sequence list', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(['sequences.view']));
      mockSelect.mockReturnValueOnce(resultChain([{ id: 'seq-1', tenantId: 'tenant-a', name: 'Onboarding' }]));

      const req = makeReq();
      const res = makeRes();
      await invoke('get', '/', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith([{ id: 'seq-1', tenantId: 'tenant-a', name: 'Onboarding' }]);
    });

    it('POST / (sequences.manage) creates a sequence', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(['sequences.manage']));
      mockInsert.mockReturnValueOnce(resultChain([{ id: 'seq-1', tenantId: 'tenant-a', name: 'Onboarding' }]));

      const req = makeReq({ body: { name: 'Onboarding', channel: 'whatsapp' } });
      const res = makeRes();
      await invoke('post', '/', req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('POST /enrol (sequences.enrol) enrols a contact', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(['sequences.enrol']));
      mockEnrolContact.mockResolvedValueOnce({ id: 'enr-1', contactId: 'c1' });

      const req = makeReq({ body: { contactId: 'c1', sequenceName: 'onboarding' } });
      const res = makeRes();
      await invoke('post', '/enrol', req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockEnrolContact).toHaveBeenCalledWith('tenant-a', 'c1', 'onboarding', 0);
    });

    it('DELETE /enrolments/:id (sequences.enrolments.remove) cancels an enrolment', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(['sequences.enrolments.remove']));
      mockCancelEnrolment.mockResolvedValueOnce({ id: 'enr-1', status: 'cancelled' });

      const req = makeReq({ params: { id: 'enr-1' } });
      const res = makeRes();
      await invoke('delete', '/enrolments/:id', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ id: 'enr-1', status: 'cancelled' });
    });
  });

  describe('shadow mode logs and lets a genuinely-denied request through', () => {
    it('PERMISSION_SHADOW_MODE=true forwards GET / to the handler despite an empty effective set', async () => {
      process.env.PERMISSION_SHADOW_MODE = 'true';
      mockGetEffectivePermissions.mockResolvedValue(new Set());
      mockSelect.mockReturnValueOnce(resultChain([]));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const req = makeReq();
      const res = makeRes();
      await invoke('get', '/', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/permission-shadow.*would deny/);
      warnSpy.mockRestore();
    });
  });

  describe('isOwner bypasses regardless of role', () => {
    it('a narrow, unprivileged role still succeeds when the effective set is the full owner set', async () => {
      // permissionResolver.test.ts proves isOwner:true resolves to
      // ALL_PERMISSIONS unconditionally; this proves the route consumes that
      // outcome correctly even though req.user.role names an unprivileged role.
      mockGetEffectivePermissions.mockResolvedValue(new Set(ALL_PERMISSIONS));
      mockSelect.mockReturnValueOnce(resultChain([{ id: 'seq-1', tenantId: 'tenant-a', name: 'Onboarding' }]));

      const req = makeReq({ user: { id: 'owner-1', tenantId: 'tenant-a', role: 'creative_assistant' } });
      const res = makeRes();
      await invoke('get', '/', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith([{ id: 'seq-1', tenantId: 'tenant-a', name: 'Onboarding' }]);
    });
  });

  describe('401 when unauthenticated', () => {
    it('GET / 401s when req.user is missing', async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();
      await invoke('get', '/', req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockGetEffectivePermissions).not.toHaveBeenCalled();
    });
  });
});
