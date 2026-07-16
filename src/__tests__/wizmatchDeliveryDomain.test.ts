import { describe, expect, it } from 'vitest';
import {
  assertCurrentConsent,
  calculateStaffingEconomics,
  createWizmatchDeliveryService,
  normalizeStaffingAnalyticsFilters,
  placementNextAllowedActions,
  submissionNextAllowedActions,
} from '../services/wizmatchDeliveryDomain';

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

  it('completes a zero-work reminder run without creating tasks or events', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };
    const service = createWizmatchDeliveryService({ connect: async () => client } as any);

    await expect(service.runDeterministicReminders('tenant-a')).resolves.toEqual({
      requirementSla: 0,
      submissionFollowUps: 0,
      availabilityReviews: 0,
      total: 0,
    });
    expect(statements).toContain('COMMIT');
    expect(statements.some(sql => sql.includes('INSERT INTO tasks'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO wizmatch_staffing_events'))).toBe(false);
    expect(statements.some(sql => /message|provider|send/i.test(sql))).toBe(false);
  });

  it('deduplicates an existing open requirement reminder', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM wizmatch_requirements r')) {
          return {
            rowCount: 1,
            rows: [{
              requirement_id: 'requirement-1',
              title: 'SAP ABAP Consultant',
              next_action: 'Review shortlist',
              next_action_due_at: new Date('2026-07-13T03:47:00.000Z'),
              assigned_to: 'recruiter-1',
            }],
          };
        }
        if (sql.includes("t.title='[Wizmatch] Requirement SLA overdue'")) {
          return { rowCount: 1, rows: [{ exists: 1 }] };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };
    const service = createWizmatchDeliveryService({ connect: async () => client } as any);

    await expect(service.runDeterministicReminders('tenant-a')).resolves.toMatchObject({
      requirementSla: 0,
      total: 0,
    });
    expect(statements.some(sql => sql.includes('INSERT INTO tasks'))).toBe(false);
    expect(statements.some(sql => sql.includes('INSERT INTO wizmatch_staffing_events'))).toBe(false);
  });

  it('provides explicit delivery and placement next actions', () => {
    expect(submissionNextAllowedActions('draft')).toEqual(['approve_submission', 'withdraw_submission']);
    expect(submissionNextAllowedActions('placed')).toEqual([]);
    expect(placementNextAllowedActions({ status: 'started', invoice_id: null })).toEqual(['link_invoice', 'open_adjustment']);
    expect(placementNextAllowedActions({ status: 'started', invoice_id: 'invoice-a', amount_due: 100, open_adjustment_count: 1 }))
      .toEqual(['review_collection', 'open_adjustment', 'resolve_adjustment']);
  });

  it('returns a tenant-scoped traceable placement read model linked to finance', async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain('WHERE p.tenant_id=$1 AND p.submission_id IS NOT NULL');
      expect(sql).toContain('pay.tenant_id=p.tenant_id');
      expect(params).toEqual(['tenant-a']);
      return {
        rows: [{
          id: 'placement-a', status: 'started', linked_submission_id: 'submission-a', linked_requirement_id: 'requirement-a',
          linked_company_id: 'company-a', linked_candidate_id: 'candidate-a', candidate_first_name: 'Rahul', candidate_last_name: 'Sharma',
          requirement_title: 'SAP ABAP', company_name: 'Company A', commercial_model: 'permanent', original_amount: 250000,
          original_currency: 'INR', original_period: 'joining', gross_margin_amount: 250000, invoice_id: 'invoice-a',
          invoice_number: 'INV-1', invoice_status: 'partially_paid', invoice_total_amount: 250000, invoice_amount_paid: 100000,
          amount_due: 150000, collection_count: 1, collection_amount: 100000, open_adjustment_count: 0,
        }],
      };
    };
    const service = createWizmatchDeliveryService({ query } as any);
    const result = await service.listPlacements('tenant-a');
    expect(result.items[0]).toMatchObject({
      placementId: 'placement-a', submissionId: 'submission-a', requirementId: 'requirement-a', companyId: 'company-a',
      candidateId: 'candidate-a', candidateName: 'Rahul Sharma',
      economics: { model: 'permanent', originalAmount: 250000, originalCurrency: 'INR' },
      invoice: { id: 'invoice-a', number: 'INV-1', amountDue: 150000 },
      collections: { count: 1, amount: 100000 },
      nextAllowedActions: ['review_collection', 'open_adjustment'],
    });
  });

  it('adds tenant-scoped acquisition counts without replacing the delivery funnel', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const service = createWizmatchDeliveryService({
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('AS job_leads')) return { rows: [{ job_leads: 25, poc_ready: 12, requirements: 7, matches: 20, shortlists: 8 }] };
        if (sql.includes('SELECT submission.status,COUNT(*)::int AS count')) return { rows: [{ status: 'submitted', count: 4 }] };
        if (sql.includes('AS companies') && sql.includes('AS recruiters')) return { rows: [{ companies: [], recruiters: [], skills: [], sources: ['theirstack'] }] };
        return { rows: [] };
      },
    } as any);
    const result = await service.analytics('tenant-a', {
      from: '2026-07-01', to: '2026-07-14',
      companyId: '11111111-1111-4111-8111-111111111111',
      recruiterId: '22222222-2222-4222-8222-222222222222',
      skillId: '33333333-3333-4333-8333-333333333333',
      source: 'TheirStack',
    });
    expect(result.funnel).toEqual([{ status: 'submitted', count: 4 }]);
    expect(result.acquisition).toMatchObject({ job_leads: 25, poc_ready: 12, requirements: 7, matches: 20, shortlists: 8 });
    expect(result.acquisitionFunnel).toEqual([
      { stage: 'job_leads', count: 25 },
      { stage: 'poc_ready', count: 12 },
      { stage: 'requirements', count: 7 },
      { stage: 'matches', count: 20 },
      { stage: 'shortlists', count: 8 },
    ]);
    const acquisitionSql = queries.find((query) => query.sql.includes('AS job_leads'))?.sql || '';
    expect(acquisitionSql).toContain("candidate.metadata->>'signalId'=signal.id::text");
    expect(acquisitionSql).toContain("candidate_match.human_decision='shortlisted'");
    expect(queries.every((query) => query.params)).toBe(true);
    expect(queries.every((query) => query.params[0] === 'tenant-a')).toBe(true);
    const scopedQuery = queries.find((query) => query.params.length === 7);
    expect(scopedQuery?.params).toEqual([
      'tenant-a', '2026-07-01', '2026-07-14',
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333', 'theirstack',
    ]);
    expect(queries.filter((query) => query.params.length === 7).every((query) => query.sql.includes('$4::uuid'))).toBe(true);
    expect(result.filters).toMatchObject({ from: '2026-07-01', to: '2026-07-14', source: 'theirstack' });
    expect(result.filterOptions).toMatchObject({ sources: ['theirstack'] });
  });

  it('validates analytics filters before interpolating tenant-scoped SQL', () => {
    expect(normalizeStaffingAnalyticsFilters({ from: '2026-07-01', to: '2026-07-14', source: 'ATS' }))
      .toMatchObject({ from: '2026-07-01', to: '2026-07-14', source: 'ats' });
    expect(() => normalizeStaffingAnalyticsFilters({ from: '14/07/2026' })).toThrow(/YYYY-MM-DD/);
    expect(() => normalizeStaffingAnalyticsFilters({ from: '2026-07-15', to: '2026-07-14' })).toThrow(/on or before/);
    expect(() => normalizeStaffingAnalyticsFilters({ companyId: 'not-a-uuid' })).toThrow(/UUID/);
    expect(() => normalizeStaffingAnalyticsFilters({ source: 'xray;drop table' })).toThrow(/source is invalid/);
    expect(() => normalizeStaffingAnalyticsFilters({ source: ['xray'] })).toThrow(/source is invalid/);
  });
});
