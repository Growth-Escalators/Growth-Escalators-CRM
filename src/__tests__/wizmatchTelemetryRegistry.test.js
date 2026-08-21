import { describe, expect, it } from 'vitest';
import { WIZMATCH_ROUTES } from '../../admin/src/routes/wizmatchRouteRegistry.ts';
import { resolveRouteView } from '../../admin/src/lib/telemetry.js';
import { WIZMATCH_TELEMETRY_ROUTES } from '../routes/wizmatchTelemetry.ts';

describe('WizMatch telemetry retirement boundary', () => {
  it('keeps both retired registries empty', () => {
    expect(WIZMATCH_ROUTES).toEqual([]);
    expect(WIZMATCH_TELEMETRY_ROUTES).toEqual([]);
  });

  it('attributes no old WizMatch browser route, so the beacon has nothing to send', () => {
    for (const [pathname, search = ''] of [
      ['/wizmatch/today'],
      ['/wizmatch/signals'],
      ['/wizmatch/candidates', '?id=cand-123'],
      ['/wizmatch/system', '?tab=sourcing'],
      ['/wizmatch/telemetry'],
    ]) {
      expect(resolveRouteView(pathname, search)).toBeNull();
    }
  });

  it('continues to ignore non-WizMatch pages', () => {
    expect(resolveRouteView('/dashboard', '')).toBeNull();
    expect(resolveRouteView('/login', '')).toBeNull();
  });
});
