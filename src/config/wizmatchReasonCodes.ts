// PRD-005 §9 — the WizMatch outbound reason-code taxonomy, ratified 2026-07-26,
// corrected in the 2026-07-26 spec-repair pass (ADR-006 D-7, D-13; PRD-005 §25.1
// A-22..A-30). Documentation only until PR 2 — PR 2 makes these values
// database-backed and, per the §9 freeze rule, stable: renaming a value after
// this point requires its own migration plus a compatibility mapping.
//
// This module is the single source of truth for the taxonomy's per-code
// metadata (Prep / Evid / Perm / Ovr / Learn). §20.1 requires a test that
// "parses §9 and asserts invariants 1-5 mechanically" — this data structure
// *is* that parse target: the invariants are checked against this table, not
// against the markdown prose, so there is exactly one place a taxonomy edit
// can go stale.

export type ReasonCodeCategory =
  | 'company_policy'
  | 'compliance'
  | 'relationship'
  | 'contact_quality'
  | 'email_quality'
  | 'signal_status'
  | 'duplicate'
  | 'campaign_compatibility'
  | 'operational'
  | 'manual_review';

export type EvidenceRequirement = 'required' | 'auto' | 'none';

export interface ReasonCodeMeta {
  readonly code: string;
  readonly category: ReasonCodeCategory;
  /** Whether free preparation (§14) may still run for a company/contact carrying this code. */
  readonly prepAllowed: boolean;
  readonly evidence: EvidenceRequirement;
  readonly permittedPermanent: boolean;
  /** true = admin/team_lead may override via a superseding row; false = non-overridable; null = n/a (no stored block, or derived decision). */
  readonly overridable: boolean | null;
  readonly learningLabel: boolean;
}

const R = (
  code: string,
  category: ReasonCodeCategory,
  prepAllowed: boolean,
  evidence: EvidenceRequirement,
  permittedPermanent: boolean,
  overridable: boolean | null,
  learningLabel: boolean,
): ReasonCodeMeta => ({ code, category, prepAllowed, evidence, permittedPermanent, overridable, learningLabel });

export const WIZMATCH_REASON_CODES: readonly ReasonCodeMeta[] = [
  // 9.1 company_policy
  R('policy_accepts_external_vendors', 'company_policy', true, 'required', false, null, true),
  R('policy_fte_vendors_only', 'company_policy', true, 'required', false, true, true),
  R('policy_contract_vendors_only', 'company_policy', true, 'required', false, true, true),
  R('policy_preferred_vendors_only', 'company_policy', true, 'required', false, true, true),
  R('policy_msp_vms_only', 'company_policy', true, 'required', true, true, true),
  R('policy_direct_hiring_only', 'company_policy', true, 'required', true, true, true),
  R('policy_no_external_agencies', 'company_policy', false, 'required', true, true, true),
  R('policy_unknown_cold_start', 'company_policy', true, 'none', false, null, true),
  R('policy_paused_by_owner', 'company_policy', true, 'none', false, true, false),
  R('policy_region_restricted', 'company_policy', true, 'required', true, true, true),
  R('policy_business_unit_restricted', 'company_policy', true, 'required', true, true, true),
  R('policy_location_restricted', 'company_policy', true, 'required', true, true, true),

  // 9.2 compliance — every code non-overridable, none a learning label
  R('company_removal_request', 'compliance', false, 'required', true, false, false),
  R('legal_notice', 'compliance', false, 'required', true, false, false),
  R('regulator_request', 'compliance', false, 'required', true, false, false),
  R('privacy_request_pending', 'compliance', false, 'required', false, false, false),
  R('contractual_restriction', 'compliance', true, 'required', true, false, false),

  // 9.3 relationship
  R('relationship_existing_client', 'relationship', true, 'required', false, true, true),
  R('relationship_vendor_partner', 'relationship', true, 'required', false, true, true),
  R('relationship_prime_partner', 'relationship', true, 'required', false, true, true),
  R('relationship_former_client', 'relationship', true, 'required', false, true, true),
  R('relationship_competitor', 'relationship', true, 'required', true, true, true),
  R('relationship_irrelevant', 'relationship', false, 'required', true, true, true),

  // 9.4 contact_quality
  R('contact_confidence_low', 'contact_quality', true, 'auto', false, false, true),
  R('contact_unverified', 'contact_quality', true, 'auto', false, false, true),
  R('contact_confidence_medium', 'contact_quality', true, 'none', false, null, true),
  R('contact_role_uncertain', 'contact_quality', true, 'none', false, null, true),
  R('contact_role_confirmed_mismatch', 'contact_quality', true, 'required', true, true, true),
  R('contact_stale', 'contact_quality', true, 'none', false, true, true),
  R('contact_rejected_by_reviewer', 'contact_quality', true, 'none', false, true, true),
  R('contact_left_company', 'contact_quality', true, 'required', true, true, true),

  // 9.5 email_quality
  R('email_hard_bounce', 'email_quality', true, 'auto', true, true, true),
  R('email_soft_bounce_repeated', 'email_quality', true, 'auto', false, true, true),
  R('email_unsubscribed', 'email_quality', true, 'auto', true, false, false),
  R('email_spam_complaint', 'email_quality', true, 'auto', true, false, false),
  R('email_role_inbox_only', 'email_quality', true, 'none', false, true, true),
  R('email_catch_all_domain', 'email_quality', true, 'auto', false, true, true),
  R('email_invalid_syntax', 'email_quality', true, 'auto', true, false, false),
  R('email_domain_unresolvable', 'email_quality', true, 'auto', false, true, true),

  // 9.6 signal_status — scoped to one signal, never blocks company or contact
  R('signal_closed', 'signal_status', true, 'auto', true, true, true),
  R('signal_expired', 'signal_status', true, 'auto', true, true, true),
  R('signal_filled_internally', 'signal_status', true, 'auto', true, true, true),
  R('signal_duplicate_posting', 'signal_status', true, 'auto', true, true, true),
  R('signal_out_of_region', 'signal_status', true, 'auto', false, true, true),
  R('signal_role_irrelevant', 'signal_status', true, 'none', false, true, true),

  // 9.7 duplicate
  R('duplicate_suspected_domain', 'duplicate', true, 'auto', false, false, false),
  R('duplicate_suspected_name', 'duplicate', true, 'auto', false, false, false),
  R('duplicate_confirmed_separate', 'duplicate', true, 'required', false, true, false),
  R('duplicate_merged', 'duplicate', true, 'required', true, false, false),

  // 9.8 campaign_compatibility
  R('campaign_type_not_permitted', 'campaign_compatibility', true, 'none', false, null, true),
  R('outreach_mode_not_permitted', 'campaign_compatibility', true, 'none', false, null, true),
  R('company_cold_email_lock', 'campaign_compatibility', true, 'auto', false, null, false),
  R('contact_already_enrolled', 'campaign_compatibility', true, 'auto', false, null, false),
  R('campaign_requires_approval', 'campaign_compatibility', true, 'none', false, null, false),

  // 9.9 operational — fail-closed/system-health, none a learning label
  R('policy_resolver_error', 'operational', true, 'auto', false, false, false),
  R('policy_missing_root', 'operational', true, 'auto', false, false, false),
  R('scope_unresolvable', 'operational', true, 'auto', false, false, false),
  R('preparation_incomplete', 'operational', true, 'auto', false, null, false),
  R('cost_guard_block', 'operational', true, 'auto', false, false, false),

  // 9.10 manual_review
  R('manual_approved_by_operator', 'manual_review', true, 'none', false, null, true),
  R('manual_block_by_operator', 'manual_review', true, 'required', true, true, true),
  R('manual_pause_by_operator', 'manual_review', true, 'none', false, true, false),
  R('manual_skip_for_now', 'manual_review', true, 'none', false, null, true),
  R('manual_reclassified', 'manual_review', true, 'required', false, true, true),
  R('manual_admin_override', 'manual_review', true, 'required', false, true, true),
  R('manual_lock_release', 'manual_review', true, 'required', false, null, false),
  R('awaiting_owner_assignment', 'manual_review', true, 'none', false, null, false),
] as const;

