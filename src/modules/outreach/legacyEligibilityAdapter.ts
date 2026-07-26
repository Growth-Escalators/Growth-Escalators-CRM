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
// D-31 (owner-ratified 2026-07-26): the exact string `enforce` is the ONLY
// mode that changes behaviour. Every other value is shadow. Canonical
// decision metadata is ALWAYS computed here and attached to every folded
// result (`canonicalDecision`/`canonicalReasonCode`/`canonicalBlockerCode`)
// so it may be displayed — but in shadow, the legacy behavioural output
// (`priority`/`nextAction`/`score`/`companyStatus`/`hardBlocks`) is left
// exactly as the legacy scorer computed it, and no write path this module
// feeds is blocked. Only under `enforce` does a canonical deny/review
// actually override the legacy bucket. This is what makes shadow a true
// no-op per PRD-005 §16 rule 2 and gate G3, while still letting an operator
// see the canonical decision. `resolveCompanyStatus`'s `actsOnDecision` field
// carries the exact same predicate `shouldBlock` uses
// (`decision !== 'allow' && enforcementMode === 'enforce'`), so this module
// never re-derives it.
//
// Scope note, stated rather than hidden: `evaluateWizmatchOutreachGate`
// requires a `companyId` (it denies with `policy_resolver_error` without
// one). `wizmatchCandidateIntelligence.ts`'s candidate-level scorer
// (`scoreCandidateIntelligence`/`detectCandidateHardBlocks`) carries no
// `companyId` — a candidate is not 1:1 with one company, and PRD-005 does
// not ask this PR to redesign that input contract. Its per-requirement
// matches (`CandidateRequirementInput`), however, DO carry a `companyId`
// (each requirement belongs to exactly one company) and are foldable — see
// `applyCanonicalEligibilityToPriorityResult`'s use from
// `wizmatchCandidateIntelligence.ts`'s `rankRequirementsForCandidateWithPolicy`.
//
// What this module removes: any legacy computation "granting" outreach
// permission on its own account (ADR-006 D-13 forbids a legacy-status
// fallback). Under `enforce`, nothing here can upgrade a canonical DENY into
// an allow; a canonical DENY always forces the legacy result to its most
// restrictive bucket, and a canonical REVIEW never lets local scoring
// promote a company past `watch` / `needs_review` for company-blocking
// purposes — humans, not a local score, clear a REVIEW.

import { resolveCompanyStatus, type CompanyStatusResult } from './outreachGate';
import type { CompanyIntelligenceStatus } from '../../services/wizmatchContactIntelligence';

export interface CanonicalCompanyEligibility {
  tenantId: string;
  companyId: string;
  /** The raw canonical decision. Always computed; display-only in shadow (D-31). */
  decision: CompanyStatusResult['decision'];
  reasonCode: string | null;
  /** Set only when `decision === 'deny'`. Format: `policy_<reasonCode>`. */
  blockerCode: string | null;
  enforcementMode: CompanyStatusResult['enforcementMode'];
  /** True only when `decision !== 'allow' && enforcementMode === 'enforce'` — mirrors `shouldBlock` (D-31). */
  actsOnDecision: boolean;
}

/**
 * The sole call site any legacy caller should use to ask "does the canonical
 * policy resolver deny/review/allow this company?" Fails closed by
 * inheritance — `resolveCompanyStatus` already returns `deny` /
 * `policy_missing_root` on a missing root row, a resolver error, or an
 * unresolvable scope (PRD-005 §8.2 L0, §8.10 rule 5); this function adds no
 * fallback of its own. Mode-awareness (D-31) is likewise inherited from
 * `resolveCompanyStatus`, not re-derived.
 */
