import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Phase 3 white-label — `emailService.ts`'s send functions (used by the CRM
// transactional/notification/invoice email path) now check a tenant's own
// connected `email_smtp` integration (`tenant_integrations`,
// `credentialEncryption.ts`) BEFORE falling back to the global Brevo path,
// reusing the exact same lookup `multiDomainMailer.sendColdEmail` already
// uses (`getTenantSmtpCredentials`, exported from `multiDomainMailer.ts`).
//
// This suite proves the load-bearing guarantee for this change: a tenant
// with no `tenant_integrations` row (true for every real tenant today,
// including Growth Escalators' own) sends EXACTLY as before — real Brevo
// client, real global sender address — while a tenant with a connected
// `email_smtp` row sends through its own SMTP credentials instead, and Brevo
// is never touched in that case.
//
// Mocking approach mirrors `multiDomainMailer.test.ts`: `db.select` is
// stubbed (not `../db/schema`), so `tenantIntegrationsService.ts` — which
// imports the real `tenantIntegrations` table object directly from
// `../db/schema` — still operates on real Drizzle Column objects for its
// `eq()`/`and()` calls; only the query result itself is faked. Credential
// encryption is real (`credentialEncryption.ts` is not mocked), so this also
// proves the encrypt/decrypt round trip works end-to-end through this path.
// ---------------------------------------------------------------------------

const mailerMocks = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: mailerMocks.createTransport },
}));

const brevoMocks = vi.hoisted(() => {
  const sendTransacEmail = vi.fn();
  const createContact = vi.fn();
  // A real `function` (not an arrow function) so `new BrevoClient(...)` in
  // emailService.ts works — arrow functions can't be used as constructors.
  const BrevoClient = vi.fn().mockImplementation(function (this: unknown, opts: unknown) {
    Object.assign(this as object, {
      _opts: opts,
      transactionalEmails: { sendTransacEmail },
      contacts: { createContact },
    });
  });
  return { sendTransacEmail, createContact, BrevoClient };
});

vi.mock('@getbrevo/brevo', () => ({
  BrevoClient: brevoMocks.BrevoClient,
}));

// `db.select` is mocked (see file-level comment); everything else `../db/index`
// exports is passed through from the real schema module so any code that
// references e.g. `contacts.id` for `eq()`/`and()` still gets real Column
// objects, even though none of the tests below exercise `sendSequenceEmail`
// (the only emailService function that touches those tables).
const dbMocks = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../db/index', async () => {
  const schema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    pool: { query: vi.fn() },
    db: {
      select: (...args: unknown[]) => dbMocks.select(...args),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    },
    contacts: schema.contacts,
    contactChannels: schema.contactChannels,
    messages: schema.messages,
    emailTemplates: schema.emailTemplates,
  };
});

import { sendTransactionalEmail, sendManualEmail } from '../services/emailService';
import { encryptCredentialsJSON } from '../services/credentialEncryption';

// `db.select().from(tenantIntegrations).where(...).limit(1)` chain stub —
// identical shape to multiDomainMailer.test.ts.
function selectChainReturning(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) };
}

/** No `tenant_integrations` row — true for every real tenant today. */
function noTenantIntegration() {
  return selectChainReturning([]);
}

function connectedEmailSmtpIntegration(overrides: { encryptedCredentials?: string } = {}) {
  return selectChainReturning([{
    id: 'ti-1',
    tenantId: 'tenant-own-smtp',
    provider: 'email_smtp',
    encryptedCredentials: overrides.encryptedCredentials
      ?? encryptCredentialsJSON({ host: 'smtp.tenant-own.test', port: 465, user: 'owner@tenant-own.test', pass: 'tenantOwnSecret' }),
    metadata: {},
    status: 'connected',
    createdAt: new Date(),
    updatedAt: new Date(),
  }]);
}

