// PRD-005 §8.10 (ADR-006 D-5) — the mandatory outreach chokepoint.
//
// `evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed` are the
// ONLY sanctioned way to reach a policy or suppression decision.
// `PolicyDecision` is a branded type: the brand field is only ever set inside
// this module, so a caller cannot fabricate an allow.
//
// PR 2 scope (PRD-005 §22.2): this module and its resolver are built and
// tested here. NO caller migrates onto it in this PR — that is PR 3's
// acceptance evidence (§8.10.1's 31-row checklist). Nothing in src/routes or
// src/services calls this module yet.
//
// Known PR-2 scope limits, stated rather than hidden:
//   - The cold-start contact-confidence gate (§7) is not evaluated here —
//     confidence grading lives in wizmatchContactIntelligenceRepo and is not
//     wired to this module until a caller passes it in. L7 here covers only
//     the suppression union (§8.10, A-1 fix) and channel/contact validity.
//   - Duplicate-suspect containment (L5, §8.8) is not yet queried against
//     wizmatch_company_duplicates from this module — that wiring is PR 3/4
//     scope per the stacked-PR plan (§22).
//   - Shadow-vs-enforce blocking behaviour is a no-op either way in PR 2:
//     nothing calls this module, so WIZMATCH_POLICY_ENFORCEMENT_MODE only
//     annotates the returned decision, per §16.

import { and, eq, inArray } from 'drizzle-orm';
import { db, contacts, wizmatchSuppressionList, wizmatchOutreachEnrolments } from '../../db';
import { WIZMATCH_LIVE_ENROLMENT_STATES } from '../../config/wizmatchOutreachStates';
import { isPreparationAllowed } from '../../config/wizmatchReasonCodes';
import { resolveEffectivePolicy } from './policyResolver';
import { computeCampaignCompatibility } from './campaignCompatibility';
import {
  OutreachBlockedError,
  type OutreachGateContext,
  type PolicyDecision,
  type RouteCode,
} from './policyTypes';

export { OutreachBlockedError };
export type { PolicyDecision, OutreachGateContext } from './policyTypes';

function readEnforcementMode(): 'shadow' | 'enforce' {
  // §16 rule 3: any value other than the exact string 'enforce' is 'shadow'.
  // Read per request (rule 4), never cached at boot.
  return process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE === 'enforce' ? 'enforce' : 'shadow';
}

function makeDecision(partial: Omit<PolicyDecision, '__brand' | 'enforcementMode'>): PolicyDecision {
  return { ...partial, __brand: 'WizmatchPolicyDecision', enforcementMode: readEnforcementMode() };
}

function denyDecision(
  reasonCode: string,
  effectiveLevel: PolicyDecision['effectiveLevel'],
  effective: PolicyDecision['effective'] = { outreachEligibility: null, externalHiringPolicy: null, relationshipType: null },
): PolicyDecision {
  return makeDecision({
    decision: 'deny',
    recommendedRoute: 'none',
    allowedCampaignTypes: [],
    allowedOutreachModes: [],
    reasonCodes: [reasonCode],
    effectiveLevel,
    effective,
    blockClass: null,
    isNonOverridable: false,
    preparationAllowed: isPreparationAllowed(reasonCode),
    requiresExplicitApproval: false,
    accountOwnerUserId: null,
    evidence: null,
  });
}

async function isSuppressed(tenantId: string, email?: string, contactId?: string): Promise<boolean> {
  if (email) {
    const normalisedEmail = email.trim().toLowerCase();
    const rows = await db
      .select({ id: wizmatchSuppressionList.id })
      .from(wizmatchSuppressionList)
      .where(and(eq(wizmatchSuppressionList.tenantId, tenantId), eq(wizmatchSuppressionList.email, normalisedEmail)));
    if (rows.length > 0) return true;
  }
  if (contactId) {
    const rows = await db
      .select({ doNotContact: contacts.doNotContact })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
    if (rows.some((r) => r.doNotContact)) return true;
  }
  return false;
}

async function hasLiveColdEmailEnrolment(tenantId: string, companyId: string): Promise<boolean> {
  const rows = await db
    .select({ id: wizmatchOutreachEnrolments.id })
    .from(wizmatchOutreachEnrolments)
    .where(
      and(
        eq(wizmatchOutreachEnrolments.tenantId, tenantId),
        eq(wizmatchOutreachEnrolments.companyId, companyId),
        eq(wizmatchOutreachEnrolments.outreachMode, 'cold_email'),
        inArray(wizmatchOutreachEnrolments.state, [...WIZMATCH_LIVE_ENROLMENT_STATES]),
      ),
    );
  return rows.length > 0;
}

