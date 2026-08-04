// 2026-07-31 — internal job-queue drainer.
//
// Context: the `jobs` table had one consumer (the HTTP endpoint n8n polled),
// n8n is gone, and production measured 221 pending jobs with "last job ever
// completed: NEVER" — including 178 real website leads that never became
// contacts. These tests pin the parser against the ACTUAL production payload
// shape (sampled structurally, values redacted) and the fail-closed flag.
//
// 2026-08-04 — two more fixes landed in this file, both covered below:
//
//   Bug 1 (lead theft by slug order): tenant resolution for form_submit
//   recovery used to go through getSingleActiveTenantWithFeature, which
//   picked the first QUALIFYING tenant by slug — so a reseller_pilot tenant
//   sorting before growth-escalators could silently absorb GE's own website
//   leads. It now goes through getDefaultIngestTenant, which is pinned to
//   DEFAULT_TENANT_SLUG. The db mock below is slug-aware specifically so the
//   "resolves to GE's tenant" tests are a real regression guard, not a mock
//   that trivially returns whatever's first.
//
//   Bug 2 (sequences never send): sequenceWorker.ts enqueues `sequence_step`
//   jobs, but nothing drained that job type — see the new
//   `processSequenceStepJob` / `drainSequenceStepsOnce` tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Extracts drizzle's BOUND VALUES off a `where()` condition object —
 * matches the technique in tenantFeatures.test.ts's "only queries isActive
 * tenants" test. Used below to make the tenant-resolution mock simulate a
 * REAL `WHERE slug = DEFAULT_TENANT_SLUG` filter (Bug 1's fix) rather than
 * just returning a fixed row regardless of the query.
 */
function extractBoundValues(condition: unknown): unknown[] {
  const chunks = (condition as { queryChunks?: Array<{ value?: unknown }> })?.queryChunks ?? [];
  return chunks
    .filter((c) => c && typeof c === 'object' && 'value' in c && !Array.isArray(c.value))
    .map((c) => c.value);
}

// Two active tenants, RESELLER FIRST — the exact ordering that made the old
// getSingleActiveTenantWithFeature('crmAutomation') silently route GE's own
// leads to the reseller (reseller_pilot also has crmAutomation: true).
const TENANT_ROWS = [
  { id: 'reseller-id', slug: 'acme-agency', plan: 'reseller_pilot', settings: {}, isActive: true },
  { id: 'tenant-1', slug: 'growth-escalators', plan: 'agency_internal', settings: {}, isActive: true },
];

// getDefaultIngestTenant() does `.where(eq(tenants.slug, DEFAULT_TENANT_SLUG)).limit(1)`;
// processFormSubmitJob's OWN "existing contact tags" lookup does
// `.where(eq(contacts.id, contact.id)).limit(1)` on the same select().from().where()
// shape. This mock tells them apart by inspecting the bound value: if it
// matches a tenant slug, return the (slug-filtered) tenant row(s); otherwise
// fall back to the contacts-lookup shape.
vi.mock('../db/index', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          const bound = extractBoundValues(condition);
          const matchedTenants = TENANT_ROWS.filter((r) => bound.includes(r.slug));
          return { limit: async () => (matchedTenants.length ? matchedTenants : [{ tags: [] }]) };
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  tenants: { id: 'id', slug: 'slug', plan: 'plan', settings: 'settings', isActive: 'isActive' },
  contacts: { id: 'id' },
}));
vi.mock('../services/contactService', () => ({ findOrCreateContact: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/jobQueue', () => ({
  getPendingJobs: vi.fn(),
  claimJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
}));
vi.mock('../services/emailService', () => ({
  sendSequenceEmail: vi.fn(),
  automatedEmailsEnabled: vi.fn(),
}));

// The real production shape: { eventId, data: { responseId, fields: [...] } }
// with labels Name / Email / Phone / Source / UTM / Business type.
function tally(fields: Array<{ label: string; value: unknown }>) {
  return { eventId: 'evt_1', data: { responseId: 'resp_1', fields } };
}

