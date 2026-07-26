// PRD-005 §21.1 — the cold-start policy readiness report. Shipped in PR 4 "so
// evidence accumulates across the whole shadow period" and consumed by G4
// (§21.2). Tenant-scoped throughout.
//
// Split the same way src/services/wizmatchReadiness.ts already does: a pure,
// unit-testable `evaluateWizmatchPolicyReadiness` that takes already-computed
// facts and does no I/O, and a thin `getWizmatchPolicyReadiness(pool, tenantId)`
// that runs the actual tenant-scoped SQL. Only the thin wrapper is DB-touching
// and is therefore not exercised by the automated test suite (consistent with
// the repo's existing convention — see wizmatchReadiness.test.ts).
//
// D-34 (owner-ratified 2026-07-26): resolved. `outreachGate.ts`'s `shouldBlock`
// now persists every distinct shadow would-block fact to `audit_events`
// (action='wizmatch_gate_denied_shadow', migration 0010, already applied —
// no 0037 dependency), idempotently per (tenant, company, reason code).
// `shadowObservedCompanyCount` below is that CUMULATIVE, persisted count —
// distinct companies actually observed would-blocking across the whole
// shadow period, consumed from the persisted rows, not console logs alone.
// `shadowWouldHaveBlockedCount` (the live snapshot this file previously
// shipped alone) is kept alongside it: the snapshot answers "if enforcement
// flipped on right now, how many companies would go dark", while the
// cumulative count answers "how much of this HAS the gate actually seen
// during the shadow period" — both are useful and neither subsumes the
// other, so both are reported rather than one replacing the other.
//
// Honest limitations, disclosed rather than silently approximated:
//   - "Export omissions" and "policy resolver errors" are cumulative,
//     event-sourced metrics that need the outreach-batch adapter (PR 8/9,
//     not yet built) and a persisted resolver-error log (same schema gap as
//     above) respectively. Both are reported as `unavailable: true` with a
//     zero count, not fabricated.
//   - "Pending duplicate suspects in the active pilot batch" (§21.2 condition
//     3) needs an `wizmatch_outreach_batches` "active pilot batch" concept
//     that does not exist yet (PR 8). Reported as `unavailable: true`.

import { and, count, countDistinct, eq, isNull, sql } from 'drizzle-orm';
import {
  db,
  wizmatchCompanies,
  wizmatchCompanyPolicies,
  wizmatchCompanyDuplicates,
  wizmatchContactCandidates,
  wizmatchOutreachEnrolments,
  auditEvents,
} from '../../db';
import { WIZMATCH_LIVE_ENROLMENT_STATES } from '../../config/wizmatchOutreachStates';
import { evaluateWizmatchOutreachGate } from './outreachGate';

export interface PolicyReadinessMetrics {
  totalCompanies: number;
  companiesWithRootPolicy: number;
  companiesMissingRootPolicy: number;
  policyCoveragePercent: number;
  classification: {
    byEligibility: Record<string, number>;
    byHiringPolicy: Record<string, number>;
    byRelationship: Record<string, number>;
  };
  contactsReviewed: number;
  contactConfidenceDistribution: { high: number; medium: number; low: number; unverified: number };
  duplicates: {
    pending: number;
    merged: number;
    confirmedSeparate: number;
    pendingWithLiveEnrolment: number;
    pendingInActivePilotBatch: { count: number; unavailable: true };
  };
  shadowWouldHaveBlockedCount: number;
  /** D-34: cumulative, persisted, distinct-company count from audit_events. */
  shadowObservedCompanyCount: number;
  reasonCodeDistribution: Record<string, number>;
  exportOmissions: { count: number; unavailable: true };
  policyResolverErrors: { count: number; unavailable: true };
}

export interface PolicyReadinessResult {
  tenantId: string;
  generatedAt: string;
  metrics: PolicyReadinessMetrics;
  /** §21.2 G4 hard preconditions, evaluated against the metrics above. */
  g4Preconditions: {
    zeroCompaniesMissingPolicy: boolean;
    zeroPendingDuplicatesWithLiveEnrolment: boolean;
  };
}

