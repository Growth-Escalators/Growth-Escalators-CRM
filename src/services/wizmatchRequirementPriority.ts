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

  for (const blocker of blockers) {
    if (blocker === 'closed_requirement') reasons.push('Blocked: requirement is closed.');
    if (blocker === 'missing_required_skills') reasons.push('Blocked: required skills are missing.');
    if (blocker === 'suppression_risk') reasons.push('Blocked: suppression risk exists.');
    if (blocker === 'unsafe_domain') reasons.push(`Blocked: domain health is ${input.domainStatus}.`);
  }

  const rawScore = urgency + indiaFirst + candidateCoverage + contactReadiness + requirementQuality + safety;
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
