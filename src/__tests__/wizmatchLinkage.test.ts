import { describe, it, expect, vi, beforeEach } from 'vitest';

// PRD-005 §8.10.2 — resolving "is this contact WizMatch-linked?" via the
// canonical wizmatch_company_contacts table, then the two documented
// fallbacks (contact_candidates.crm_contact_id, job_signals.contact_id).
//
// D-32 / U-13 regression: `resolveWizmatchLinkage` now resolves ALL linked
// companies and ranks them by canonical decision (deny > review > allow)
// instead of returning on the first `.limit(1)` match — so this mock must
// return every matching row per mechanism (not just one) and must also
// answer the policy-resolver's own queries (predicate-captured by company,
// per the fixed idiom — see wizmatchPolicyService.test.ts / M-5/L-6).

const state = vi.hoisted(() => ({
  /** Hoisted so the `vi.mock` factory below can enforce the tenant predicate. */
  tenant: 'tenant-1',
  companyContactRows: [] as any[],
  candidateRows: [] as any[],
  signalRows: [] as any[],
  channelRows: [] as any[],
  /** Keyed by companyId -> array of active policy rows for that company. */
  policyRowsByCompany: {} as Record<string, any[]>,
}));

function paramValues(node: unknown, seen = new WeakSet<object>()): string[] {
  if (node === null || typeof node !== 'object') return [];
  if (seen.has(node as object)) return [];
  seen.add(node as object);
  const out: string[] = [];
  const ctorName = (node as { constructor?: { name?: string } }).constructor?.name;
  if (ctorName === 'Param' && typeof (node as { value?: unknown }).value === 'string') {
    out.push((node as { value: string }).value);
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'table') continue;
    out.push(...paramValues(value, seen));
  }
  return out;
}

// The 2026-07-26 independent re-review found this mock still used the
// discard-the-predicate idiom (PR 2 M-5 / PR 3 L-6 / PR 5 H-7, the third
// recurrence): rows were returned per TABLE regardless of the `where()`
// condition, and `.limit()` was `() => promise`. Both of D-32's own
// regressions therefore stayed green — deleting the tenant predicate from
// `collectLinkedCompanyIds`, and reverting to `.limit(1)`, changed nothing
// the suite could see. Two behaviours are added here so the suite can
// actually fail:
//   1. the tenant predicate is honoured — rows are only returned when the
//      queried tenant appears in the condition's bound parameters;
//   2. `.limit(n)` genuinely slices, so a reintroduced `.limit(1)` truncates
//      the multi-company fixtures and breaks most-restrictive-wins.
vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  const dbLike: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          const values = new Set(paramValues(condition));
          // A query that does not bind the tenant is not tenant-scoped, and
          // this mock refuses to answer it — the same way a real tenant
          // predicate would return another tenant's zero rows.
          const tenantScoped = values.has(state.tenant);
          const resolveRows = (): Promise<any[]> => {
            if (!tenantScoped) return Promise.resolve([]);
            if (table === actualSchema.wizmatchCompanyContacts) return Promise.resolve(state.companyContactRows);
            if (table === actualSchema.wizmatchContactCandidates) return Promise.resolve(state.candidateRows);
            if (table === actualSchema.wizmatchJobSignals) return Promise.resolve(state.signalRows);
            if (table === actualSchema.contactChannels) return Promise.resolve(state.channelRows);
            if (table === actualSchema.wizmatchCompanyPolicies) {
              const companyId = Object.keys(state.policyRowsByCompany).find((id) => values.has(id));
              return Promise.resolve(companyId ? state.policyRowsByCompany[companyId] : []);
            }
            // Suppression / duplicates / enrolments / companies — none of
            // this suite's fixtures exercise them, so they're always empty.
            return Promise.resolve([]);
          };
          const promise = resolveRows();
          // resolveWizmatchLinkageByEmail's contactChannels lookup chains
          // .limit(1). Honour the bound genuinely, so that reintroducing a
          // per-mechanism `.limit(1)` in wizmatchLinkage.ts truncates the
          // U-13 fixtures and fails the most-restrictive-wins tests.
          return Object.assign(promise, {
            limit: (n: number) => promise.then((rows) => rows.slice(0, n)),
          });
        },
      }),
    }),
  };
  return { ...actualSchema, db: dbLike };
});