/** Pure — no I/O. Unit-testable with fixture inputs. */
export function evaluateWizmatchPolicyReadiness(input: {
  totalCompanies: number;
  companiesWithRootPolicy: number;
  byEligibility: Record<string, number>;
  byHiringPolicy: Record<string, number>;
  byRelationship: Record<string, number>;
  contactsReviewed: number;
  contactConfidenceDistribution: { high: number; medium: number; low: number; unverified: number };
  duplicatesPending: number;
  duplicatesMerged: number;
  duplicatesConfirmedSeparate: number;
  duplicatesPendingWithLiveEnrolment: number;
  shadowWouldHaveBlockedCount: number;
  shadowObservedCompanyCount: number;
  reasonCodeDistribution: Record<string, number>;
  tenantId: string;
}): PolicyReadinessResult {
  const companiesMissingRootPolicy = Math.max(0, input.totalCompanies - input.companiesWithRootPolicy);
  const policyCoveragePercent = input.totalCompanies === 0 ? 100 : Math.round((input.companiesWithRootPolicy / input.totalCompanies) * 10000) / 100;

  return {
    tenantId: input.tenantId,
    generatedAt: new Date().toISOString(),
    metrics: {
      totalCompanies: input.totalCompanies,
      companiesWithRootPolicy: input.companiesWithRootPolicy,
      companiesMissingRootPolicy,
      policyCoveragePercent,
      classification: {
        byEligibility: input.byEligibility,
        byHiringPolicy: input.byHiringPolicy,
        byRelationship: input.byRelationship,
      },
      contactsReviewed: input.contactsReviewed,
      contactConfidenceDistribution: input.contactConfidenceDistribution,
      duplicates: {
        pending: input.duplicatesPending,
        merged: input.duplicatesMerged,
        confirmedSeparate: input.duplicatesConfirmedSeparate,
        pendingWithLiveEnrolment: input.duplicatesPendingWithLiveEnrolment,
        pendingInActivePilotBatch: { count: 0, unavailable: true },
      },
      shadowWouldHaveBlockedCount: input.shadowWouldHaveBlockedCount,
      shadowObservedCompanyCount: input.shadowObservedCompanyCount,
      reasonCodeDistribution: input.reasonCodeDistribution,
      exportOmissions: { count: 0, unavailable: true },
      policyResolverErrors: { count: 0, unavailable: true },
    },
    g4Preconditions: {
      zeroCompaniesMissingPolicy: companiesMissingRootPolicy === 0,
      zeroPendingDuplicatesWithLiveEnrolment: input.duplicatesPendingWithLiveEnrolment === 0,
    },
  };
}

