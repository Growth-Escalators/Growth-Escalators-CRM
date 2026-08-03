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

// `db.select` is mocked here (not just `pool.query`) because sendColdEmail now
// checks for a per-tenant `tenant_integrations` row (Phase 3 white-label —
// tenantIntegrationsService.getDecryptedCredentials) BEFORE falling back to
// the global PURELYMAIL_*_1..6 pool below. `tenantIntegrationsService.ts`
// imports the real `tenantIntegrations` schema object directly from
// `../db/schema` (not through this mocked `../db/index`), so `eq()`/`and()`
// still operate on real Column objects — only `db.select` itself needs a stub.
const dbMocks = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../db/index', () => ({
  pool: { query: vi.fn() },
  db: { select: (...args: unknown[]) => dbMocks.select(...args) },
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
import { encryptCredentialsJSON } from '../services/credentialEncryption';
import crypto from 'crypto';

// `db.select().from(tenantIntegrations).where(...).limit(1)` chain stub.
function selectChainReturning(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) };
}

/** No `tenant_integrations` row — true for every tenant today. */
function noTenantIntegration() {
  return selectChainReturning([]);
}

/**
 * A `connected` `email_smtp` row with real, decryptable ciphertext (or a
 * deliberately broken payload, for the corruption test). `status` is always
 * 'connected' here because the mocked chain doesn't apply the real
 * `AND status = 'connected'` filter itself — a row that is NOT connected is
 * simulated with `noTenantIntegration()` instead, matching what Postgres
 * would actually return.
 */
function connectedEmailSmtpIntegration(overrides: { encryptedCredentials?: string } = {}) {
  return selectChainReturning([{
    id: 'ti-1',
    tenantId: 'tenant-1',
    provider: 'email_smtp',
    encryptedCredentials: overrides.encryptedCredentials
      ?? encryptCredentialsJSON({ host: 'smtp.tenant-own.test', port: 465, user: 'owner@tenant-own.test', pass: 'tenantOwnSecret' }),
    metadata: {},
    status: 'connected',
    createdAt: new Date(),
    updatedAt: new Date(),
  }]);
}

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
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    mailerMocks.sendMail.mockResolvedValue({ messageId: 'message-1' });
    systemChannel = '';
    sendSlackMessage.mockClear();
    // Default: no `tenant_integrations` row — true for every tenant today.
    // This is what makes every pre-existing test below a zero-behavior-change
    // proof: they all exercise the global-pool path exactly as before.
    dbMocks.select.mockReset();
    dbMocks.select.mockImplementation(() => noTenantIntegration());
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

// ---------------------------------------------------------------------------
// Phase 3 white-label — per-tenant `tenant_integrations` (provider
// 'email_smtp') takes priority over the shared global Purelymail pool above.
// ---------------------------------------------------------------------------
describe('multiDomainMailer.sendColdEmail — zero-behavior-change proof for the 3 existing tenants (Phase 3 tenant_integrations)', () => {
  const originalEnv = { ...process.env };

  // Fictitious ids standing in for the repo's 3 real tenants (this repo is
  // public — no real tenant slug/name belongs in source, see
  // tenantFeatures.test.ts's `sample-agency-basic` precedent). What matters
  // for this proof is only that NONE of them has a `tenant_integrations` row
  // yet, which is true of all 3 real tenants today.
  const EXISTING_TENANTS = ['ge-like-tenant-id', 'wizmatch-like-tenant-id', 'sample-agency-tenant-id'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.AUTOMATED_EMAILS_ENABLED = 'true';
    for (let i = 1; i <= 6; i++) {
      delete process.env[`PURELYMAIL_SMTP_USER_${i}`];
      delete process.env[`PURELYMAIL_SMTP_PASS_${i}`];
    }
    process.env.PURELYMAIL_SMTP_HOST = 'smtp.test.local';
    process.env.PURELYMAIL_SMTP_PORT = '587';
    process.env.PURELYMAIL_SMTP_USER_1 = 'sender@warned.example';
    process.env.PURELYMAIL_SMTP_PASS_1 = 'secret';
    mailerMocks.sendMail.mockResolvedValue({ messageId: 'message-1' });
    dbMocks.select.mockReset();
    dbMocks.select.mockImplementation(() => noTenantIntegration());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each(EXISTING_TENANTS)(
    'tenant %s has no tenant_integrations row, so it sends through exactly the global Purelymail pool, unchanged',
    async (tenantId) => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ domain: 'warned.example' }] } as any)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

      const result = await sendColdEmail({
        to: 'candidate@example.com', subject: 'Quick role fit', body: 'Hi there', fromName: 'Archit', tenantId,
      });

      // Byte-identical to the pre-Phase-3 result and transport args asserted
      // in the describe block above.
      expect(result).toEqual({ from: 'Archit <sender@warned.example>', domain: 'warned.example', messageId: 'message-1' });
      expect(mailerMocks.createTransport).toHaveBeenCalledWith({
        host: 'smtp.test.local', port: 587, secure: false,
        auth: { user: 'sender@warned.example', pass: 'secret' },
      });
    },
  );
});