import { resolveWizmatchLinkage, resolveWizmatchLinkageByEmail } from '../modules/outreach/wizmatchLinkage';

const TENANT = state.tenant;

function rootPolicy(companyId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `policy-${companyId}`,
    companyId,
    scopeType: 'entire_company',
    scopeKey: 'entire_company',
    outreachEligibility: 'eligible',
    externalHiringPolicy: 'accepts_external_vendors',
    relationshipType: 'new_prospect',
    reasonCode: 'policy_accepts_external_vendors',
    blockClass: 'standard',
    isNonOverridable: false,
    isPermanent: false,
    evidenceKind: 'human_text',
    evidenceText: 'test',
    evidenceUrl: null,
    evidenceRef: null,
    source: 'human',
    actorUserId: null,
    supersededAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.companyContactRows = [];
  state.candidateRows = [];
  state.signalRows = [];
  state.channelRows = [];
  state.policyRowsByCompany = {};
});

describe('resolveWizmatchLinkage', () => {
  it('returns null when the contact is linked nowhere', async () => {
    expect(await resolveWizmatchLinkage(TENANT, 'contact-1')).toBeNull();
  });

  it('resolves the single canonical wizmatch_company_contacts company (allow)', async () => {
    state.companyContactRows = [{ companyId: 'company-canonical', relationshipStage: 'active' }];
    state.policyRowsByCompany['company-canonical'] = [rootPolicy('company-canonical')];
    const linkage = await resolveWizmatchLinkage(TENANT, 'contact-1');
    expect(linkage?.companyId).toBe('company-canonical');
    expect(linkage?.relationshipStage).toBe('active');
    expect(linkage?.companiesConsidered).toHaveLength(1);
    expect(linkage?.companiesConsidered[0]).toMatchObject({ companyId: 'company-canonical', decision: 'allow' });
  });

  it('falls back to wizmatch_contact_candidates.crm_contact_id when no canonical row exists', async () => {
    state.candidateRows = [{ companyId: 'company-candidate' }];
    state.policyRowsByCompany['company-candidate'] = [rootPolicy('company-candidate')];
    const linkage = await resolveWizmatchLinkage(TENANT, 'contact-1');
    expect(linkage?.companyId).toBe('company-candidate');
  });

  it('falls back to wizmatch_job_signals.contact_id as the last resort', async () => {
    state.signalRows = [{ companyId: 'company-signal' }];
    state.policyRowsByCompany['company-signal'] = [rootPolicy('company-signal')];
    const linkage = await resolveWizmatchLinkage(TENANT, 'contact-1');
    expect(linkage?.companyId).toBe('company-signal');
  });

  it('returns null for an empty contactId rather than querying', async () => {
    expect(await resolveWizmatchLinkage(TENANT, '')).toBeNull();
  });

  // The mock only answers a query whose bound parameters include the queried
  // tenant, so this fails if any `eq(<table>.tenantId, tenantId)` is dropped
  // from collectLinkedCompanyIds — the regression the previous mock could not
  // see (M-5 / L-6 / H-7, third recurrence).
  it('does not resolve a linkage for another tenant (tenant predicate is load-bearing)', async () => {
    state.companyContactRows = [{ companyId: 'company-canonical', relationshipStage: 'active' }];
    state.policyRowsByCompany['company-canonical'] = [rootPolicy('company-canonical')];
    expect(await resolveWizmatchLinkage('tenant-other', 'contact-1')).toBeNull();
  });

  // D-32 / U-13 regression: two companies linked to the same contact, one
  // eligible and one blocked. The prior `.limit(1)`-per-mechanism code could
  // return the eligible one first depending on row order — an eligible
  // company masking a blocked one. The fix must ALWAYS resolve to the
  // most-restrictive (deny) company, with both considered in provenance.
  it('resolves to the most restrictive of two linked companies, never an arbitrary one (U-13)', async () => {
    state.companyContactRows = [
      { companyId: 'company-eligible', relationshipStage: 'active' },
      { companyId: 'company-blocked', relationshipStage: 'active' },
    ];
    state.policyRowsByCompany['company-eligible'] = [rootPolicy('company-eligible')];
    state.policyRowsByCompany['company-blocked'] = [
      rootPolicy('company-blocked', {
        outreachEligibility: 'blocked',
        isNonOverridable: true,
        blockClass: 'compliance',
        reasonCode: 'company_removal_request',
      }),
    ];

    const linkage = await resolveWizmatchLinkage(TENANT, 'contact-1');
    expect(linkage?.companyId).toBe('company-blocked');
    expect(linkage?.companiesConsidered).toHaveLength(2);
    expect(linkage?.companiesConsidered.map((c) => c.companyId).sort()).toEqual(['company-blocked', 'company-eligible']);
    expect(linkage?.companiesConsidered.find((c) => c.companyId === 'company-blocked')?.decision).toBe('deny');
    expect(linkage?.companiesConsidered.find((c) => c.companyId === 'company-eligible')?.decision).toBe('allow');
  });

  it('review beats allow when no company is denied (deny > review > allow)', async () => {
    state.companyContactRows = [
      { companyId: 'company-allow' },
      { companyId: 'company-review' },
    ];
    state.policyRowsByCompany['company-allow'] = [rootPolicy('company-allow')];
    state.policyRowsByCompany['company-review'] = [rootPolicy('company-review', { outreachEligibility: 'needs_review' })];

    const linkage = await resolveWizmatchLinkage(TENANT, 'contact-1');
    expect(linkage?.companyId).toBe('company-review');
  });

  it('deduplicates the same company found via more than one mechanism', async () => {
    state.companyContactRows = [{ companyId: 'company-both' }];
    state.candidateRows = [{ companyId: 'company-both' }];
    state.policyRowsByCompany['company-both'] = [rootPolicy('company-both')];

    const linkage = await resolveWizmatchLinkage(TENANT, 'contact-1');
    expect(linkage?.companiesConsidered).toHaveLength(1);
  });
});

