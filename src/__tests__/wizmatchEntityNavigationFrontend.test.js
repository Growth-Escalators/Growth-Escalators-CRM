import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getVisibleEntries, groupForPath } from '../../admin/src/components/navEntries.js';
import { nextRovingTabIndex, trappedDialogFocusTarget } from '../../admin/src/lib/focusManagement.js';
import { invalidateGlobalSearchRequest } from '../../admin/src/lib/globalSearchRequest.js';
import { requirementStagePresentation } from '../../admin/src/pages/wizmatch-ui/requirementWorkflow.js';
import {
  buildWizmatchEntityHref,
  buildWizmatchLegacyEntityTarget,
  buildWizmatchTodayView,
  findWizmatchRoute,
  mergeRouteSearch,
  WIZMATCH_PRIMARY_ROUTES,
  WIZMATCH_ROUTE_REGISTRY,
  wizmatchAliasTarget,
} from '../../admin/src/lib/wizmatchRouteRegistry.js';

describe('Wizmatch entity-first navigation', () => {
  it('shows the nine canonical destinations in operator order when all gates are open', () => {
    expect(WIZMATCH_PRIMARY_ROUTES.map((route) => route.label)).toEqual([
      'Today',
      'Job Leads',
      'Companies',
      'Hiring Contacts',
      'Roles / Requirements',
      'Candidates',
      'Submissions',
      'Placements',
      'Reports',
    ]);

    const visible = getVisibleEntries(
      'admin',
      { staffingPilotAccess: true },
      'wizmatch',
      { A: true, B: true, C: true },
    );
    expect(visible.filter((entry) => !entry.group).map((entry) => entry.label)).toEqual(
      WIZMATCH_PRIMARY_ROUTES.map((route) => route.label),
    );
    expect(visible.filter((entry) => entry.group).every((entry) => entry.group.startsWith('more-'))).toBe(true);
  });

  it('keeps every registry entry product scoped and staffing phases fail closed', () => {
    expect(WIZMATCH_ROUTE_REGISTRY.every((route) => route.product === 'wizmatch')).toBe(true);
    const closed = getVisibleEntries('staff', { staffingPilotAccess: true }, 'wizmatch');
    expect(closed.map((entry) => entry.id)).toContain('wm-signals');
    expect(closed.map((entry) => entry.id)).not.toContain('wm-my-work');
    expect(closed.map((entry) => entry.id)).not.toContain('wm-talent-matching');
    expect(closed.map((entry) => entry.id)).not.toContain('wm-delivery');

    const growth = getVisibleEntries('admin', {}, 'growth-escalators', { A: true, B: true, C: true });
    expect(growth.some((entry) => entry.to?.startsWith('/wizmatch'))).toBe(false);
  });

  it('opens one More area for every legacy communication, CRM and administration route', () => {
    const args = ['admin', { staffingPilotAccess: true }, 'wizmatch', { A: true, B: true, C: true }];
    expect(groupForPath('/wizmatch/inbox', ...args)).toBe('more');
    expect(groupForPath('/wizmatch/contacts', ...args)).toBe('more');
    expect(groupForPath('/wizmatch/system', ...args)).toBe('more');
  });

  it('resolves legacy routes to canonical names and preserves their query state', () => {
    expect(findWizmatchRoute('/wizmatch/review-workbench')?.label).toBe('Today');
    expect(wizmatchAliasTarget('/wizmatch/local-demo-flow', '?from=bookmark')).toBe('/wizmatch/today?from=bookmark');
    expect(findWizmatchRoute('/wizmatch/source-candidates')?.label).toBe('Candidates');
    expect(wizmatchAliasTarget('/wizmatch/source-candidates', '?requirementId=req-1')).toBe(
      '/wizmatch/candidates?view=sourcing&requirementId=req-1',
    );
    expect(wizmatchAliasTarget('/wizmatch/source-candidates', '?view=review&candidateId=c-1')).toBe(
      '/wizmatch/candidates?view=review&candidateId=c-1',
    );
    expect(wizmatchAliasTarget('/wizmatch/readiness', '?section=providers')).toBe(
      '/wizmatch/system?tab=readiness&section=providers',
    );
    expect(mergeRouteSearch('/wizmatch/roles?view=priority', '?requirementId=req-2')).toBe(
      '/wizmatch/roles?view=priority&requirementId=req-2',
    );
    expect(wizmatchAliasTarget('/wizmatch/requirements/new', '?companyId=company-a')).toBe(
      '/wizmatch/roles?action=new&companyId=company-a',
    );
  });

  it('preserves filters on parameterized bookmarks while the path identity wins over stale query state', () => {
    expect(buildWizmatchLegacyEntityTarget('requirement', 'req-7', '?tab=activity&requirementId=stale')).toBe(
      '/wizmatch/roles?tab=activity&requirementId=req-7',
    );
    expect(buildWizmatchLegacyEntityTarget('signal', 'signal-3', '?source=ats')).toBe(
      '/wizmatch/job-leads?source=ats&signalId=signal-3',
    );

    const appSource = readFileSync(resolve(process.cwd(), 'admin/src/App.jsx'), 'utf8');
    expect(appSource).toContain('path="/wizmatch/requirements/:requirementId"');
    expect(appSource).toContain('path="/wizmatch/signals/:signalId"');
    expect(appSource).toContain('path="/wizmatch/candidates/:candidateId"');
    expect(appSource).toContain('path="/wizmatch/placements/:placementId"');
  });

  it('builds stable entity deep links instead of sending users to a generic queue', () => {
    expect(buildWizmatchEntityHref('company', 'company-1')).toBe('/wizmatch/companies?companyId=company-1');
    expect(buildWizmatchEntityHref('contact', 'person-1')).toBe('/wizmatch/hiring-contacts?contactId=person-1');
    expect(buildWizmatchEntityHref('requirement', 'role-1')).toBe('/wizmatch/roles?requirementId=role-1');
    expect(buildWizmatchEntityHref('submission', 'sub-1')).toBe('/wizmatch/submissions?submissionId=sub-1');
  });
});

