import { describe, it, expect } from 'vitest';
import {
  WIZMATCH_REASON_CODES,
  WIZMATCH_PREP_BLOCKING_REASON_CODES,
  checkWizmatchTaxonomyInvariants,
  isPreparationAllowed,
} from '../config/wizmatchReasonCodes';

describe('WizMatch reason-code taxonomy (PRD-005 §9.11 invariants)', () => {
  it('has no invariant violations', () => {
    expect(checkWizmatchTaxonomyInvariants()).toEqual([]);
  });

  it('invariant 3 — exactly six codes stop preparation', () => {
    expect(WIZMATCH_PREP_BLOCKING_REASON_CODES).toHaveLength(6);
    expect([...WIZMATCH_PREP_BLOCKING_REASON_CODES].sort()).toEqual(
      [
        'policy_no_external_agencies',
        'relationship_irrelevant',
        'company_removal_request',
        'legal_notice',
        'regulator_request',
        'privacy_request_pending',
      ].sort(),
    );
  });

  it('a company_removal_request stops preparation (H-1 regression)', () => {
    expect(isPreparationAllowed('company_removal_request')).toBe(false);
  });

  it('the three operational fail-closed codes allow preparation (H-3)', () => {
    expect(isPreparationAllowed('policy_resolver_error')).toBe(true);
    expect(isPreparationAllowed('policy_missing_root')).toBe(true);
    expect(isPreparationAllowed('scope_unresolvable')).toBe(true);
  });

  it('every code has a unique value', () => {
    const codes = WIZMATCH_REASON_CODES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every compliance code is non-overridable', () => {
    for (const r of WIZMATCH_REASON_CODES) {
      if (r.category === 'compliance') {
        expect(r.overridable).toBe(false);
      }
    }
  });
});
