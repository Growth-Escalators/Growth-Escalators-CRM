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

  it('surfaces Talent Matching in nav + search (the actionable matching workspace)', () => {
    const route = WIZMATCH_ROUTES.find((r) => r.id === 'talent-matching');
    expect(route).toBeDefined();
    expect(route.group).toBe('more.crmUtilities');
    expect(route.searchVisible).toBe(true);
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
