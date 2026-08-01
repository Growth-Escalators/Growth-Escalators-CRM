// PRD-005 §10.1 — the runtime option lists behind every company-policy picker.
//
// These five lists were previously hand-copied in three places: the admin
// Companies page's bulk dialog, the company drawer's Policy section, and (for
// four of them) `src/modules/outreach/policyService.ts`'s write-time validation
// arrays. The type-space unions in `src/modules/outreach/policyTypes.ts` could
// not stop that drift, because a TypeScript union ERASES AT RUNTIME — a `<select>`
// cannot render one, so every consumer that needs actual values re-typed them.
//
// This module is that missing runtime source. It follows the exact shape of
// `src/config/wizmatchReasonCodes.ts` (the documented precedent for a module
// imported across the backend/frontend boundary) and is bound by the same rule:
//
//   PURE DATA ONLY. No imports of its own, no `process.env`, no Node APIs, no
//   db/drizzle. The admin SPA imports this file directly via Vite, so the day
//   someone adds `import { db } from '../db'` here the admin bundle either
//   fails to build or ships a broken chunk, a long way from the cause.
//
// `policyService.ts` — which imports db/drizzle and is NOT browser-safe — now
// derives its validation arrays from these lists, and the assignment there is
// annotated with the `policyTypes.ts` union, so `tsc` proves at compile time
// that this file and the canonical unions agree. That check is the reason this
// extraction is a de-duplication and not simply a fourth copy.
//
// If you need runtime/env-dependent logic for policy enums, put it in a service
// that imports this file; do not add it here.

/** §8.9 outreach eligibility — the dimension the gate reads first. */
export const ELIGIBILITY_OPTIONS = ['eligible', 'needs_review', 'paused', 'blocked'] as const;

/** §8.9 external hiring policy — what a company will accept from an agency. */
export const HIRING_POLICY_OPTIONS = [
  'accepts_external_vendors',
  'fte_vendors_only',
  'contract_vendors_only',
  'preferred_vendors_only',
  'msp_vms_only',
  'direct_hiring_only',
  'no_external_agencies',
  'unknown',
] as const;

/** §8.9 relationship type — who this company already is to us. */
export const RELATIONSHIP_OPTIONS = [
  'new_prospect',
  'existing_prospect',
  'existing_client',
  'vendor_partner',
  'prime_partner',
  'former_client',
  'competitor',
  'irrelevant',
] as const;

/**
 * The scope types a POLICY FORM can offer — deliberately NOT the canonical
 * scope-type vocabulary. That is `SCOPE_TYPES` in
 * `src/modules/outreach/policyTypes.ts` (owner-ratified D-R2, kept in
 * set-equality with migration 0037's `..._scope_type_chk` by
 * `src/__tests__/wizmatchPolicyScopeTypeParity.test.ts`), and it has six
 * members. `specific_signal` and `specific_requirement` are omitted here
 * because each one needs a concrete signal/requirement id that a free-standing
 * policy form has no way to pick; they are written from the signal and
 * requirement surfaces instead. Do not "fix" this list to six — it is a UI
 * subset by design, and it must never be treated as the vocabulary.
 */
export const UI_SCOPE_TYPE_OPTIONS = ['entire_company', 'region', 'business_unit', 'location'] as const;

/**
 * The region vocabulary, and the reason a `region`-scoped policy row is the one
 * non-root scope that is meaningful across an arbitrary multi-company
 * selection: migration 0037's `wizmatch_company_policies_region_label_chk`
 * pins `scope_ref_label` to exactly these two values for `scope_type='region'`.
 * `business_unit` and `location` labels are free text and therefore
 * per-company; `region` is a closed, tenant-independent set.
 */
export const REGION_SCOPE_LABELS = ['india', 'us'] as const;

/** §10.1 evidence kinds accepted on a policy row. */
export const EVIDENCE_KIND_OPTIONS = [
  'human_text',
  'source_url',
  'email_reply_ref',
  'provider_event_ref',
  'legal_document_ref',
  'automated_detection',
] as const;