describe('parseTallySubmission', () => {
  it('extracts the real production field labels', async () => {
    const { parseTallySubmission } = await import('../services/jobDrainer');
    const p = parseTallySubmission(tally([
      { label: 'Name', value: 'Asha Rao' },
      { label: 'Email', value: 'asha@example.invalid' },
      { label: 'Phone', value: '+91 98765 43210' },
      { label: 'Source', value: 'google' },
      { label: 'UTM', value: 'utm_campaign=spring' },
      { label: 'Business type', value: 'Agency' },
    ]));
    expect(p).toEqual({
      name: 'Asha Rao', email: 'asha@example.invalid', phone: '+91 98765 43210',
      source: 'google', utm: 'utm_campaign=spring', businessType: 'Agency',
    });
  });

  it('matches labels case- and whitespace-insensitively', async () => {
    const { parseTallySubmission } = await import('../services/jobDrainer');
    const p = parseTallySubmission(tally([
      { label: '  EMAIL  ', value: 'x@example.invalid' },
      { label: 'full name', value: 'Ravi Mehta' },
    ]));
    expect(p.email).toBe('x@example.invalid');
    expect(p.name).toBe('Ravi Mehta');
  });

  it('does not depend on field ORDER (order is not stable across forms)', async () => {
    const { parseTallySubmission } = await import('../services/jobDrainer');
    const a = parseTallySubmission(tally([{ label: 'Email', value: 'a@example.invalid' }, { label: 'Name', value: 'A' }]));
    const b = parseTallySubmission(tally([{ label: 'Name', value: 'A' }, { label: 'Email', value: 'a@example.invalid' }]));
    expect(a).toEqual(b);
  });

  it('joins array answers (Tally sends multi-select as arrays)', async () => {
    const { parseTallySubmission } = await import('../services/jobDrainer');
    expect(parseTallySubmission(tally([{ label: 'Business type', value: ['Agency', 'SaaS'] }])).businessType)
      .toBe('Agency, SaaS');
  });

  it('ignores null/empty values rather than returning empty strings', async () => {
    const { parseTallySubmission } = await import('../services/jobDrainer');
    const p = parseTallySubmission(tally([
      { label: 'Email', value: null }, { label: 'Phone', value: '   ' }, { label: 'Name', value: '' },
    ]));
    expect(p.email).toBeUndefined();
    expect(p.phone).toBeUndefined();
    expect(p.name).toBeUndefined();
  });

  it('survives a malformed payload without throwing', async () => {
    const { parseTallySubmission } = await import('../services/jobDrainer');
    for (const bad of [null, undefined, {}, { data: null }, { data: { fields: 'nope' } }, 'string']) {
      expect(() => parseTallySubmission(bad)).not.toThrow();
    }
  });
});