/**
 * Evaluates the L0-L8 gate ladder (PRD-005 §8.2). Never throws for a policy
 * outcome — fails closed by returning a DENY decision. Only a genuinely
 * unexpected error (e.g. a DB connection failure) surfaces as a rejected
 * promise, and even that path is meant to be caught by the caller and
 * treated as DENY (§8.10 rule 5).
 */
export async function evaluateWizmatchOutreachGate(ctx: OutreachGateContext): Promise<PolicyDecision> {
  try {
    if (!ctx.companyId) {
      return denyDecision('policy_resolver_error', 0);
    }

    const effective = await resolveEffectivePolicy(ctx.tenantId, ctx.companyId, ctx);

    // L0 — no active entire_company root row.
    if (!effective.rootRow) {
      return denyDecision('policy_missing_root', 0);
    }

    // Fail closed on unresolvable scope applicability (H-4) — evaluated
    // before every gate below since it means the ladder itself is unsound.
    if (effective.unresolvableScopeType) {
      return denyDecision('scope_unresolvable', 0);
    }

    // L1 — non-overridable entire_company block.
    if (effective.rootRow.outreachEligibility === 'blocked' && effective.rootRow.isNonOverridable) {
      const l1ReasonCode = effective.rootRow.reasonCode ?? 'manual_block_by_operator';
      return makeDecision({
        decision: 'deny',
        recommendedRoute: 'none',
        allowedCampaignTypes: [],
        allowedOutreachModes: [],
        reasonCodes: [l1ReasonCode],
        effectiveLevel: 1,
        effective: {
          outreachEligibility: { value: 'blocked', scopeKey: 'entire_company', policyId: effective.rootRow.id },
          externalHiringPolicy: effective.externalHiringPolicy,
          relationshipType: effective.relationshipType,
        },
        blockClass: effective.rootRow.blockClass,
        isNonOverridable: true,
        preparationAllowed: isPreparationAllowed(l1ReasonCode),
        requiresExplicitApproval: false,
        accountOwnerUserId: null,
        evidence: {
          kind: effective.rootRow.evidenceKind ?? undefined,
          text: effective.rootRow.evidenceText ?? undefined,
          url: effective.rootRow.evidenceUrl ?? undefined,
          ref: effective.rootRow.evidenceRef ?? undefined,
          source: effective.rootRow.source,
          actorUserId: effective.rootRow.actorUserId ?? undefined,
        },
      });
    }

    // From here on the ladder has a sound root and resolved scope
    // applicability, so every subsequent decision — allow, review or deny —
    // carries the real per-dimension provenance rather than nulling it out.
    const effectiveSnapshot: PolicyDecision['effective'] = {
      outreachEligibility: effective.outreachEligibility,
      externalHiringPolicy: effective.externalHiringPolicy,
      relationshipType: effective.relationshipType,
    };

    // L1b — relationship hard exclusion.
    const relationshipType = effective.relationshipType?.value ?? 'new_prospect';
    if (relationshipType === 'competitor' || relationshipType === 'irrelevant') {
      return denyDecision(
        relationshipType === 'competitor' ? 'relationship_competitor' : 'relationship_irrelevant',
        1,
        effectiveSnapshot,
      );
    }

    // L1c — non-overridable block at a narrower scope.
    const narrowerNonOverridable = effective.applicableRows.find(
      (r) => r.scopeType !== 'entire_company' && r.outreachEligibility === 'blocked' && r.isNonOverridable,
    );
    if (narrowerNonOverridable) {
      return makeDecision({
        decision: 'deny',
        recommendedRoute: 'none',
        allowedCampaignTypes: [],
        allowedOutreachModes: [],
        reasonCodes: [narrowerNonOverridable.reasonCode ?? 'manual_block_by_operator'],
        effectiveLevel: 1,
        effective: {
          outreachEligibility: {
            value: 'blocked',
            scopeKey: narrowerNonOverridable.scopeKey,
            policyId: narrowerNonOverridable.id,
          },
          externalHiringPolicy: effective.externalHiringPolicy,
          relationshipType: effective.relationshipType,
        },
        blockClass: narrowerNonOverridable.blockClass,
        isNonOverridable: true,
        preparationAllowed: true,
        requiresExplicitApproval: false,
        accountOwnerUserId: null,
        evidence: {
          kind: narrowerNonOverridable.evidenceKind ?? undefined,
          text: narrowerNonOverridable.evidenceText ?? undefined,
          url: narrowerNonOverridable.evidenceUrl ?? undefined,
          ref: narrowerNonOverridable.evidenceRef ?? undefined,
          source: narrowerNonOverridable.source,
          actorUserId: narrowerNonOverridable.actorUserId ?? undefined,
        },
      });
    }

    // L2 — overridable entire_company block.
    if (effective.rootRow.outreachEligibility === 'blocked') {
      return denyDecision(effective.rootRow.reasonCode ?? 'manual_block_by_operator', 2, effectiveSnapshot);
    }

    const hiringPolicy = effective.externalHiringPolicy?.value ?? 'unknown';
    const compat = computeCampaignCompatibility(hiringPolicy, relationshipType);

    // L3 — region/BU/location restriction supplied a blocked/paused value.
    const eligibility = effective.outreachEligibility;
    if (
      eligibility &&
      (eligibility.value === 'blocked' || eligibility.value === 'paused') &&
      (eligibility.scopeKey.startsWith('region:') ||
        eligibility.scopeKey.startsWith('business_unit:') ||
        eligibility.scopeKey.startsWith('location:'))
    ) {
      return denyDecision(
        eligibility.scopeKey.startsWith('region:')
          ? 'policy_region_restricted'
          : eligibility.scopeKey.startsWith('business_unit:')
            ? 'policy_business_unit_restricted'
            : 'policy_location_restricted',
        3,
        effectiveSnapshot,
      );
    }

    // L4 — signal/requirement restriction.
    if (
      eligibility &&
      (eligibility.value === 'blocked' || eligibility.value === 'paused') &&
      (eligibility.scopeKey.startsWith('specific_signal:') || eligibility.scopeKey.startsWith('specific_requirement:'))
    ) {
      return denyDecision('signal_role_irrelevant', 4, effectiveSnapshot);
    }

    // L5 — pause / needs-review.
    if (eligibility?.value === 'paused') {
      return denyDecision('policy_paused_by_owner', 5, effectiveSnapshot);
    }
    const needsReview = eligibility?.value === 'needs_review' || compat.decision === 'review';

    // L6 — campaign compatibility.
    if (ctx.campaignType && !compat.allowedCampaignTypes.includes(ctx.campaignType)) {
      return denyDecision('campaign_type_not_permitted', 6, effectiveSnapshot);
    }
    if (ctx.outreachMode && !compat.allowedOutreachModes.includes(ctx.outreachMode)) {
      return denyDecision('outreach_mode_not_permitted', 6, effectiveSnapshot);
    }

    // L6b — company cold-email lock.
    if (ctx.outreachMode === 'cold_email' && (await hasLiveColdEmailEnrolment(ctx.tenantId, ctx.companyId))) {
      return denyDecision('company_cold_email_lock', 6, effectiveSnapshot);
    }

    // L7 — contact/email restriction: suppression union (fixes A-1).
    if (await isSuppressed(ctx.tenantId, ctx.email, ctx.contactId)) {
      return denyDecision('email_hard_bounce', 7, effectiveSnapshot);
    }

    // L8 — score/contact approval never blocks; advisory only.

    return makeDecision({
      decision: compat.decision === 'deny' ? 'deny' : needsReview ? 'review' : 'allow',
      recommendedRoute: compat.route as RouteCode,
      allowedCampaignTypes: compat.decision === 'deny' ? [] : compat.allowedCampaignTypes,
      allowedOutreachModes: compat.decision === 'deny' ? [] : compat.allowedOutreachModes,
      reasonCodes: needsReview ? ['policy_unknown_cold_start'] : [],
      effectiveLevel: 8,
      effective: {
        outreachEligibility: effective.outreachEligibility,
        externalHiringPolicy: effective.externalHiringPolicy,
        relationshipType: effective.relationshipType,
      },
      blockClass: null,
      isNonOverridable: false,
      preparationAllowed: compat.preparationAllowed,
      requiresExplicitApproval: needsReview,
      accountOwnerUserId: null,
      evidence: null,
    });
  } catch {
    // Fail closed on any unexpected error (§8.10 rule 5).
    return denyDecision('policy_resolver_error', 0);
  }
}

export async function assertWizmatchOutreachAllowed(ctx: OutreachGateContext): Promise<PolicyDecision> {
  const decision = await evaluateWizmatchOutreachGate(ctx);
  if (decision.decision !== 'allow') {
    throw new OutreachBlockedError(decision);
  }
  return decision;
}

export interface CompanyStatusResult {
  decision: 'allow' | 'review' | 'deny';
  reasonCode: string | null;
}

/**
 * Compatibility adapter (§11.3, ADR-006 D-13). Returns the policy-derived
 * status ONLY — never falls back to `wizmatch_company_intelligence.status`
 * or any other legacy status. A company with no root row is `deny` /
 * `policy_missing_root`, unconditionally.
 */
export async function resolveCompanyStatus(tenantId: string, companyId: string): Promise<CompanyStatusResult> {
  const decision = await evaluateWizmatchOutreachGate({ tenantId, action: 'enrol', companyId });
  return { decision: decision.decision, reasonCode: decision.reasonCodes[0] ?? null };
}
