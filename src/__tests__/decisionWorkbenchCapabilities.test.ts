// PR 8B (P8B-2) — behavioural coverage for the workbench capability
// calculation. Every case asserts the FUNCTION'S OUTCOME for a {role,
// item-state} pair, so removing any single rule branch turns a case red rather
// than merely changing a string.
//
// This module is a prediction of what `runTodayActions` would do, not the
// enforcement path; `wizmatchTodayRoutes.test.ts` separately proves the server
// still denies a hidden action on its own.

import { describe, it, expect } from 'vitest';
import type { DecisionWorkbenchCompanyItem } from '../modules/outreach/decisionWorkbench';
import {
  computeTodayActionCapabilities,
  computeBulkCapability,
  computeSignalActionCapabilities,
  computeContactActionCapabilities,
} from '../modules/outreach/decisionWorkbenchCapabilities';

function item(overrides: Partial<DecisionWorkbenchCompanyItem> = {}): DecisionWorkbenchCompanyItem {
  return {
    companyId: 'company-1',
    companyName: 'Acme',
    companyDomain: 'acme.test',
    accountOwnerUserId: null,
    canonicalDecision: 'review',
    canonicalReasonCode: 'manual_reclassified',
    canonicalBlockerCode: null,
    effectiveDecision: 'review',
    enforcementMode: 'enforce',
    requiresExplicitApproval: true,
    policyId: 'policy-1',
    outreachEligibility: 'needs_review',
    externalHiringPolicy: 'unknown',
    relationshipType: 'new_prospect',
    blockClass: null,
    isNonOverridable: false,
    nonOverridableScopeKey: null,
    reviewDate: null,
    reviewDateArrived: false,
    policyReasonCode: 'manual_reclassified',
    policyScopeKey: 'entire_company',
    contactConfidenceTier: 'high',
    duplicatePending: false,
    duplicateId: null,
    routed: false,
    recommendedRoute: 'standard_outreach',
    disabledReason: null,
    ...overrides,
  } as DecisionWorkbenchCompanyItem;
}

const WRITE_ACTIONS = [
  'approve_queue',
  'skip',
  'pause',
  'resume',
  'block',
  'reject',
  'assign_owner',
  'set_review_date',
] as const;

describe('computeTodayActionCapabilities — role allow-list (mirrors wizmatchToday.ts)', () => {
  it('a staff role sees approve_queue disabled with the route\'s own reason', () => {
    const caps = computeTodayActionCapabilities(item(), 'staff', 'single');
    expect(caps.approve_queue.enabled).toBe(false);
    expect(caps.approve_queue.reason).toBe('This action requires team_lead or admin.');
  });

  it.each(['manager_ops', 'sales', 'staff', 'viewer', undefined])(
    'pilot-eligible reader role %s sees ZERO enabled write actions',
    (role) => {
      const caps = computeTodayActionCapabilities(item({ duplicatePending: true, duplicateId: 'dup-1' }), role, 'single');
      for (const action of [...WRITE_ACTIONS, 'merge', 'confirm_separate'] as const) {
        expect(caps[action].enabled, `${String(role)} / ${action}`).toBe(false);
        expect(caps[action].reason).toBeTruthy();
      }
    },
  );

  it.each(['admin', 'team_lead'])('role %s can act on an ordinary needs_review company', (role) => {
    const caps = computeTodayActionCapabilities(item(), role, 'single');
    for (const action of WRITE_ACTIONS) {
      expect(caps[action].enabled, `${role} / ${action}`).toBe(true);
      expect(caps[action].reason).toBeNull();
    }
  });
});

