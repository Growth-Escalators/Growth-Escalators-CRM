export type CandidateIntelligenceRegion = 'india' | 'us';
export type CandidateIntelligencePriority = 'hot' | 'warm' | 'watch' | 'blocked';

export interface CandidateRequirementInput {
  id: string;
  title: string;
  companyName?: string | null;
  requiredSkills?: string[] | null;
  location?: string | null;
  region?: string | null;
  workMode?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetCurrency?: string | null;
  priority?: string | null;
  status?: string | null;
}

export interface CandidateSignalInput {
  id: string;
  jobTitle: string;
  companyName?: string | null;
  keywords?: string[] | null;
  location?: string | null;
  score?: number | null;
  status?: string | null;
}

export interface CandidateIntelligenceInput {
  id: string;
  contactId?: string | null;
  name: string;
  skills: string[];
  location?: string | null;
  visaStatus?: string | null;
  rateHourly?: number | null;
  rateCurrency?: string | null;
  availabilityDate?: string | null;
  availabilityStatus?: string | null;
  source?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  resumeUrl?: string | null;
  isWizmatchCertified?: boolean | null;
  hasUsableContactChannel?: boolean | null;
  doNotContact?: boolean | null;
  suppressed?: boolean | null;
  activePlacementCount?: number | null;
  activeSubmissionCount?: number | null;
  priorPlacementCount?: number | null;
  requirements?: CandidateRequirementInput[];
  signals?: CandidateSignalInput[];
}

export interface CandidateRequirementMatch {
  requirementId: string;
  title: string;
  companyName: string | null;
  score: number;
  priority: CandidateIntelligencePriority;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
}

export interface CandidateIntelligenceResult {
  id: string;
  contactId: string | null;
  name: string;
  skills: string[];
  location: string | null;
  region: CandidateIntelligenceRegion;
  availabilityStatus: string | null;
  score: number;
  priority: CandidateIntelligencePriority;
  bestUse: string;
  componentScores: {
    skillFit: number;
    availability: number;
    regionWorkModeFit: number;
    rateBudgetFit: number;
    profileQuality: number;
    relationshipOutcome: number;
    riskControls: number;
  };
  topRequirementMatches: CandidateRequirementMatch[];
  reasons: string[];
  concerns: string[];
  blockers: string[];
}

export const CANDIDATE_INTELLIGENCE_GUARDRAILS = {
  sending: 'manual_review_only',
  submissions: 'no_automatic_submission',
  paidEnrichment: 'disabled',
  sourceMode: 'existing_tables_first',
  scope: 'internal_it_tech_staffing_only',
} as const;

const INDIA_MARKERS = [
  'india',
  'bangalore',
  'bengaluru',
  'hyderabad',
  'pune',
  'chennai',
  'mumbai',
  'delhi',
  'gurgaon',
  'gurugram',
  'noida',
  'kolkata',
  'ahmedabad',
  'kochi',
  'coimbatore',
  'indore',
  'chandigarh',
  'jaipur',
];

const TECH_TERMS = [
  'software',
  'developer',
  'engineer',
  'frontend',
  'backend',
  'fullstack',
  'full stack',
  'devops',
  'cloud',
  'data',
  'java',
  'python',
  'react',
  'node',
  'qa',
  'automation',
  'security',
  'salesforce',
  'servicenow',
  'sap',
  'ai',
  'ml',
  'product',
  'platform',
  'aws',
  'azure',
  'kubernetes',
  'microservices',
];

