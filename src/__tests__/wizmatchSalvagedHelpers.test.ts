import { describe, expect, it } from 'vitest';
import { extractCanonicalSkillKeywords } from '../services/wizmatchSkillExtraction';
import {
  buildRequirementReadiness,
  allowedRequirementTransitions,
} from '../services/wizmatchStaffingDomain';
import {
  submissionNextAllowedActions,
  placementNextAllowedActions,
} from '../services/wizmatchDeliveryDomain';
import {
  normalizeLinkedInProfileUrl,
  normalizeXrayResultLimit,
  capLinkedInProfileResults,
} from '../services/wizmatchXrayScraper';

describe('extractCanonicalSkillKeywords', () => {
  it('matches longest phrase first so JavaScript is not seen as Java', () => {
    const result = extractCanonicalSkillKeywords('JavaScript developer');
    expect(result).toContain('javascript');
    expect(result).not.toContain('java');
  });

  it('suppresses generic sap when a specific SAP module is present', () => {
    const result = extractCanonicalSkillKeywords('SAP ABAP consultant with 5 years');
    expect(result).toContain('sap abap');
    expect(result).not.toContain('sap');
  });

  it('resolves unambiguous aliases (golang → go, artificial intelligence → ai)', () => {
    const result = extractCanonicalSkillKeywords('Senior golang engineer, artificial intelligence background');
    expect(result).toContain('go');
    expect(result).toContain('ai');
  });

  it('requires word boundaries — bare "go" in prose does not match', () => {
    const result = extractCanonicalSkillKeywords('We are ready to go with the project');
    expect(result).not.toContain('go');
  });

  it('returns [] for empty input', () => {
    expect(extractCanonicalSkillKeywords('')).toEqual([]);
  });
});

describe('buildRequirementReadiness', () => {
  const readyRequirement = {
    company_id: 'c1',
    sla_due_at: '2026-08-01',
    next_action: 'call source',
    next_action_due_at: '2026-07-20',
  };
  const readyChecks = {
    has_primary_source: true,
    has_primary_channel: true,
    has_account_owner: true,
    has_recruiter: true,
    has_mandatory_skill: true,
  };

  it('reports acceptance ready when all fields present', () => {
    const readiness = buildRequirementReadiness(readyRequirement, readyChecks);
    expect(readiness.acceptance.ready).toBe(true);
    expect(readiness.acceptance.missing).toEqual([]);
    expect(readiness.matching.ready).toBe(true);
  });

  it('reports company as missing when company_id is null', () => {
    const readiness = buildRequirementReadiness({ ...readyRequirement, company_id: null }, readyChecks);
    expect(readiness.acceptance.ready).toBe(false);
    expect(readiness.acceptance.missing).toContain('company');
  });

  it('acceptance ready but matching not-ready when mandatory skill missing', () => {
    const readiness = buildRequirementReadiness(readyRequirement, { ...readyChecks, has_mandatory_skill: false });
    expect(readiness.acceptance.ready).toBe(true);
    expect(readiness.matching.ready).toBe(false);
    expect(readiness.matching.missing).toContain('reviewed mandatory canonical skill');
  });

  it('flags dated next action when next_action or its due date is missing', () => {
    const missingAction = buildRequirementReadiness({ ...readyRequirement, next_action: null }, readyChecks);
    expect(missingAction.acceptance.missing).toContain('dated next action');
    const missingDue = buildRequirementReadiness({ ...readyRequirement, next_action_due_at: null }, readyChecks);
    expect(missingDue.acceptance.missing).toContain('dated next action');
  });
});

describe('allowedRequirementTransitions', () => {
  it('blocks the accepted target with a blocker when readiness is not ready', () => {
    const transitions = allowedRequirementTransitions('sourced', false);
    const accepted = transitions.find((t) => t.stage === 'accepted');
    if (accepted) {
      expect(accepted.allowed).toBe(false);
      expect(accepted.blockers).toContain('Complete requirement acceptance readiness');
    }
  });

  it('allows the accepted target with no blockers when readiness is ready', () => {
    const transitions = allowedRequirementTransitions('sourced', true);
    const accepted = transitions.find((t) => t.stage === 'accepted');
    if (accepted) {
      expect(accepted.allowed).toBe(true);
      expect(accepted.blockers).toEqual([]);
    }
  });

  it('returns [] for an unknown stage', () => {
    expect(allowedRequirementTransitions('bogus_stage', true)).toEqual([]);
  });
});