describe('Wizmatch keyboard and canonical-workflow accessibility', () => {
  it('invalidates an in-flight global search before a cleared query can display stale results', () => {
    const requestRef = { current: 4 };
    expect(invalidateGlobalSearchRequest(requestRef)).toBe(5);
    expect(requestRef.current).toBe(5);
  });

  it('presents paused and terminal requirements honestly instead of falling back to Draft', () => {
    expect(requirementStagePresentation('on_hold')).toMatchObject({ active: false, label: 'On hold' });
    expect(requirementStagePresentation('closed_lost')).toMatchObject({ active: false, label: 'Closed lost' });
    expect(requirementStagePresentation('cancelled')).toMatchObject({ active: false, label: 'Cancelled' });
    expect(requirementStagePresentation('accepted')).toMatchObject({ active: true, stage: 'accepted' });
  });

  it('wraps horizontal tab focus and supports Home and End', () => {
    expect(nextRovingTabIndex('ArrowRight', 3, 4)).toBe(0);
    expect(nextRovingTabIndex('ArrowLeft', 0, 4)).toBe(3);
    expect(nextRovingTabIndex('Home', 2, 4)).toBe(0);
    expect(nextRovingTabIndex('End', 1, 4)).toBe(3);
    expect(nextRovingTabIndex('Enter', 1, 4)).toBeNull();
  });

  it('keeps forward and reverse Tab focus inside an open dialog', () => {
    const first = { id: 'first' };
    const middle = { id: 'middle' };
    const last = { id: 'last' };
    const elements = [first, middle, last];
    expect(trappedDialogFocusTarget(elements, last, false)).toBe(first);
    expect(trappedDialogFocusTarget(elements, first, true)).toBe(last);
    expect(trappedDialogFocusTarget(elements, middle, false)).toBeNull();
    expect(trappedDialogFocusTarget(elements, { id: 'outside' }, false)).toBe(first);
  });

  it('uses structured dialogs throughout every canonical entity-first page', () => {
    const canonicalPages = [
      'WizmatchTodayPage.jsx',
      'WizmatchJobLeadsPage.jsx',
      'WizmatchCompaniesPage.jsx',
      'WizmatchHiringContactsPage.jsx',
      'WizmatchRolesPage.jsx',
      'WizmatchCandidatesPage.jsx',
      'WizmatchDeliveryBoardPage.jsx',
      'WizmatchPlacementsPage.jsx',
      'WizmatchAnalyticsPage.jsx',
    ];
    const nativeDialogCall = /(?:window\s*\.\s*)?\b(?:alert|prompt|confirm)\s*\(/;
    for (const filename of canonicalPages) {
      const source = readFileSync(resolve(process.cwd(), 'admin/src/pages', filename), 'utf8');
      expect(source, `${filename} must not use a native browser dialog`).not.toMatch(nativeDialogCall);
    }
  });

  it('contains wide canonical content inside shrinkable shells and local scroll regions', () => {
    const appLayout = readFileSync(resolve(process.cwd(), 'admin/src/components/AppLayout.jsx'), 'utf8');
    const workspace = readFileSync(resolve(process.cwd(), 'admin/src/components/wizmatch/WorkspaceUI.jsx'), 'utf8');
    const candidates = readFileSync(resolve(process.cwd(), 'admin/src/pages/WizmatchCandidatesPage.jsx'), 'utf8');
    const modal = readFileSync(resolve(process.cwd(), 'admin/src/components/ui/Modal.jsx'), 'utf8');
    expect(appLayout).toMatch(/<main className="[^"]*min-w-0/);
    expect(workspace).toMatch(/<main className=\{`[^`]*min-w-0/);
    expect(candidates).toContain('max-h-48 overflow-auto');
    expect(modal).toContain('flex flex-wrap items-center justify-end');
  });
});

