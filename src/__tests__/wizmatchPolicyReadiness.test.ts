// PRD-005 §21.1 — readiness report pure-function tests. Only the pure
// evaluator is exercised here (no DB), following wizmatchReadiness.test.ts's
// existing split-testing convention (see wizmatchReadiness.ts for the
// tested-pure-fn / untested-thin-DB-wrapper split this file mirrors).

import { describe, it, expect } from 'vitest';
import { evaluateWizmatchPolicyReadiness } from '../modules/outreach/policyReadiness';

const baseInput = {
  tenantId: 'tenant-1',
  totalCompanies: 10,
  companiesWithRootPolicy: 10,
  byEligibility: { eligible: 6, needs_review: 4 },
  byHiringPolicy: { accepts_external_vendors: 6, unknown: 4 },
  byRelationship: { new_prospect: 10 },
  contactsReviewed: 5,
  contactConfidenceDistribution: { high: 2, medium: 1, low: 1, unverified: 1 },
  duplicatesPending: 0,
  duplicatesMerged: 0,
  duplicatesConfirmedSeparate: 0,
  duplicatesPendingWithLiveEnrolment: 0,
  shadowWouldHaveBlockedCount: 0,
  reasonCodeDistribution: { policy_accepts_external_vendors: 6, policy_unknown_cold_start: 4 },
};

describe('evaluateWizmatchPolicyReadiness', () => {
  it('reports full policy coverage and zero missing when every company has a root row', () => {
    const result = evaluateWizmatchPolicyReadiness(baseInput);
    expect(result.metrics.companiesMissingRootPolicy).toBe(0);
    expect(result.metrics.policyCoveragePercent).toBe(100);
    expect(result.g4Preconditions.zeroCompaniesMissingPolicy).toBe(true);
  });

  it('computes companiesMissingRootPolicy and coverage percent when coverage is partial (§21.2 condition 4)', () => {
    const result = evaluateWizmatchPolicyReadiness({ ...baseInput, totalCompanies: 131, companiesWithRootPolicy: 129 });
    expect(result.metrics.companiesMissingRootPolicy).toBe(2);
    expect(result.metrics.policyCoveragePercent).toBeCloseTo((129 / 131) * 100, 1);
    expect(result.g4Preconditions.zeroCompaniesMissingPolicy).toBe(false);
  });

  it('treats zero total companies as 100% coverage rather than dividing by zero', () => {
    const result = evaluateWizmatchPolicyReadiness({ ...baseInput, totalCompanies: 0, companiesWithRootPolicy: 0 });
    expect(result.metrics.policyCoveragePercent).toBe(100);
    expect(result.metrics.companiesMissingRootPolicy).toBe(0);
  });

  it('flags the G4 precondition false when a pending duplicate has a live enrolment (§21.2 condition 2)', () => {
    const result = evaluateWizmatchPolicyReadiness({ ...baseInput, duplicatesPending: 1, duplicatesPendingWithLiveEnrolment: 1 });
    expect(result.g4Preconditions.zeroPendingDuplicatesWithLiveEnrolment).toBe(false);
  });

  it('passes through the classification distributions and reason-code distribution unchanged', () => {
    const result = evaluateWizmatchPolicyReadiness(baseInput);
    expect(result.metrics.classification.byEligibility).toEqual(baseInput.byEligibility);
    expect(result.metrics.reasonCodeDistribution).toEqual(baseInput.reasonCodeDistribution);
  });

  it('honestly marks export omissions and policy resolver errors as unavailable rather than fabricating a count', () => {
    const result = evaluateWizmatchPolicyReadiness(baseInput);
    expect(result.metrics.exportOmissions.unavailable).toBe(true);
    expect(result.metrics.policyResolverErrors.unavailable).toBe(true);
    expect(result.metrics.duplicates.pendingInActivePilotBatch.unavailable).toBe(true);
  });

  it('never lets companiesMissingRootPolicy go negative even with an inconsistent input', () => {
    const result = evaluateWizmatchPolicyReadiness({ ...baseInput, totalCompanies: 5, companiesWithRootPolicy: 8 });
    expect(result.metrics.companiesMissingRootPolicy).toBe(0);
  });
});
