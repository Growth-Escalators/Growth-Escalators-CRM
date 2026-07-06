import { describe, expect, it } from 'vitest';
import {
  CONTACT_INTELLIGENCE_PHASE1_CAPS,
  assertPhase1CostCaps,
  qualifyCompanyForContactIntelligence,
  resolveContactIntelligenceReviewAction,
} from '../services/wizmatchContactIntelligence';

describe('Wizmatch Contact Intelligence Phase 1', () => {
  it('qualifies a strong India IT signal as Tier A and caps contacts at 3', () => {
    const result = qualifyCompanyForContactIntelligence({
      company: {
        id: 'company-1',
        name: 'Bengaluru Cloud Staffing',
        domain: 'example.in',
        country: 'India',
        industry: 'IT staffing',
        isPrime: true,
        primeMsaStatus: 'signed',
      },
      signal: {
        jobTitle: 'Senior Java Developer',
        keywords: ['java', 'spring', 'microservices'],
        location: 'Bangalore, India',
        score: 9,
        daysOpen: 12,
      },
      candidateSupply: { matchedCandidateCount: 4 },
      relationships: { knownContactCount: 4, positiveReplyCount: 1, placementCount: 1, isPrime: true, hasSignedMsa: true },
      safety: { domainStatus: 'healthy' },
      internalContacts: [
        { id: '1', name: 'Asha Rao', title: 'Head of Talent Acquisition', email: 'asha@example.in', verified: true, relationshipSignals: ['reply'] },
        { id: '2', name: 'Ravi Mehta', title: 'Engineering Manager', email: 'ravi@example.in', verified: true },
        { id: '3', name: 'Nisha Jain', title: 'Vendor Manager', email: 'nisha@example.in', verified: true },
        { id: '4', name: 'Generic HR', title: 'HR Executive', email: 'hr@example.in', verified: false },
      ],
    });

    expect(result.targetRegion).toBe('india');
    expect(result.qualificationTier).toBe('A');
    expect(result.qualificationScore).toBeGreaterThanOrEqual(80);
    expect(result.contactCandidates).toHaveLength(3);
    expect(result.discoveryRunStatus).toBe('succeeded');
  });

  it('blocks non-tech and HRMS/payroll signals even if other inputs look useful', () => {
    const result = qualifyCompanyForContactIntelligence({
      company: { id: 'company-2', name: 'People Suite', domain: 'people.example', industry: 'HRMS payroll' },
      signal: { jobTitle: 'Payroll Executive', keywords: ['attendance', 'payroll'], score: 8, daysOpen: 4 },
      candidateSupply: { matchedCandidateCount: 5 },
      relationships: { knownContactCount: 2 },
      safety: { domainStatus: 'healthy' },
    });

    expect(result.qualificationTier).toBe('Reject');
    expect(result.companyStatus).toBe('rejected');
    expect(result.hardBlocks).toContain('non_tech');
  });

  it('suppression overrides an otherwise qualified company', () => {
    const result = qualifyCompanyForContactIntelligence({
      company: { id: 'company-3', name: 'US Cloud Integrator', domain: 'cloud.example', industry: 'technology', h1bSponsorCount: 10 },
      signal: { jobTitle: 'DevOps Engineer', keywords: ['aws', 'kubernetes'], location: 'New York, NY', score: 9, daysOpen: 8 },
      candidateSupply: { matchedCandidateCount: 3 },
      relationships: { knownContactCount: 1 },
      safety: { suppressedCount: 1, domainStatus: 'healthy' },
    });

    expect(result.qualificationTier).toBe('Reject');
    expect(result.companyStatus).toBe('suppressed');
    expect(result.discoveryRunStatus).toBe('skipped');
  });

  it('keeps paid enrichment impossible in Phase 1', () => {
    expect(CONTACT_INTELLIGENCE_PHASE1_CAPS.paidDiscoveryEnabled).toBe(false);
    expect(CONTACT_INTELLIGENCE_PHASE1_CAPS.maxPaidDiscoveryPerCompany).toBe(0);
    expect(assertPhase1CostCaps(1)).toBe('blocked_by_cap');
  });

  it('maps company review actions without enabling sending or paid discovery', () => {
    const approve = resolveContactIntelligenceReviewAction({
      entity: 'company',
      action: 'approve_company',
      currentCompanyStatus: 'qualified',
    });

    expect(approve.allowed).toBe(true);
    expect(approve.nextCompanyStatus).toBe('discovery_blocked');
    expect(approve.reasons.join(' ')).toContain('no outreach is sent');

    const paidDiscovery = resolveContactIntelligenceReviewAction({
      entity: 'company',
      action: 'request_paid_discovery',
      currentCompanyStatus: 'qualified',
    });

    expect(paidDiscovery.allowed).toBe(false);
    expect(paidDiscovery.nextCompanyStatus).toBe('discovery_blocked');
    expect(paidDiscovery.nextDiscoveryStatus).toBe('blocked_by_cap');
  });

  it('maps contact candidate review actions to safe statuses', () => {
    expect(resolveContactIntelligenceReviewAction({
      entity: 'contact_candidate',
      action: 'approve_contact',
      currentContactStatus: 'needs_review',
    }).nextContactStatus).toBe('approved');

    expect(resolveContactIntelligenceReviewAction({
      entity: 'contact_candidate',
      action: 'mark_do_not_contact',
      currentContactStatus: 'needs_review',
    }).nextContactStatus).toBe('do_not_contact');
  });
});
