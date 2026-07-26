import type {
  CandidateIntelligenceInput,
  CandidateRequirementInput,
} from './wizmatchCandidateIntelligence';
import { rankCandidatesForRequirement } from './wizmatchCandidateIntelligence';

export type RequirementPriority = 'hot' | 'warm' | 'watch' | 'blocked';

export interface RequirementPriorityInput extends CandidateRequirementInput {
  candidateMatches?: CandidateIntelligenceInput[];
  signalCount?: number | null;
  contactApprovedCount?: number | null;
  contactBlockedCount?: number | null;
  domainStatus?: string | null;
  hasSuppression?: boolean | null;
  /** Client company qualification tier (A | B | C | Reject) from wizmatch_company_intelligence. */
  companyTier?: string | null;
}

export interface RequirementPriorityResult {
  id: string;
  title: string;
  companyName: string | null;
  region: 'india' | 'us';
  priority: RequirementPriority;
  score: number;
  status: string | null;
  componentScores: {
    urgency: number;
    indiaFirst: number;
    candidateCoverage: number;
    contactReadiness: number;
    requirementQuality: number;
    safety: number;
    accountQuality: number;
  };
  topCandidateMatches: Array<{
    candidateId: string;
    name: string;
    score: number;
    priority: string;
    reasons: string[];
  }>;
  nextAction: 'review_candidates' | 'approve_contact' | 'complete_requirement' | 'watch' | 'blocked';
  reasons: string[];
  blockers: string[];
  /** D-31 — set only by the *WithPolicy wrappers below; display-only canonical metadata. */
  canonicalDecision?: 'allow' | 'review' | 'deny';
  canonicalReasonCode?: string | null;
  canonicalBlockerCode?: string | null;
}

export const REQUIREMENT_PRIORITY_GUARDRAILS = {
  sending: 'manual_review_only',
  submissions: 'no_automatic_submission',
  paidEnrichment: 'disabled',
  deterministicBeforeAi: true,
  scope: 'internal_it_tech_staffing_only',
} as const;

function clamp(value: number, max = 100) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function detectRegion(requirement: CandidateRequirementInput): 'india' | 'us' {
  if (requirement.region === 'india' || requirement.region === 'us') return requirement.region;
  const text = [requirement.location, requirement.title].filter(Boolean).join(' ').toLowerCase();
  return /india|bangalore|bengaluru|hyderabad|pune|chennai|mumbai|delhi|noida|gurgaon|gurugram/.test(text)
    ? 'india'
    : 'us';
}

function priorityFor(score: number, blockers: string[]): RequirementPriority {
  if (blockers.length > 0 || score < 45) return 'blocked';
  if (score >= 82) return 'hot';
  if (score >= 65) return 'warm';
  return 'watch';
}

function nextActionFor(
  priority: RequirementPriority,
  matchCount: number,
  contactApprovedCount: number,
): RequirementPriorityResult['nextAction'] {
  if (priority === 'blocked') return 'blocked';
  if (matchCount > 0) return 'review_candidates';
  if (contactApprovedCount <= 0) return 'approve_contact';
  return priority === 'watch' ? 'watch' : 'complete_requirement';
}

