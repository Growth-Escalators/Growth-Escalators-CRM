// PRD-005 §8.6 (hiring-policy routing) and §8.7 (relationship-type routing),
// plus the §8.7 combination rule: the more restrictive `decision` wins, and
// when §8.7 yields a non-null route it takes precedence (account routing is
// more actionable than hiring-policy routing).

import type { CampaignType, ExternalHiringPolicy, OutreachMode, RelationshipType, RouteCode } from './policyTypes';

export interface CampaignCompatibility {
  decision: 'allow' | 'review' | 'deny';
  route: RouteCode;
  allowedCampaignTypes: CampaignType[];
  allowedOutreachModes: OutreachMode[];
  preparationAllowed: boolean;
}

const HIRING_POLICY_TABLE: Record<ExternalHiringPolicy, CampaignCompatibility> = {
  accepts_external_vendors: {
    decision: 'allow',
    route: 'standard_outreach',
    allowedCampaignTypes: ['fte_permanent', 'contract', 'c2h'],
    allowedOutreachModes: ['cold_email', 'account_managed', 'research_only'],
    preparationAllowed: true,
  },
  fte_vendors_only: {
    decision: 'allow',
    route: 'standard_outreach',
    allowedCampaignTypes: ['fte_permanent'],
    allowedOutreachModes: ['cold_email', 'account_managed', 'research_only'],
    preparationAllowed: true,
  },
  contract_vendors_only: {
    decision: 'allow',
    route: 'standard_outreach',
    allowedCampaignTypes: ['contract', 'c2h'],
    allowedOutreachModes: ['cold_email', 'account_managed', 'research_only'],
    preparationAllowed: true,
  },
  preferred_vendors_only: {
    decision: 'review',
    route: 'vendor_empanelment',
    allowedCampaignTypes: ['vendor_empanelment'],
    // cold_email is permitted only for an approved vendor_empanelment batch —
    // that per-batch approval check happens at the batch API, not here.
    allowedOutreachModes: ['research_only'],
    preparationAllowed: true,
  },
  msp_vms_only: {
    decision: 'deny',
    route: 'msp_vms_research',
    allowedCampaignTypes: ['msp_vms'],
    allowedOutreachModes: ['research_only'],
    preparationAllowed: true,
  },
  direct_hiring_only: {
    decision: 'deny',
    route: 'monitor_only',
    allowedCampaignTypes: [],
    allowedOutreachModes: ['research_only'],
    preparationAllowed: true,
  },
  no_external_agencies: {
    decision: 'deny',
    route: 'none',
    allowedCampaignTypes: [],
    allowedOutreachModes: [],
    preparationAllowed: false,
  },
  unknown: {
    decision: 'review',
    route: 'prepare_then_review',
    allowedCampaignTypes: [],
    allowedOutreachModes: ['research_only'],
    preparationAllowed: true,
  },
};

interface RelationshipOverride {
  decision: 'allow' | 'review' | 'deny' | null;
  route: RouteCode | null;
  allowedOutreachModes: OutreachMode[] | null;
  preparationAllowed: boolean;
}

const RELATIONSHIP_TABLE: Record<RelationshipType, RelationshipOverride> = {
  new_prospect: { decision: null, route: null, allowedOutreachModes: null, preparationAllowed: true },
  existing_prospect: { decision: null, route: null, allowedOutreachModes: null, preparationAllowed: true },
  existing_client: {
    decision: 'deny',
    route: 'account_owner',
    allowedOutreachModes: ['account_managed'],
    preparationAllowed: true,
  },
  vendor_partner: {
    decision: 'deny',
    route: 'partnership_workflow',
    allowedOutreachModes: ['account_managed'],
    preparationAllowed: true,
  },
  prime_partner: {
    decision: 'deny',
    route: 'account_management',
    allowedOutreachModes: ['account_managed'],
    preparationAllowed: true,
  },
  former_client: {
    decision: 'review',
    route: 'reengagement_review',
    allowedOutreachModes: ['account_managed', 'research_only'],
    preparationAllowed: true,
  },
  // competitor / irrelevant are enforced earlier at gate level L1b; included
  // here for completeness of the routing table only.
  competitor: { decision: 'deny', route: 'none', allowedOutreachModes: [], preparationAllowed: true },
  irrelevant: { decision: 'deny', route: 'none', allowedOutreachModes: [], preparationAllowed: false },
};

const DECISION_RANK: Record<'allow' | 'review' | 'deny', number> = { allow: 0, review: 1, deny: 2 };

export function computeCampaignCompatibility(
  hiringPolicy: ExternalHiringPolicy,
  relationshipType: RelationshipType,
): CampaignCompatibility {
  const base = HIRING_POLICY_TABLE[hiringPolicy];
  const override = RELATIONSHIP_TABLE[relationshipType];

  const decision =
    override.decision && DECISION_RANK[override.decision] > DECISION_RANK[base.decision]
      ? override.decision
      : base.decision;

  const route = override.route ?? base.route;
  const allowedOutreachModes = override.route ? (override.allowedOutreachModes ?? []) : base.allowedOutreachModes;
  const preparationAllowed = base.preparationAllowed && override.preparationAllowed;

  return {
    decision,
    route,
    allowedCampaignTypes: base.allowedCampaignTypes,
    allowedOutreachModes,
    preparationAllowed,
  };
}
