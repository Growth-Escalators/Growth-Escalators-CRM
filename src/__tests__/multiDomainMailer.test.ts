import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mailerMocks = vi.hoisted(() => {
  const sendMail = vi.fn();
  return {
    sendMail,
    createTransport: vi.fn(() => ({ sendMail })),
  };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: mailerMocks.createTransport },
}));

vi.mock('../db/index', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../db/index';
import { sendColdEmail, AllInboxesAtDailyCapError } from '../services/multiDomainMailer';

describe('multiDomainMailer.sendColdEmail', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    for (let i = 1; i <= 6; i++) {
      delete process.env[`PURELYMAIL_SMTP_USER_${i}`];
      delete process.env[`PURELYMAIL_SMTP_PASS_${i}`];
      delete process.env[`PURELYMAIL_USER_${i}`];
      delete process.env[`PURELYMAIL_PASS_${i}`];
    }
    process.env.PURELYMAIL_SMTP_HOST = 'smtp.test.local';
    process.env.PURELYMAIL_SMTP_PORT = '587';
    process.env.PURELYMAIL_SMTP_USER_1 = 'sender@warned.example';
    process.env.PURELYMAIL_SMTP_PASS_1 = 'secret';
    mailerMocks.sendMail.mockResolvedValue({ messageId: 'message-1' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('keeps sending through configured inbox fallback when no sendable domains match', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as any)          // sendable domains: none
      .mockResolvedValueOnce({ rows: [] } as any)           // today's per-inbox counts: none
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // sends_7d bump

    const result = await sendColdEmail({
      to: 'candidate@example.com',
      subject: 'Quick role fit',
      body: 'Hi there',
      fromName: 'Archit',
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({
      from: 'Archit <sender@warned.example>',
      fromInbox: 'sender@warned.example',
      domain: 'warned.example',
      messageId: 'message-1',
    });
    expect(mailerMocks.sendMail).toHaveBeenCalledOnce();
    // Paused/blacklisted domains must never be used for cold sends.
    expect(vi.mocked(pool.query).mock.calls[0][0]).toContain("NOT IN ('paused', 'blacklisted')");
  });

  it('throws AllInboxesAtDailyCapError when the only inbox is already at the daily cap', async () => {
    process.env.WIZMATCH_MAX_SENDS_PER_INBOX_DAY = '30';
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as any) // sendable domains: none → fallback to all inboxes
      .mockResolvedValueOnce({ rows: [{ inbox: 'sender@warned.example', c: 30 }] } as any); // already at cap

    await expect(
      sendColdEmail({ to: 'x@example.com', subject: 's', body: 'b', fromName: 'Archit', tenantId: 'tenant-1' }),
    ).rejects.toBeInstanceOf(AllInboxesAtDailyCapError);
    expect(mailerMocks.sendMail).not.toHaveBeenCalled();
  });
});
