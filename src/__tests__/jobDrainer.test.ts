// 2026-07-31 — internal job-queue drainer.
//
// Context: the `jobs` table had one consumer (the HTTP endpoint n8n polled),
// n8n is gone, and production measured 221 pending jobs with "last job ever
// completed: NEVER" — including 178 real website leads that never became
// contacts. These tests pin the parser against the ACTUAL production payload
// shape (sampled structurally, values redacted) and the fail-closed flag.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Tenant resolution now goes through getSingleActiveTenantWithFeature
// (tenantFeatures.ts), which queries db.select({...}).from(tenants).where(eq(tenants.isActive, true))
// and awaits the `where(...)` result DIRECTLY (no .limit() in that path).
// processFormSubmitJob's OWN "existing contact tags" lookup still chains
// .limit(1) on the same select().from().where() shape. One mock object
// serves both: it's directly awaitable (thenable) for the tenant-resolution
// path AND supports .limit() for the contacts lookup.
vi.mock('../db/index', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          then: (resolve: (v: unknown) => void) =>
            resolve([{ id: 'tenant-1', slug: 'growth-escalators', plan: 'agency_internal', settings: {} }]),
          limit: async () => [{ tags: [] }],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  tenants: { id: 'id', slug: 'slug', plan: 'plan', settings: 'settings', isActive: 'isActive' },
  contacts: { id: 'id' },
}));
vi.mock('../services/contactService', () => ({ findOrCreateContact: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

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
  it('only ever asks the queue for form_submit jobs', async () => {
    // The other queued types were handled by n8n logic that does not exist in
    // this repo. Widening this without establishing that logic would risk
    // creating wrong records from real customer data.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'jobDrainer.ts'), 'utf8');
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const calls = bare.match(/getPendingJobs\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("'form_submit'");
  });
});