export function scoreRequirementPriority(input: RequirementPriorityInput): RequirementPriorityResult {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const region = detectRegion(input);
  const candidateMatches = input.candidateMatches ?? [];
  const rankedCandidates = rankCandidatesForRequirement(input, candidateMatches).slice(0, 3);
  const hasSkills = (input.requiredSkills ?? []).length > 0;

  if (input.status === 'closed') blockers.push('closed_requirement');
  if (!hasSkills) blockers.push('missing_required_skills');
  if (input.hasSuppression) blockers.push('suppression_risk');
  if (['paused', 'blacklisted'].includes(input.domainStatus ?? '')) blockers.push('unsafe_domain');

  const urgency = (() => {
    if (input.priority === 'urgent') {
      reasons.push('Urgent requirement.');
      return 20;
    }
    if (input.priority === 'high') {
      reasons.push('High-priority requirement.');
      return 15;
    }
    return input.priority === 'low' ? 5 : 10;
  })();

  const indiaFirst = (() => {
    if (region === 'india') {
      reasons.push('India-first priority applies.');
      return 15;
    }
    return 8;
  })();

  const candidateCoverage = (() => {
    if (rankedCandidates.some((candidate) => candidate.score >= 85)) {
      reasons.push('Hot candidate match exists.');
      return 25;
    }
    if (rankedCandidates.length >= 2) {
      reasons.push('Multiple candidate matches exist.');
      return 18;
    }
    if (rankedCandidates.length === 1) {
      reasons.push('One candidate match exists.');
      return 12;
    }
    return 0;
  })();

  const contactReadiness = (() => {
    const approved = input.contactApprovedCount ?? 0;
    const blocked = input.contactBlockedCount ?? 0;
    if (approved > 0) {
      reasons.push('Approved contact path exists.');
      return 15;
    }
    if (blocked > 0) {
      reasons.push('Contact path has blockers that need review.');
      return 5;
    }
    return 8;
  })();

  const requirementQuality = (() => {
    let score = 0;
    if (hasSkills) score += 7;
    if (input.location) score += 3;
    if (input.workMode) score += 3;
    if ((input.budgetMax ?? 0) > 0) score += 4;
    if (input.status === 'sheet_ready' || input.status === 'shared') {
      score += 3;
      reasons.push('Requirement sheet/review artifact is ready.');
    }
    return clamp(score, 15);
  })();

  const safety = (() => {
    if (blockers.some((block) => ['suppression_risk', 'unsafe_domain'].includes(block))) return 0;
    return 10;
  })();

  const accountQuality = (() => {
    switch (input.companyTier) {
      case 'A':
        reasons.push('Tier A client account.');
        return 15;
      case 'B':
        reasons.push('Tier B client account.');
        return 8;
      case 'C':
        reasons.push('Tier C client account.');
        return 3;
      case 'Reject':
        reasons.push('Client account is Reject-tier.');
        return 0;
      default:
        return 0;
    }
  })();

  for (const blocker of blockers) {
    if (blocker === 'closed_requirement') reasons.push('Blocked: requirement is closed.');
    if (blocker === 'missing_required_skills') reasons.push('Blocked: required skills are missing.');
    if (blocker === 'suppression_risk') reasons.push('Blocked: suppression risk exists.');
    if (blocker === 'unsafe_domain') reasons.push(`Blocked: domain health is ${input.domainStatus}.`);
  }

  const rawScore =
    urgency + indiaFirst + candidateCoverage + contactReadiness + requirementQuality + safety + accountQuality;
  const score = blockers.length > 0 ? Math.min(clamp(rawScore), 44) : clamp(rawScore);
  const priority = priorityFor(score, blockers);

  return {
    id: input.id,
    title: input.title,
    companyName: input.companyName ?? null,
    region,
    priority,
    score,
    status: input.status ?? null,
    componentScores: {
      urgency,
      indiaFirst,
      candidateCoverage,
      contactReadiness,
      requirementQuality,
      safety,
      accountQuality,
    },
    topCandidateMatches: rankedCandidates.map((candidate) => ({
      candidateId: candidate.id,
      name: candidate.name,
      score: candidate.score,
      priority: candidate.priority,
      reasons: candidate.reasons.slice(0, 3),
    })),
    nextAction: nextActionFor(priority, rankedCandidates.length, input.contactApprovedCount ?? 0),
    reasons,
    blockers,
  };
}

export function rankRequirementPriorityQueue(inputs: RequirementPriorityInput[]) {
  return inputs
    .map(scoreRequirementPriority)
    .sort((a, b) => b.score - a.score || b.topCandidateMatches.length - a.topCandidateMatches.length);
}