describe('processFormSubmitJob — contact invariants', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.resetModules());

  it('skips a submission with no email rather than creating a junk contact', async () => {
    const { processFormSubmitJob } = await import('../services/jobDrainer');
    const { findOrCreateContact } = await import('../services/contactService');
    const r = await processFormSubmitJob('job-1', tally([{ label: 'Name', value: 'No Email' }]));
    expect(r).toBe('skipped');
    expect(findOrCreateContact).not.toHaveBeenCalled();
  });

  // THE REGRESSION TEST for Bug 1 at the ingestion-recovery layer: TENANT_ROWS
  // above deliberately sorts the reseller tenant BEFORE growth-escalators.
  // Recovered website leads must still land on GE's tenant.
  it('resolves to growth-escalators, not the reseller, even though the reseller tenant sorts first by slug', async () => {
    const { processFormSubmitJob } = await import('../services/jobDrainer');
    const { findOrCreateContact } = await import('../services/contactService');
    (findOrCreateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ contact: { id: 'c1' }, created: true });
    await processFormSubmitJob('job-1', tally([{ label: 'Email', value: 'asha@example.invalid' }]));
    const tenantIdArg = (findOrCreateContact as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(tenantIdArg).toBe('tenant-1'); // growth-escalators, never 'reseller-id'
  });

  it('lowercases the email and digit-normalises the phone with a 91 prefix', async () => {
    const { processFormSubmitJob } = await import('../services/jobDrainer');
    const { findOrCreateContact } = await import('../services/contactService');
    (findOrCreateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ contact: { id: 'c1' }, created: true });
    await processFormSubmitJob('job-1', tally([
      { label: 'Email', value: '  MiXeD@Example.INVALID ' },
      { label: 'Phone', value: '+91 (98765) 43210' },
      { label: 'Name', value: 'Asha Rao' },
    ]));
    const arg = (findOrCreateContact as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(arg.channels[0]).toEqual({ channelType: 'email', channelValue: 'mixed@example.invalid', isPrimary: true });
    expect(arg.channels[1]).toEqual({ channelType: 'whatsapp', channelValue: '919876543210' });
    expect(arg.firstName).toBe('Asha');
    expect(arg.lastName).toBe('Rao');
  });

  it('adds the 91 prefix only when it is missing', async () => {
    const { processFormSubmitJob } = await import('../services/jobDrainer');
    const { findOrCreateContact } = await import('../services/contactService');
    (findOrCreateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ contact: { id: 'c1' }, created: true });
    await processFormSubmitJob('job-1', tally([
      { label: 'Email', value: 'a@example.invalid' }, { label: 'Phone', value: '919876543210' },
    ]));
    const arg = (findOrCreateContact as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(arg.channels[1].channelValue).toBe('919876543210');
  });

  it('omits the whatsapp channel entirely when no phone was given', async () => {
    const { processFormSubmitJob } = await import('../services/jobDrainer');
    const { findOrCreateContact } = await import('../services/contactService');
    (findOrCreateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ contact: { id: 'c1' }, created: true });
    await processFormSubmitJob('job-1', tally([{ label: 'Email', value: 'a@example.invalid' }]));
    expect((findOrCreateContact as ReturnType<typeof vi.fn>).mock.calls[0][1].channels).toHaveLength(1);
  });

  it('falls back to the email local-part when no name was given', async () => {
    const { processFormSubmitJob } = await import('../services/jobDrainer');
    const { findOrCreateContact } = await import('../services/contactService');
    (findOrCreateContact as ReturnType<typeof vi.fn>).mockResolvedValue({ contact: { id: 'c1' }, created: true });
    await processFormSubmitJob('job-1', tally([{ label: 'Email', value: 'asha@example.invalid' }]));
    expect((findOrCreateContact as ReturnType<typeof vi.fn>).mock.calls[0][1].firstName).toBe('asha');
  });
});

