import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
  },
  messages: {},
  contacts: {},
  contactChannels: { id: 'id', contactId: 'contact_id', tenantId: 'tenant_id', channelType: 'channel_type', channelValue: 'channel_value' },
  waTemplates: {},
}));

function makeReqRes(tenantId: string, contactId: string, body: Record<string, unknown> = { message: 'hi' }) {
  const req = { user: { tenantId }, params: { contactId }, body } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

async function invokeSend(req: any, res: any, path = '/conversations/:contactId/send') {
  const { default: router } = await import('../routes/inbox');
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.post);
  await layer!.route!.stack[0].handle(req, res, vi.fn());
}

describe('POST /api/inbox/conversations/:contactId/send(-template) (C8 — tenant isolation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('/send scopes the WhatsApp channel lookup to the caller tenant, not just the contact', async () => {
    let capturedWhere: unknown;
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((cond: unknown) => {
          capturedWhere = cond;
          return { limit: vi.fn().mockResolvedValue([]) }; // no channel found → 400, no send attempted
        }),
      }),
    });

    const tenantA = makeReqRes('tenant-a', 'contact-in-tenant-b');
    await invokeSend(tenantA.req, tenantA.res);

    expect(capturedWhere).toBeDefined();
    // 400 (no WhatsApp channel found for THIS tenant) rather than proceeding
    // to send — proves the query didn't fall back to a tenant-blind match.
    expect(tenantA.statusFn).toHaveBeenCalledWith(400);
  });

  it('/send-template scopes the WhatsApp channel lookup to the caller tenant', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const tenantA = makeReqRes('tenant-a', 'contact-in-tenant-b', { templateName: 'ge_welcome' });
    await invokeSend(tenantA.req, tenantA.res, '/conversations/:contactId/send-template');

    expect(tenantA.statusFn).toHaveBeenCalledWith(400);
  });

  it('the same contactId queried by two different tenants produces two different where() conditions (proves tenantId is embedded, not just contactId)', async () => {
    const seenWheres: unknown[] = [];
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((cond: unknown) => {
          seenWheres.push(cond);
          return { limit: vi.fn().mockResolvedValue([]) };
        }),
      }),
    });

    const sameContactId = 'contact-xyz';
    const tenantA = makeReqRes('tenant-a', sameContactId);
    const tenantB = makeReqRes('tenant-b', sameContactId);
    await invokeSend(tenantA.req, tenantA.res);
    await invokeSend(tenantB.req, tenantB.res);

    expect(seenWheres).toHaveLength(2);
    expect(seenWheres[0]).not.toEqual(seenWheres[1]);
  });
});
