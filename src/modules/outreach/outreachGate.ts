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
//   - The duplicate REVIEW UI (merge / confirm-separate, and the
//     policy-divergence warning) is PR 4. L5 containment itself is enforced
//     here, since §22.2 #14 requires the resolver to implement L0-L8.
//   - Shadow-vs-enforce blocking behaviour is a no-op either way in PR 2:
//     nothing calls this module, so WIZMATCH_POLICY_ENFORCEMENT_MODE only
//     annotates the returned decision, per §16.

import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  db,
  contacts,
  wizmatchCompanies,
  wizmatchCompanyDuplicates,
  wizmatchSuppressionList,
  wizmatchOutreachEnrolments,
} from '../../db';
import { WIZMATCH_LIVE_ENROLMENT_STATES } from '../../config/wizmatchOutreachStates';
import { isPreparationAllowed } from '../../config/wizmatchReasonCodes';
import { resolveEffectivePolicy } from './policyResolver';
import { computeCampaignCompatibility } from './campaignCompatibility';
import {
  OutreachBlockedError,
  type OutreachGateContext,
  type PolicyDecision,
  type PolicyDecisionFields,
  type RouteCode,
} from './policyTypes';

export { OutreachBlockedError };
export type { PolicyDecision, OutreachGateContext } from './policyTypes';

function readEnforcementMode(): 'shadow' | 'enforce' {
  // §16 rule 3: any value other than the exact string 'enforce' is 'shadow'.
  // Read per request (rule 4), never cached at boot.
  return process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE === 'enforce' ? 'enforce' : 'shadow';
}

/**
 * The ONLY construction site of a branded `PolicyDecision` in the codebase
 * (§8.10 rule 3). The brand key is a module-private `unique symbol` declared in
 * policyTypes.ts, so this single deliberate cast is the only way one comes into
 * existence — no caller can produce the key structurally.
 */
function makeDecision(partial: Omit<PolicyDecisionFields, 'enforcementMode'>): PolicyDecision {
  return { ...partial, enforcementMode: readEnforcementMode() } as unknown as PolicyDecision;
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

/**
 * §10.9 suppression `reason` -> §9.5 reason code. The gate must report why the
 * address was suppressed, not a blanket "hard bounce" — a stated unsubscribe
 * and a dead mailbox are different facts and drive different operator action.
 */
const SUPPRESSION_REASON_TO_CODE: Record<string, string> = {
  hard_bounce: 'email_hard_bounce',
  invalid_email: 'email_invalid_syntax',
  spam_complaint: 'email_spam_complaint',
  complaint: 'email_spam_complaint',
  unsubscribe: 'email_unsubscribed',
  do_not_contact: 'email_unsubscribed',
  manual: 'email_unsubscribed',
};

/**
 * The §8.10 suppression union: the exact email/channel row AND
 * `contacts.do_not_contact`. Both sides are lowercased at read — the stored
 * column too, not only the query input, because rows written by any path that
 * bypasses `normalizeChannelValue` can carry mixed case (§8.10.1 rows 26/29).
 * Returns the matching grain's reason code so L7 reports the real cause.
 */
async function findSuppression(
  tenantId: string,
  email?: string,
  contactId?: string,
): Promise<string | null> {
  if (email) {
    const normalisedEmail = email.trim().toLowerCase();
    const rows = await db
      .select({ reason: wizmatchSuppressionList.reason })
      .from(wizmatchSuppressionList)
      .where(
        and(
          eq(wizmatchSuppressionList.tenantId, tenantId),
          eq(sql`lower(${wizmatchSuppressionList.email})`, normalisedEmail),
        ),
      );
    if (rows.length > 0) {
      return SUPPRESSION_REASON_TO_CODE[rows[0]?.reason ?? ''] ?? 'email_unsubscribed';
    }
  }
  if (contactId) {
    const rows = await db
      .select({ doNotContact: contacts.doNotContact })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)));
    // A `do_not_contact` contact is a stated personal preference (§8.5), never
    // a channel-quality fact — reporting it as a bounce would be wrong.
    if (rows.some((r) => r.doNotContact)) return 'email_unsubscribed';
  }
  return null;
}

