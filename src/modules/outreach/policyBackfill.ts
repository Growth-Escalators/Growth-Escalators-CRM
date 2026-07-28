// PRD-005 §11 / ADR-006 "Backfill proposal" — pure logic for the dry-run-first
// root-policy backfill. Kept under src/ (not scripts/, which sits outside
// tsconfig's rootDir and cannot be imported by src/__tests__) so the report
// shape and the tolerance guard are directly unit-testable; the thin,
// DB-touching CLI wrapper lives at scripts/onboarding/wizmatch-policy-backfill.ts.

export interface BackfillDryRunReport {
  mode: 'dry_run' | 'apply';
  tenantId: string;
  totalCompanies: number;
  missingRootPolicyCount: number;
  sample: Array<{ id: string; name: string }>;
}

export const DEFAULT_BACKFILL_TOLERANCE = 5;

/** Pure — builds the report shape from already-fetched rows. */
export function buildDryRunReport(
  mode: BackfillDryRunReport['mode'],
  tenantId: string,
  totalCompanies: number,
  missingRows: Array<{ id: string; name: string }>,
  sampleSize = 10,
): BackfillDryRunReport {
  return {
    mode,
    tenantId,
    totalCompanies,
    missingRootPolicyCount: missingRows.length,
    sample: missingRows.slice(0, sampleSize),
  };
}

/**
 * Aborts (throws) if `liveCount` deviates from `dryRunCount` by more than
 * `tolerance` in either direction (PRD-005 §11, resolves review M-6).
 */
export function assertWithinTolerance(dryRunCount: number, liveCount: number, tolerance = DEFAULT_BACKFILL_TOLERANCE): void {
  const deviation = Math.abs(liveCount - dryRunCount);
  if (deviation > tolerance) {
    throw new Error(
      `Backfill aborted: live missing-root-policy count (${liveCount}) deviates from the dry-run count ` +
        `(${dryRunCount}) by ${deviation}, exceeding tolerance ${tolerance}. Re-run the dry run and investigate ` +
        `before retrying --apply.`,
    );
  }
}
