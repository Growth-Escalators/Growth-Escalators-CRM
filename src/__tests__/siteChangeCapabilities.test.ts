// The one capability calculation the approvals UI renders from.
//
// PR 8A's review found the WizMatch workbench "showed actions a `staff`
// member's role always 403s" — the frontend had its own idea of what was
// allowed and the backend had another. The fix was one canonical
// backend-computed calculation, and this file is what stops that fix from
// rotting: if a button is enabled here and the route refuses it, this is where
// the bug is.
//
// Two sweeps below matter more than the individual cases:
//   - no role and no status combination can reach `approve` except an admin on
//     a change awaiting approval;
//   - EVERY disabled capability carries a non-empty reason. An unexplained
//     disabled control is its own defect class here (PR 8A H-2), and it is the
//     kind that only shows up in front of a user.
import { describe, expect, it } from 'vitest';

import {
  SITE_CHANGE_ACTIONS,
  canDecideSiteChanges,
  computeSiteChangeCapabilities,
  resolveSiteChangePreviewTier,
  toSiteChangeDTO,
  type SiteChangeAction,
} from '../services/siteChangeCapabilities';
import { SITE_CHANGE_STATUSES, type SiteChange, type SiteChangeStatus } from '../services/siteChangeService';

const ROLES = ['admin', 'team_lead', 'staff', 'viewer'] as const;

function change(overrides: Partial<SiteChange> = {}): SiteChange {
  return {
    id: 'change-1',
    tenantId: 'tenant-1',
    siteId: 'site-1',
    changeKind: 'page_update',
    pageUrl: 'https://example.com/pricing',
    status: 'awaiting_approval',
    version: 3,
    payload: {},
    stagedRef: 'staged-1',
    previewUrl: null,
    diff: null,
    stagedAt: new Date('2026-08-05T09:00:00Z'),
    verifyPassed: true,
    verifyIssues: [],
    verifiedAt: new Date('2026-08-05T09:05:00Z'),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    decisionReason: null,
    publishRequestId: null,
    publishedAt: null,
    liveUrl: null,
    externalRef: null,
    publishResult: null,
    lastError: null,
    lastErrorAt: null,
    verifiedLiveAt: null,
    supersededByChangeId: null,
    source: 'cron',
    createdBy: null,
    createdAt: new Date('2026-08-05T08:00:00Z'),
    updatedAt: new Date('2026-08-05T09:05:00Z'),
    ...overrides,
  };
}

describe('the disabled-reason invariant', () => {
  it('never disables an action without explaining why, for any status or role', () => {
    const unexplained: string[] = [];
    for (const status of SITE_CHANGE_STATUSES) {
      for (const role of ROLES) {
        const caps = computeSiteChangeCapabilities(change({ status }), { role });
        for (const action of SITE_CHANGE_ACTIONS) {
          const cap = caps[action];
          if (!cap.enabled && (cap.reason === null || cap.reason.trim().length === 0)) {
            unexplained.push(`${status}/${role}/${action}`);
          }
          // The converse too: an enabled action must not carry a reason, or
          // the UI would render an explanation next to a working button.
          if (cap.enabled && cap.reason !== null) {
            unexplained.push(`${status}/${role}/${action} (enabled but has a reason)`);
          }
        }
      }
    }
    expect(unexplained).toEqual([]);
  });
});

describe('who may decide', () => {
  it('restricts approve, reject and publish to admins', () => {
    for (const role of ROLES) {
      const caps = computeSiteChangeCapabilities(change({ status: 'awaiting_approval' }), { role });
      expect(caps.approve.enabled).toBe(role === 'admin');
      expect(caps.reject.enabled).toBe(role === 'admin');
    }
    for (const role of ROLES) {
      const caps = computeSiteChangeCapabilities(
        change({ status: 'approved', approvedBy: 'user-1', approvedAt: new Date() }),
        { role },
      );
      expect(caps.publish.enabled).toBe(role === 'admin');
    }
  });

  it('lets a non-admin still stage and verify — those touch nothing live', () => {
    const caps = computeSiteChangeCapabilities(change({ status: 'staged' }), { role: 'staff' });
    expect(caps.verify.enabled).toBe(true);
  });

  it('agrees with canDecideSiteChanges', () => {
    expect(canDecideSiteChanges({ role: 'admin' })).toBe(true);
    expect(canDecideSiteChanges({ role: 'team_lead' })).toBe(false);
  });
});

