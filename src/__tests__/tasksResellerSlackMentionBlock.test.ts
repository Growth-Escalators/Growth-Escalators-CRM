// The assignee/mention → Slack DM resolver in routes/tasks.ts matches a
// task's assignedTo (or a comment mention) by name against a hardcoded GE
// staff roster (slackService's MEMBER_MAP). That roster is scoped to GE's
// own workspace, so the match — and the resulting DM — must only ever fire
// for GE's own tenant. A same-named person on any other tenant must never
// trigger a Slack DM into GE's workspace, and their task/comment data must
// never be sent there.
//
// The MEMBER_MAP entries used below are synthetic test fixtures, not the
// real GE roster — the mock replaces the module entirely so the test proves
// the *tenant gate*, independent of who is actually on the map.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendSlackDM = vi.fn().mockResolvedValue(true);

vi.mock('../services/slackService', () => ({
  sendSlackDM: (...args: unknown[]) => mockSendSlackDM(...args),
  MEMBER_MAP: {
    'synthetic-member': { slackId: 'SYN-SLACK-ID', name: 'Synthetic Member', role: 'staff' },
  },
}));

const mockPoolQuery = vi.fn();
const mockDbSelect = vi.fn();

vi.mock('../db/index', () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
  tasks: {}, contacts: {}, deals: {}, taskChecklistItems: {}, users: {},
}));

function makeReqRes(tenantSlug: string | undefined, body: Record<string, unknown>) {
  const req = { user: { tenantId: 'tenant-id', tenantSlug }, body, params: {} } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

// Grabs the LAST handler on the route (skipping requirePerm('tasks.create'),
// which now sits in front of it) — this test is about the tenant-scoped
// Slack DM logic, not permission gating (that's covered separately in
// tasksPermissions.test.ts), so it deliberately bypasses the permission
// middleware rather than mocking permissionResolver here too.
async function invokePost(req: any, res: any) {
  const { default: router } = await import('../routes/tasks');
  const layer = router.stack.find((l: any) => l.route?.path === '/' && l.route?.methods?.post);
  const stack = layer!.route!.stack;
  await stack[stack.length - 1].handle(req, res, vi.fn());
}

// Flush the microtask queue enough times for the fire-and-forget
// `void sendAssignmentDM(...)` chain (a couple of awaits deep) to settle.
async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('reseller Slack-mention identity guard on /api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPoolQuery.mockResolvedValue({
      rows: [{ id: 'task-1', assigned_to: 'synthetic-member', title: 'Ship the thing', due_at: null }],
    });
  });

  it("GE's own tenant still gets the assignment DM (unchanged)", async () => {
    const { req, res } = makeReqRes('growth-escalators', { title: 'Ship the thing', assignedTo: 'synthetic-member' });
    await invokePost(req, res);
    await flushMicrotasks();

    expect(mockSendSlackDM).toHaveBeenCalledTimes(1);
    expect(mockSendSlackDM.mock.calls[0][0]).toBe('SYN-SLACK-ID');
  });

  it('a reseller tenant with a same-named assignee triggers no DM into the GE workspace', async () => {
    const { req, res } = makeReqRes('acme-reseller', { title: 'Ship the thing', assignedTo: 'synthetic-member' });
    await invokePost(req, res);
    await flushMicrotasks();

    expect(mockSendSlackDM).not.toHaveBeenCalled();
  });

  it('a tenant with no tenantSlug claim (never GE) triggers no DM either', async () => {
    const { req, res } = makeReqRes(undefined, { title: 'Ship the thing', assignedTo: 'synthetic-member' });
    await invokePost(req, res);
    await flushMicrotasks();

    expect(mockSendSlackDM).not.toHaveBeenCalled();
  });

  it('the task itself is still created for a reseller tenant — only the DM is gated', async () => {
    const { req, res, statusFn, jsonFn } = makeReqRes('acme-reseller', { title: 'Ship the thing', assignedTo: 'synthetic-member' });
    await invokePost(req, res);
    await flushMicrotasks();

    expect(statusFn).toHaveBeenCalledWith(201);
    expect(jsonFn).toHaveBeenCalledWith({ task: expect.objectContaining({ id: 'task-1' }) });
  });
});