describe('computeTodayActionCapabilities — blocked root requires an admin override', () => {
  const blocked = item({ outreachEligibility: 'blocked', effectiveDecision: 'deny' });

  it.each(['resume', 'approve_queue', 'skip', 'pause'] as const)(
    'a team_lead sees %s disabled with the admin-override reason when the root row is blocked',
    (action) => {
      const caps = computeTodayActionCapabilities(blocked, 'team_lead', 'single');
      expect(caps[action].enabled).toBe(false);
      expect(caps[action].reason).toBe('Overriding a block requires an admin.');
    },
  );

  it('an admin CAN override an overridable block — the rule is role-specific, not a blanket deny', () => {
    const caps = computeTodayActionCapabilities(blocked, 'admin', 'single');
    expect(caps.resume.enabled).toBe(true);
    expect(caps.approve_queue.enabled).toBe(true);
  });

  it('non-unblocking actions stay available to a team_lead on a blocked company', () => {
    const caps = computeTodayActionCapabilities(blocked, 'team_lead', 'single');
    expect(caps.block.enabled).toBe(true);
    expect(caps.assign_owner.enabled).toBe(true);
    expect(caps.set_review_date.enabled).toBe(true);
  });

  it('a merely PAUSED root does not trigger the admin-override rule (blocked, not paused)', () => {
    const caps = computeTodayActionCapabilities(item({ outreachEligibility: 'paused', effectiveDecision: 'deny' }), 'team_lead', 'single');
    expect(caps.resume.enabled).toBe(true);
  });
});

describe('computeTodayActionCapabilities — non-overridable blocks (P8B-1 scope split)', () => {
  const companyScopes = ['entire_company', 'region:india', 'business_unit:staffing', 'location:bengaluru'];

  it.each(companyScopes)(
    'a non-overridable block at scope %s disables every unblocking action for EVERY role, admin included',
    (scopeKey) => {
      for (const role of ['admin', 'team_lead']) {
        const caps = computeTodayActionCapabilities(
          item({ isNonOverridable: true, nonOverridableScopeKey: scopeKey, outreachEligibility: 'blocked', effectiveDecision: 'deny' }),
          role,
          'single',
        );
        for (const action of ['approve_queue', 'resume', 'skip', 'pause'] as const) {
          expect(caps[action].enabled, `${role} / ${action} / ${scopeKey}`).toBe(false);
          expect(caps[action].reason).toContain('non-overridable block');
        }
      }
    },
  );

  // P8B-1 cross-check: a block scoped to ONE signal or ONE requirement
  // constrains that signal/requirement, not the company. Disabling
  // company-level actions for it is the pre-P8B-1 defect.
  it.each([
    'specific_signal:3f1a5c2e-0000-4000-8000-000000000001',
    'specific_requirement:3f1a5c2e-0000-4000-8000-000000000002',
  ])('a non-overridable block at scope %s does NOT disable company-level unblocking actions', (scopeKey) => {
    const caps = computeTodayActionCapabilities(
      item({ isNonOverridable: true, nonOverridableScopeKey: scopeKey }),
      'admin',
      'single',
    );
    for (const action of ['approve_queue', 'resume', 'skip', 'pause'] as const) {
      expect(caps[action].enabled, `${action} / ${scopeKey}`).toBe(true);
    }
  });

  // The policy lane's explicit field wins over the scope-key derivation once
  // it lands, so the two lanes agree without a rename dance.
  it('honours an explicit nonOverridableBlockKind when the item carries one', () => {
    const asSignal = computeTodayActionCapabilities(
      { ...item({ isNonOverridable: true, nonOverridableScopeKey: 'entire_company' }), nonOverridableBlockKind: 'signal' } as DecisionWorkbenchCompanyItem,
      'admin',
      'single',
    );
    expect(asSignal.approve_queue.enabled).toBe(true);

    const asCompany = computeTodayActionCapabilities(
      { ...item({ isNonOverridable: true, nonOverridableScopeKey: 'specific_signal:x' }), nonOverridableBlockKind: 'company_scope' } as DecisionWorkbenchCompanyItem,
      'admin',
      'single',
    );
    expect(asCompany.approve_queue.enabled).toBe(false);
  });

  it('an unrecognised scope key falls back to the restrictive company-scope answer', () => {
    const caps = computeTodayActionCapabilities(
      item({ isNonOverridable: true, nonOverridableScopeKey: null }),
      'admin',
      'single',
    );
    expect(caps.approve_queue.enabled).toBe(false);
  });
});