// PRD-005 §11.3 / ADR-006 D-13 — this is one of the five legacy eligibility
// computations named in PRD-005 §5.2 C-2. Its local `accountQuality`
// component previously read only `companyTier`, an indirect
// `wizmatch_company_intelligence`-derived legacy value with no canonical
// backstop. These wrappers fold the canonical resolver's decision on top via
// src/modules/outreach/legacyEligibilityAdapter.ts whenever a `companyId` is
// present on the input (requirements are company-scoped via
// `wizmatch_requirements.company_id`, so this is the normal case — see
// `fetchCandidateIntelligenceRequirements` in src/routes/wizmatch.ts). A
// canonical DENY always forces `priority: 'blocked'` regardless of local
// score; a canonical REVIEW caps `hot`/`warm` to `watch`.
/**
 * H-2 fix: `evaluateWizmatchOutreachGate` denies without a `companyId`
 * (§8.10 rule 5, fail-closed). `wizmatch_requirements.company_id` is
 * nullable (the masked-client case), and the prior code returned the local
 * score unchanged in that case — a fail-**open**, since a company-scoped
 * gate cannot even be asked and the requirement was allowed through anyway.
 * Mirrors `wizmatchClientDiscovery.ts`'s `missing_company` hard block: no
 * `companyId` is itself a blocker, forcing `blocked`/`nextAction: 'blocked'`
 * regardless of local score.
 *
 * RESIDUAL-C1 fix (2026-07-26 re-review): H-2's first fix applied that block
 * **unconditionally**, ignoring enforcement mode — so a masked-client
 * requirement (`company_id IS NULL`) became `priority: 'blocked'` and 409'd
 * on `POST /requirement-priority/:id/review-plan` while the shipped default
 * mode is `shadow`. That is the same defect class as C-1 (a canonical
 * decision changing behaviour in shadow), reintroduced through the one path
 * that never reaches `resolveCompanyStatus`/`actsOnDecision`. Unlike
 * `wizmatchClientDiscovery.ts`, whose `missing_company` block predates this
 * stack and is therefore legacy behaviour, this block is new in PR 5 and so
 * must obey D-31: canonical metadata is always attached for display; the
 * behavioural output (`priority`/`nextAction`/`blockers`) only changes under
 * the exact string `enforce`.
 */
function withMissingCompanyBlocker(scored: RequirementPriorityResult): RequirementPriorityResult {
  // D-31: always visible, never behavioural in shadow. There is no canonical
  // decision to quote here (the gate is company-scoped and cannot be asked
  // without a company), so the fail-closed intent is reported directly.
  const withMetadata: RequirementPriorityResult = {
    ...scored,
    canonicalDecision: 'deny',
    canonicalReasonCode: 'missing_company',
    canonicalBlockerCode: 'policy_missing_company',
  };
  if (!isEnforcementActive()) return withMetadata;
  if (scored.blockers.includes('missing_company')) return withMetadata;
  return {
    ...withMetadata,
    priority: 'blocked',
    blockers: [...scored.blockers, 'missing_company'],
    nextAction: 'blocked',
  };
}

export async function scoreRequirementPriorityWithPolicy(
  tenantId: string,
  input: RequirementPriorityInput,
): Promise<RequirementPriorityResult> {
  const scored = scoreRequirementPriority(input);
  if (!input.companyId) return withMissingCompanyBlocker(scored);
  const canonical = await resolveCanonicalCompanyEligibility(tenantId, input.companyId);
  return applyCanonicalEligibilityToPriorityResult(scored, canonical);
}

export async function rankRequirementPriorityQueueWithPolicy(
  tenantId: string,
  inputs: RequirementPriorityInput[],
): Promise<RequirementPriorityResult[]> {
  const scored = inputs.map(scoreRequirementPriority);
  const canonicalByCompanyId = await resolveCanonicalCompanyEligibilityBatch(
    tenantId,
    inputs.map((i) => i.companyId),
  );
  return scored
    .map((result, idx) => {
      const companyId = inputs[idx]?.companyId;
      if (!companyId) return withMissingCompanyBlocker(result);
      const canonical = canonicalByCompanyId.get(companyId);
      return canonical ? applyCanonicalEligibilityToPriorityResult(result, canonical) : result;
    })
    .sort((a, b) => b.score - a.score || b.topCandidateMatches.length - a.topCandidateMatches.length);
}

import {
  resolveCanonicalCompanyEligibility,
  resolveCanonicalCompanyEligibilityBatch,
  applyCanonicalEligibilityToPriorityResult,
} from '../modules/outreach/legacyEligibilityAdapter';
import { isEnforcementActive } from '../modules/outreach/outreachGate';
