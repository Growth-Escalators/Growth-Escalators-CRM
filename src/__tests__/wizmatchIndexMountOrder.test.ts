// PRD-005 PR 5/6 review finding M-1 — regression guard.
//
// `wizmatchPolicyRoutes.test.ts` and `wizmatchTodayRoutes.test.ts` prove each
// router's OWN role gates in isolation, mounted on a bare express app. They
// cannot see the defect M-1 actually was: in the real `src/index.ts`, the
// admin/team_lead/viewer-only `wizmatchRequireAdmin` gate ran as `app.use`
// middleware for the WHOLE `/api/wizmatch` prefix, ahead of the policy and
// (now) decision-workbench routers — so a staff-tier request for e.g.
// `/companies/:id/policy` or `/today/queues` was 403'd before it ever reached
// a router that would have allowed it, regardless of what that router's own
// role gate said.
//
// `src/index.ts` itself cannot be safely imported in a unit test — module
// load starts a real HTTP listener and a real Postgres pool. This is
// therefore a source-level ordering guard, the same convention this repo
// already uses for other registration-order invariants
// (`wizmatchCompanyBootstrapCoverage.test.ts`, `wizmatchLegacyEligibilityGuard.test.ts`):
// it reads the actual file and asserts the real statement order, so a future
// edit that re-introduces the M-1 ordering is caught mechanically rather than
// depending on a reviewer re-reading the mount block.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');

function firstIndexOf(needle: string): number {
  const idx = source.indexOf(needle);
  expect(idx, `expected to find "${needle}" in src/index.ts`).toBeGreaterThan(-1);
  return idx;
}

describe('src/index.ts — /api/wizmatch mount order (M-1)', () => {
  it('mounts wizmatchPolicyRouter BEFORE the wizmatchRequireAdmin-gated wizmatchRouter', () => {
    const policyMount = firstIndexOf("wizmatchRequireStaffing, wizmatchPolicyRouter)");
    const adminGatedMount = firstIndexOf("requireAuth, wizmatchRequireAdmin, wizmatchRouter)");
    expect(policyMount).toBeLessThan(adminGatedMount);
  });

  it('mounts wizmatchTodayRouter BEFORE the wizmatchRequireAdmin-gated wizmatchRouter', () => {
    const todayMount = firstIndexOf("wizmatchRequireStaffing, wizmatchTodayRouter)");
    const adminGatedMount = firstIndexOf("requireAuth, wizmatchRequireAdmin, wizmatchRouter)");
    expect(todayMount).toBeLessThan(adminGatedMount);
  });

  it('gates both new-order mounts on requireAuth + wizmatchRequireStaffing (staff+), not wizmatchRequireAdmin', () => {
    expect(source).toMatch(/app\.use\('\/api\/wizmatch', requireAuth, wizmatchRequireStaffing, wizmatchPolicyRouter\)/);
    expect(source).toMatch(/app\.use\('\/api\/wizmatch', requireAuth, wizmatchRequireStaffing, wizmatchTodayRouter\)/);
  });
});