describe('emailService.sendTransactionalEmail — tenant SMTP vs global Brevo fallback (Phase 3 tenant_integrations)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.BREVO_API_KEY = 'test-brevo-key';
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    brevoMocks.sendTransacEmail.mockResolvedValue({ messageId: 'brevo-msg-1' });
    mailerMocks.sendMail.mockResolvedValue({ messageId: 'tenant-smtp-msg-1' });
    dbMocks.select.mockReset();
    // Default: no `tenant_integrations` row — matches every real tenant today.
    dbMocks.select.mockImplementation(() => noTenantIntegration());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---- (a) zero-behavior-change proof: no integration -> global Brevo path ----

  it('(a) a tenant with NO configured email_smtp integration sends via the existing global Brevo path, unchanged', async () => {
    const result = await sendTransactionalEmail(
      'lead@example.com',
      'Lead Name',
      'Welcome',
      '<p>hi</p>',
      'hi',
      'tenant-no-integration',
    );

    // Real provider used is Brevo, with the exact pre-existing global sender.
    expect(brevoMocks.BrevoClient).toHaveBeenCalledWith({ apiKey: 'test-brevo-key' });
    expect(brevoMocks.sendTransacEmail).toHaveBeenCalledWith({
      subject: 'Welcome',
      htmlContent: '<p>hi</p>',
      textContent: 'hi',
      sender: { name: 'Growth Escalators', email: 'hello@growthescalators.com' },
      to: [{ email: 'lead@example.com', name: 'Lead Name' }],
    });
    expect(result).toEqual({ success: true, messageId: 'brevo-msg-1' });

    // Tenant SMTP transport is never touched for this tenant.
    expect(mailerMocks.createTransport).not.toHaveBeenCalled();
    expect(mailerMocks.sendMail).not.toHaveBeenCalled();
  });

  it('(a) a call with no tenantId at all (pre-existing callers not yet updated) skips the tenant lookup entirely and hits Brevo, unchanged', async () => {
    const result = await sendTransactionalEmail('lead@example.com', 'Lead Name', 'Welcome', '<p>hi</p>', 'hi');

    expect(dbMocks.select).not.toHaveBeenCalled();
    expect(brevoMocks.sendTransacEmail).toHaveBeenCalledWith(
      expect.objectContaining({ sender: { name: 'Growth Escalators', email: 'hello@growthescalators.com' } }),
    );
    expect(result).toEqual({ success: true, messageId: 'brevo-msg-1' });
  });

  it('(a) preserves the pre-existing BREVO_API_KEY-unset mock-success behavior for a tenant with no integration', async () => {
    delete process.env.BREVO_API_KEY;
    const result = await sendTransactionalEmail('lead@example.com', 'Lead Name', 'Welcome', '<p>hi</p>', 'hi', 'tenant-no-integration');

    expect(result.success).toBe(true);
    expect(result.mock).toBe(true);
    expect(brevoMocks.BrevoClient).not.toHaveBeenCalled();
    expect(mailerMocks.createTransport).not.toHaveBeenCalled();
  });

  it.each(['ge-like-tenant-id', 'wizmatch-like-tenant-id', 'sample-agency-tenant-id'])(
    '(a) tenant %s (no tenant_integrations row) sends through exactly the global Brevo path, unchanged',
    async (tenantId) => {
      const result = await sendTransactionalEmail('lead@example.com', 'Lead Name', 'Welcome', '<p>hi</p>', 'hi', tenantId);
      expect(result).toEqual({ success: true, messageId: 'brevo-msg-1' });
      expect(brevoMocks.sendTransacEmail).toHaveBeenCalledWith(
        expect.objectContaining({ sender: { name: 'Growth Escalators', email: 'hello@growthescalators.com' } }),
      );
      expect(mailerMocks.sendMail).not.toHaveBeenCalled();
    },
  );

  // ---- (b) tenant with its own connected SMTP integration ----

  it('(b) a tenant WITH configured SMTP credentials sends via those credentials instead of Brevo', async () => {
    dbMocks.select.mockImplementation(() => connectedEmailSmtpIntegration());

    const result = await sendTransactionalEmail(
      'lead@example.com',
      'Lead Name',
      'Welcome',
      '<p>hi</p>',
      'hi',
      'tenant-own-smtp',
    );

    expect(mailerMocks.createTransport).toHaveBeenCalledWith({
      host: 'smtp.tenant-own.test',
      port: 465,
      secure: false,
      auth: { user: 'owner@tenant-own.test', pass: 'tenantOwnSecret' },
    });
    expect(mailerMocks.sendMail).toHaveBeenCalledWith({
      from: 'owner@tenant-own.test',
      to: 'lead@example.com',
      subject: 'Welcome',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(result).toEqual({ success: true, messageId: 'tenant-smtp-msg-1' });

    // Brevo is never touched for a tenant with its own connected SMTP account.
    expect(brevoMocks.BrevoClient).not.toHaveBeenCalled();
    expect(brevoMocks.sendTransacEmail).not.toHaveBeenCalled();
  });

  it('(b) throws (sends nothing, no Brevo fallback) when a connected row has a corrupt credential payload', async () => {
    dbMocks.select.mockImplementation(() => connectedEmailSmtpIntegration({ encryptedCredentials: 'not-a-valid-ciphertext-payload' }));

    await expect(
      sendTransactionalEmail('lead@example.com', 'Lead Name', 'Welcome', '<p>hi</p>', 'hi', 'tenant-own-smtp'),
    ).rejects.toThrow();

    expect(mailerMocks.sendMail).not.toHaveBeenCalled();
    expect(brevoMocks.sendTransacEmail).not.toHaveBeenCalled();
  });

  it('(b) throws when the decrypted payload is missing a required field (e.g. no pass), never silently falling back to Brevo', async () => {
    dbMocks.select.mockImplementation(() => connectedEmailSmtpIntegration({
      encryptedCredentials: encryptCredentialsJSON({ host: 'smtp.tenant-own.test', port: 465, user: 'owner@tenant-own.test' }),
    }));

    await expect(
      sendTransactionalEmail('lead@example.com', 'Lead Name', 'Welcome', '<p>hi</p>', 'hi', 'tenant-own-smtp'),
    ).rejects.toThrow(/incomplete\/invalid payload/);

    expect(mailerMocks.sendMail).not.toHaveBeenCalled();
    expect(brevoMocks.sendTransacEmail).not.toHaveBeenCalled();
  });
});

describe('emailService.sendManualEmail — forwards tenantId through to the same fallback logic', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.BREVO_API_KEY = 'test-brevo-key';
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    brevoMocks.sendTransacEmail.mockResolvedValue({ messageId: 'brevo-msg-2' });
    mailerMocks.sendMail.mockResolvedValue({ messageId: 'tenant-smtp-msg-2' });
    dbMocks.select.mockReset();
    dbMocks.select.mockImplementation(() => noTenantIntegration());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('(a) with no tenant integration, sends via Brevo exactly as before (body converted to <br> html)', async () => {
    const result = await sendManualEmail('lead@example.com', 'Lead Name', 'Hi', 'line one\nline two', 'tenant-no-integration');

    expect(brevoMocks.sendTransacEmail).toHaveBeenCalledWith({
      subject: 'Hi',
      htmlContent: 'line one<br>line two',
      textContent: 'line one\nline two',
      sender: { name: 'Growth Escalators', email: 'hello@growthescalators.com' },
      to: [{ email: 'lead@example.com', name: 'Lead Name' }],
    });
    expect(result.success).toBe(true);
    expect(mailerMocks.sendMail).not.toHaveBeenCalled();
  });

  it('(b) with a connected tenant SMTP integration, sends via those credentials instead of Brevo', async () => {
    dbMocks.select.mockImplementation(() => connectedEmailSmtpIntegration());

    const result = await sendManualEmail('lead@example.com', 'Lead Name', 'Hi', 'line one\nline two', 'tenant-own-smtp');

    expect(mailerMocks.createTransport).toHaveBeenCalledWith({
      host: 'smtp.tenant-own.test',
      port: 465,
      secure: false,
      auth: { user: 'owner@tenant-own.test', pass: 'tenantOwnSecret' },
    });
    expect(mailerMocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'owner@tenant-own.test',
      to: 'lead@example.com',
      subject: 'Hi',
      html: 'line one<br>line two',
      text: 'line one\nline two',
    }));
    expect(result).toEqual({ success: true, messageId: 'tenant-smtp-msg-2' });
    expect(brevoMocks.sendTransacEmail).not.toHaveBeenCalled();
  });
});
