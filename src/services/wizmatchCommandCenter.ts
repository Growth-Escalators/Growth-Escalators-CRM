import {
  CONTACT_INTELLIGENCE_PHASE1_CAPS,
  type ContactIntelligenceResult,
} from './wizmatchContactIntelligence';

export type WizmatchRegion = 'india' | 'us';
export type CommandPriority = 'hot' | 'warm' | 'watch' | 'blocked';
export type CommandActionType =
  | 'review_contact'
  | 'review_match'
  | 'review_requirement'
  | 'review_candidate'
  | 'resolve_safety'
  | 'monitor';

export interface CommandCenterSignalInput {
  id: string;
  jobTitle: string;
  companyId?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyIndustry?: string | null;
  companyCountry?: string | null;
  isPrime?: boolean | null;
  source?: string | null;
  location?: string | null;
  status?: string | null;
  score?: number | null;
  daysOpen?: number | null;
  matchedCandidateCount?: number | null;
  domainStatus?: string | null;
  suppressedCount?: number | null;
}

export interface CommandCenterCandidateInput {
  id: string;
  name: string;
  skills: string[];
  location?: string | null;
  visaStatus?: string | null;
  rateHourly?: number | null;
  rateCurrency?: string | null;
  availabilityStatus?: string | null;
  source?: string | null;
  isWizmatchCertified?: boolean | null;
}

export interface CommandCenterRequirementInput {
  id: string;
  title: string;
  companyName?: string | null;
  requiredSkills?: string[] | null;
  location?: string | null;
  region?: string | null;
  priority?: string | null;
  positions?: number | null;
  status?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetCurrency?: string | null;
}

export interface CommandCenterMetricsInput {
  activeSignals: number;
  prioritySignals: number;
  availableCandidates: number;
  openRequirements: number;
  reviewReadyCompanies: number;
  blockedCompanies: number;
  activePlacements: number;
  pausedDomains: number;
  suppressedContacts: number;
}

export interface ScoredClientOpportunity {
  id: string;
  companyId: string | null;
  companyName: string;
  companyDomain: string | null;
  jobTitle: string;
  region: WizmatchRegion;
  source: string | null;
  status: string | null;
  score: number;
  priority: CommandPriority;
  matchedCandidateCount: number;
  reasons: string[];
  blockers: string[];
}

export interface ScoredCandidateIntelligence {
  id: string;
  name: string;
  skills: string[];
  location: string | null;
  availabilityStatus: string | null;
  score: number;
  priority: CommandPriority;
  bestUse: string;
  reasons: string[];
  concerns: string[];
}

export interface ScoredRequirement {
  id: string;
  title: string;
  companyName: string | null;
  region: WizmatchRegion;
  priority: CommandPriority;
  score: number;
  requiredSkills: string[];
  positions: number;
  status: string | null;
  reasons: string[];
}

export interface CommandQueueItem {
  id: string;
  actionType: CommandActionType;
  title: string;
  subtitle: string;
  score: number;
  priority: CommandPriority;
  module: string;
  reasons: string[];
}

export interface WizmatchCommandCenterResult {
  generatedAt: string;
  phase: 'phase_1_command_center_read_only';
  costControls: typeof CONTACT_INTELLIGENCE_PHASE1_CAPS;
  guardrails: {
    paidEnrichment: 'disabled';
    sending: 'manual_review_only';
    writes: 'disabled_for_command_center';
    schemaChanges: 'none';
  };
  metrics: CommandCenterMetricsInput;
  moduleHealth: Array<{
    module: string;
    status: 'live' | 'planning' | 'blocked';
    summary: string;
    priority: CommandPriority;
  }>;
  clientDiscovery: ScoredClientOpportunity[];
  contactIntelligence: ContactIntelligenceResult[];
  candidateIntelligence: ScoredCandidateIntelligence[];
  requirements: ScoredRequirement[];
  commandQueue: CommandQueueItem[];
}

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
];

const TECH_TERMS = [
  'software',
  'developer',
  'engineer',
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
];

const NON_TECH_TERMS = [
  'payroll',
  'attendance',
  'hrms',
  'warehouse',
  'driver',
  'hospitality',
  'retail',
  'nurse',
  'doctor',
  'construction',
];

function clamp(score: number, max = 100) {
  return Math.max(0, Math.min(max, Math.round(score)));
}