function clamp(score: number, max = 100) {
  return Math.max(0, Math.min(max, Math.round(score)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#. ]/g, ' ').trim();
}

function includesAny(value: string, terms: string[]) {
  const lower = normalize(value);
  return terms.some((term) => lower.includes(term));
}

function regionFromText(...values: Array<string | null | undefined>): CandidateIntelligenceRegion {
  const combined = values.filter(Boolean).join(' ');
  return includesAny(combined, INDIA_MARKERS) ? 'india' : 'us';
}

function priorityFor(score: number, blockers: string[]): CandidateIntelligencePriority {
  if (blockers.length > 0 || score < 50) return 'blocked';
  if (score >= 85) return 'hot';
  if (score >= 70) return 'warm';
  return 'watch';
}

function uniqueTerms(values: Array<string | null | undefined>) {
  return Array.from(new Set(
    values
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9+#. ]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1),
  ));
}

function skillOverlap(candidateSkills: string[], demandTerms: string[]) {
  const skills = candidateSkills.map(normalize).filter(Boolean);
  const terms = demandTerms.map(normalize).filter(Boolean);
  return skills.filter((skill) => terms.some((term) => skill.includes(term) || term.includes(skill)));
}

export function detectCandidateHardBlocks(input: CandidateIntelligenceInput): string[] {
  const blockers: string[] = [];
  if (input.doNotContact || input.suppressed) blockers.push('do_not_contact_or_suppressed');
  if ((input.activePlacementCount ?? 0) > 0 || input.availabilityStatus === 'placed') blockers.push('already_placed');
  if ((input.activeSubmissionCount ?? 0) > 0 || input.availabilityStatus === 'submitted') blockers.push('duplicate_submission_risk');
  if (!input.hasUsableContactChannel) blockers.push('missing_contact_channel');
  if (!input.skills.length || !includesAny(input.skills.join(' '), TECH_TERMS)) blockers.push('non_tech_or_unknown_profile');
  return blockers;
}

export function rankRequirementsForCandidate(
  candidate: Pick<CandidateIntelligenceInput, 'skills' | 'location' | 'rateHourly' | 'rateCurrency'>,
  requirements: CandidateRequirementInput[],
): CandidateRequirementMatch[] {
  return requirements.map((requirement) => {
    const requiredSkills = requirement.requiredSkills ?? [];
    const matchedSkills = skillOverlap(candidate.skills, requiredSkills);
    const missingSkills = requiredSkills.filter((skill) =>
      !matchedSkills.some((matched) => normalize(matched) === normalize(skill)),
    );
    const reasons: string[] = [];
    let score = 0;

    if (requiredSkills.length > 0) {
      const pct = matchedSkills.length / requiredSkills.length;
      score += Math.round(pct * 45);
      if (pct >= 0.75) reasons.push('Strong required-skill overlap.');
      else if (pct > 0) reasons.push('Partial required-skill overlap.');
    }
    const candidateRegion = regionFromText(candidate.location);
    const requirementRegion = requirement.region === 'india' || requirement.region === 'us'
      ? requirement.region
      : regionFromText(requirement.location);
    if (candidateRegion === requirementRegion) {
      score += 20;
      reasons.push('Candidate region matches requirement.');
    } else if (requirement.workMode === 'remote') {
      score += 12;
      reasons.push('Remote work mode softens region mismatch.');
    }
    if (requirement.priority === 'urgent') score += 15;
    else if (requirement.priority === 'high') score += 10;
    if ((requirement.budgetMax ?? 0) > 0 && (candidate.rateHourly ?? 0) > 0) {
      const budgetMax = requirement.budgetMax ?? 0;
      const rate = candidate.rateHourly ?? 0;
      if (rate <= budgetMax) {
        score += 12;
        reasons.push('Candidate rate fits captured budget.');
      } else {
        score += 4;
      }
    } else {
      score += 6;
    }
    if (requirement.status === 'sheet_ready' || requirement.status === 'shared') score += 8;

    const finalScore = clamp(score);
    return {
      requirementId: requirement.id,
      title: requirement.title,
      companyName: requirement.companyName ?? null,
      score: finalScore,
      priority: priorityFor(finalScore, []),
      matchedSkills,
      missingSkills,
      reasons,
    };
  }).sort((a, b) => b.score - a.score);
}

export function scoreCandidateIntelligence(input: CandidateIntelligenceInput): CandidateIntelligenceResult {
  const reasons: string[] = [];
  const concerns: string[] = [];
  const blockers = detectCandidateHardBlocks(input);
  const region = regionFromText(input.location);
  const demandTerms = uniqueTerms([
    ...(input.requirements ?? []).flatMap((req) => req.requiredSkills ?? []),
    ...(input.requirements ?? []).map((req) => req.title),
    ...(input.signals ?? []).flatMap((signal) => [signal.jobTitle, ...(signal.keywords ?? [])]),
  ]);
  const overlap = skillOverlap(input.skills, demandTerms.length > 0 ? demandTerms : TECH_TERMS);

  const skillFit = (() => {
    if (blockers.includes('non_tech_or_unknown_profile')) return 0;
    if (overlap.length >= 4) {
      reasons.push('Strong skill overlap with active demand.');
      return 30;
    }
    if (overlap.length >= 2) {
      reasons.push('Useful skill overlap with active demand.');
      return 22;
    }
    if (overlap.length > 0) {
      reasons.push('Some skill relevance found.');
      return 14;
    }
    concerns.push('No clear overlap with current demand terms.');
    return 5;
  })();

  const availability = (() => {
    if (['placed', 'submitted'].includes(input.availabilityStatus ?? '')) return 0;
    if (input.availabilityStatus === 'available' || input.availabilityStatus === 'benched') {
      reasons.push('Candidate is available for review.');
      return 20;
    }
    if (input.availabilityDate) {
      reasons.push('Candidate has an availability date.');
      return 12;
    }
    concerns.push(`Availability is ${input.availabilityStatus || 'unknown'}.`);
    return 6;
  })();

  const regionWorkModeFit = (() => {
    if (region === 'india') {
      reasons.push('India candidate supply priority applies.');
      return 15;
    }
    return 8;
  })();

  const rateBudgetFit = (() => {
    if (!input.rateHourly || input.rateHourly <= 0) {
      concerns.push('Rate is not captured.');
      return 3;
    }
    const matchingBudgets = (input.requirements ?? []).filter((req) => (req.budgetMax ?? 0) > 0);
    if (matchingBudgets.some((req) => input.rateHourly! <= (req.budgetMax ?? 0))) {
      reasons.push('Rate fits at least one active requirement budget.');
      return 10;
    }
    reasons.push(`Rate is captured (${input.rateCurrency === 'INR' ? 'INR' : 'USD'} ${input.rateHourly}/hr).`);
    return 7;
  })();

  const profileQuality = (() => {
    let score = 0;
    if (input.hasUsableContactChannel) score += 4;
    if (input.resumeUrl || input.linkedinUrl || input.githubUrl) score += 3;
    if (input.source && ['naukri', 'bench_network', 'referral', 'manual', 'xray', 'github'].includes(input.source)) score += 2;
    if (input.isWizmatchCertified) score += 1;
    if (score >= 7) reasons.push('Candidate profile has usable channels and source detail.');
    return clamp(score, 10);
  })();

  const relationshipOutcome = (() => {
    let score = 0;
    if (input.isWizmatchCertified) {
      score += 4;
      reasons.push('Wizmatch certified candidate.');
    }
    if ((input.priorPlacementCount ?? 0) > 0) {
      score += 6;
      reasons.push('Prior placement/outcome history exists.');
    }
    return clamp(score, 10);
  })();

  const riskControls = (() => {
    if (blockers.length > 0) return 0;
    if ((input.activeSubmissionCount ?? 0) > 0) return 1;
    return 5;
  })();

  for (const block of blockers) {
    if (block === 'do_not_contact_or_suppressed') concerns.push('Blocked by do-not-contact or suppression state.');
    if (block === 'already_placed') concerns.push('Blocked because candidate is already placed.');
    if (block === 'duplicate_submission_risk') concerns.push('Blocked by active submission/duplicate risk.');
    if (block === 'missing_contact_channel') concerns.push('Blocked because no usable contact channel exists.');
    if (block === 'non_tech_or_unknown_profile') concerns.push('Blocked because profile is not clearly IT/Tech.');
  }

  const topRequirementMatches = rankRequirementsForCandidate(input, input.requirements ?? []).slice(0, 3);
  const rawScore = skillFit + availability + regionWorkModeFit + rateBudgetFit + profileQuality + relationshipOutcome + riskControls;
  const score = blockers.length > 0 ? Math.min(clamp(rawScore), 49) : clamp(rawScore);
  const priority = priorityFor(score, blockers);

  return {
    id: input.id,
    contactId: input.contactId ?? null,
    name: input.name,
    skills: input.skills,
    location: input.location ?? null,
    region,
    availabilityStatus: input.availabilityStatus ?? null,
    score,
    priority,
    bestUse: topRequirementMatches[0]?.title || overlap.slice(0, 3).join(', ') || input.skills.slice(0, 3).join(', ') || 'Manual review',
    componentScores: {
      skillFit,
      availability,
      regionWorkModeFit,
      rateBudgetFit,
      profileQuality,
      relationshipOutcome,
      riskControls,
    },
    topRequirementMatches,
    reasons,
    concerns,
    blockers,
  };
}

export function rankCandidateIntelligenceQueue(inputs: CandidateIntelligenceInput[]): CandidateIntelligenceResult[] {
  return inputs.map(scoreCandidateIntelligence).sort((a, b) => b.score - a.score);
}

export function rankCandidatesForRequirement(
  requirement: CandidateRequirementInput,
  candidates: CandidateIntelligenceInput[],
): CandidateIntelligenceResult[] {
  return candidates
    .map((candidate) => scoreCandidateIntelligence({ ...candidate, requirements: [requirement] }))
    .sort((a, b) => b.score - a.score);
}
