import { describe, expect, it } from 'vitest';
import { WIZMATCH_ROUTES } from '../../admin/src/routes/wizmatchRouteRegistry.ts';
import { resolveRouteView, sendRouteViewBeacon } from '../../admin/src/lib/telemetry.js';
import { WIZMATCH_TELEMETRY_ROUTES } from '../routes/wizmatchTelemetry.ts';

describe('WizMatch telemetry retirement boundary', () => {
  it('keeps backend telemetry tracking retired while CRM compatibility routes may exist', () => {
    expect(WIZMATCH_ROUTES.length).toBeGreaterThan(0);
    expect(WIZMATCH_TELEMETRY_ROUTES).toEqual([]);
  });

  it('attributes no browser route, including shared CRM compatibility paths', () => {
    for (const [pathname, search = ''] of [
      ['/wizmatch/contacts'],
      ['/wizmatch/inbox'],
      ['/wizmatch/billing'],
      ['/wizmatch/today'],
      ['/wizmatch/candidates', '?id=cand-123'],
      ['/dashboard'],
      ['/login'],
    ]) {
      expect(resolveRouteView(pathname, search)).toBeNull();
    }
  });

  it('keeps the beacon sender as a harmless compatibility no-op', () => {
    expect(sendRouteViewBeacon('anything', '/wizmatch/contacts')).toBeUndefined();
  });
});