describe('computeTodayActionCapabilities — per-action preconditions', () => {
  it('approve_queue is disabled on an already-eligible company (idempotency)', () => {
    const caps = computeTodayActionCapabilities(item({ outreachEligibility: 'eligible', effectiveDecision: 'allow' }), 'admin', 'single');
    expect(caps.approve_queue.enabled).toBe(false);
    expect(caps.approve_queue.reason).toContain('already eligible');
  });

  it.each(['outreachEligibility', 'externalHiringPolicy', 'relationshipType', 'policyReasonCode'] as const)(
    'set_review_date is disabled when the root row is missing %s',
    (field) => {
      const caps = computeTodayActionCapabilities(item({ [field]: null }), 'admin', 'single');
      expect(caps.set_review_date.enabled).toBe(false);
      expect(caps.set_review_date.reason).toContain('missing a required field');
    },
  );

  it('set_review_date is enabled once every dimension is resolved', () => {
    expect(computeTodayActionCapabilities(item(), 'admin', 'single').set_review_date.enabled).toBe(true);
  });

  it('merge/confirm_separate need a pending duplicate', () => {
    const without = computeTodayActionCapabilities(item(), 'admin', 'single');
    expect(without.merge.enabled).toBe(false);
    expect(without.confirm_separate.enabled).toBe(false);

    const with_ = computeTodayActionCapabilities(item({ duplicatePending: true, duplicateId: 'dup-1' }), 'admin', 'single');
    expect(with_.merge.enabled).toBe(true);
    expect(with_.confirm_separate.enabled).toBe(true);
  });
});

describe('bulk capability — admin-only, whatever the single-row answer is', () => {
  it('a team_lead has NO bulk capability even though its single-row actions are enabled', () => {
    expect(computeTodayActionCapabilities(item(), 'team_lead', 'single').approve_queue.enabled).toBe(true);
    expect(computeBulkCapability('team_lead')).toEqual({ enabled: false, reason: 'Bulk actions require admin.' });
    expect(computeTodayActionCapabilities(item(), 'team_lead', 'bulk').approve_queue.enabled).toBe(false);
  });

  it.each(['manager_ops', 'sales', 'staff', 'viewer', undefined])('role %s has no bulk capability', (role) => {
    expect(computeBulkCapability(role).enabled).toBe(false);
  });

  it('an admin has bulk capability', () => {
    expect(computeBulkCapability('admin')).toEqual({ enabled: true, reason: null });
    expect(computeTodayActionCapabilities(item(), 'admin', 'bulk').approve_queue.enabled).toBe(true);
  });
});

