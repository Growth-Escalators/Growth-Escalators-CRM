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

  it('rejects a linked recipient outside the requirement company and rolls back', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM wizmatch_submissions')) return { rowCount: 1, rows: [{ id: 'submission-1', requirement_id: 'requirement-1', candidate_id: 'candidate-1', consent_id: 'consent-1', status: 'approved' }] };
        if (sql.includes('FROM wizmatch_candidate_consents')) return { rowCount: 1, rows: [{ id: 'consent-1', status: 'granted' }] };
        if (sql.includes('FROM wizmatch_requirements')) return { rowCount: 1, rows: [{ id: 'requirement-1', company_id: 'company-a' }] };
        if (sql.includes('FROM wizmatch_company_contacts')) return { rowCount: 1, rows: [{ id: 'contact-b', company_id: 'company-b' }] };
        return { rowCount: 0, rows: [] };
      },
      release: () => { statements.push('RELEASE'); },
    };
    const service = createWizmatchDeliveryService({ connect: async () => client } as any);
    await expect(service.recordSent({ tenantId: 'tenant-a', userId: 'lead-1' }, 'submission-1', {
      recipients: [{ companyContactId: 'contact-b', name: 'Person B' }],
    })).rejects.toMatchObject({ code: 'invalid_reference' });
    expect(statements).toContain('ROLLBACK');
    expect(statements.some(sql => sql.includes('INSERT INTO wizmatch_submission_recipients'))).toBe(false);
  });

  it('rejects a second placement for an already placed submission', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM wizmatch_submissions')) return { rowCount: 1, rows: [{ id: 'submission-1', status: 'placed' }] };
        return { rowCount: 0, rows: [] };
      },
      release: () => { statements.push('RELEASE'); },
    };
    const service = createWizmatchDeliveryService({ connect: async () => client } as any);
    await expect(service.createPlacement({ tenantId: 'tenant-a', userId: 'admin-1' }, 'submission-1', { offerId: 'offer-1' }))
      .rejects.toMatchObject({ code: 'duplicate_placement' });
    expect(statements).toContain('ROLLBACK');
    expect(statements.some(sql => sql.includes('INSERT INTO wizmatch_placements'))).toBe(false);
  });

  it('rejects an invoice paired with a different billing client', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM wizmatch_placements')) return { rowCount: 1, rows: [{ id: 'placement-1', requirement_id: 'requirement-1' }] };
        if (sql.includes('FROM invoices')) return { rowCount: 1, rows: [{ id: 'invoice-1', client_id: 'client-a' }] };
        if (sql.includes('FROM billing_clients')) return { rowCount: 1, rows: [{ id: 'client-b' }] };
        return { rowCount: 0, rows: [] };
      },
      release: () => { statements.push('RELEASE'); },
    };
    const service = createWizmatchDeliveryService({ connect: async () => client } as any);
    await expect(service.linkInvoice({ tenantId: 'tenant-a', userId: 'admin-1' }, 'placement-1', {
      invoiceId: 'invoice-1', billingClientId: 'client-b',
    })).rejects.toMatchObject({ code: 'invalid_reference' });
    expect(statements).toContain('ROLLBACK');
    expect(statements.some(sql => sql.includes('UPDATE wizmatch_placements SET invoice_id'))).toBe(false);
  });

  it('rejects a payment that belongs to a different invoice', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM wizmatch_placements')) return { rowCount: 1, rows: [{ id: 'placement-1', requirement_id: 'requirement-1', invoice_id: 'invoice-1' }] };
        if (sql.includes('FROM payments')) return { rowCount: 1, rows: [{ id: 'payment-2', invoice_id: 'invoice-2', client_id: 'client-a' }] };
        if (sql.includes('FROM invoices')) return { rowCount: 1, rows: [{ id: 'invoice-1', client_id: 'client-a' }] };
        return { rowCount: 0, rows: [] };
      },
      release: () => { statements.push('RELEASE'); },
    };
    const service = createWizmatchDeliveryService({ connect: async () => client } as any);
    await expect(service.createAdjustment({ tenantId: 'tenant-a', userId: 'admin-1' }, 'placement-1', {
      type: 'refund', paymentId: 'payment-2', reason: 'Client refund',
    })).rejects.toMatchObject({ code: 'invalid_reference' });
    expect(statements).toContain('ROLLBACK');
    expect(statements.some(sql => sql.includes('INSERT INTO wizmatch_staffing_adjustments'))).toBe(false);
  });

  it('rejects public consent document references before opening a transaction', async () => {
    const service = createWizmatchDeliveryService({ connect: async () => { throw new Error('should not connect'); } } as any);
    await expect(service.createConsent({ tenantId: 'tenant-a', userId: 'recruiter-1' }, {
      candidateId: 'candidate-1', requirementId: 'requirement-1', documentReference: 'https://public.example/rtr.pdf',
    })).rejects.toMatchObject({ code: 'private_document_required' });
  });

  it('defaults exact-requirement consent to 30 days and rejects longer validity', async () => {
    const params: unknown[][] = [];
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        if (values) params.push(values);
        if (sql.includes('FROM wizmatch_candidates')) return { rowCount: 1, rows: [{ id: 'candidate-1' }] };
        if (sql.includes('FROM wizmatch_requirements')) return { rowCount: 1, rows: [{ id: 'requirement-1' }] };
        if (sql.includes("status IN ('requested','granted')")) return { rowCount: 0, rows: [] };
        if (sql.includes('INSERT INTO wizmatch_candidate_consents')) return { rowCount: 1, rows: [{ id: 'consent-1', status: 'requested' }] };
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };
    const service = createWizmatchDeliveryService({ connect: async () => client } as any);
    const started = Date.now();
    await service.createConsent({ tenantId: 'tenant-a', userId: 'recruiter-1' }, { candidateId: 'candidate-1', requirementId: 'requirement-1' });
    const insertParams = params.find((value) => value[0] === 'tenant-a' && value[1] === 'candidate-1' && value.length === 9);
    const expiry = new Date(String(insertParams?.[8])).getTime();
    expect(expiry).toBeGreaterThanOrEqual(started + 30 * 86400000 - 1_000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 30 * 86400000 + 1_000);

    await expect(service.createConsent({ tenantId: 'tenant-a', userId: 'recruiter-1' }, {
      candidateId: 'candidate-1', requirementId: 'requirement-1', expiresAt: new Date(Date.now() + 31 * 86400000).toISOString(),
    })).rejects.toMatchObject({ code: 'consent_validity_exceeded' });
  });

  it('requires complete contract economics and an exception below 20 percent margin', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM wizmatch_submissions')) return { rowCount: 1, rows: [{ id: 'submission-1', status: 'offered', candidate_id: 'candidate-1', requirement_id: 'requirement-1' }] };
        if (sql.includes('FROM wizmatch_offers')) return { rowCount: 1, rows: [{ id: 'offer-1', submission_id: 'submission-1', status: 'accepted', currency: 'INR', period: 'hourly' }] };
        if (sql.includes('FROM wizmatch_requirements')) return { rowCount: 1, rows: [{ id: 'requirement-1', company_id: 'company-1' }] };
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };
    const service = createWizmatchDeliveryService({ connect: async () => client } as any);
    await expect(service.createPlacement({ tenantId: 'tenant-a', userId: 'admin-1' }, 'submission-1', {
      offerId: 'offer-1', model: 'contract', billAmount: 1000,
    })).rejects.toMatchObject({ code: 'contract_economics_required' });
    await expect(service.createPlacement({ tenantId: 'tenant-a', userId: 'admin-1' }, 'submission-1', {
      offerId: 'offer-1', model: 'contract', billAmount: 1000, loadedCost: 850,
    })).rejects.toMatchObject({ code: 'margin_exception_required' });
    expect(statements.some(sql => sql.includes('INSERT INTO wizmatch_placements'))).toBe(false);
  });
});
