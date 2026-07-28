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

const sendSlackMessage = vi.fn(async (...args: unknown[]) => true);
vi.mock('../services/slackService', () => ({
  sendSlackMessage: (...args: unknown[]) => sendSlackMessage(...args),
}));

// A getter (not a fixed value) so a test can flip WIZMATCH_SYSTEM_CHANNEL
// without vi.resetModules() — constants.ts computes the real export once at
// import time, which a later process.env write wouldn't affect.
let systemChannel = '';
vi.mock('../config/constants', () => ({
  get WIZMATCH_SYSTEM_CHANNEL() { return systemChannel; },
}));

import { pool } from '../db/index';
import { sendColdEmail } from '../services/multiDomainMailer';

describe('multiDomainMailer.sendColdEmail', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // sendColdEmail is gated by the master automated-email kill-switch; this
    // suite tests the send path, so enable it explicitly.
    process.env.AUTOMATED_EMAILS_ENABLED = 'true';
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
    systemChannel = '';
    sendSlackMessage.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('PRD-005 §18.3 — fails closed (throws, sends nothing) when no healthy domain matches and the emergency override is off', async () => {
    delete process.env.WIZMATCH_MAILER_EMERGENCY_OVERRIDE;
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      sendColdEmail({
        to: 'candidate@example.com',
        subject: 'Quick role fit',
        body: 'Hi there',
        fromName: 'Archit',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow(/WIZMATCH_MAILER_EMERGENCY_OVERRIDE/);
    expect(mailerMocks.sendMail).not.toHaveBeenCalled();
  });

  it('sends through the configured inbox fallback when no healthy domain matches AND the emergency override is explicitly on, alerting Slack', async () => {
    process.env.WIZMATCH_MAILER_EMERGENCY_OVERRIDE = 'true';
    systemChannel = '#wizmatch-system';
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
    expect(sendSlackMessage).toHaveBeenCalledTimes(1);
    expect(sendSlackMessage.mock.calls[0][0]).toBe('#wizmatch-system');
    expect(String(sendSlackMessage.mock.calls[0][1])).toMatch(/emergency override/i);
  });

  it('is suppressed (throws, sends nothing) when AUTOMATED_EMAILS_ENABLED is off', async () => {
    delete process.env.AUTOMATED_EMAILS_ENABLED;
    await expect(
      sendColdEmail({ to: 'x@example.com', subject: 's', body: 'b', fromName: 'A', tenantId: 't1' }),
    ).rejects.toThrow(/AUTOMATED_EMAILS_ENABLED/);
    expect(mailerMocks.sendMail).not.toHaveBeenCalled();
  });
});

describe('multiDomainMailer.sendWarmupEmails — mailbox health (§8.10.1 row 30)', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.AUTOMATED_EMAILS_ENABLED = 'true';
    for (let i = 1; i <= 6; i++) {
      delete process.env[`PURELYMAIL_SMTP_USER_${i}`];
      delete process.env[`PURELYMAIL_SMTP_PASS_${i}`];
    }
    process.env.PURELYMAIL_SMTP_USER_1 = 'healthy@warmed.example';
    process.env.PURELYMAIL_SMTP_PASS_1 = 'secret1';
    process.env.PURELYMAIL_SMTP_USER_2 = 'unhealthy@cold.example';
    process.env.PURELYMAIL_SMTP_PASS_2 = 'secret2';
    mailerMocks.sendMail.mockResolvedValue({ messageId: 'warmup-1' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('never warms an inbox whose domain is not healthy', async () => {
    const { sendWarmupEmails } = await import('../services/multiDomainMailer');
    // Only warmed.example reports healthy; cold.example does not appear.
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ domain: 'warmed.example' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    await sendWarmupEmails('tenant-1', ['friend@partner.example']);

    expect(mailerMocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mailerMocks.sendMail.mock.calls[0][0].from).toContain('healthy@warmed.example');
  });

  it('sends nothing when no configured inbox is on a healthy domain', async () => {
    const { sendWarmupEmails } = await import('../services/multiDomainMailer');
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const result = await sendWarmupEmails('tenant-1', ['friend@partner.example']);

    expect(mailerMocks.sendMail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, total: 2 });
  });
});