/**
 * §8.8 / §8.2 L5 — a company with an unresolved duplicate suspect cannot enter
 * active outreach. Checked in BOTH directions: the pair is stored ordered
 * (company_a_id < company_b_id), so a company that is only ever the "b" side
 * would never be blocked by a company_a_id-only lookup. Free preparation still
 * runs — the caller reads `preparationAllowed`.
 */
async function findPendingDuplicate(tenantId: string, companyId: string): Promise<string | null> {
  const rows = await db
    .select({ detectionRule: wizmatchCompanyDuplicates.detectionRule })
    .from(wizmatchCompanyDuplicates)
    .where(
      and(
        eq(wizmatchCompanyDuplicates.tenantId, tenantId),
        eq(wizmatchCompanyDuplicates.resolution, 'pending'),
        or(
          eq(wizmatchCompanyDuplicates.companyAId, companyId),
          eq(wizmatchCompanyDuplicates.companyBId, companyId),
        ),
      ),
    );
  if (rows.length === 0) return null;
  return rows[0]?.detectionRule === 'domain' ? 'duplicate_suspected_domain' : 'duplicate_suspected_name';
}

/** §8.7: `existing_client` routes to the company's account owner, or "unassigned" when null. */
async function readAccountOwnerUserId(tenantId: string, companyId: string): Promise<string | null> {
  const rows = await db
    .select({ accountOwnerUserId: wizmatchCompanies.accountOwnerUserId })
    .from(wizmatchCompanies)
    .where(and(eq(wizmatchCompanies.tenantId, tenantId), eq(wizmatchCompanies.id, companyId)));
  return rows[0]?.accountOwnerUserId ?? null;
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
        // Derived from the taxonomy (§8.9, H-1), never hardcoded — a narrower
        // compliance block must stop preparation exactly as a company-wide one does.
        preparationAllowed: isPreparationAllowed(
          narrowerNonOverridable.reasonCode ?? 'manual_block_by_operator',
        ),
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

    // L5 — pause / needs-review / duplicate-suspected.
    if (eligibility?.value === 'paused') {
      return denyDecision('policy_paused_by_owner', 5, effectiveSnapshot);
    }
    const duplicateReasonCode = await findPendingDuplicate(ctx.tenantId, ctx.companyId);
    if (duplicateReasonCode) {
      // Every GateAction is an outreach action; preparation is not one of them,
      // and stays permitted via preparationAllowed (§8.8).
      return denyDecision(duplicateReasonCode, 5, effectiveSnapshot);
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
    const suppressionReasonCode = await findSuppression(ctx.tenantId, ctx.email, ctx.contactId);
    if (suppressionReasonCode) {
      return denyDecision(suppressionReasonCode, 7, effectiveSnapshot);
    }

    // L8 — score/contact approval never blocks; advisory only.

    const terminalDecision = compat.decision === 'deny' ? 'deny' : needsReview ? 'review' : 'allow';

    return makeDecision({
      decision: terminalDecision,
      recommendedRoute: compat.route as RouteCode,
      // §8.6: "restricted is not uniformly denied". A `deny` decision still
      // reports the routes that ARE permitted — msp_vms_only keeps `msp_vms` /
      // research_only, and every §8.7 account-managed override keeps
      // account_managed — so the batch API can route the work that policy does
      // allow. Zeroing these on deny would make §8.6/§8.7's own tables
      // unreachable. §8.9: `[]` means "none permitted", not "denied".
      allowedCampaignTypes: compat.allowedCampaignTypes,
      allowedOutreachModes: compat.allowedOutreachModes,
      // The real cause, not a fixed literal — a `preferred_vendors_only` review
      // and a `former_client` review are different operator decisions.
      reasonCodes: terminalDecision === 'allow' || !compat.reasonCode ? [] : [compat.reasonCode],
      effectiveLevel: 8,
      effective: {
        outreachEligibility: effective.outreachEligibility,
        externalHiringPolicy: effective.externalHiringPolicy,
        relationshipType: effective.relationshipType,
      },
      blockClass: null,
      isNonOverridable: false,
      // Taxonomy-derived inside computeCampaignCompatibility (§8.9, H-1), and
      // the AND of both grains — no_external_agencies still stops preparation
      // even when the relationship code alone would permit it.
      preparationAllowed: compat.preparationAllowed,
      requiresExplicitApproval: needsReview,
      accountOwnerUserId:
        compat.route === 'account_owner' ? await readAccountOwnerUserId(ctx.tenantId, ctx.companyId) : null,
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