describe('Wizmatch Today normalization', () => {
  const now = new Date('2026-07-14T12:00:00.000Z');
  const myWork = {
    requirements: [
      {
        id: 'req-overdue',
        title: 'SAP ABAP Consultant',
        company_id: 'company-a',
        company_name: 'Company A',
        source_first_name: 'Person',
        source_last_name: 'A',
        attribution_status: 'attributed',
        next_action: 'Confirm interview panel',
        next_action_due_at: '2026-07-12T09:00:00.000Z',
      },
      {
        id: 'req-blocked',
        title: 'Java Backend Developer',
        company_id: 'company-a',
        company_name: 'Company A',
        attribution_status: 'needs_attribution',
        next_action: null,
        next_action_due_at: '2026-07-20T09:00:00.000Z',
      },
    ],
    tasks: [
      {
        id: 'task-today',
        title: 'Review Java candidates',
        requirement_id: 'req-blocked',
        due_at: '2026-07-14T14:00:00.000Z',
      },
    ],
  };
  const workbench = {
    actions: [{
      id: 'review-candidate-1',
      actionType: 'review_candidate',
      targetType: 'candidate',
      targetId: 'candidate-1',
      title: 'Review candidate evidence',
      subtitle: 'SAP ABAP · available',
    }],
  };

  it('separates overdue, due-today, blocked and lead-review work with exact links', () => {
    const view = buildWizmatchTodayView(myWork, workbench, { now, canReviewTeam: true });
    expect(view.buckets.overdue.map((item) => item.id)).toEqual(['requirement:req-overdue']);
    expect(view.buckets.due_today.map((item) => item.id)).toEqual(['task:task-today']);
    expect(view.buckets.blocked.map((item) => item.id)).toEqual(['requirement:req-blocked']);
    expect(view.buckets.team_review.map((item) => item.id)).toEqual(['review:review-candidate-1']);
    expect(view.buckets.blocked[0].blocker).toContain('Source hiring contact is missing');
    expect(view.buckets.team_review[0].href).toBe('/wizmatch/candidates?candidateId=candidate-1&view=review');
    expect(view.metrics).toEqual({ needsAttention: 3, assignedRoles: 2, teamReview: 1 });
  });

  it('does not expose team review actions to roles without that capability', () => {
    const view = buildWizmatchTodayView(myWork, workbench, { now, canReviewTeam: false });
    expect(view.buckets.team_review).toEqual([]);
    expect(view.items.some((item) => item.capability === 'team_review')).toBe(false);
  });

  it('uses the normalized server work-item contract including recently changed and entityHref', () => {
    const view = buildWizmatchTodayView({
      workItems: [{
        id: 'requirement:req-new',
        entityType: 'requirement',
        entityId: 'req-new',
        entityHref: '/wizmatch/roles?requirementId=req-new',
        title: 'SAP FICO Consultant',
        companyName: 'Company B',
        bucket: 'recently_changed',
        recommendedAction: 'Review requirement',
        slaDueAt: '2026-07-15T12:00:00.000Z',
      }],
    }, {}, { now, canReviewTeam: false });

    expect(view.buckets.recently_changed).toHaveLength(1);
    expect(view.buckets.recently_changed[0]).toMatchObject({
      href: '/wizmatch/roles?requirementId=req-new',
      subtitle: 'Company B',
      recommendedAction: 'Review requirement',
    });
  });
});
