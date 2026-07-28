// PRD-005 §11 / ADR-006 "Backfill proposal" — dry-run report + tolerance-guard
// pure-function tests. The pure logic lives in src/modules/outreach/policyBackfill.ts;
// the DB-touching CLI wrapper (scripts/onboarding/wizmatch-policy-backfill.ts)
// re-exports it and is intentionally thin/untested here, consistent with the
// wizmatchReadiness.ts tested-pure-fn / untested-thin-DB-wrapper split.

import { describe, it, expect } from 'vitest';
import { buildDryRunReport, assertWithinTolerance } from '../modules/outreach/policyBackfill';

describe('buildDryRunReport', () => {
  it('reports the missing count and a capped sample, mode=dry_run by default', () => {
    const missing = Array.from({ length: 15 }, (_, i) => ({ id: `company-${i}`, name: `Company ${i}` }));
    const report = buildDryRunReport('dry_run', 'tenant-1', 131, missing);
    expect(report.mode).toBe('dry_run');
    expect(report.totalCompanies).toBe(131);
    expect(report.missingRootPolicyCount).toBe(15);
    expect(report.sample).toHaveLength(10); // default sampleSize
  });

  it('reports zero missing when every company already has a root row', () => {
    const report = buildDryRunReport('dry_run', 'tenant-1', 131, []);
    expect(report.missingRootPolicyCount).toBe(0);
    expect(report.sample).toEqual([]);
  });
});

describe('assertWithinTolerance', () => {
  it('does not throw when the live count matches the dry-run count exactly', () => {
    expect(() => assertWithinTolerance(131, 131)).not.toThrow();
  });

  it('does not throw when the deviation is within the default tolerance', () => {
    expect(() => assertWithinTolerance(131, 134, 5)).not.toThrow();
  });

  it('aborts (throws) when the live count deviates beyond tolerance — the safety-net guard', () => {
    expect(() => assertWithinTolerance(131, 200, 5)).toThrow(/deviates/);
  });

  it('aborts when the live count is LOWER than the dry-run count by more than tolerance too (not just higher)', () => {
    expect(() => assertWithinTolerance(131, 50, 5)).toThrow(/deviates/);
  });
});
