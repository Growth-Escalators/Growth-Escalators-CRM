import { describe, expect, it } from 'vitest';
import {
  WIZMATCH_ROUTES,
  evaluateWizmatchPermission,
  findWizmatchRouteForPath,
  getWizmatchLegacyRedirects,
} from '../../admin/src/routes/wizmatchRouteRegistry.ts';

describe('wizmatchRouteRegistry', () => {
  it('has a unique id and a unique canonical path per entry', () => {
    const ids = WIZMATCH_ROUTES.map((r) => r.id);
    const paths = WIZMATCH_ROUTES.map((r) => r.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('never lets a legacy alias collide with another route\'s canonical path or another alias', () => {
    const allAliases = WIZMATCH_ROUTES.flatMap((r) => r.legacyAliases);
    expect(new Set(allAliases).size).toBe(allAliases.length);
    const canonicalPaths = new Set(WIZMATCH_ROUTES.map((r) => r.path));
    for (const alias of allAliases) {
      expect(canonicalPaths.has(alias)).toBe(false);
    }
  });

  it('exposes exactly the 6 renamed-path legacy aliases required for bookmark compatibility', () => {
    const redirects = getWizmatchLegacyRedirects();
    const map = Object.fromEntries(redirects.map((r) => [r.from, r.to]));
    expect(map).toEqual({
      '/wizmatch/dashboard': '/wizmatch/today',
      '/wizmatch/signals': '/wizmatch/job-leads',
      '/wizmatch/relationships': '/wizmatch/companies',
      '/wizmatch/contact-intelligence': '/wizmatch/hiring-contacts',
      '/wizmatch/delivery': '/wizmatch/submissions',
      '/wizmatch/analytics': '/wizmatch/reports',
    });
  });

  it('resolves a route by its canonical path and by any of its legacy aliases', () => {
    expect(findWizmatchRouteForPath('/wizmatch/job-leads')?.id).toBe('job-leads');
    expect(findWizmatchRouteForPath('/wizmatch/signals')?.id).toBe('job-leads');
    expect(findWizmatchRouteForPath('/wizmatch/does-not-exist')).toBeUndefined();
  });

  it('has exactly 9 primary entries matching the approved nav', () => {
    const primary = WIZMATCH_ROUTES.filter((r) => r.group === 'primary').map((r) => r.label);
    expect(primary).toEqual([
      'Today', 'Job Leads', 'Companies', 'Hiring Contacts', 'Roles / Requirements',
      'Candidates', 'Submissions', 'Placements', 'Reports',
    ]);
  });

  it('assigns every "more.*" group entry a matching moreSection label', () => {
    for (const route of WIZMATCH_ROUTES) {
      if (route.group && route.group !== 'primary') {
        expect(route.moreSection).toBeTruthy();
      }
    }
  });

  it('leaves pending-merge entries with no group, so they are excluded from nav generation', () => {
    const pendingMergeIds = [
      'my-work', 'review-workbench', 'client-discovery', 'requirement-priority',
      'candidate-intelligence', 'source-candidates',
    ];
    for (const id of pendingMergeIds) {
      const route = WIZMATCH_ROUTES.find((r) => r.id === id);
      expect(route).toBeDefined();
      expect(route.group).toBeUndefined();
      expect(route.searchVisible).toBe(false);
    }
  });

  // 2026-08-02 — the Growth CRM pages that a /wizmatch/* path was pointed at
  // are now hidden from the WizMatch sidebar and Cmd+K while staying fully
  // routable. Encoded as three separate invariants so a regression says which
  // half broke: hidden-from-nav, hidden-from-search, and still-reachable.
  // The last one is what makes this reversible rather than a deletion.
  const ROUTABLE_BUT_HIDDEN = [
    ['more-inbox', '/wizmatch/inbox'],
    ['more-outreach', '/wizmatch/outreach'],
    ['more-templates-email', '/wizmatch/emails'],
    ['more-templates-wa', '/wizmatch/whatsapp-templates'],
    ['more-contacts', '/wizmatch/contacts'],
    ['more-pipeline', '/wizmatch/pipeline'],
    ['more-tasks', '/wizmatch/tasks'],
    ['more-discovery', '/wizmatch/discover'],
    ['more-provider-runs', '/wizmatch/system?tab=sourcing'],
    ['more-billing', '/wizmatch/billing'],
    ['more-expenses', '/wizmatch/finance'],
  ];

  it.each(ROUTABLE_BUT_HIDDEN)('%s is out of the sidebar (no group) and out of Cmd+K', (id) => {
    const route = WIZMATCH_ROUTES.find((r) => r.id === id);
    expect(route, `registry entry ${id} disappeared — hidden is not deleted`).toBeDefined();
    // navEntries.js filters on `route.group !== undefined`, so an absent group
    // is the whole mechanism. A group value the Sidebar does not render would
    // instead produce a ghost: in Cmd+K, missing from the sidebar.
    expect(route.group, `${id} regained a group — it would reappear in the sidebar`).toBeUndefined();
    expect(route.moreSection, `${id} keeps a moreSection with no group`).toBeUndefined();
    expect(route.searchVisible, `${id} must stay out of Cmd+K`).toBe(false);
  });

  it.each(ROUTABLE_BUT_HIDDEN)('%s is still ROUTABLE at %s', (id, path) => {
    const route = WIZMATCH_ROUTES.find((r) => r.id === id);
    expect(route.path).toBe(path);
    expect(findWizmatchRouteForPath(path)?.id).toBe(id);
  });

  it('has retired the Communication bucket entirely', () => {
    // Sidebar.jsx's MORE_SECTION_ORDER no longer renders 'Communication'. An
    // entry declaring it (or the old 'more.communication' group) would be
    // dropped from the sidebar silently while still showing in Cmd+K.
    const offenders = WIZMATCH_ROUTES.filter(
      (r) => r.group === 'more.communication' || r.moreSection === 'Communication',
    ).map((r) => r.id);
    expect(offenders).toEqual([]);
  });

  it('surfaces Talent Matching in nav + search (the actionable matching workspace)', () => {
    const route = WIZMATCH_ROUTES.find((r) => r.id === 'talent-matching');
    expect(route).toBeDefined();
    expect(route.group).toBe('more.crmUtilities');
    expect(route.searchVisible).toBe(true);
  });

  // H-11 / D-38 regression: the Duplicate Companies nav/route/page must be
  // unavailable while WIZMATCH_COMPANY_POLICY_ENABLED is off. The PR 4
  // marker previously (falsely) claimed this was already true — it wasn't:
  // the route had no flag in its permission list at all.
  it('gates the Duplicate Companies nav entry on wizmatchCompanyPolicyEnabled', () => {
    const route = WIZMATCH_ROUTES.find((r) => r.id === 'duplicate-review');
    expect(route).toBeDefined();
    const permissions = Array.isArray(route.permission) ? route.permission : [route.permission];
    expect(permissions).toContain('wizmatchCompanyPolicyEnabled');
    expect(evaluateWizmatchPermission({ isAdminTier: true, wizmatchCompanyPolicyEnabled: false }, route.permission)).toBe(false);
    expect(evaluateWizmatchPermission({ isAdminTier: true, wizmatchCompanyPolicyEnabled: true }, route.permission)).toBe(true);
  });

  describe('evaluateWizmatchPermission', () => {
    it('treats "always" as unconditionally true regardless of flags', () => {
      expect(evaluateWizmatchPermission({}, 'always')).toBe(true);
    });

    it('checks a single flag', () => {
      expect(evaluateWizmatchPermission({ canWizmatch: true }, 'canWizmatch')).toBe(true);
      expect(evaluateWizmatchPermission({ canWizmatch: false }, 'canWizmatch')).toBe(false);
      expect(evaluateWizmatchPermission({}, 'canWizmatch')).toBe(false);
    });

    it('AND-combines an array of flags', () => {
      const permission = ['canStaffing', 'staffingPhaseA'];
      expect(evaluateWizmatchPermission({ canStaffing: true, staffingPhaseA: true }, permission)).toBe(true);
      expect(evaluateWizmatchPermission({ canStaffing: true, staffingPhaseA: false }, permission)).toBe(false);
      expect(evaluateWizmatchPermission({ canStaffing: false, staffingPhaseA: true }, permission)).toBe(false);
    });
  });
});