describe('isJobDrainerEnabled — fail closed', () => {
  it.each([undefined, '', 'false', 'no', 'off', '0', 'TRUEISH'])('is OFF for %j', async (v) => {
    const { isJobDrainerEnabled } = await import('../services/jobDrainer');
    expect(isJobDrainerEnabled({ JOB_DRAINER_ENABLED: v } as NodeJS.ProcessEnv)).toBe(false);
  });

  it.each(['true', 'TRUE', '1', 'yes', 'on', ' true '])('is ON for %j', async (v) => {
    const { isJobDrainerEnabled } = await import('../services/jobDrainer');
    expect(isJobDrainerEnabled({ JOB_DRAINER_ENABLED: v } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('scope discipline', () => {
  it('only ever asks the queue for form_submit and sequence_step jobs', async () => {
    // The other queued types (inbound_wa, chatwoot_event, booking_processed,
    // hot_lead_alert, facebook_lead_failed) were handled by n8n logic that
    // does not exist in this repo. Widening to those without establishing
    // that logic would risk creating wrong records from real customer data.
    // sequence_step is different: its processing logic (sendSequenceEmail)
    // already exists in this repo — see processSequenceStepJob.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'jobDrainer.ts'), 'utf8');
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const calls = bare.match(/getPendingJobs\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual(expect.stringContaining("'form_submit'"));
    expect(calls).toContainEqual(expect.stringContaining("'sequence_step'"));
    for (const forbidden of ['inbound_wa', 'chatwoot_event', 'booking_processed', 'hot_lead_alert', 'facebook_lead_failed']) {
      expect(calls.some((c) => c.includes(`'${forbidden}'`))).toBe(false);
    }
  });
});

describe('processSequenceStepJob — reuses sendSequenceEmail, tenant-scoped (Bug 2 fix)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.resetModules());

  it('throws on a payload missing contactId/tenantId/templateName, rather than silently no-oping', async () => {
    const { processSequenceStepJob } = await import('../services/jobDrainer');
    await expect(processSequenceStepJob('job-1', { contactId: 'c1' }, null)).rejects.toThrow(/missing/);
  });

  it('calls sendSequenceEmail with the CONTACT/TEMPLATE/TENANT off the job payload — not a global default tenant', async () => {
    const { processSequenceStepJob } = await import('../services/jobDrainer');
    const { sendSequenceEmail } = await import('../services/emailService');
    (sendSequenceEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, messageId: 'msg_1' });
    const payload = {
      enrolmentId: 'enrol-1',
      contactId: 'contact-9',
      tenantId: 'wizmatch-tenant-id', // deliberately NOT growth-escalators — proves no hardcoded default is used
      stepDefinition: { templateName: 'followup_day3', channel: 'email' },
    };
    const outcome = await processSequenceStepJob('job-1', payload, null);
    expect(outcome).toBe('sent');
    expect(sendSequenceEmail).toHaveBeenCalledWith('contact-9', 'followup_day3', 'wizmatch-tenant-id');
  });

  it('falls back to the job row tenantId when the payload omits it', async () => {
    const { processSequenceStepJob } = await import('../services/jobDrainer');
    const { sendSequenceEmail } = await import('../services/emailService');
    (sendSequenceEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    const payload = { contactId: 'contact-9', stepDefinition: { templateName: 'welcome_d2c' } };
    await processSequenceStepJob('job-1', payload, 'job-row-tenant-id');
    expect(sendSequenceEmail).toHaveBeenCalledWith('contact-9', 'welcome_d2c', 'job-row-tenant-id');
  });

  it('returns "blocked" (not an error) when sendSequenceEmail reports the outreach policy blocked it', async () => {
    const { processSequenceStepJob } = await import('../services/jobDrainer');
    const { sendSequenceEmail } = await import('../services/emailService');
    (sendSequenceEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, reason: 'outreach_blocked:cooldown_active' });
    const outcome = await processSequenceStepJob('job-1', {
      contactId: 'c1', tenantId: 't1', stepDefinition: { templateName: 'nudge_day7' },
    }, null);
    expect(outcome).toBe('blocked');
  });

  it('returns "skipped" for terminal, non-retryable reasons (no email channel, unknown template, contact not found)', async () => {
    const { processSequenceStepJob } = await import('../services/jobDrainer');
    const { sendSequenceEmail } = await import('../services/emailService');
    for (const reason of ['no email channel', 'unknown template: nope', 'contact not found']) {
      (sendSequenceEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false, reason });
      const outcome = await processSequenceStepJob('job-1', {
        contactId: 'c1', tenantId: 't1', stepDefinition: { templateName: 'nope' },
      }, null);
      expect(outcome).toBe('skipped');
    }
  });

  // Preserves the AUTOMATED_EMAILS_ENABLED kill switch: a job that reaches
  // sendSequenceEmail while the flag is off must be RETRIED later (thrown),
  // never marked done — done would lose the send forever once re-enabled.
  it('throws (retryable) rather than completing when sendSequenceEmail reports the automated-emails kill switch is off', async () => {
    const { processSequenceStepJob } = await import('../services/jobDrainer');
    const { sendSequenceEmail } = await import('../services/emailService');
    (sendSequenceEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, reason: 'automated_emails_disabled' });
    await expect(processSequenceStepJob('job-1', {
      contactId: 'c1', tenantId: 't1', stepDefinition: { templateName: 'welcome_d2c' },
    }, null)).rejects.toThrow(/AUTOMATED_EMAILS_ENABLED/);
  });
});

describe('drainSequenceStepsOnce — gating, tenant scope, and failure isolation (Bug 2 fix)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.resetModules());

  it('never claims a sequence_step job while AUTOMATED_EMAILS_ENABLED is off — preserves the existing kill switch', async () => {
    const { drainSequenceStepsOnce } = await import('../services/jobDrainer');
    const { automatedEmailsEnabled } = await import('../services/emailService');
    const { getPendingJobs, claimJob } = await import('../services/jobQueue');
    (automatedEmailsEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const stats = await drainSequenceStepsOnce();
    expect(stats).toEqual({ processed: 0, sent: 0, blocked: 0, skipped: 0, failed: 0 });
    expect(getPendingJobs).not.toHaveBeenCalled();
    expect(claimJob).not.toHaveBeenCalled();
  });

  it('produces a send attempt per due job, tenant-scoped, once AUTOMATED_EMAILS_ENABLED is on', async () => {
    const { drainSequenceStepsOnce } = await import('../services/jobDrainer');
    const { automatedEmailsEnabled, sendSequenceEmail } = await import('../services/emailService');
    const { getPendingJobs, claimJob, completeJob } = await import('../services/jobQueue');
    (automatedEmailsEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (getPendingJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'job-1', tenantId: 'ge-tenant', payload: { contactId: 'c1', tenantId: 'ge-tenant', stepDefinition: { templateName: 'welcome_d2c' } } },
    ]);
    (claimJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job-1' });
    (sendSequenceEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, messageId: 'msg_1' });

    const stats = await drainSequenceStepsOnce();

    expect(getPendingJobs).toHaveBeenCalledWith('sequence_step', expect.any(Number));
    expect(sendSequenceEmail).toHaveBeenCalledWith('c1', 'welcome_d2c', 'ge-tenant');
    expect(completeJob).toHaveBeenCalledWith('job-1');
    expect(stats).toEqual({ processed: 1, sent: 1, blocked: 0, skipped: 0, failed: 0 });
  });

  // THE OTHER key regression test named in the PR: one bad job must not wedge
  // the drainer loop — later jobs in the same batch still get processed.
  it('a failing job does not block later jobs in the same batch', async () => {
    const { drainSequenceStepsOnce } = await import('../services/jobDrainer');
    const { automatedEmailsEnabled, sendSequenceEmail } = await import('../services/emailService');
    const { getPendingJobs, claimJob, completeJob, failJob } = await import('../services/jobQueue');
    (automatedEmailsEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (getPendingJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'job-bad', tenantId: 't1', payload: { contactId: 'c1', tenantId: 't1', stepDefinition: { templateName: 'welcome_d2c' } } },
      { id: 'job-good', tenantId: 't1', payload: { contactId: 'c2', tenantId: 't1', stepDefinition: { templateName: 'welcome_d2c' } } },
    ]);
    (claimJob as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'claimed' });
    (failJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (sendSequenceEmail as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('SMTP transport exploded'))
      .mockResolvedValueOnce({ success: true, messageId: 'msg_2' });

    const stats = await drainSequenceStepsOnce();

    expect(failJob).toHaveBeenCalledWith('job-bad', expect.stringContaining('SMTP transport exploded'));
    expect(completeJob).toHaveBeenCalledWith('job-good');
    expect(stats).toEqual({ processed: 1, sent: 1, blocked: 0, skipped: 0, failed: 1 });
  });

  it('leaves a job alone (no complete/fail) when another worker already claimed it', async () => {
    const { drainSequenceStepsOnce } = await import('../services/jobDrainer');
    const { automatedEmailsEnabled, sendSequenceEmail } = await import('../services/emailService');
    const { getPendingJobs, claimJob, completeJob, failJob } = await import('../services/jobQueue');
    (automatedEmailsEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (getPendingJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'job-1', tenantId: 't1', payload: { contactId: 'c1', tenantId: 't1', stepDefinition: { templateName: 'welcome_d2c' } } },
    ]);
    (claimJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined); // race lost
    await drainSequenceStepsOnce();
    expect(sendSequenceEmail).not.toHaveBeenCalled();
    expect(completeJob).not.toHaveBeenCalled();
    expect(failJob).not.toHaveBeenCalled();
  });
});
