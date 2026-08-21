import { describe, expect, it } from 'vitest';
import {
  WIZMATCH_ROUTES,
  evaluateWizmatchPermission,
  findWizmatchRouteForPath,
  getWizmatchLegacyRedirects,
} from '../../admin/src/routes/wizmatchRouteRegistry.ts';

describe('WizMatch retirement compatibility boundary', () => {
  it('contains only Growth CRM compatibility destinations', () => {
    const ids = WIZMATCH_ROUTES.map((route) => route.id);
    expect(ids).toEqual([
      'more-contacts',
      'more-pipeline',
      'more-tasks',
      'more-inbox',
      'more-templates-email',
      'more-templates-wa',
      'more-permissions',
      'more-audit',
      'more-branding',
      'more-configuration',
      'more-billing',
      'more-contracts',
      'more-expenses',
    ]);
  });

  it('publishes no legacy bookmark aliases for retired WizMatch product pages', () => {
    expect(getWizmatchLegacyRedirects()).toEqual([]);
  });

  it('does not resolve retired WizMatch product paths', () => {
    for (const path of [
      '/wizmatch/today',
      '/wizmatch/job-leads',
      '/wizmatch/candidates',
      '/wizmatch/requirements',
      '/wizmatch/submissions',
      '/wizmatch/placements',
      '/wizmatch/reports',
      '/wizmatch/system',
    ]) {
      expect(findWizmatchRouteForPath(path)).toBeUndefined();
    }
  });

  it('resolves shared CRM compatibility paths', () => {
    expect(findWizmatchRouteForPath('/wizmatch/contacts')?.id).toBe('more-contacts');
    expect(findWizmatchRouteForPath('/wizmatch/inbox')?.id).toBe('more-inbox');
    expect(findWizmatchRouteForPath('/wizmatch/billing')?.id).toBe('more-billing');
  });

  it('retains generic permission evaluation for compatibility navigation', () => {
    expect(evaluateWizmatchPermission({}, 'always')).toBe(true);
    expect(evaluateWizmatchPermission({ canCRM: true }, 'canCRM')).toBe(true);
    expect(evaluateWizmatchPermission({ canCRM: true, canTasks: false }, ['canCRM', 'canTasks'])).toBe(false);
  });
});
