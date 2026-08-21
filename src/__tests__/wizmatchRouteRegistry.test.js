import { describe, expect, it } from 'vitest';
import {
  WIZMATCH_ROUTES,
  evaluateWizmatchPermission,
  findWizmatchRouteForPath,
  getWizmatchLegacyRedirects,
} from '../../admin/src/routes/wizmatchRouteRegistry.ts';

describe('WizMatch navigation retirement boundary', () => {
  it('publishes no WizMatch navigation destinations', () => {
    expect(WIZMATCH_ROUTES).toEqual([]);
  });

  it('publishes no legacy WizMatch bookmark redirects', () => {
    expect(getWizmatchLegacyRedirects()).toEqual([]);
  });

  it('does not resolve old WizMatch paths', () => {
    for (const path of [
      '/wizmatch/today',
      '/wizmatch/dashboard',
      '/wizmatch/job-leads',
      '/wizmatch/candidates',
      '/wizmatch/requirements',
      '/wizmatch/submissions',
      '/wizmatch/placements',
      '/wizmatch/system',
    ]) {
      expect(findWizmatchRouteForPath(path)).toBeUndefined();
    }
  });

  it('retains the generic permission helper only for import compatibility', () => {
    expect(evaluateWizmatchPermission({}, 'always')).toBe(true);
    expect(evaluateWizmatchPermission({ canCRM: true }, 'canCRM')).toBe(true);
    expect(evaluateWizmatchPermission({ canCRM: true, canTasks: false }, ['canCRM', 'canTasks'])).toBe(false);
  });
});
