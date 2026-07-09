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
import { sendColdEmail } from '../services/multiDomainMailer';

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

  it('keeps sending through configured inbox fallback when no healthy domains match', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const result = await sendColdEmail({
      to: 'candidate@example.com',
      subject: 'Quick role fit',
      body: 'Hi there',
      fromName: 'Archit',
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({
      from: 'Archit <sender@warned.example>',
      domain: 'warned.example',
      messageId: 'message-1',
    });
    expect(mailerMocks.createTransport).toHaveBeenCalledWith({
      host: 'smtp.test.local',
      port: 587,
      secure: false,
      auth: { user: 'sender@warned.example', pass: 'secret' },
    });
    expect(mailerMocks.sendMail).toHaveBeenCalledOnce();
    expect(vi.mocked(pool.query).mock.calls[0][0]).toContain("status = 'healthy'");
  });
});
