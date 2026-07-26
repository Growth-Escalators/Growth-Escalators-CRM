// PRD-005 §11.3 / §23 "Lifecycle" row, ADR-006 D-13 — PR 5 compatibility adapter.
//
// Five legacy services independently re-derive whether a company may be
// contacted (PRD-005 §5.2 C-2): wizmatchClientDiscovery.ts,
// wizmatchCandidateIntelligence.ts, wizmatchCommandCenter.ts,
// wizmatchRequirementPriority.ts, wizmatchContactIntelligence.ts. This module
// is the ONLY place that translates the canonical resolver
// (`resolveCompanyStatus` / `evaluateWizmatchOutreachGate`,
// src/modules/outreach/outreachGate.ts) into each legacy response shape, so
// every migrated caller agrees with the gate by construction rather than by
// convention.
//
// Scope note, stated rather than hidden: `evaluateWizmatchOutreachGate`
// requires a `companyId` (it denies with `policy_resolver_error` without
// one). `wizmatchCandidateIntelligence.ts` and `wizmatchRequirementPriority.ts`
// score a candidate/requirement, not a company, and their existing input
// shapes carry no `companyId` — a candidate is not 1:1 with one company, and
// PRD-005 does not ask this PR to redesign those input contracts. Their
// company-level blockers therefore route through this adapter only where a
// caller can supply a `companyId` (see `withCanonicalCompanyEligibility`);
// where none is available the legacy blocker stands, unmigrated and
// explicitly out of scope for the reason above — recorded, not silently
// dropped, per PRD-005 §5.3 disclosure norms.
//
// What this module removes: any legacy computation "granting" outreach
// permission on its own account (ADR-006 D-13 forbids a legacy-status
// fallback). Nothing here can upgrade a canonical DENY into an allow; a
// canonical DENY always forces the legacy result to its most restrictive
// bucket. A canonical REVIEW never lets local scoring promote a company past
// `watch` / `needs_review` for company-blocking purposes — humans, not a
// local score, clear a REVIEW.

import { resolveCompanyStatus, type CompanyStatusResult } from './outreachGate';
import type { CompanyIntelligenceStatus } from '../../services/wizmatchContactIntelligence';

export interface CanonicalCompanyEligibility {
  tenantId: string;
  companyId: string;
  decision: CompanyStatusResult['decision'];
  reasonCode: string | null;
  /** Set only when `decision === 'deny'`. Format: `policy_<reasonCode>`. */
  blockerCode: string | null;
}

/**
 * The sole call site any legacy caller should use to ask "does the canonical
 * policy resolver deny/review/allow this company?" Fails closed by
 * inheritance — `resolveCompanyStatus` already returns `deny` /
 * `policy_missing_root` on a missing root row, a resolver error, or an
 * unresolvable scope (PRD-005 §8.2 L0, §8.10 rule 5); this function adds no
 * fallback of its own.
 */
export async function resolveCanonicalCompanyEligibility(
  tenantId: string,
  companyId: string,
): Promise<CanonicalCompanyEligibility> {
  const { decision, reasonCode } = await resolveCompanyStatus(tenantId, companyId);
  return {
    tenantId,
    companyId,
    decision,
    reasonCode,
    blockerCode: decision === 'deny' ? `policy_${reasonCode ?? 'denied'}` : null,
  };
}

/** Batch form, deduplicated by companyId, for a list of company-scoped results. */
export async function resolveCanonicalCompanyEligibilityBatch(
  tenantId: string,
  companyIds: Array<string | null | undefined>,
): Promise<Map<string, CanonicalCompanyEligibility>> {
  const uniqueIds = [...new Set(companyIds.filter((id): id is string => !!id))];
  const entries = await Promise.all(
    uniqueIds.map(async (companyId) => [companyId, await resolveCanonicalCompanyEligibility(tenantId, companyId)] as const),
  );
  return new Map(entries);
}

interface PriorityBucketResult {
  priority: 'hot' | 'warm' | 'watch' | 'blocked';
  blockers: string[];
}

/**
 * The shared fold-in for every legacy `hot|warm|watch|blocked` shape
 * (`ClientDiscoveryResult`, `ScoredClientOpportunity`, and — where a
 * `companyId` is supplied — `CandidateIntelligenceResult` /
 * `RequirementPriorityResult` / their `wizmatchCommandCenter.ts` mirrors).
 * A canonical DENY always wins over local scoring (§8.4 hard-blocks-beat-
 * specificity, applied here at the display layer too). A canonical REVIEW
 * caps an `allow`-only local `hot`/`warm` result down to `watch`, since a
 * company still needing human policy review must never look pre-approved.
 */
export function applyCanonicalEligibilityToPriorityResult<T extends PriorityBucketResult>(
  result: T,
  canonical: CanonicalCompanyEligibility,
): T {
  if (canonical.decision === 'deny') {
    if (result.priority === 'blocked' && result.blockers.includes(canonical.blockerCode as string)) return result;
    return { ...result, priority: 'blocked', blockers: [...result.blockers, canonical.blockerCode as string] };
  }
  if (canonical.decision === 'review' && (result.priority === 'hot' || result.priority === 'warm')) {
    return { ...result, priority: 'watch' };
  }
  return result;
}

/** Applies the canonical decision to every result carrying a `companyId`; results without one are left untouched (see module header). */
export function applyCanonicalEligibilityToPriorityResults<T extends PriorityBucketResult & { companyId: string | null }>(
  results: T[],
  canonicalByCompanyId: Map<string, CanonicalCompanyEligibility>,
): T[] {
  return results.map((result) => {
    if (!result.companyId) return result;
    const canonical = canonicalByCompanyId.get(result.companyId);
    if (!canonical) return result;
    return applyCanonicalEligibilityToPriorityResult(result, canonical);
  });
}

interface ContactIntelligenceEligibilityShape {
  companyStatus: CompanyIntelligenceStatus;
  hardBlocks: string[];
}

/**
 * Fold-in for `ContactIntelligenceResult` (`wizmatchContactIntelligence.ts`),
 * whose legacy shape is a 9-value `companyStatus` plus a `hardBlocks[]`
 * array rather than the 4-value priority bucket. `discovery_blocked` is used
 * for a canonical deny generically — it is distinct from `suppressed`
 * (email/channel-grain suppression specifically) so the two causes stay
 * distinguishable in the taxonomy, per ADR-006 D-7 grain separation.
 */
export function applyCanonicalEligibilityToContactIntelligence<T extends ContactIntelligenceEligibilityShape>(
  result: T,
  canonical: CanonicalCompanyEligibility,
): T {
  if (canonical.decision === 'deny') {
    if (result.hardBlocks.includes(canonical.blockerCode as string)) return result;
    return {
      ...result,
      companyStatus: 'discovery_blocked',
      hardBlocks: [...result.hardBlocks, canonical.blockerCode as string],
    };
  }
  if (canonical.decision === 'review' && result.companyStatus === 'ready_for_discovery') {
    return { ...result, companyStatus: 'needs_review' };
  }
  return result;
}