export type WizmatchReasonCode = (typeof WIZMATCH_REASON_CODES)[number]['code'];

const BY_CODE = new Map(WIZMATCH_REASON_CODES.map((r) => [r.code, r]));

export function getReasonCodeMeta(code: string): ReasonCodeMeta | undefined {
  return BY_CODE.get(code);
}

/**
 * §9.11 invariant 3 — the complete Prep-blocking set is exactly these six
 * codes. §8.9's `preparationAllowed` is DERIVED from this set, never
 * enumerated a second time (resolves review H-1).
 */
export const WIZMATCH_PREP_BLOCKING_REASON_CODES: readonly string[] = WIZMATCH_REASON_CODES.filter(
  (r) => !r.prepAllowed,
).map((r) => r.code);

/**
 * Fail-closed on an unrecognised or malformed code (PR 8A hardening). The
 * previous default of `true` meant a typo, a stale client value, or a code
 * retired by a future taxonomy migration would silently continue preparing —
 * and therefore scraping and writing contact candidates for — a company the
 * resolver could not classify. An unknown code is exactly the case §8.10 rule
 * 5 says must resolve to DENY, never to last-known-good; the same rule now
 * applies to this derived permission, not only to the top-level decision.
 */
export function isPreparationAllowed(code: string): boolean {
  const meta = getReasonCodeMeta(code);
  return meta ? meta.prepAllowed : false;
}

/** §9.11 mechanical invariant checks. Thrown, not just returned, so a taxonomy edit that violates one fails loudly at import time in tests. */
export function checkWizmatchTaxonomyInvariants(): string[] {
  const violations: string[] = [];

  // Invariant 3: exactly six codes stop preparation.
  if (WIZMATCH_PREP_BLOCKING_REASON_CODES.length !== 6) {
    violations.push(
      `invariant 3: expected exactly 6 Prep-blocking codes, found ${WIZMATCH_PREP_BLOCKING_REASON_CODES.length}: ${WIZMATCH_PREP_BLOCKING_REASON_CODES.join(', ')}`,
    );
  }

  for (const r of WIZMATCH_REASON_CODES) {
    // Invariant 4: every code producing a permanent block requires evidence.
    if (r.permittedPermanent && r.evidence === 'none') {
      violations.push(`invariant 4: ${r.code} may be permanent but requires no evidence`);
    }
    // Invariant 5: every code producing a non-overridable block requires evidence.
    if (r.overridable === false && r.evidence === 'none') {
      violations.push(`invariant 5: ${r.code} is non-overridable but requires no evidence`);
    }
    // Invariant 2: every compliance code is non-overridable and permits no
    // preparation except contractual_restriction.
    if (r.category === 'compliance') {
      if (r.overridable !== false) {
        violations.push(`invariant 2: compliance code ${r.code} must be non-overridable`);
      }
      if (r.code !== 'contractual_restriction' && r.prepAllowed) {
        violations.push(`invariant 2: compliance code ${r.code} must block preparation`);
      }
    }
  }

  return violations;
}