describe('approve', () => {
  it('is reachable only from awaiting_approval, for an admin', () => {
    const reachable: string[] = [];
    for (const status of SITE_CHANGE_STATUSES) {
      for (const role of ROLES) {
        if (computeSiteChangeCapabilities(change({ status }), { role }).approve.enabled) {
          reachable.push(`${status}/${role}`);
        }
      }
    }
    expect(reachable).toEqual(['awaiting_approval/admin']);
  });

  it('refuses a change whose verification failed, even if its status somehow says otherwise', () => {
    // Defence against a future transition-table edit. The status check alone
    // would pass here; the verifyPassed check is what actually stops it.
    const caps = computeSiteChangeCapabilities(
      change({ status: 'awaiting_approval', verifyPassed: false }),
      { role: 'admin' },
    );
    expect(caps.approve.enabled).toBe(false);
    expect(caps.approve.reason).toMatch(/verification failed/i);
  });

  it('explains a verification failure specifically, not generically', () => {
    const caps = computeSiteChangeCapabilities(change({ status: 'verification_failed' }), { role: 'admin' });
    expect(caps.approve.reason).toMatch(/blocking issue/i);
  });
});

describe('publish', () => {
  it('is reachable only from approved, for an admin', () => {
    const reachable: string[] = [];
    for (const status of SITE_CHANGE_STATUSES) {
      for (const role of ROLES) {
        const c = change({ status, approvedBy: 'user-1', approvedAt: new Date() });
        if (computeSiteChangeCapabilities(c, { role }).publish.enabled) reachable.push(`${status}/${role}`);
      }
    }
    expect(reachable).toEqual(['approved/admin']);
  });

  it('refuses an approved change that was never staged', () => {
    const caps = computeSiteChangeCapabilities(
      change({ status: 'approved', approvedBy: 'u', approvedAt: new Date(), stagedRef: null }),
      { role: 'admin' },
    );
    expect(caps.publish.enabled).toBe(false);
    expect(caps.publish.reason).toMatch(/never staged/i);
  });

  it('points a failed publish at retry rather than at publish', () => {
    const caps = computeSiteChangeCapabilities(
      change({ status: 'publish_failed', approvedBy: 'u', approvedAt: new Date() }),
      { role: 'admin' },
    );
    expect(caps.publish.enabled).toBe(false);
    expect(caps.publish.reason).toMatch(/retry/i);
  });
});

describe('retry_publish', () => {
  it('is the way out of publish_failed, so that status is not a dead end', () => {
    // Before this action existed, `reject` was the ONLY enabled action on a
    // publish_failed change — an operator could see that a client's site had
    // not received an approved change, and could do nothing about it but
    // throw the change away.
    const caps = computeSiteChangeCapabilities(
      change({ status: 'publish_failed', approvedBy: 'u', approvedAt: new Date() }),
      { role: 'admin' },
    );
    expect(caps.retry_publish.enabled).toBe(true);
  });

  it('leaves no status an operator can reach but not act on', () => {
    // The general form of the bug above: a status an operator can reach but
    // cannot leave. Four statuses are legitimately actionless and are named
    // here rather than the assertion being loosened, so a NEW stuck status
    // still fails this test:
    //   rejected / superseded — terminal by design.
    //   publishing            — a publish is in flight; the process moves it
    //                           to published/handoff_required/publish_failed.
    //                           An operator control here would race it.
    //   published             — done. Its only remaining transition is
    //                           `supersede`, which happens automatically when
    //                           a newer proposal for the same target is
    //                           created — not something an operator invokes.
    const ACTIONLESS_BY_DESIGN = ['rejected', 'superseded', 'publishing', 'published'];
    const stuck: string[] = [];
    for (const status of SITE_CHANGE_STATUSES) {
      if (ACTIONLESS_BY_DESIGN.includes(status)) continue;
      const caps = computeSiteChangeCapabilities(
        change({ status, approvedBy: 'u', approvedAt: new Date(), stagedRef: 'staged-1' }),
        { role: 'admin' },
      );
      if (!SITE_CHANGE_ACTIONS.some((a) => caps[a].enabled)) stuck.push(status);
    }
    expect(stuck).toEqual([]);
  });

  it('is offered only on publish_failed, and only to an admin', () => {
    const offered: string[] = [];
    for (const status of SITE_CHANGE_STATUSES) {
      for (const role of ROLES) {
        const c = change({ status, approvedBy: 'u', approvedAt: new Date() });
        if (computeSiteChangeCapabilities(c, { role }).retry_publish.enabled) offered.push(`${status}/${role}`);
      }
    }
    // Admin-gated because a retry re-enters `approved` without re-asking for
    // approval — the original approver survives the round trip.
    expect(offered).toEqual(['publish_failed/admin']);
  });
});