export async function resolveCanonicalCompanyEligibility(
  tenantId: string,
  companyId: string,
): Promise<CanonicalCompanyEligibility> {
  const { decision, reasonCode, enforcementMode, actsOnDecision } = await resolveCompanyStatus(tenantId, companyId);
  return {
    tenantId,
    companyId,
    decision,
    reasonCode,
    blockerCode: decision === 'deny' ? `policy_${reasonCode ?? 'denied'}` : null,
    enforcementMode,
    actsOnDecision,
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
  /** Present on the concrete legacy shapes this fold is used against (H-4: must stay in lockstep with `priority`). */
  nextAction?: string;
}

/** The display-only canonical fields every folded `PriorityBucketResult` carries, D-31. */
export interface CanonicalDisplayFields {
  canonicalDecision: CanonicalCompanyEligibility['decision'];
  canonicalReasonCode: string | null;
  canonicalBlockerCode: string | null;
}

/**
 * The shared fold-in for every legacy `hot|warm|watch|blocked` shape
 * (`ClientDiscoveryResult`, `ScoredClientOpportunity`, and — where a
 * `companyId` is supplied — `CandidateIntelligenceResult` /
 * `RequirementPriorityResult` / their `wizmatchCommandCenter.ts` mirrors).
 *
 * D-31: canonical metadata (`canonicalDecision`/`canonicalReasonCode`/
 * `canonicalBlockerCode`) is always attached, for display. The legacy
 * `priority`/`blockers`/`nextAction` are only overridden when
 * `canonical.actsOnDecision` is true (exact `enforce` mode and a non-allow
 * decision) — in shadow (or on an allow) the legacy behavioural output is
 * returned completely unchanged, satisfying §16 rule 2's "blocks nothing".
 *
 * H-4: `nextAction` is folded in lockstep with `priority` so the
 * `priority === 'blocked' ⟺ nextAction === 'blocked'` invariant the legacy
 * scorers hold by construction is never broken by this adapter — a
 * canonically-denied company must never render a live action button.
 */
export function applyCanonicalEligibilityToPriorityResult<T extends PriorityBucketResult>(
  result: T,
  canonical: CanonicalCompanyEligibility,
): T & CanonicalDisplayFields {
  const withMetadata: T & CanonicalDisplayFields = {
    ...result,
    canonicalDecision: canonical.decision,
    canonicalReasonCode: canonical.reasonCode,
    canonicalBlockerCode: canonical.blockerCode,
  };

  if (!canonical.actsOnDecision) {
    // Shadow (or an allow): legacy behavioural output preserved verbatim.
    return withMetadata;
  }

  if (canonical.decision === 'deny') {
    if (withMetadata.priority === 'blocked' && withMetadata.blockers.includes(canonical.blockerCode as string)) {
      return withMetadata;
    }
    return {
      ...withMetadata,
      priority: 'blocked',
      blockers: [...withMetadata.blockers, canonical.blockerCode as string],
      ...(withMetadata.nextAction !== undefined ? { nextAction: 'blocked' } : {}),
    };
  }
  if (canonical.decision === 'review' && (withMetadata.priority === 'hot' || withMetadata.priority === 'warm')) {
    return {
      ...withMetadata,
      priority: 'watch',
      ...(withMetadata.nextAction !== undefined ? { nextAction: 'watch' } : {}),
    };
  }
  return withMetadata;
}

/** Applies the canonical decision to every result carrying a `companyId`; results without one are left untouched (see module header) — they carry no canonical fields since there is nothing to display. */
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
 *
 * D-31: same mode-awareness as `applyCanonicalEligibilityToPriorityResult` —
 * canonical metadata is always attached; the legacy `companyStatus`/
 * `hardBlocks` are only overridden when `canonical.actsOnDecision` is true.
 *
 * H-3: the REVIEW branch keys on `companyStatus === 'qualified'`, the value
 * `statusForTier` (`wizmatchContactIntelligence.ts`) actually produces for a
 * non-rejected, non-suppressed company — `'ready_for_discovery'` is never
 * produced by that function, so keying on it made this branch dead code.
 */
export function applyCanonicalEligibilityToContactIntelligence<T extends ContactIntelligenceEligibilityShape>(
  result: T,
  canonical: CanonicalCompanyEligibility,
): T & CanonicalDisplayFields {
  const withMetadata: T & CanonicalDisplayFields = {
    ...result,
    canonicalDecision: canonical.decision,
    canonicalReasonCode: canonical.reasonCode,
    canonicalBlockerCode: canonical.blockerCode,
  };

  if (!canonical.actsOnDecision) {
    return withMetadata;
  }

  if (canonical.decision === 'deny') {
    if (withMetadata.hardBlocks.includes(canonical.blockerCode as string)) return withMetadata;
    return {
      ...withMetadata,
      companyStatus: 'discovery_blocked',
      hardBlocks: [...withMetadata.hardBlocks, canonical.blockerCode as string],
    };
  }
  if (canonical.decision === 'review' && withMetadata.companyStatus === 'qualified') {
    return { ...withMetadata, companyStatus: 'needs_review' };
  }
  return withMetadata;
}