function includesAny(value: string, terms: string[]) {
  const lower = value.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function regionFromText(...values: Array<string | null | undefined>): WizmatchRegion {
  const combined = values.filter(Boolean).join(' ');
  return includesAny(combined, INDIA_MARKERS) ? 'india' : 'us';
}

function priorityFor(score: number, blockers: string[] = []): CommandPriority {
  if (blockers.length > 0) return 'blocked';
  if (score >= 80) return 'hot';
  if (score >= 60) return 'warm';
  return 'watch';
}

function skillTerms(values: Array<string | null | undefined>) {
  const words = values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
  return Array.from(new Set(words));
}

export function scoreClientDiscoveryOpportunity(signal: CommandCenterSignalInput): ScoredClientOpportunity {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const region = regionFromText(signal.location, signal.companyCountry, signal.source);
  const combined = [
    signal.jobTitle,
    signal.companyIndustry,
    signal.companyName,
    signal.location,
  ].filter(Boolean).join(' ');

  if (includesAny(combined, NON_TECH_TERMS)) {
    blockers.push('non_tech_signal');
    reasons.push('Rejected from pursuit: non-tech/HRMS/payroll/attendance language found.');
  }
  if ((signal.suppressedCount ?? 0) > 0) {
    blockers.push('suppressed_domain');
    reasons.push('Suppression history blocks automated pursuit.');
  }
  if (['paused', 'blacklisted'].includes(signal.domainStatus ?? '')) {
    blockers.push('unsafe_domain');
    reasons.push(`Domain health is ${signal.domainStatus}.`);
  }

  let score = 0;
  if (includesAny(combined, TECH_TERMS)) {
    score += 25;
    reasons.push('IT/Tech signal detected.');
  }
  const signalScore = signal.score ?? 0;
  if (signalScore >= 8) {
    score += 25;
    reasons.push('Existing Wizmatch signal score is high.');
  } else if (signalScore >= 6) {
    score += 18;
    reasons.push('Existing Wizmatch signal score is usable.');
  } else if (signalScore > 0) {
    score += 8;
  }
  if (region === 'india') {
    score += 15;
    reasons.push('India-first priority applies.');
  } else if (signalScore >= 8 || signal.isPrime) {
    score += 10;
    reasons.push('US opportunity kept because high-value evidence exists.');
  } else {
    score += 5;
  }
  const matched = signal.matchedCandidateCount ?? 0;
  if (matched >= 3) {
    score += 20;
    reasons.push('Strong candidate supply exists.');
  } else if (matched >= 1) {
    score += 12;
    reasons.push('Some candidate supply exists.');
  }
  if (signal.isPrime) {
    score += 10;
    reasons.push('Prime/vendor relationship memory exists.');
  }
  if ((signal.daysOpen ?? 0) <= 21) {
    score += 5;
  }

  const finalScore = blockers.length ? Math.min(clamp(score), 39) : clamp(score);
  return {
    id: signal.id,
    companyId: signal.companyId ?? null,
    companyName: signal.companyName ?? 'Unknown company',
    companyDomain: signal.companyDomain ?? null,
    jobTitle: signal.jobTitle,
    region,
    source: signal.source ?? null,
    status: signal.status ?? null,
    score: finalScore,
    priority: priorityFor(finalScore, blockers),
    matchedCandidateCount: matched,
    reasons,
    blockers,
  };
}

export function scoreCandidateIntelligence(
  candidate: CommandCenterCandidateInput,
  focusTerms: string[] = [],
): ScoredCandidateIntelligence {
  const reasons: string[] = [];
  const concerns: string[] = [];
  const skillsLower = candidate.skills.map((skill) => skill.toLowerCase());
  const focusLower = focusTerms.map((term) => term.toLowerCase());
  const overlap = focusLower.length > 0
    ? skillsLower.filter((skill) => focusLower.some((term) => skill.includes(term) || term.includes(skill)))
    : skillsLower.filter((skill) => TECH_TERMS.some((term) => skill.includes(term)));

  let score = 0;
  if (overlap.length >= 4) {
    score += 35;
    reasons.push('Strong skill overlap with active Wizmatch demand.');
  } else if (overlap.length >= 2) {
    score += 25;
    reasons.push('Useful skill overlap with current demand.');
  } else if (overlap.length > 0) {
    score += 15;
    reasons.push('Some skill relevance found.');
  } else {
    concerns.push('No clear overlap with current focus terms.');
  }

  const region = regionFromText(candidate.location);
  if (region === 'india') {
    score += 20;
    reasons.push('India candidate supply priority.');
  } else {
    score += 10;
  }
  if (candidate.availabilityStatus === 'available') {
    score += 20;
    reasons.push('Candidate is marked available.');
  } else {
    concerns.push(`Availability is ${candidate.availabilityStatus || 'unknown'}.`);
  }
  if (candidate.isWizmatchCertified) {
    score += 10;
    reasons.push('Wizmatch certified.');
  }
  if (candidate.rateHourly && candidate.rateHourly > 0) {
    score += 8;
    reasons.push(`Rate known (${candidate.rateCurrency === 'INR' ? 'INR' : 'USD'} ${candidate.rateHourly}/hr).`);
  }
  if (candidate.source && ['naukri', 'bench_network', 'referral', 'manual'].includes(candidate.source)) {
    score += 7;
    reasons.push(`Trusted source: ${candidate.source}.`);
  }

  const finalScore = clamp(score);
  return {
    id: candidate.id,
    name: candidate.name,
    skills: candidate.skills,
    location: candidate.location ?? null,
    availabilityStatus: candidate.availabilityStatus ?? null,
    score: finalScore,
    priority: priorityFor(finalScore),
    bestUse: overlap.slice(0, 3).join(', ') || candidate.skills.slice(0, 3).join(', ') || 'Manual review',
    reasons,
    concerns,
  };
}

export function scoreRequirement(requirement: CommandCenterRequirementInput): ScoredRequirement {
  const reasons: string[] = [];
  const region = requirement.region === 'india' || requirement.region === 'us'
    ? requirement.region
    : regionFromText(requirement.location);
  let score = 0;
  if (region === 'india') {
    score += 20;
    reasons.push('India requirement priority.');
  } else {
    score += 10;
  }
  if (requirement.priority === 'urgent') {
    score += 25;
    reasons.push('Urgent requirement.');
  } else if (requirement.priority === 'high') {
    score += 18;
    reasons.push('High-priority requirement.');
  } else {
    score += 8;
  }
  const requiredSkills = requirement.requiredSkills ?? [];
  if (requiredSkills.length >= 4) {
    score += 20;
    reasons.push('Clear skill definition.');
  } else if (requiredSkills.length > 0) {
    score += 12;
  }
  if ((requirement.positions ?? 1) >= 2) {
    score += 15;
    reasons.push('Multiple positions available.');
  } else {
    score += 8;
  }
  if ((requirement.budgetMax ?? 0) > 0 || (requirement.budgetMin ?? 0) > 0) {
    score += 10;
    reasons.push('Budget is captured.');
  }
  if (requirement.status === 'sheet_ready' || requirement.status === 'shared') {
    score += 10;
    reasons.push('Requirement sheet workflow is already moving.');
  }

  const finalScore = clamp(score);
  return {
    id: requirement.id,
    title: requirement.title,
    companyName: requirement.companyName ?? null,
    region,
    priority: priorityFor(finalScore),
    score: finalScore,
    requiredSkills,
    positions: requirement.positions ?? 1,
    status: requirement.status ?? null,
    reasons,
  };
}

function moduleHealthFor(metrics: CommandCenterMetricsInput): WizmatchCommandCenterResult['moduleHealth'] {
  return [
    {
      module: 'Client Discovery / Company Signals',
      status: metrics.activeSignals > 0 ? 'live' : 'planning',
      priority: metrics.prioritySignals > 0 ? 'hot' : 'warm',
      summary: `${metrics.activeSignals} active signals, ${metrics.prioritySignals} priority signals.`,
    },
    {
      module: 'Contact Intelligence',
      status: 'live',
      priority: metrics.reviewReadyCompanies > 0 ? 'hot' : 'warm',
      summary: `${metrics.reviewReadyCompanies} companies ready for manual contact review.`,
    },
    {
      module: 'Candidate Intelligence',
      status: metrics.availableCandidates > 0 ? 'live' : 'planning',
      priority: metrics.availableCandidates > 0 ? 'warm' : 'watch',
      summary: `${metrics.availableCandidates} available candidates in pool.`,
    },
    {
      module: 'Requirement Intake',
      status: metrics.openRequirements > 0 ? 'live' : 'planning',
      priority: metrics.openRequirements > 0 ? 'warm' : 'watch',
      summary: `${metrics.openRequirements} open requirements.`,
    },
    {
      module: 'Domain Health / Sending Safety',
      status: metrics.pausedDomains > 0 || metrics.suppressedContacts > 0 ? 'live' : 'planning',
      priority: metrics.pausedDomains > 0 ? 'blocked' : 'watch',
      summary: `${metrics.pausedDomains} paused/blacklisted domains, ${metrics.suppressedContacts} suppressions.`,
    },
  ];
}

function commandQueueFor(
  clients: ScoredClientOpportunity[],
  contacts: ContactIntelligenceResult[],
  candidates: ScoredCandidateIntelligence[],
  requirements: ScoredRequirement[],
): CommandQueueItem[] {
  const queue: CommandQueueItem[] = [];

  for (const item of contacts.slice(0, 5)) {
    if (item.hardBlocks.length > 0) {
      queue.push({
        id: `safety-${item.companyId}`,
        actionType: 'resolve_safety',
        title: `Resolve safety block: ${item.companyName}`,
        subtitle: item.hardBlocks.join(', '),
        score: item.qualificationScore,
        priority: 'blocked',
        module: 'Contact Intelligence',
        reasons: item.reasons.slice(0, 3),
      });
    } else if (item.qualificationTier === 'A' && item.contactCandidates.length > 0) {
      queue.push({
        id: `contact-${item.companyId}`,
        actionType: 'review_contact',
        title: `Review ${item.contactCandidates.length} contact(s): ${item.companyName}`,
        subtitle: `${item.targetRegion.toUpperCase()} · Tier ${item.qualificationTier} · ${item.qualificationScore}/100`,
        score: item.qualificationScore,
        priority: 'hot',
        module: 'Contact Intelligence',
        reasons: item.reasons.slice(0, 3),
      });
    }
  }

  for (const client of clients.slice(0, 5)) {
    if (client.priority === 'hot' || client.priority === 'blocked') {
      queue.push({
        id: `client-${client.id}`,
        actionType: client.priority === 'blocked' ? 'resolve_safety' : 'review_match',
        title: client.priority === 'blocked'
          ? `Blocked company signal: ${client.companyName}`
          : `Review match path: ${client.companyName}`,
        subtitle: `${client.jobTitle} · ${client.region.toUpperCase()} · ${client.matchedCandidateCount} candidate(s)`,
        score: client.score,
        priority: client.priority,
        module: 'Client Discovery',
        reasons: [...client.reasons, ...client.blockers].slice(0, 3),
      });
    }
  }

  for (const requirement of requirements.slice(0, 4)) {
    if (requirement.priority === 'hot' || requirement.priority === 'warm') {
      queue.push({
        id: `requirement-${requirement.id}`,
        actionType: 'review_requirement',
        title: `Fill requirement: ${requirement.title}`,
        subtitle: `${requirement.region.toUpperCase()} · ${requirement.positions} position(s)`,
        score: requirement.score,
        priority: requirement.priority,
        module: 'Requirement Intake',
        reasons: requirement.reasons.slice(0, 3),
      });
    }
  }

  for (const candidate of candidates.slice(0, 4)) {
    if (candidate.priority === 'hot') {
      queue.push({
        id: `candidate-${candidate.id}`,
        actionType: 'review_candidate',
        title: `Review candidate: ${candidate.name}`,
        subtitle: candidate.bestUse,
        score: candidate.score,
        priority: candidate.priority,
        module: 'Candidate Intelligence',
        reasons: candidate.reasons.slice(0, 3),
      });
    }
  }

  return queue
    .sort((a, b) => {
      const priorityWeight = { blocked: 4, hot: 3, warm: 2, watch: 1 };
      return priorityWeight[b.priority] - priorityWeight[a.priority] || b.score - a.score;
    })
    .slice(0, 12);
}

export function buildWizmatchCommandCenter(input: {
  metrics: CommandCenterMetricsInput;
  contactIntelligence: ContactIntelligenceResult[];
  signals: CommandCenterSignalInput[];
  candidates: CommandCenterCandidateInput[];
  requirements: CommandCenterRequirementInput[];
  generatedAt?: string;
}): WizmatchCommandCenterResult {
  const clientDiscovery = input.signals
    .map(scoreClientDiscoveryOpportunity)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const focusTerms = skillTerms([
    ...input.signals.slice(0, 20).map((signal) => signal.jobTitle),
    ...input.signals.slice(0, 20).flatMap((signal) => signal.location ? [signal.location] : []),
    ...input.requirements.slice(0, 20).flatMap((req) => req.requiredSkills ?? []),
  ]);

  const candidateIntelligence = input.candidates
    .map((candidate) => scoreCandidateIntelligence(candidate, focusTerms))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const requirements = input.requirements
    .map(scoreRequirement)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const contactIntelligence = input.contactIntelligence
    .slice()
    .sort((a, b) => b.qualificationScore - a.qualificationScore)
    .slice(0, 12);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    phase: 'phase_1_command_center_read_only',
    costControls: CONTACT_INTELLIGENCE_PHASE1_CAPS,
    guardrails: {
      paidEnrichment: 'disabled',
      sending: 'manual_review_only',
      writes: 'disabled_for_command_center',
      schemaChanges: 'none',
    },
    metrics: input.metrics,
    moduleHealth: moduleHealthFor(input.metrics),
    clientDiscovery,
    contactIntelligence,
    candidateIntelligence,
    requirements,
    commandQueue: commandQueueFor(clientDiscovery, contactIntelligence, candidateIntelligence, requirements),
  };
}
