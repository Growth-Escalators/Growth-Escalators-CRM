// There is no per-tenant WhatsApp Business number yet — every inbox send goes
// out through GE's own META_PHONE_NUMBER_ID/META_ACCESS_TOKEN. This pins the
// guard added to routes/inbox.ts: only GE's own tenant may use the shared
// WhatsApp number. Any other tenant must be blocked with a clear error and
// must never reach the Meta Cloud API call — i.e. never send under GE's
// identity — while GE's own tenant keeps working exactly as before.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

function makeReqRes(tenantSlug: string | undefined, contactId: string, body: Record<string, unknown>) {
  const req = { user: { tenantId: 'tenant-id', tenantSlug }, params: { contactId }, body } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

function mockChannelFound() {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ channelValue: '919876543210' }]),
      }),
    }),
  });
}

function mockInsertSaved() {
  mockDbInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'msg-1', content: 'hi' }]),
    }),
  });
}

async function invoke(req: any, res: any, path: string) {
  const { default: router } = await import('../routes/inbox');
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.post);
  await layer!.route!.stack[0].handle(req, res, vi.fn());
}

describe('reseller WhatsApp identity guard on /api/inbox', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockChannelFound();
    mockInsertSaved();
    process.env.META_PHONE_NUMBER_ID = 'ge-shared-phone-id';
    process.env.META_ACCESS_TOKEN = 'ge-shared-token';
    fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('POST /conversations/:contactId/send', () => {
    it("GE's own tenant sends exactly as today (Meta Cloud API called)", async () => {
      const { req, res, jsonFn, statusFn } = makeReqRes('growth-escalators', 'contact-1', { message: 'hi' });
      await invoke(req, res, '/conversations/:contactId/send');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('ge-shared-phone-id');
      expect(statusFn).not.toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith({ message: { id: 'msg-1', content: 'hi' } });
    });

    it('a reseller tenant is blocked with no send and no message persisted', async () => {
      const { req, res, statusFn, jsonFn } = makeReqRes('acme-reseller', 'contact-1', { message: 'hi' });
      await invoke(req, res, '/conversations/:contactId/send');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(statusFn).toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith({ error: "WhatsApp sending isn't configured for your workspace" });
    });

    it('a tenant with no tenantSlug claim (never GE) is blocked the same way', async () => {
      const { req, res, statusFn } = makeReqRes(undefined, 'contact-1', { message: 'hi' });
      await invoke(req, res, '/conversations/:contactId/send');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(statusFn).toHaveBeenCalledWith(403);
    });
  });

  describe('POST /conversations/:contactId/send-template', () => {
    it("GE's own tenant still sends templates as today", async () => {
      const { req, res, jsonFn } = makeReqRes('growth-escalators', 'contact-1', { templateName: 'ge_welcome_d2c' });
      await invoke(req, res, '/conversations/:contactId/send-template');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(jsonFn).toHaveBeenCalledWith({ message: { id: 'msg-1', content: 'hi' } });
    });

    it('a reseller tenant is blocked before any template send', async () => {
      const { req, res, statusFn, jsonFn } = makeReqRes('acme-reseller', 'contact-1', { templateName: 'ge_welcome_d2c' });
      await invoke(req, res, '/conversations/:contactId/send-template');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(statusFn).toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith({ error: "WhatsApp sending isn't configured for your workspace" });
    });
  });

  it('the "no WhatsApp channel" 400 still fires before the tenant gate (existing contract preserved)', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });
    const { req, res, statusFn } = makeReqRes('acme-reseller', 'contact-1', { message: 'hi' });
    await invoke(req, res, '/conversations/:contactId/send');

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