/** Thin, DB-touching wrapper. Not exercised by the automated suite — see file header. */
export async function getWizmatchPolicyReadiness(tenantId: string): Promise<PolicyReadinessResult> {
  const [{ value: totalCompanies }] = await db
    .select({ value: count() })
    .from(wizmatchCompanies)
    .where(eq(wizmatchCompanies.tenantId, tenantId));

  const rootRows = await db
    .select({
      companyId: wizmatchCompanyPolicies.companyId,
      outreachEligibility: wizmatchCompanyPolicies.outreachEligibility,
      externalHiringPolicy: wizmatchCompanyPolicies.externalHiringPolicy,
      relationshipType: wizmatchCompanyPolicies.relationshipType,
      reasonCode: wizmatchCompanyPolicies.reasonCode,
    })
    .from(wizmatchCompanyPolicies)
    .where(
      and(
        eq(wizmatchCompanyPolicies.tenantId, tenantId),
        eq(wizmatchCompanyPolicies.scopeType, 'entire_company'),
        isNull(wizmatchCompanyPolicies.supersededAt),
      ),
    );

  const byEligibility: Record<string, number> = {};
  const byHiringPolicy: Record<string, number> = {};
  const byRelationship: Record<string, number> = {};
  const reasonCodeDistribution: Record<string, number> = {};
  for (const row of rootRows) {
    if (row.outreachEligibility) byEligibility[row.outreachEligibility] = (byEligibility[row.outreachEligibility] ?? 0) + 1;
    if (row.externalHiringPolicy) byHiringPolicy[row.externalHiringPolicy] = (byHiringPolicy[row.externalHiringPolicy] ?? 0) + 1;
    if (row.relationshipType) byRelationship[row.relationshipType] = (byRelationship[row.relationshipType] ?? 0) + 1;
    if (row.reasonCode) reasonCodeDistribution[row.reasonCode] = (reasonCodeDistribution[row.reasonCode] ?? 0) + 1;
  }

  const [{ value: contactsReviewed }] = await db
    .select({ value: count() })
    .from(wizmatchContactCandidates)
    .where(and(eq(wizmatchContactCandidates.tenantId, tenantId), sql`${wizmatchContactCandidates.status} <> 'needs_review'`));

  const confidenceRows = await db
    .select({
      confidenceScore: wizmatchContactCandidates.confidenceScore,
      deliverabilityStatus: wizmatchContactCandidates.deliverabilityStatus,
    })
    .from(wizmatchContactCandidates)
    .where(eq(wizmatchContactCandidates.tenantId, tenantId));

  const contactConfidenceDistribution = { high: 0, medium: 0, low: 0, unverified: 0 };
  for (const row of confidenceRows) {
    if (row.deliverabilityStatus === 'unverified') {
      contactConfidenceDistribution.unverified += 1;
      continue;
    }
    const score = row.confidenceScore ?? 0;
    if (score >= 8) contactConfidenceDistribution.high += 1;
    else if (score >= 6) contactConfidenceDistribution.medium += 1;
    else contactConfidenceDistribution.low += 1;
  }

  const duplicateRows = await db
    .select({
      companyAId: wizmatchCompanyDuplicates.companyAId,
      companyBId: wizmatchCompanyDuplicates.companyBId,
      resolution: wizmatchCompanyDuplicates.resolution,
    })
    .from(wizmatchCompanyDuplicates)
    .where(eq(wizmatchCompanyDuplicates.tenantId, tenantId));

  const duplicatesPending = duplicateRows.filter((r) => r.resolution === 'pending').length;
  const duplicatesMerged = duplicateRows.filter((r) => r.resolution === 'merged').length;
  const duplicatesConfirmedSeparate = duplicateRows.filter((r) => r.resolution === 'confirmed_separate').length;

  // §21.2 condition 2: "no pending duplicate has a live outreach enrolment",
  // using the FULL eight-state live list (including the five conversation
  // states) — not the earlier three-state predicate the PRD explicitly warns
  // would have let an open conversation pass the gate.
  const pendingCompanyIds = Array.from(
    new Set(duplicateRows.filter((r) => r.resolution === 'pending').flatMap((r) => [r.companyAId, r.companyBId])),
  );
  let duplicatesPendingWithLiveEnrolment = 0;
  if (pendingCompanyIds.length > 0) {
    const liveRows = await db
      .select({ companyId: wizmatchOutreachEnrolments.companyId })
      .from(wizmatchOutreachEnrolments)
      .where(
        and(
          eq(wizmatchOutreachEnrolments.tenantId, tenantId),
          sql`${wizmatchOutreachEnrolments.companyId} = ANY(${pendingCompanyIds})`,
          sql`${wizmatchOutreachEnrolments.state} = ANY(${[...WIZMATCH_LIVE_ENROLMENT_STATES]})`,
        ),
      );
    duplicatesPendingWithLiveEnrolment = new Set(liveRows.map((r) => r.companyId)).size;
  }

  // Shadow would-have-blocked count — a LIVE SNAPSHOT proxy. Evaluates the
  // same gate every real call site uses, for every company with a root
  // policy, and counts non-'allow'. Kept alongside the cumulative count
  // below (D-34) — see file header for why both are reported.
  let shadowWouldHaveBlockedCount = 0;
  for (const row of rootRows) {
    const decision = await evaluateWizmatchOutreachGate({ tenantId, action: 'enrol', companyId: row.companyId });
    if (decision.decision !== 'allow') shadowWouldHaveBlockedCount += 1;
  }

  // D-34: the cumulative, persisted count — distinct companies `shouldBlock`
  // has actually observed would-blocking in shadow mode, across the whole
  // shadow period, from `audit_events` (not a snapshot, not a console log).
  const [{ value: shadowObservedCompanyCount }] = await db
    .select({ value: countDistinct(auditEvents.resourceId) })
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, 'wizmatch_gate_denied_shadow')));

  return evaluateWizmatchPolicyReadiness({
    tenantId,
    totalCompanies,
    companiesWithRootPolicy: rootRows.length,
    byEligibility,
    byHiringPolicy,
    byRelationship,
    contactsReviewed,
    contactConfidenceDistribution,
    duplicatesPending,
    duplicatesMerged,
    duplicatesConfirmedSeparate,
    duplicatesPendingWithLiveEnrolment,
    shadowWouldHaveBlockedCount,
    shadowObservedCompanyCount,
    reasonCodeDistribution,
  });
}