describe('terminal statuses', () => {
  it.each<SiteChangeStatus>(['rejected', 'superseded'])('disable every action on a %s change', (status) => {
    const caps = computeSiteChangeCapabilities(change({ status }), { role: 'admin' });
    for (const action of SITE_CHANGE_ACTIONS) {
      expect(caps[action].enabled, `${action} should be disabled`).toBe(false);
      expect(caps[action].reason).toContain(status);
    }
  });
});

describe('verify', () => {
  it('tells an operator to stage first rather than silently disabling', () => {
    const caps = computeSiteChangeCapabilities(change({ status: 'proposed', stagedRef: null }), { role: 'admin' });
    expect(caps.verify.enabled).toBe(false);
    expect(caps.verify.reason).toMatch(/stage this change/i);
  });
});

describe('complete_handoff', () => {
  it('is offered only on a change awaiting a human merge', () => {
    const offered = SITE_CHANGE_STATUSES.filter(
      (status) =>
        computeSiteChangeCapabilities(
          change({ status, approvedBy: 'u', approvedAt: new Date() }),
          { role: 'admin' },
        ).complete_handoff.enabled,
    );
    expect(offered).toEqual(['handoff_required']);
  });
});

describe('resolveSiteChangePreviewTier', () => {
  it('prefers a real source diff when one exists', () => {
    expect(resolveSiteChangePreviewTier(change({ diff: '--- a\n+++ b\n+title' }))).toBe('diff');
  });

  it('falls back to a hosted draft preview', () => {
    expect(resolveSiteChangePreviewTier(change({ previewUrl: 'https://example.com/?preview=1' }))).toBe('preview');
  });

  it('always has a floor, so an operator is never asked to approve something they cannot see', () => {
    expect(resolveSiteChangePreviewTier(change({ diff: null, previewUrl: null }))).toBe('elements');
    // Whitespace-only values are not a preview.
    expect(resolveSiteChangePreviewTier(change({ diff: '   ', previewUrl: '  ' }))).toBe('elements');
  });
});

describe('toSiteChangeDTO', () => {
  it('carries capabilities and the preview tier alongside every column', () => {
    const dto = toSiteChangeDTO(change(), { role: 'admin' });
    expect(dto.id).toBe('change-1');
    expect(dto.version).toBe(3);
    expect(dto.capabilities.approve.enabled).toBe(true);
    expect(dto.previewTier).toBe('elements');
  });

  it('computes capabilities per actor, so two roles see different rows', () => {
    const asAdmin = toSiteChangeDTO(change(), { role: 'admin' });
    const asStaff = toSiteChangeDTO(change(), { role: 'staff' });
    expect(asAdmin.capabilities.approve.enabled).toBe(true);
    expect(asStaff.capabilities.approve.enabled).toBe(false);
  });

  it('exposes every action the UI knows about', () => {
    const dto = toSiteChangeDTO(change(), { role: 'admin' });
    const actions = Object.keys(dto.capabilities).sort() as SiteChangeAction[];
    expect(actions).toEqual([...SITE_CHANGE_ACTIONS].sort());
  });
});
