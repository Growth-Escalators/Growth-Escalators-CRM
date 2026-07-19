import { beforeEach, describe, expect, it, vi } from 'vitest';

// Thin route-level smoke tests proving the `/signals/:id/draft` and `/signals/:id/send`
// route handlers correctly map each src/services/wizmatchOutreachService.ts result
// variant to the expected HTTP status/body — i.e. that the M26 extraction into that
// service didn't change the route's external contract. Uses the same router.stack
// extraction pattern as wizmatchRequirementDelete.test.ts. The service module itself is
// mocked here (its real behavior has its own dedicated coverage in
// wizmatchOutreachService.test.ts), so this file only exercises the route glue.

const generateSignalDraftEmails = vi.fn();
const sendSignalDraftEmail = vi.fn();
vi.mock('../services/wizmatchOutreachService', () => ({
  generateSignalDraftEmails: (...args: unknown[]) => generateSignalDraftEmails(...args),
  sendSignalDraftEmail: (...args: unknown[]) => sendSignalDraftEmail(...args),
}));

import router from '../routes/wizmatch';

function routeHandler(path: string, method: string) {
  const layer = (router as unknown as { stack: any[] }).stack.find(
    (l) => l.route?.path === path && Boolean(l.route.methods?.[method]),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /signals/:id/draft — result-variant → HTTP status mapping', () => {
  const req = () => ({ user: { tenantId: 'tenant-1', id: 'user-1' }, params: { id: 'sig-1' } });

  it('maps not_found to 404', async () => {
    generateSignalDraftEmails.mockResolvedValueOnce({ kind: 'not_found' });
    const res = mockRes();
    await routeHandler('/signals/:id/draft', 'post')(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it('maps no_contact to 400', async () => {
    generateSignalDraftEmails.mockResolvedValueOnce({ kind: 'no_contact' });
    const res = mockRes();
    await routeHandler('/signals/:id/draft', 'post')(req(), res);
    expect(res.statusCode).toBe(400);
  });

  it('maps failed to 500 with the detail', async () => {
    generateSignalDraftEmails.mockResolvedValueOnce({ kind: 'failed', detail: 'boom' });
    const res = mockRes();
    await routeHandler('/signals/:id/draft', 'post')(req(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ detail: 'boom' });
  });

  it('maps succeeded to 200 with the body', async () => {
    generateSignalDraftEmails.mockResolvedValueOnce({ kind: 'succeeded', body: { signalId: 'sig-1', drafts: [] } });
    const res = mockRes();
    await routeHandler('/signals/:id/draft', 'post')(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ signalId: 'sig-1', drafts: [] });
  });
});

describe('POST /signals/:id/send — result-variant → HTTP status mapping', () => {
  const req = (body: Record<string, unknown> = { variant_message_id: 'msg-1' }) => ({
    user: { tenantId: 'tenant-1', id: 'user-1' },
    params: { id: 'sig-1' },
    body,
  });

  beforeEach(() => {
    process.env.WIZMATCH_SENDING_ENABLED = 'true';
  });

  it('returns 403 when the sending kill-switch is off, without calling the service', async () => {
    process.env.WIZMATCH_SENDING_ENABLED = 'false';
    const res = mockRes();
    await routeHandler('/signals/:id/send', 'post')(req(), res);
    expect(res.statusCode).toBe(403);
    expect(sendSignalDraftEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when variant_message_id is missing, without calling the service', async () => {
    const res = mockRes();
    await routeHandler('/signals/:id/send', 'post')(req({}), res);
    expect(res.statusCode).toBe(400);
    expect(sendSignalDraftEmail).not.toHaveBeenCalled();
  });

  it('maps not_found to 404', async () => {
    sendSignalDraftEmail.mockResolvedValueOnce({ kind: 'not_found' });
    const res = mockRes();
    await routeHandler('/signals/:id/send', 'post')(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it('maps no_email_channel to 400', async () => {
    sendSignalDraftEmail.mockResolvedValueOnce({ kind: 'no_email_channel' });
    const res = mockRes();
    await routeHandler('/signals/:id/send', 'post')(req(), res);
    expect(res.statusCode).toBe(400);
  });

  it('maps suppressed to 400', async () => {
    sendSignalDraftEmail.mockResolvedValueOnce({ kind: 'suppressed' });
    const res = mockRes();
    await routeHandler('/signals/:id/send', 'post')(req(), res);
    expect(res.statusCode).toBe(400);
  });

  it('maps hmac_secret_unset to 500', async () => {
    sendSignalDraftEmail.mockResolvedValueOnce({ kind: 'hmac_secret_unset' });
    const res = mockRes();
    await routeHandler('/signals/:id/send', 'post')(req(), res);
    expect(res.statusCode).toBe(500);
  });

  it('maps failed to 500 with the detail', async () => {
    sendSignalDraftEmail.mockResolvedValueOnce({ kind: 'failed', detail: 'smtp down' });
    const res = mockRes();
    await routeHandler('/signals/:id/send', 'post')(req(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ detail: 'smtp down' });
  });

  it('maps succeeded to 200 with the body', async () => {
    sendSignalDraftEmail.mockResolvedValueOnce({
      kind: 'succeeded',
      body: { messageId: 'msg-1', sent: true, from: 'archit@wizmatch.com', domain: 'wizmatch.com' },
    });
    const res = mockRes();
    await routeHandler('/signals/:id/send', 'post')(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ messageId: 'msg-1', sent: true, from: 'archit@wizmatch.com', domain: 'wizmatch.com' });
  });
});