describe('submissionNextAllowedActions', () => {
  it('draft can be approved or withdrawn', () => {
    expect(submissionNextAllowedActions('draft')).toEqual(['approve_submission', 'withdraw_submission']);
  });

  it('interviewing can record feedback, create offer, or withdraw', () => {
    expect(submissionNextAllowedActions('interviewing')).toContain('record_interview_feedback');
    expect(submissionNextAllowedActions('interviewing')).toContain('create_offer');
  });

  it('terminal statuses expose no next actions', () => {
    for (const terminal of ['placed', 'rejected', 'withdrawn', 'closed']) {
      expect(submissionNextAllowedActions(terminal)).toEqual([]);
    }
  });

  it('returns [] for an unknown status', () => {
    expect(submissionNextAllowedActions('bogus')).toEqual([]);
  });
});

describe('placementNextAllowedActions', () => {
  it('offers link_invoice when started with no invoice', () => {
    const actions = placementNextAllowedActions({ status: 'started', invoice_id: null });
    expect(actions).toContain('link_invoice');
  });

  it('review_collection when an invoice with amount_due > 0 exists', () => {
    const actions = placementNextAllowedActions({ status: 'started', invoice_id: 'inv1', amount_due: 500 });
    expect(actions).toContain('review_collection');
    expect(actions).not.toContain('review_invoice');
  });

  it('review_invoice when invoice exists and amount_due is zero', () => {
    const actions = placementNextAllowedActions({ status: 'ended', invoice_id: 'inv1', amount_due: 0 });
    expect(actions).toContain('review_invoice');
  });

  it('surfaces resolve_adjustment when open_adjustment_count > 0', () => {
    const actions = placementNextAllowedActions({ status: 'ended', invoice_id: 'inv1', open_adjustment_count: 2 });
    expect(actions).toContain('resolve_adjustment');
  });
});

describe('normalizeLinkedInProfileUrl', () => {
  it('normalises host to www.linkedin.com and strips query/hash/trailing slash', () => {
    expect(normalizeLinkedInProfileUrl('https://in.linkedin.com/in/jane-doe/?utm_source=x'))
      .toBe('https://www.linkedin.com/in/jane-doe');
  });

  it('returns null for non-linkedin URLs', () => {
    expect(normalizeLinkedInProfileUrl('https://example.com/in/jane')).toBeNull();
  });

  it('returns null for linkedin URLs that are not profile pages', () => {
    expect(normalizeLinkedInProfileUrl('https://www.linkedin.com/company/acme')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(normalizeLinkedInProfileUrl('not a url')).toBeNull();
  });
});

describe('normalizeXrayResultLimit', () => {
  it('accepts integers 1-10', () => {
    expect(normalizeXrayResultLimit(1)).toBe(1);
    expect(normalizeXrayResultLimit(10)).toBe(10);
    expect(normalizeXrayResultLimit(5)).toBe(5);
  });

  it('rejects out-of-range or non-integer values', () => {
    expect(() => normalizeXrayResultLimit(0)).toThrow(RangeError);
    expect(() => normalizeXrayResultLimit(11)).toThrow(RangeError);
    expect(() => normalizeXrayResultLimit(2.5)).toThrow(RangeError);
  });

  it('defaults to 3 when unspecified', () => {
    expect(normalizeXrayResultLimit()).toBe(3);
  });
});

describe('capLinkedInProfileResults', () => {
  const makeResult = (link: string, position = 1) => ({ position, title: 'Jane', link, snippet: '' });

  it('caps to the requested limit and dedupes via a shared Set', () => {
    const results = [
      makeResult('https://linkedin.com/in/a/'),
      makeResult('https://linkedin.com/in/a?utm=x'),
      makeResult('https://linkedin.com/in/b'),
      makeResult('https://linkedin.com/in/c'),
    ];
    const capped = capLinkedInProfileResults(results, 2);
    expect(capped).toHaveLength(2);
    expect(capped[0].link).toBe('https://www.linkedin.com/in/a');
    expect(capped[1].link).toBe('https://www.linkedin.com/in/b');
  });

  it('filters out non-profile URLs', () => {
    const results = [
      makeResult('https://example.com/somewhere'),
      makeResult('https://linkedin.com/in/real'),
    ];
    const capped = capLinkedInProfileResults(results, 5);
    expect(capped).toHaveLength(1);
    expect(capped[0].link).toBe('https://www.linkedin.com/in/real');
  });

  it('respects an externally-shared seen set across calls', () => {
    const seen = new Set<string>();
    const first = capLinkedInProfileResults([makeResult('https://linkedin.com/in/a')], 3, seen);
    const second = capLinkedInProfileResults([makeResult('https://linkedin.com/in/a')], 3, seen);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