describe('resolveWizmatchLinkageByEmail', () => {
  it('resolves the contact by email channel, then delegates to resolveWizmatchLinkage', async () => {
    state.channelRows = [{ contactId: 'contact-9' }];
    state.companyContactRows = [{ companyId: 'company-9', relationshipStage: 'active' }];
    state.policyRowsByCompany['company-9'] = [rootPolicy('company-9')];
    const linkage = await resolveWizmatchLinkageByEmail(TENANT, 'Person@Example.com');
    expect(linkage?.companyId).toBe('company-9');
    expect(linkage?.relationshipStage).toBe('active');
    expect(linkage?.contactId).toBe('contact-9');
  });

  // Load-bearing for §22.3 #5: an email-only caller (row 21, /send-test) can
  // only reach the contact grain of the suppression union — contacts.do_not_contact
  // — if the resolved contactId comes back with the linkage. Dropping it silently
  // degrades the union to the email grain alone, which is the A-1 defect.
  it('carries the resolved contactId back so the caller can gate on the contact grain', async () => {
    state.channelRows = [{ contactId: 'contact-42' }];
    state.companyContactRows = [{ companyId: 'company-42', relationshipStage: 'active' }];
    state.policyRowsByCompany['company-42'] = [rootPolicy('company-42')];
    const linkage = await resolveWizmatchLinkageByEmail(TENANT, 'dnc@example.com');
    expect(linkage?.contactId).toBe('contact-42');
  });

  it('returns null when no contact owns that email channel', async () => {
    expect(await resolveWizmatchLinkageByEmail(TENANT, 'nobody@example.com')).toBeNull();
  });
});