// The two sibling predictors for the queues that do NOT go through
// /today/actions. They mirror `allowBulkRole` in src/routes/wizmatch.ts (the
// same >1 ⇒ admin split) plus a terminal-status deny per surface.
describe('computeSignalActionCapabilities', () => {
  const signal = (status: string) => ({ status });

  it.each(['admin', 'team_lead'])('role %s may qualify and reject a signal awaiting a decision', (role) => {
    for (const status of ['new', 'scored', 'enriched']) {
      const caps = computeSignalActionCapabilities(signal(status), role, 'single');
      expect(caps.qualify, `${role}/${status}`).toEqual({ enabled: true, reason: null });
      expect(caps.reject).toEqual({ enabled: true, reason: null });
    }
  });

  it.each(['manager_ops', 'sales', 'staff', 'viewer', undefined])('reader role %s sees no signal action at all', (role) => {
    const caps = computeSignalActionCapabilities(signal('new'), role, 'single');
    for (const action of ['qualify', 'reject'] as const) {
      expect(caps[action].enabled, String(role)).toBe(false);
      expect(caps[action].reason).toBe('This action requires team_lead or admin.');
    }
  });

  // >1 target is a bulk action server-side whatever it is named, so a
  // team_lead selecting two signals must be told that BEFORE clicking.
  it('a team_lead may act on one signal but not on a selection (the >1 ⇒ admin split)', () => {
    expect(computeSignalActionCapabilities(signal('new'), 'team_lead', 'single').qualify.enabled).toBe(true);
    const bulk = computeSignalActionCapabilities(signal('new'), 'team_lead', 'bulk');
    expect(bulk.qualify).toEqual({ enabled: false, reason: 'Bulk actions require admin.' });
    expect(computeSignalActionCapabilities(signal('new'), 'admin', 'bulk').qualify.enabled).toBe(true);
  });

  // `qualifySignalAndCreatePocTask` refuses these itself (`status NOT IN
  // ('dead','placed')`); `rejectSignal` does NOT, and would overwrite a
  // `placed` signal with `dead`. Both are denied here.
  it.each(['dead', 'placed'])('a %s signal is terminal — neither action is offered, to ANY role', (status) => {
    for (const role of ['admin', 'team_lead']) {
      const caps = computeSignalActionCapabilities(signal(status), role, 'single');
      for (const action of ['qualify', 'reject'] as const) {
        expect(caps[action].enabled, `${role}/${status}/${action}`).toBe(false);
        expect(caps[action].reason).toContain(status);
      }
    }
  });

  // The terminal list must not swallow the in-flight states, which are still
  // decidable — a `sent` signal can still be rejected.
  it.each(['drafted', 'sent', 'matched', 'replied_positive'])('an in-flight %s signal is still actionable', (status) => {
    expect(computeSignalActionCapabilities(signal(status), 'admin', 'single').reject.enabled).toBe(true);
  });
});

describe('computeContactActionCapabilities', () => {
  const contact = (status: string) => ({ status });

  it.each(['admin', 'team_lead'])('role %s may approve and reject a candidate awaiting review', (role) => {
    for (const status of ['new', 'needs_review']) {
      const caps = computeContactActionCapabilities(contact(status), role, 'single');
      expect(caps.approve, `${role}/${status}`).toEqual({ enabled: true, reason: null });
      expect(caps.reject).toEqual({ enabled: true, reason: null });
    }
  });

  it.each(['manager_ops', 'sales', 'staff', 'viewer', undefined])('reader role %s sees no contact action at all', (role) => {
    const caps = computeContactActionCapabilities(contact('needs_review'), role, 'single');
    for (const action of ['approve', 'reject'] as const) {
      expect(caps[action].enabled, String(role)).toBe(false);
      expect(caps[action].reason).toBe('This action requires team_lead or admin.');
    }
  });

  it('a team_lead may review one contact but not a selection (the >1 ⇒ admin split)', () => {
    expect(computeContactActionCapabilities(contact('needs_review'), 'team_lead', 'single').approve.enabled).toBe(true);
    expect(computeContactActionCapabilities(contact('needs_review'), 'team_lead', 'bulk').approve)
      .toEqual({ enabled: false, reason: 'Bulk actions require admin.' });
    expect(computeContactActionCapabilities(contact('needs_review'), 'admin', 'bulk').approve.enabled).toBe(true);
  });

  // `applyContactCandidateReview` resolves its transition from a HARDCODED
  // `currentContactStatus: 'needs_review'` and updates on (tenant_id, id)
  // alone, so the server would happily let a second review overwrite the
  // first one's decision and reviewer. This deny is the only thing between an
  // operator and that overwrite.
  it.each(['approved', 'rejected', 'do_not_contact', 'linked_to_crm'])(
    'a %s candidate has already been decided — neither action is offered, to ANY role',
    (status) => {
      for (const role of ['admin', 'team_lead']) {
        const caps = computeContactActionCapabilities(contact(status), role, 'single');
        for (const action of ['approve', 'reject'] as const) {
          expect(caps[action].enabled, `${role}/${status}/${action}`).toBe(false);
          expect(caps[action].reason).toContain('already reviewed');
        }
      }
    },
  );
});
