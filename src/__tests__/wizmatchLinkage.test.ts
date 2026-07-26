import { describe, it, expect, vi, beforeEach } from 'vitest';

// PRD-005 §8.10.2 — resolving "is this contact WizMatch-linked?" via the
// canonical wizmatch_company_contacts table, then the two documented
// fallbacks (contact_candidates.crm_contact_id, job_signals.contact_id).

const state = vi.hoisted(() => ({
  companyContactRows: [] as any[],
  candidateRows: [] as any[],
  signalRows: [] as any[],
  channelRows: [] as any[],
}));

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    ...actualSchema,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => {
              if (table === actualSchema.wizmatchCompanyContacts) return Promise.resolve(state.companyContactRows);
              if (table === actualSchema.wizmatchContactCandidates) return Promise.resolve(state.candidateRows);
              if (table === actualSchema.wizmatchJobSignals) return Promise.resolve(state.signalRows);
              if (table === actualSchema.contactChannels) return Promise.resolve(state.channelRows);
              return Promise.resolve([]);
            },
          }),
        }),
      }),
    },
  };
});

import { resolveWizmatchLinkage, resolveWizmatchLinkageByEmail } from '../modules/outreach/wizmatchLinkage';

const TENANT = 'tenant-1';

beforeEach(() => {
  state.companyContactRows = [];
  state.candidateRows = [];
  state.signalRows = [];
  state.channelRows = [];
});

describe('resolveWizmatchLinkage', () => {
  it('returns null when the contact is linked nowhere', async () => {
    expect(await resolveWizmatchLinkage(TENANT, 'contact-1')).toBeNull();
  });

  it('prefers the canonical wizmatch_company_contacts row', async () => {
    state.companyContactRows = [{ companyId: 'company-canonical', relationshipStage: 'active' }];
    state.candidateRows = [{ companyId: 'company-fallback' }];
    const linkage = await resolveWizmatchLinkage(TENANT, 'contact-1');
    expect(linkage).toEqual({ companyId: 'company-canonical', relationshipStage: 'active' });
  });

  it('falls back to wizmatch_contact_candidates.crm_contact_id when no canonical row exists', async () => {
    state.candidateRows = [{ companyId: 'company-candidate' }];
    const linkage = await resolveWizmatchLinkage(TENANT, 'contact-1');
    expect(linkage).toEqual({ companyId: 'company-candidate' });
  });

  it('falls back to wizmatch_job_signals.contact_id as the last resort', async () => {
    state.signalRows = [{ companyId: 'company-signal' }];
    const linkage = await resolveWizmatchLinkage(TENANT, 'contact-1');
    expect(linkage).toEqual({ companyId: 'company-signal' });
  });

  it('returns null for an empty contactId rather than querying', async () => {
    expect(await resolveWizmatchLinkage(TENANT, '')).toBeNull();
  });
});

describe('resolveWizmatchLinkageByEmail', () => {
  it('resolves the contact by email channel, then delegates to resolveWizmatchLinkage', async () => {
    state.channelRows = [{ contactId: 'contact-9' }];
    state.companyContactRows = [{ companyId: 'company-9', relationshipStage: 'active' }];
    const linkage = await resolveWizmatchLinkageByEmail(TENANT, 'Person@Example.com');
    expect(linkage).toEqual({ companyId: 'company-9', relationshipStage: 'active' });
  });

  it('returns null when no contact owns that email channel', async () => {
    expect(await resolveWizmatchLinkageByEmail(TENANT, 'nobody@example.com')).toBeNull();
  });
});