describe('multiDomainMailer.sendColdEmail — per-tenant SMTP integration (Phase 3 tenant_integrations)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.AUTOMATED_EMAILS_ENABLED = 'true';
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    for (let i = 1; i <= 6; i++) {
      delete process.env[`PURELYMAIL_SMTP_USER_${i}`];
      delete process.env[`PURELYMAIL_SMTP_PASS_${i}`];
    }
    // Global pool deliberately left unconfigured for this describe block —
    // proves the tenant-owned path doesn't fall through to it at all.
    mailerMocks.sendMail.mockResolvedValue({ messageId: 'tenant-message-1' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses the tenants own connected SMTP credentials and never consults the shared domain-health gate', async () => {
    dbMocks.select.mockImplementation(() => connectedEmailSmtpIntegration());
    // sendWithInboxes always attempts the sends_7d bump at the end of a send
    // (harmless no-op for a domain that isn't in wizmatch_domain_health) —
    // stub it so the mocked pool.query resolves rather than returning
    // undefined.
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await sendColdEmail({
      to: 'candidate@example.com', subject: 'Quick role fit', body: 'Hi there', fromName: 'Archit', tenantId: 'tenant-1',
    });

    expect(mailerMocks.createTransport).toHaveBeenCalledWith({
      host: 'smtp.tenant-own.test', port: 465, secure: false,
      auth: { user: 'owner@tenant-own.test', pass: 'tenantOwnSecret' },
    });
    expect(result).toEqual({ from: 'Archit <owner@tenant-own.test>', domain: 'tenant-own.test', messageId: 'tenant-message-1' });
    // The only pool.query call is the harmless sends_7d bump attempt — the
    // shared-pool domain-health SELECT gate ("status = 'healthy'") is never
    // consulted for a tenant's own account.
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pool.query).mock.calls[0][0]).not.toContain("status = 'healthy'");
    expect(vi.mocked(pool.query).mock.calls[0][0]).toContain('UPDATE wizmatch_domain_health');
  });

  it('throws (sends nothing) when a connected row has a corrupt/incomplete credential payload, rather than silently falling back to the global pool', async () => {
    dbMocks.select.mockImplementation(() => connectedEmailSmtpIntegration({ encryptedCredentials: 'not-a-valid-ciphertext-payload' }));

    await expect(
      sendColdEmail({ to: 'candidate@example.com', subject: 's', body: 'b', fromName: 'Archit', tenantId: 'tenant-1' }),
    ).rejects.toThrow();
    expect(mailerMocks.sendMail).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled(); // never silently fell through to the global pool
  });

  it('throws when the decrypted payload is missing a required field (e.g. no pass)', async () => {
    dbMocks.select.mockImplementation(() => connectedEmailSmtpIntegration({
      encryptedCredentials: encryptCredentialsJSON({ host: 'smtp.tenant-own.test', port: 465, user: 'owner@tenant-own.test' }),
    }));

    await expect(
      sendColdEmail({ to: 'candidate@example.com', subject: 's', body: 'b', fromName: 'Archit', tenantId: 'tenant-1' }),
    ).rejects.toThrow(/incomplete\/invalid payload/);
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
