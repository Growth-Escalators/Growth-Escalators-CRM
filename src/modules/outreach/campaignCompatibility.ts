// PRD-005 §8.6 (hiring-policy routing) and §8.7 (relationship-type routing),
// plus the §8.7 combination rule: the more restrictive `decision` wins, and
// when §8.7 yields a non-null route it takes precedence (account routing is
// more actionable than hiring-policy routing).

import { isPreparationAllowed } from '../../config/wizmatchReasonCodes';
import type { CampaignType, ExternalHiringPolicy, OutreachMode, RelationshipType, RouteCode } from './policyTypes';

export interface CampaignCompatibility {
  decision: 'allow' | 'review' | 'deny';
  route: RouteCode;
  allowedCampaignTypes: CampaignType[];
  allowedOutreachModes: OutreachMode[];
  /**
   * Derived from the §9 taxonomy via `isPreparationAllowed`, never hand-written
   * here (§8.9, review H-1: "derived, not enumerated"). A second hand-maintained
   * prep list is exactly what H-1 forbids, because it silently drifts from the
   * taxonomy and would keep enriching a company that asked to be removed.
   */
  preparationAllowed: boolean;
  /** The §9 code explaining a non-allow outcome; null when nothing restricts. */
  reasonCode: string | null;
}

interface HiringPolicyRow {
  decision: 'allow' | 'review' | 'deny';
  route: RouteCode;
  allowedCampaignTypes: CampaignType[];
  allowedOutreachModes: OutreachMode[];
  reasonCode: string;
}

const HIRING_POLICY_TABLE: Record<ExternalHiringPolicy, HiringPolicyRow> = {
  accepts_external_vendors: {
    decision: 'allow',
    route: 'standard_outreach',
    allowedCampaignTypes: ['fte_permanent', 'contract', 'c2h'],
    allowedOutreachModes: ['cold_email', 'account_managed', 'research_only'],
    reasonCode: 'policy_accepts_external_vendors',
  },
  fte_vendors_only: {
    decision: 'allow',
    route: 'standard_outreach',
    allowedCampaignTypes: ['fte_permanent'],
    allowedOutreachModes: ['cold_email', 'account_managed', 'research_only'],
    reasonCode: 'policy_fte_vendors_only',
  },
  contract_vendors_only: {
    decision: 'allow',
    route: 'standard_outreach',
    allowedCampaignTypes: ['contract', 'c2h'],
    allowedOutreachModes: ['cold_email', 'account_managed', 'research_only'],
    reasonCode: 'policy_contract_vendors_only',
  },
  preferred_vendors_only: {
    decision: 'review',
    route: 'vendor_empanelment',
    allowedCampaignTypes: ['vendor_empanelment'],
    // cold_email is permitted only for an approved vendor_empanelment batch —
    // that per-batch approval check happens at the batch API, not here.
    allowedOutreachModes: ['research_only'],
    reasonCode: 'policy_preferred_vendors_only',
  },
  msp_vms_only: {
    decision: 'deny',
    route: 'msp_vms_research',
    allowedCampaignTypes: ['msp_vms'],
    allowedOutreachModes: ['research_only'],
    reasonCode: 'policy_msp_vms_only',
  },
  direct_hiring_only: {
    decision: 'deny',
    route: 'monitor_only',
    allowedCampaignTypes: [],
    allowedOutreachModes: ['research_only'],
    reasonCode: 'policy_direct_hiring_only',
  },
  no_external_agencies: {
    decision: 'deny',
    route: 'none',
    allowedCampaignTypes: [],
    allowedOutreachModes: [],
    reasonCode: 'policy_no_external_agencies',
  },
  unknown: {
    decision: 'review',
    route: 'prepare_then_review',
    allowedCampaignTypes: [],
    allowedOutreachModes: ['research_only'],
    reasonCode: 'policy_unknown_cold_start',
  },
};

interface RelationshipOverride {
  decision: 'allow' | 'review' | 'deny' | null;
  route: RouteCode | null;
  allowedOutreachModes: OutreachMode[] | null;
  /** Campaign types this relationship CONTRIBUTES on top of the hiring policy's (§8.7). */
  contributesCampaignTypes: CampaignType[];
  reasonCode: string | null;
}

const RELATIONSHIP_TABLE: Record<RelationshipType, RelationshipOverride> = {
  new_prospect: {
    decision: null,
    route: null,
    allowedOutreachModes: null,
    contributesCampaignTypes: [],
    reasonCode: null,
  },
  existing_prospect: {
    decision: null,
    route: null,
    allowedOutreachModes: null,
    contributesCampaignTypes: [],
    reasonCode: null,
  },
  existing_client: {
    decision: 'deny',
    route: 'account_owner',
    allowedOutreachModes: ['account_managed'],
    contributesCampaignTypes: [],
    reasonCode: 'relationship_existing_client',
  },
  vendor_partner: {
    decision: 'deny',
    route: 'partnership_workflow',
    allowedOutreachModes: ['account_managed'],
    contributesCampaignTypes: [],
    reasonCode: 'relationship_vendor_partner',
  },
  prime_partner: {
    decision: 'deny',
    route: 'account_management',
    allowedOutreachModes: ['account_managed'],
    contributesCampaignTypes: [],
    reasonCode: 'relationship_prime_partner',
  },
  former_client: {
    decision: 'review',
    route: 'reengagement_review',
    allowedOutreachModes: ['account_managed', 'research_only'],
    // §8.7: former_client "contributes campaign type `reengagement`".
    contributesCampaignTypes: ['reengagement'],
    reasonCode: 'relationship_former_client',
  },
  // competitor / irrelevant are enforced earlier at gate level L1b; included
  // here for completeness of the routing table only.
  competitor: {
    decision: 'deny',
    route: 'none',
    allowedOutreachModes: [],
    contributesCampaignTypes: [],
    reasonCode: 'relationship_competitor',
  },
  irrelevant: {
    decision: 'deny',
    route: 'none',
    allowedOutreachModes: [],
    contributesCampaignTypes: [],
    reasonCode: 'relationship_irrelevant',
  },
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

  // §8.7 combination rule: a non-null relationship route takes precedence, so
  // its code is the one that explains the outcome.
  const reasonCode = override.reasonCode ?? base.reasonCode;

  // Both grains must permit preparation — `no_external_agencies` combined with
  // `existing_client` still stops prep, even though the relationship code alone
  // would allow it.
  const preparationAllowed = isPreparationAllowed(base.reasonCode) && (override.reasonCode
    ? isPreparationAllowed(override.reasonCode)
    : true);

  const allowedCampaignTypes = [
    ...base.allowedCampaignTypes,
    ...override.contributesCampaignTypes.filter((t) => !base.allowedCampaignTypes.includes(t)),
  ];

  return {
    decision,
    route,
    allowedCampaignTypes,
    allowedOutreachModes,
    preparationAllowed,
    reasonCode,
  };
}
