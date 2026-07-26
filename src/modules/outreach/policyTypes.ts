// PRD-005 §8.9, §8.10 — vendor-neutral, resolver-neutral types for the WizMatch
// outbound-policy gate. Mirrors the shape convention of src/modules/esign/providers/
// (ADR-007 D-1): a plain interface/type module the rest of WizMatch depends on,
// with no logic of its own.

export type ScopeType =
  | 'entire_company'
  | 'region'
  | 'business_unit'
  | 'location'
  | 'specific_signal'
  | 'specific_requirement';

export type OutreachEligibility = 'eligible' | 'needs_review' | 'paused' | 'blocked';

export type ExternalHiringPolicy =
  | 'accepts_external_vendors'
  | 'fte_vendors_only'
  | 'contract_vendors_only'
  | 'preferred_vendors_only'
  | 'msp_vms_only'
  | 'direct_hiring_only'
  | 'no_external_agencies'
  | 'unknown';

export type RelationshipType =
  | 'new_prospect'
  | 'existing_prospect'
  | 'existing_client'
  | 'vendor_partner'
  | 'prime_partner'
  | 'former_client'
  | 'competitor'
  | 'irrelevant';

export type CampaignType =
  | 'fte_permanent'
  | 'contract'
  | 'c2h'
  | 'vendor_empanelment'
  | 'msp_vms'
  | 'reengagement';

export type OutreachMode = 'cold_email' | 'account_managed' | 'research_only';

export type BlockClass = 'standard' | 'compliance' | 'legal';

export type EvidenceKind =
  | 'human_text'
  | 'source_url'
  | 'email_reply_ref'
  | 'provider_event_ref'
  | 'legal_document_ref'
  | 'automated_detection';

export type GateAction = 'enrol' | 'queue' | 'export' | 'send' | 'follow_up' | 'retry' | 're_enrol';

export type RouteCode =
  | 'standard_outreach'
  | 'vendor_empanelment'
  | 'msp_vms_research'
  | 'monitor_only'
  | 'none'
  | 'account_owner'
  | 'partnership_workflow'
  | 'account_management'
  | 'reengagement_review'
  | 'prepare_then_review';

export interface OutreachGateContext {
  tenantId: string;
  action: GateAction;
  companyId?: string;
  contactId?: string;
  /** Normalised by the gate: .trim().toLowerCase() before use. */
  email?: string;
  signalId?: string;
  requirementId?: string;
  campaignType?: CampaignType;
  outreachMode?: OutreachMode;
  region?: string;
  businessUnit?: string;
  location?: string;
  actorUserId?: string;
}

export interface EffectiveDimension<V> {
  value: V;
  scopeKey: string;
  policyId: string;
}

export interface PolicyEvidence {
  kind?: EvidenceKind;
  text?: string;
  url?: string;
  ref?: string;
  source: string;
  actorUserId?: string;
}

/**
 * The §8.9 payload without the brand. Callers may read this shape; they may
 * not produce a `PolicyDecision` from it — only the gate module can.
 */
export interface PolicyDecisionFields {
  decision: 'allow' | 'review' | 'deny';
  recommendedRoute: RouteCode;
  allowedCampaignTypes: CampaignType[];
  allowedOutreachModes: OutreachMode[];
  reasonCodes: string[];
  effectiveLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  effective: {
    outreachEligibility: EffectiveDimension<OutreachEligibility> | null;
    externalHiringPolicy: EffectiveDimension<ExternalHiringPolicy> | null;
    relationshipType: EffectiveDimension<RelationshipType> | null;
  };
  blockClass: BlockClass | null;
  isNonOverridable: boolean;
  preparationAllowed: boolean;
  requiresExplicitApproval: boolean;
  accountOwnerUserId: string | null;
  evidence: PolicyEvidence | null;
  /** shadow | enforce — recorded on every decision so the observed value is never stale (§16). */
  enforcementMode: 'shadow' | 'enforce';
}

/**
 * The brand key (PRD-005 §8.10 rule 3). `declare const ... unique symbol` is
 * type-space only — it emits no runtime value and is NOT exported, so no module
 * outside this one can name the key. That is what makes `PolicyDecision`
 * genuinely unforgeable: an object literal written anywhere else structurally
 * cannot carry this property, so a caller cannot fabricate an allow. A string
 * field such as `__brand: 'WizmatchPolicyDecision'` would not achieve this,
 * because TypeScript is structural and any caller can write that literal.
 */
declare const policyDecisionBrand: unique symbol;

/**
 * Branded so a `PolicyDecision` can only be constructed by the gate module
 * (PRD-005 §8.10 rule 3). A sender must accept a `PolicyDecision`, never a
 * boolean, and cannot fabricate an allow.
 */
export interface PolicyDecision extends PolicyDecisionFields {
  readonly [policyDecisionBrand]: 'WizmatchPolicyDecision';
}

export class OutreachBlockedError extends Error {
  readonly decision: PolicyDecision;
  constructor(decision: PolicyDecision) {
    super(`WizMatch outreach blocked: ${decision.reasonCodes.join(', ') || decision.decision}`);
    this.name = 'OutreachBlockedError';
    this.decision = decision;
  }
}
