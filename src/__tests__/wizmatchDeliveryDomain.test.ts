import { describe, expect, it } from 'vitest';
import { assertCurrentConsent, calculateStaffingEconomics, createWizmatchDeliveryService } from '../services/wizmatchDeliveryDomain';

describe('Gate C delivery invariants', () => {
  it('requires granted requirement-specific consent', () => {
    expect(() => assertCurrentConsent(null)).toThrow(/consent is required/i);
    expect(() => assertCurrentConsent({ status: 'requested' })).toThrow(/consent is required/i);
    expect(() => assertCurrentConsent({ status: 'granted', expires_at: new Date(Date.now() - 1_000) })).toThrow(/expired/i);
    expect(() => assertCurrentConsent({ status: 'granted', expires_at: new Date(Date.now() + 60_000) })).not.toThrow();
  });

  it('keeps permanent placement fee separate from collection', () => {
    expect(calculateStaffingEconomics({ model: 'permanent', feeAmount: 250_000 })).toEqual({ grossMarginAmount: 250_000, grossMarginPercent: 100 });
  });

  it('calculates contract margin from bill and loaded cost', () => {
    expect(calculateStaffingEconomics({ model: 'contract', billAmount: 2_000, payAmount: 1_400, loadedCost: 1_500 }))
      .toEqual({ grossMarginAmount: 500, grossMarginPercent: 25 });
  });

  it('does not invent margin when commercial facts are missing', () => {
    expect(calculateStaffingEconomics({ model: 'contract' })).toEqual({ grossMarginAmount: 0, grossMarginPercent: 0 });
  });

  it('rolls back submission approval when exact consent is missing', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM wizmatch_submissions')) return { rowCount: 1, rows: [{ id: 'submission-1', tenant_id: 'tenant-a', requirement_id: 'requirement-1', candidate_id: 'candidate-1', status: 'draft' }] };
        if (sql.includes('FROM wizmatch_candidate_consents')) return { rowCount: 0, rows: [] };
        return { rowCount: 0, rows: [] };
      },
      release: () => { statements.push('RELEASE'); },
    };
    const service = createWizmatchDeliveryService({ connect: async () => client } as any);
    await expect(service.approveSubmission({ tenantId: 'tenant-a', userId: 'lead-1' }, 'submission-1')).rejects.toMatchObject({ code: 'consent_required' });
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(statements.some(sql => sql.includes("UPDATE wizmatch_submissions SET status='approved'"))).toBe(false);
  });
});
